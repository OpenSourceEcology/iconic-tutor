"""Studio's prepaid test-credit ledger and operator CLI. Amounts are integer micro-USD."""

import argparse
import hashlib
import hmac
import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from contextlib import closing, contextmanager
from decimal import Decimal, InvalidOperation
from http.cookies import CookieError, SimpleCookie
from uuid import UUID, uuid4

from studio_authoring import RequestError, connect, encoded, timestamp

MILLION = 1_000_000
OFFER_CENTS = 500
COOKIE = "studio_credit_session"
SESSION_AGE = 30 * 86400
SCHEMA = """
CREATE TABLE IF NOT EXISTS credit_accounts (
 id TEXT PRIMARY KEY, label TEXT NOT NULL, code_hash TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS credit_sessions (
 token_hash TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES credit_accounts(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS credit_purchases (
 id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES credit_accounts(id), request_id TEXT NOT NULL,
 amount INTEGER NOT NULL, session TEXT UNIQUE, url TEXT, state TEXT NOT NULL, at TEXT NOT NULL,
 UNIQUE(account,request_id));
CREATE TABLE IF NOT EXISTS credit_events (event TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS credit_grants (
 id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES credit_accounts(id), amount INTEGER NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS credit_calls (
 account TEXT NOT NULL REFERENCES credit_accounts(id), request_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
 model TEXT NOT NULL, state TEXT NOT NULL, reserve INTEGER NOT NULL, cost INTEGER,
 input_rate INTEGER NOT NULL, cached_rate INTEGER NOT NULL, output_rate INTEGER NOT NULL,
 input_tokens INTEGER, cached_tokens INTEGER, output_tokens INTEGER, provider_id TEXT,
 result TEXT, at TEXT NOT NULL, PRIMARY KEY(account,request_id));
"""


@contextmanager
def database(write=False):
    with closing(connect()) as db:
        db.executescript(SCHEMA)
        with db:
            db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield db


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def request_key(value):
    try:
        return str(UUID(value))
    except (ValueError, AttributeError, TypeError):
        raise RequestError("Provide a UUID request_id.")


def create_account(label):
    if not isinstance(label, str) or not 1 <= len(label.strip()) <= 100:
        raise RequestError("Use an account label of 1–100 characters.")
    code, account = secrets.token_urlsafe(32), str(uuid4())
    with database(True) as db:
        db.execute("INSERT INTO credit_accounts VALUES(?,?,?)", (account, label.strip(), digest(code)))
    return account, code


def rotate_code(account):
    code = secrets.token_urlsafe(32)
    with database(True) as db:
        changed = db.execute("UPDATE credit_accounts SET code_hash=? WHERE id=?", (digest(code), account))
        if changed.rowcount != 1:
            raise RequestError("Unknown contributor account.")
        db.execute("DELETE FROM credit_sessions WHERE account=?", (account,))
    return code


def session_hash(cookie):
    jar = SimpleCookie()
    try:
        jar.load(cookie)
    except CookieError:
        return ""
    return digest(jar[COOKIE].value) if COOKIE in jar else ""


def identity(db, cookie, required=True):
    row = db.execute(
        """SELECT a.id,a.label FROM credit_accounts a JOIN credit_sessions s ON s.account=a.id
                        WHERE s.token_hash=? AND s.expires>?""",
        (session_hash(cookie), int(time.time())),
    ).fetchone()
    if required and not row:
        raise RequestError("Sign in with an operator-issued contributor access code.", 401)
    return row


def login(code, old_cookie=""):
    if not isinstance(code, str) or len(code) > 128:
        raise RequestError("Invalid contributor access code.", 401)
    with database(True) as db:
        row = db.execute("SELECT id FROM credit_accounts WHERE code_hash=?", (digest(code),)).fetchone()
        if not row:
            raise RequestError("Invalid contributor access code.", 401)
        token = secrets.token_urlsafe(32)
        db.execute(
            "DELETE FROM credit_sessions WHERE token_hash=? OR expires<=?",
            (session_hash(old_cookie), int(time.time())),
        )
        db.execute(
            "INSERT INTO credit_sessions VALUES(?,?,?)",
            (digest(token), row["id"], int(time.time()) + SESSION_AGE),
        )
    return COOKIE + "=" + token


def rates():
    model = os.environ.get("STUDIO_FRONTIER_MODEL", "").strip()

    def rate(name, default=""):
        number = Decimal(os.environ.get("STUDIO_FRONTIER_" + name + "_USD_PER_MTOK", default))
        if (
            not number.is_finite()
            or not 0 <= number <= 100_000
            or number != number.quantize(Decimal("0.000001"))
        ):
            raise ValueError()
        return int(number * MILLION)

    try:
        inp = rate("INPUT")
        out = rate("OUTPUT")
        cached = rate("CACHED_INPUT", str(Decimal(inp) / MILLION))
        if not model or inp == 0 or out == 0 or cached > inp:
            raise ValueError()
    except (ValueError, InvalidOperation):
        raise RequestError("The operator must configure the frontier model and its token rates.", 503)
    return model, inp, cached, out


def cost(input_tokens, cached_tokens, output_tokens, inp, cached, out):
    return (
        (input_tokens - cached_tokens) * inp + cached_tokens * cached + output_tokens * out + MILLION - 1
    ) // MILLION


def totals(db, account):
    params = (account,)

    def total(sql):
        return db.execute(sql, params).fetchone()[0] or 0

    purchases = total("SELECT SUM(amount) FROM credit_purchases WHERE account=? AND state='paid'")
    grants = total("SELECT SUM(amount) FROM credit_grants WHERE account=?")
    spent = total("SELECT SUM(cost) FROM credit_calls WHERE account=? AND state='settled'")
    held = total("SELECT SUM(reserve) FROM credit_calls WHERE account=? AND state='held'")
    return purchases + grants - spent, held


def stripe_configured():
    return os.environ.get("STUDIO_STRIPE_TEST_SECRET_KEY", "").startswith("sk_test_") and os.environ.get(
        "STUDIO_STRIPE_TEST_WEBHOOK_SECRET", ""
    ).startswith("whsec_")


def status(cookie):
    try:
        model, inp, cached, out = rates()
        pricing = {
            "configured": True,
            "model": model,
            "input_usd_per_mtok": inp / MILLION,
            "cached_input_usd_per_mtok": cached / MILLION,
            "output_usd_per_mtok": out / MILLION,
        }
    except RequestError:
        pricing = {"configured": False}
    result = {
        "authenticated": False,
        "rates": pricing,
        "checkout_enabled": stripe_configured(),
        "offer_cents": OFFER_CENTS,
    }
    with database() as db:
        row = identity(db, cookie, required=False)
        if not row:
            return result
        account = row["id"]
        balance, held = totals(db, account)
        history = db.execute(
            """SELECT 'frontier' kind, state status, -coalesce(cost,0) amount_microusd,
                                reserve reserved_microusd, at, request_id, model, input_tokens, output_tokens, cached_tokens
                                FROM credit_calls WHERE account=?
                                UNION ALL SELECT 'test_checkout',state,CASE WHEN state='paid' THEN amount ELSE 0 END,
                                0,at,request_id,NULL,NULL,NULL,NULL FROM credit_purchases WHERE account=?
                                UNION ALL SELECT 'operator_test_grant','credited',amount,0,at,id,NULL,NULL,NULL,NULL
                                FROM credit_grants WHERE account=? ORDER BY at DESC LIMIT 100""",
            (account, account, account),
        )
        result.update(
            authenticated=True,
            account_label=row["label"],
            balance_microusd=balance,
            held_microusd=held,
            available_microusd=balance - held,
            history=[dict(r) for r in history],
        )
    return result


class ProviderRejected(RequestError):
    """The provider definitively rejected the request before doing inference."""


def usage_counts(raw):
    usage = raw["usage"]
    input_count, output_count = usage["prompt_tokens"], usage["completion_tokens"]
    cached_count = (usage.get("prompt_tokens_details") or {}).get("cached_tokens", 0)
    if (
        not all(type(n) is int and 0 <= n <= 100_000_000 for n in (input_count, cached_count, output_count))
        or cached_count > input_count
    ):
        raise ValueError("Invalid usage receipt.")
    return input_count, cached_count, output_count


def receipt_for(row, counts, provider_id):
    inp, cached, out = counts
    usage_cost = cost(inp, cached, out, row["input_rate"], row["cached_rate"], row["output_rate"])
    charge = min(usage_cost, row["reserve"])
    return {
        "request_id": row["request_id"],
        "model": row["model"],
        "provider_id": provider_id,
        "input_tokens": inp,
        "cached_tokens": cached,
        "output_tokens": out,
        "usage_cost_microusd": usage_cost,
        "amount_microusd": charge,
        "operator_covered_microusd": usage_cost - charge,
        "input_usd_per_mtok": row["input_rate"] / MILLION,
        "cached_input_usd_per_mtok": row["cached_rate"] / MILLION,
        "output_usd_per_mtok": row["output_rate"] / MILLION,
    }


def settle(db, row, counts, provider_id, result):
    receipt = receipt_for(row, counts, provider_id)
    db.execute(
        """UPDATE credit_calls SET state='settled',input_tokens=?,cached_tokens=?,output_tokens=?,
                  cost=?,provider_id=?,result=? WHERE account=? AND request_id=? AND state='held'""",
        (*counts, receipt["amount_microusd"], provider_id, result, row["account"], row["request_id"]),
    )
    return receipt


def metered_completion(cookie, request_id, payload, invoke):
    key = request_key(request_id)
    model, inp, cached, out = rates()
    messages = payload.get("messages")
    max_output = payload.get("max_completion_tokens", payload.get("max_tokens"))
    if (
        payload.get("model") != model
        or type(max_output) is not int
        or not 1 <= max_output <= 32768
        or not isinstance(messages, list)
        or not messages
        or len(messages) > 128
        or any(not isinstance(m, dict) or not isinstance(m.get("content"), str) for m in messages)
        or payload.get("n", 1) != 1
        or payload.get("stream")
        or payload.get("tools")
    ):
        raise RequestError("This frontier request requires one bounded text completion.", 400)
    # Conservative byte count plus per-message framing, including system/context messages.
    estimated_input = len(encoded(payload).encode()) + 64 * (1 + len(messages))
    if estimated_input > 1_000_000:
        raise RequestError("The frontier prompt exceeds the supported size.")
    reserved = cost(estimated_input, 0, max_output, inp, cached, out)
    fingerprint = digest(encoded(payload))
    with database(True) as db:
        account = identity(db, cookie)["id"]
        row = db.execute(
            "SELECT * FROM credit_calls WHERE account=? AND request_id=?", (account, key)
        ).fetchone()
        if row:
            if row["fingerprint"] != fingerprint:
                raise RequestError("This request ID belongs to another question.", 409)
            if row["state"] == "settled" and row["result"]:
                counts = row["input_tokens"], row["cached_tokens"], row["output_tokens"]
                return json.loads(row["result"]), receipt_for(row, counts, row["provider_id"])
            raise RequestError("This request was already registered. Check your credit history.", 409)
        balance, held = totals(db, account)
        if balance - held < reserved:
            raise RequestError(
                f"Insufficient credit. This request needs a reserve of {reserved} micro-USD.", 402
            )
        db.execute(
            """INSERT INTO credit_calls(account,request_id,fingerprint,model,state,reserve,input_rate,cached_rate,
                      output_rate,at) VALUES(?,?,?,?,'held',?,?,?,?,?)""",
            (account, key, fingerprint, model, reserved, inp, cached, out, timestamp()),
        )
    try:
        raw = invoke(payload)
        counts = usage_counts(raw)
        provider_id = raw["id"]
        if not isinstance(provider_id, str) or not provider_id:
            raise ValueError("Missing provider receipt ID.")
        serialized = encoded(raw)
    except ProviderRejected:
        with database(True) as db:
            db.execute(
                "UPDATE credit_calls SET state='released' WHERE account=? AND request_id=? AND state='held'",
                (account, key),
            )
        raise
    except Exception as exc:
        raise RequestError(
            "The provider outcome needs reconciliation. Credit remains reserved. Check your history.", 502
        ) from exc
    with database(True) as db:
        row = db.execute(
            "SELECT * FROM credit_calls WHERE account=? AND request_id=?", (account, key)
        ).fetchone()
        if row["state"] != "held":
            raise RequestError("An operator already reconciled this request.", 409)
        receipt = settle(db, row, counts, provider_id, serialized)
    return raw, receipt


def public_origin(local_origin):
    origin = os.environ.get("STUDIO_PUBLIC_ORIGIN", local_origin).rstrip("/")
    try:
        parts = urllib.parse.urlsplit(origin)
        allowed = parts.scheme == "https" or (
            parts.scheme == "http" and parts.hostname in ("127.0.0.1", "localhost", "::1")
        )
        if (
            not allowed
            or not parts.hostname
            or parts.username
            or parts.password
            or parts.path
            or parts.query
            or parts.fragment
        ):
            raise ValueError()
    except ValueError:
        raise RequestError("Configure an HTTPS STUDIO_PUBLIC_ORIGIN or use loopback HTTP.", 503)
    return origin


def stripe_session(order, origin):
    landing = origin + "/coach.html"
    fields = {
        "mode": "payment",
        "success_url": landing,
        "cancel_url": landing,
        "client_reference_id": order["id"],
        "metadata[studio_credit_order]": order["id"],
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": str(order["amount"] // 10000),
        "line_items[0][price_data][product_data][name]": "Iconic Tutor prepaid test credits",
    }
    req = urllib.request.Request(
        "https://api.stripe.com/v1/checkout/sessions",
        data=urllib.parse.urlencode(fields).encode(),
        headers={
            "Authorization": "Bearer " + os.environ["STUDIO_STRIPE_TEST_SECRET_KEY"],
            "Idempotency-Key": "iconic-studio-" + order["id"],
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            data = json.loads(response.read(128_000))
        session, url = data["id"], data["url"]
        if (
            data.get("livemode") is not False
            or not session.startswith("cs_test_")
            or urllib.parse.urlsplit(url).netloc != "checkout.stripe.com"
            or not url.startswith("https://")
        ):
            raise ValueError()
        return session, url
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as exc:
        raise RequestError(
            "Test checkout is unavailable. Retry this purchase with the same request ID.", 502
        ) from exc


def checkout(cookie, request_id, local_origin):
    key = request_key(request_id)
    if not stripe_configured():
        raise RequestError("Configure both Stripe test checkout credentials.", 503)
    origin = public_origin(local_origin)
    with database(True) as db:
        account = identity(db, cookie)["id"]
        row = db.execute(
            "SELECT * FROM credit_purchases WHERE account=? AND request_id=?", (account, key)
        ).fetchone()
        if row:
            if row["state"] != "pending":
                raise RequestError("This purchase has already finished. Check your credit history.", 409)
            if row["url"]:
                return {"url": row["url"]}
        else:
            order_id = str(uuid4())
            db.execute(
                "INSERT INTO credit_purchases(id,account,request_id,amount,state,at) VALUES(?,?,?,?,'pending',?)",
                (order_id, account, key, OFFER_CENTS * 10000, timestamp()),
            )
            row = db.execute("SELECT * FROM credit_purchases WHERE id=?", (order_id,)).fetchone()
    session, url = stripe_session(row, origin)
    with database(True) as db:
        saved = db.execute("SELECT * FROM credit_purchases WHERE id=?", (row["id"],)).fetchone()
        if saved["session"] and saved["session"] != session:
            raise RequestError("A different checkout session is already bound to this purchase.", 409)
        db.execute("UPDATE credit_purchases SET session=?,url=? WHERE id=?", (session, url, row["id"]))
    return {"url": url}


def webhook(raw, signature):
    secret = os.environ.get("STUDIO_STRIPE_TEST_WEBHOOK_SECRET", "")
    if not secret.startswith("whsec_"):
        raise RequestError("Test webhook is disabled.", 503)
    fields = [field.strip().split("=", 1) for field in signature.split(",") if "=" in field]
    try:
        times = [val for name, val in fields if name == "t"]
        if len(times) != 1 or abs(int(time.time()) - int(times[0])) > 300:
            raise ValueError()
        expected = hmac.new(secret.encode(), times[0].encode() + b"." + raw, hashlib.sha256).hexdigest()
        if not any(name == "v1" and hmac.compare_digest(expected, val) for name, val in fields):
            raise ValueError()
    except (ValueError, TypeError):
        raise RequestError("Invalid Stripe webhook signature.", 400)
    event = json.loads(raw)
    if (
        not isinstance(event, dict)
        or event.get("livemode") is not False
        or not isinstance(event.get("id"), str)
    ):
        raise RequestError("Expected a signed Stripe test event.")
    kind = event.get("type")
    if kind not in (
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
        "checkout.session.expired",
        "checkout.session.async_payment_failed",
    ):
        return {"received": True}
    session = (event.get("data") or {}).get("object") or {}
    order_id = (session.get("metadata") or {}).get("studio_credit_order")
    if not order_id:
        return {"received": True}  # Other Checkout integrations may use this Stripe account.
    with database(True) as db:
        if db.execute("SELECT 1 FROM credit_events WHERE event=?", (event["id"],)).fetchone():
            return {"received": True}
        row = db.execute("SELECT * FROM credit_purchases WHERE id=?", (order_id,)).fetchone()
        sid = session.get("id", "")
        if (
            not row
            or not isinstance(sid, str)
            or not sid.startswith("cs_test_")
            or session.get("livemode") is not False
            or row["session"] not in (None, sid)
            or session.get("mode") != "payment"
            or session.get("client_reference_id") != order_id
            or session.get("currency") != "usd"
            or type(session.get("amount_total")) is not int
            or session["amount_total"] * 10000 != row["amount"]
        ):
            raise RequestError("Checkout does not match a local test-credit purchase.", 400)
        state = row["state"]
        if (
            kind in ("checkout.session.completed", "checkout.session.async_payment_succeeded")
            and session.get("payment_status") == "paid"
        ):
            state = "paid"
        elif state != "paid" and kind in (
            "checkout.session.expired",
            "checkout.session.async_payment_failed",
        ):
            state = "failed"
        db.execute("UPDATE credit_purchases SET session=?,state=? WHERE id=?", (sid, state, order_id))
        db.execute("INSERT INTO credit_events VALUES(?)", (event["id"],))
    return {"received": True}


def cookie_header(value, max_age):
    secure = "; Secure" if os.environ.get("STUDIO_PUBLIC_ORIGIN", "").startswith("https://") else ""
    return value + "; Path=/api/; HttpOnly; SameSite=Strict; Max-Age=" + str(max_age) + secure


def handle_credits(handler, method, body=None):
    path = urllib.parse.urlsplit(handler.path).path
    cookie = handler.headers.get("Cookie", "")
    try:
        if method == "GET" and path == "/api/credits/status":
            return handler.json_response(200, status(cookie))
        if method == "POST" and path == "/api/credits/login":
            value = login(body.get("code"), cookie)
            return handler.json_response(
                200, status(value), {"Set-Cookie": cookie_header(value, SESSION_AGE)}
            )
        if method == "POST" and path == "/api/credits/logout":
            with database(True) as db:
                db.execute("DELETE FROM credit_sessions WHERE token_hash=?", (session_hash(cookie),))
            return handler.json_response(200, status(""), {"Set-Cookie": cookie_header(COOKIE + "=", 0)})
        if method == "POST" and path == "/api/credits/checkout":
            return handler.json_response(
                200, checkout(cookie, body.get("request_id"), "http://" + handler.headers["Host"])
            )
        raise RequestError("Unknown credit endpoint.", 404)
    except RequestError as exc:
        return handler.json_response(exc.status, {"error": str(exc)})


def handle_webhook(handler):
    try:
        size = int(handler.headers.get("Content-Length", "0"))
        if not 0 < size <= 256_000 or handler.headers.get_content_type() != "application/json":
            raise RequestError("Expected a bounded Stripe JSON event.")
        result = webhook(handler.rfile.read(size), handler.headers.get("Stripe-Signature", ""))
        return handler.json_response(200, result)
    except RequestError as exc:
        return handler.json_response(exc.status, {"error": str(exc)})
    except (TypeError, ValueError, KeyError, AttributeError):
        return handler.json_response(400, {"error": "Malformed Stripe event."})


def grant(account, cents, key):
    key = request_key(key)
    if type(cents) is not int or not 1 <= cents <= 100_000:
        raise RequestError("Use a test grant of 1–100,000 cents.")
    with database(True) as db:
        if not db.execute("SELECT 1 FROM credit_accounts WHERE id=?", (account,)).fetchone():
            raise RequestError("Unknown contributor account.")
        old = db.execute("SELECT * FROM credit_grants WHERE id=?", (key,)).fetchone()
        if old and (old["account"] != account or old["amount"] != cents * 10000):
            raise RequestError("Grant ID already belongs to a different grant.")
        db.execute(
            "INSERT OR IGNORE INTO credit_grants VALUES(?,?,?,?)", (key, account, cents * 10000, timestamp())
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("create-account").add_argument("label")
    sub.add_parser("rotate-code").add_argument("account")
    grant_args = sub.add_parser("grant-test")
    grant_args.add_argument("account")
    grant_args.add_argument("cents", type=int)
    grant_args.add_argument("grant_uuid")
    reconcile = sub.add_parser("reconcile")
    reconcile.add_argument("account")
    reconcile.add_argument("request_id")
    outcome = reconcile.add_mutually_exclusive_group(required=True)
    outcome.add_argument("--unused", action="store_true")
    outcome.add_argument("--usage", nargs=4, metavar=("INPUT", "CACHED", "OUTPUT", "PROVIDER_ID"))
    sub.add_parser("list-held")
    args = parser.parse_args()
    try:
        if args.action == "create-account":
            account, code = create_account(args.label)
            print("Account ID:", account, "\nPrivate access code:", code)
        elif args.action == "rotate-code":
            print("New private access code:", rotate_code(args.account))
        elif args.action == "grant-test":
            grant(args.account, args.cents, args.grant_uuid)
        elif args.action == "list-held":
            with database() as db:
                for row in db.execute(
                    "SELECT account,request_id,model,reserve,at FROM credit_calls WHERE state='held'"
                ):
                    print(encoded(dict(row)))
        else:
            with database(True) as db:
                row = db.execute(
                    "SELECT * FROM credit_calls WHERE account=? AND request_id=? AND state='held'",
                    (args.account, request_key(args.request_id)),
                ).fetchone()
                if not row:
                    raise RequestError("No matching unresolved reservation.")
                if args.unused:
                    db.execute(
                        "UPDATE credit_calls SET state='released' WHERE account=? AND request_id=?",
                        (args.account, row["request_id"]),
                    )
                else:
                    inp, cached, out, receipt = args.usage
                    counts = usage_counts(
                        {
                            "usage": {
                                "prompt_tokens": int(inp),
                                "completion_tokens": int(out),
                                "prompt_tokens_details": {"cached_tokens": int(cached)},
                            }
                        }
                    )
                    settle(db, row, counts, receipt, None)
    except ValueError as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
