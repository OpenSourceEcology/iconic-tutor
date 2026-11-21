"""Exercise payment fulfillment, per-browser identity and pre-inference credit reservations."""

import hashlib
import hmac
import json
import sys
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Barrier, Event, Thread
from unittest.mock import Mock
from uuid import uuid4

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import studio_credits as credits
import studio_server

KEY = "whsec_fixture_for_local_tests"
PAYLOAD = {
    "model": "example",
    "messages": [{"role": "user", "content": "Review my citations."}],
    "max_tokens": 600,
}
RAW = {
    "id": "chatcmpl-unit",
    "model": "example",
    "choices": [{"message": {"content": "result"}}],
    "usage": {"prompt_tokens": 120, "prompt_tokens_details": {"cached_tokens": 20}, "completion_tokens": 50},
}


def uid():
    return str(uuid4())


@pytest.fixture(autouse=True)
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("STUDIO_AUTHORING_DB", str(tmp_path / "db.sqlite3"))
    monkeypatch.setenv("STUDIO_FRONTIER_MODEL", "example")
    monkeypatch.setenv("STUDIO_FRONTIER_INPUT_USD_PER_MTOK", "2.5")
    monkeypatch.setenv("STUDIO_FRONTIER_CACHED_INPUT_USD_PER_MTOK", "0.25")
    monkeypatch.setenv("STUDIO_FRONTIER_OUTPUT_USD_PER_MTOK", "18")
    monkeypatch.setenv("STUDIO_STRIPE_TEST_WEBHOOK_SECRET", KEY)
    monkeypatch.setenv("STUDIO_STRIPE_TEST_SECRET_KEY", "sk_test_fixture")
    monkeypatch.delenv("STUDIO_PUBLIC_ORIGIN", raising=False)
    monkeypatch.delenv("STUDIO_OSE_SUPPORT_BPS", raising=False)


def funded(cents=500):
    account, code = credits.create_account("same public label")
    cookie = credits.login(code)
    if cents:
        credits.grant(account, cents, uid())
    return account, cookie


def test_accounts_cookies_grants_and_usage_receipt(monkeypatch):
    account, cookie = funded(1)
    other_account, another = funded(0)
    assert not credits.status("studio_credit_session=" + account)["authenticated"]
    assert not credits.status("")["authenticated"]
    assert credits.status(another)["balance_microusd"] == 0
    call = Mock(return_value=RAW)
    key = uid()
    with pytest.raises(credits.RequestError) as err:
        credits.metered_completion(cookie, key, PAYLOAD, call)
    assert err.value.status == 402 and not call.called  # max reserve > 1 cent
    grant_id = uid()
    for _ in range(2):
        credits.grant(account, 5, grant_id)
    with pytest.raises(credits.RequestError):
        credits.grant(other_account, 5, grant_id)
    assert credits.status(cookie)["balance_microusd"] == 60000
    raw, receipt = credits.metered_completion(cookie, key, PAYLOAD, call)
    assert raw == RAW and receipt["amount_microusd"] == 1212
    assert (receipt["model_cost_microusd"], receipt["support_fee_microusd"], receipt["markup_bps"]) == (
        1155,
        57,
        500,
    )
    monkeypatch.setenv("STUDIO_OSE_SUPPORT_BPS", "250")
    assert receipt["cached_tokens"] == 20
    assert credits.metered_completion(cookie, key, PAYLOAD, call) == (raw, receipt)
    assert call.call_count == 1
    with pytest.raises(credits.RequestError) as err:
        credits.metered_completion(cookie, key, {**PAYLOAD, "max_tokens": 1}, call)
    assert err.value.status == 409
    info = credits.status(cookie)
    assert info["available_microusd"] == 58788 and info["held_microusd"] == 0
    assert next(h for h in info["history"] if h["kind"] == "frontier")["amount_microusd"] == -1212
    assert credits.status(another)["history"] == []
    monkeypatch.delenv("STUDIO_FRONTIER_INPUT_USD_PER_MTOK")
    assert not credits.status(cookie)["rates"]["configured"]
    with pytest.raises(credits.RequestError) as err:
        credits.metered_completion(cookie, uid(), PAYLOAD, call)
    assert err.value.status == 503 and call.call_count == 1


def test_simultaneous_questions_hold_funds_before_provider():
    _, cookie = funded(2)  # one maximum reservation fits, two do not
    started, finish = Event(), Event()

    def slow(_):
        started.set()
        assert finish.wait(5)
        return RAW

    with ThreadPoolExecutor() as pool:
        first_key = uid()
        first = pool.submit(credits.metered_completion, cookie, first_key, PAYLOAD, slow)
        assert started.wait(5)
        try:
            assert credits.status(cookie)["held_microusd"] > 10000
            for key, code in [(uid(), 402), (first_key, 409)]:
                with pytest.raises(credits.RequestError) as err:
                    credits.metered_completion(
                        cookie, key, PAYLOAD, lambda p: pytest.fail("second call started")
                    )
                assert err.value.status == code
        finally:
            finish.set()
        first.result()
    assert credits.status(cookie)["held_microusd"] == 0


def test_unknown_outcomes_and_definitive_provider_rejection(monkeypatch):
    account, cookie = funded()
    with pytest.raises(credits.ProviderRejected):
        credits.metered_completion(
            cookie, uid(), PAYLOAD, Mock(side_effect=credits.ProviderRejected("Unauthorized", 401))
        )
    assert credits.status(cookie)["held_microusd"] == 0
    for raw, unused in [
        ({"choices": []}, False),
        ({"id": "x", "usage": {"prompt_tokens": True, "completion_tokens": 1}}, True),
    ]:
        key = uid()
        with pytest.raises(credits.RequestError) as err:
            credits.metered_completion(cookie, key, PAYLOAD, Mock(return_value=raw))
        assert err.value.status == 502 and credits.status(cookie)["held_microusd"] > 0
        args = ["--unused"] if unused else ["--usage", "120", "20", "50", "chatcmpl-unit"]
        monkeypatch.setattr(sys, "argv", ["studio_credits.py", "reconcile", account, key, *args])
        credits.main()
        assert credits.status(cookie)["held_microusd"] == 0
    assert credits.status(cookie)["balance_microusd"] == 5_000_000 - 1212


def signature(raw, now=None):
    stamp = str(int(time.time()) if now is None else now)
    sig = hmac.new(KEY.encode(), stamp.encode() + b"." + raw, hashlib.sha256).hexdigest()
    return "t=" + stamp + ",v1=" + sig


def event(order, kind="checkout.session.completed", payment="paid", **changes):
    obj = {
        "id": "cs_test_demo",
        "mode": "payment",
        "livemode": False,
        "currency": "usd",
        "amount_total": 500,
        "client_reference_id": order,
        "metadata": {"studio_credit_order": order},
        "payment_status": payment,
        **changes,
    }
    return json.dumps(
        {"id": "evt_" + uid(), "livemode": False, "type": kind, "data": {"object": obj}}
    ).encode()


def test_checkout_only_signed_matched_vouchers_are_credited(monkeypatch):
    _, cookie = funded(0)
    _, other = funded(0)
    created = []

    def fake_checkout(order, origin):
        created.append(order["id"])
        return "cs_test_demo", "https://checkout.stripe.com/c/pay/demo"

    monkeypatch.setattr(credits, "stripe_session", fake_checkout)
    key = uid()
    checkout = credits.checkout(cookie, key, "http://127.0.0.1:8766")
    assert checkout == credits.checkout(cookie, key, "http://127.0.0.1:8766")
    assert len(created) == 1 and credits.status(cookie)["balance_microusd"] == 0
    order = created[0]
    ok = event(order)
    for bad in [signature(ok, 1), signature(ok + b" "), ""]:
        with pytest.raises(credits.RequestError):
            credits.webhook(ok, bad)
    for changes in [
        {"currency": "eur"},
        {"amount_total": 501},
        {"livemode": True},
        {"id": "cs_test_other"},
        {"mode": "subscription"},
        {"client_reference_id": "wrong"},
    ]:
        raw = event(order, **changes)
        with pytest.raises(credits.RequestError):
            credits.webhook(raw, signature(raw))
    for kind in ["checkout.session.completed", "checkout.session.async_payment_failed"]:
        raw = event(order, kind, "unpaid")
        credits.webhook(raw, signature(raw))
        assert credits.status(cookie)["balance_microusd"] == 0
    for raw in [
        ok,
        ok,
        event(order, "checkout.session.async_payment_succeeded"),
        event(order, "checkout.session.expired", "unpaid"),
    ]:
        credits.webhook(raw, signature(raw))
    assert (
        credits.status(cookie)["balance_microusd"] == 5_000_000
        and credits.status(other)["balance_microusd"] == 0
    )
    monkeypatch.setenv("STUDIO_STRIPE_TEST_SECRET_KEY", "sk_live_disabled_fixture")
    assert not credits.status(cookie)["checkout_enabled"]
    with pytest.raises(credits.RequestError) as err:
        credits.checkout(cookie, uid(), "http://127.0.0.1:8766")
    assert err.value.status == 503


def test_stripe_outbound_contract_and_disallowed_redirect(monkeypatch):
    from io import BytesIO

    calls = []

    def stripe(req, timeout):
        calls.append(req)
        return BytesIO(
            json.dumps(
                {"livemode": False, "id": "cs_test_demo", "url": "https://checkout.stripe.com/c/demo"}
            ).encode()
        )

    monkeypatch.setattr(credits.urllib.request, "urlopen", stripe)
    order = {"id": uid(), "amount": 5_000_000}
    assert credits.stripe_session(order, "http://localhost:8766")[0] == "cs_test_demo"
    assert calls[0].full_url == "https://api.stripe.com/v1/checkout/sessions"
    fields = urllib.parse.parse_qs(calls[0].data.decode())
    assert fields["metadata[studio_credit_order]"] == [order["id"]]
    assert fields["line_items[0][price_data][unit_amount]"] == ["500"]
    assert fields["success_url"] == fields["cancel_url"] == ["http://localhost:8766/coach.html"]
    assert calls[0].get_header("Idempotency-key") == "iconic-studio-" + order["id"]
    monkeypatch.setattr(
        credits.urllib.request,
        "urlopen",
        lambda *a, **k: BytesIO(b'{"livemode":false,"id":"cs_test_demo","url":"https://other.example/"}'),
    )
    with pytest.raises(credits.RequestError):
        credits.stripe_session(order, "http://localhost:8766")


def test_http_sessions_and_raw_webhook():
    _, code = credits.create_account("First builder")
    server = ThreadingHTTPServer(("127.0.0.1", 0), studio_server.Handler)
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()

    def request(method, path, data=None, headers=None):
        conn = HTTPConnection("127.0.0.1", server.server_port)
        try:
            conn.request(method, path, data, headers or {})
            res = conn.getresponse()
            return res.status, json.loads(res.read()), res.getheader("Set-Cookie")
        finally:
            conn.close()

    try:
        headers = {"Content-Type": "application/json"}
        result, status, cookie = request("POST", "/api/credits/login", json.dumps({"code": code}), headers)
        assert result == 200 and status["account_label"] == "First builder" and "HttpOnly" in cookie
        _, _, second = request("POST", "/api/credits/login", json.dumps({"code": code}), headers)
        assert cookie != second
        cookie = cookie.split(";")[0]
        second = second.split(";")[0]
        assert request("GET", "/api/credits/status", headers={"Cookie": cookie})[1]["authenticated"]
        assert (
            request(
                "POST",
                "/api/credits/logout",
                "{}",
                {**headers, "Cookie": cookie, "Origin": "https://wrong.example"},
            )[0]
            == 403
        )
        request("POST", "/api/credits/logout", "{}", {**headers, "Cookie": cookie})
        assert not request("GET", "/api/credits/status", headers={"Cookie": cookie})[1]["authenticated"]
        assert request("GET", "/api/credits/status", headers={"Cookie": second})[1]["authenticated"]
        raw = b'{"id":"evt_test", "livemode":false, "type":"unknown"}'
        assert (
            request("POST", "/api/credits/webhook", raw, {**headers, "Stripe-Signature": signature(raw)})[0]
            == 200
        )
        assert request("POST", "/api/credits/webhook", raw, headers)[0] == 400
    finally:
        server.shutdown()
        server.server_close()
        worker.join()


def test_unsolicited_provider_overage_preserves_prepaid_limit():
    _, cookie = funded(2)
    receipt_data = {**RAW, "usage": {"prompt_tokens": 90_000, "completion_tokens": 9_000}}
    _, receipt = credits.metered_completion(cookie, uid(), PAYLOAD, Mock(return_value=receipt_data))
    assert receipt["input_tokens"] == 90000 and receipt["output_tokens"] == 9000
    assert receipt["model_cost_microusd"] == 387000
    assert receipt["support_fee_microusd"] == 19350
    assert receipt["usage_cost_microusd"] == 406350
    assert receipt["operator_covered_microusd"] == 406350 - receipt["amount_microusd"] > 0
    assert credits.status(cookie)["available_microusd"] >= 0


def test_operator_rotates_one_accounts_credentials_and_sessions():
    account, code = credits.create_account("A")
    old = credits.login(code)
    _, other = funded()
    fresh = credits.rotate_code(account)
    with pytest.raises(credits.RequestError):
        credits.login(code)
    assert not credits.status(old)["authenticated"]
    assert credits.status(other)["authenticated"]
    assert credits.status(credits.login(fresh))["account_label"] == "A"


def test_concurrent_legacy_db_migration_keeps_receipts_and_holds_at_zero_fee(monkeypatch):
    account, cookie = funded()
    monkeypatch.setenv("STUDIO_OSE_SUPPORT_BPS", "0")
    old_settled, old_held = uid(), uid()
    _, original = credits.metered_completion(cookie, old_settled, PAYLOAD, Mock(return_value=RAW))
    with pytest.raises(credits.RequestError):
        credits.metered_completion(cookie, old_held, PAYLOAD, Mock(side_effect=TimeoutError()))
    legacy_balance = credits.status(cookie)["available_microusd"]
    # Rebuild the table with the columns and primary key from the pre-markup release.
    legacy_columns = (
        "account,request_id,fingerprint,model,state,reserve,cost,input_rate,cached_rate,"
        "output_rate,input_tokens,cached_tokens,output_tokens,provider_id,result,at"
    )
    with credits.database(True) as db:
        db.execute("ALTER TABLE credit_calls RENAME TO staging")
        db.execute("""CREATE TABLE credit_calls (
            account TEXT NOT NULL REFERENCES credit_accounts(id), request_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
            model TEXT NOT NULL, state TEXT NOT NULL, reserve INTEGER NOT NULL, cost INTEGER,
            input_rate INTEGER NOT NULL, cached_rate INTEGER NOT NULL, output_rate INTEGER NOT NULL,
            input_tokens INTEGER, cached_tokens INTEGER, output_tokens INTEGER, provider_id TEXT,
            result TEXT, at TEXT NOT NULL, PRIMARY KEY(account,request_id))""")
        db.execute(f"INSERT INTO credit_calls({legacy_columns}) SELECT {legacy_columns} FROM staging")
        db.execute("DROP TABLE staging")
    monkeypatch.setenv("STUDIO_OSE_SUPPORT_BPS", "750")
    barrier = Barrier(8)

    def check():
        barrier.wait(timeout=5)
        return credits.status(cookie)

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(check) for _ in range(8)]
        for future in futures:
            info = future.result()
            assert info["available_microusd"] == legacy_balance
            for event in (r for r in info["history"] if r["kind"] == "frontier"):
                assert event["markup_bps"] == 0
                if event["status"] == "settled":
                    assert (event["model_cost_microusd"], event["support_fee_microusd"]) == (1155, 0)
    never = Mock(side_effect=AssertionError("Unexpected second inference"))
    _, replay = credits.metered_completion(cookie, old_settled, PAYLOAD, never)
    assert replay == original
    monkeypatch.setattr(
        sys,
        "argv",
        ["studio_credits.py", "reconcile", account, old_held, "--usage", "120", "20", "50", "legacy"],
    )
    credits.main()
    info = credits.status(cookie)
    assert info["balance_microusd"] == 5_000_000 - 2 * 1155
    assert (
        credits.metered_completion(cookie, uid(), PAYLOAD, Mock(return_value=RAW))[1]["support_fee_microusd"]
        == 86
    )


def test_fee_is_pinned_for_ambiguous_outcomes_and_reconciliation(monkeypatch):
    account, cookie = funded()
    key = uid()
    monkeypatch.setenv("STUDIO_OSE_SUPPORT_BPS", "1250")
    with pytest.raises(credits.RequestError):
        credits.metered_completion(cookie, key, PAYLOAD, Mock(side_effect=TimeoutError()))
    entry = next(r for r in credits.status(cookie)["history"] if r["kind"] == "frontier")
    assert entry["markup_bps"] == 1250 and entry["support_fee_microusd"] is None
    monkeypatch.setenv("STUDIO_OSE_SUPPORT_BPS", "0")
    monkeypatch.setattr(
        sys, "argv", ["credits", "reconcile", account, key, "--usage", "120", "20", "50", "verified"]
    )
    credits.main()
    entry = next(r for r in credits.status(cookie)["history"] if r["kind"] == "frontier")
    assert entry["model_cost_microusd"] == 1155 and entry["support_fee_microusd"] == 144
    assert (
        entry["amount_microusd"] == -1299
        and entry["usage_cost_microusd"] == 1299
        and entry["markup_bps"] == 1250
    )
    assert entry["operator_covered_microusd"] == 0


def test_preflight_includes_entire_fee_and_invalid_config_cannot_run(monkeypatch):
    _, cookie = funded(1)
    payload = {**PAYLOAD, "max_tokens": 500}
    never = Mock(side_effect=AssertionError("Unexpected inference"))
    monkeypatch.setenv("STUDIO_OSE_SUPPORT_BPS", "5000")
    with pytest.raises(credits.RequestError) as err:
        credits.metered_completion(cookie, uid(), payload, never)
    assert err.value.status == 402 and not never.called
    for invalid in ("-1", "10001", "5%", "12.3", ""):
        monkeypatch.setenv("STUDIO_OSE_SUPPORT_BPS", invalid)
        assert not credits.status(cookie)["rates"]["configured"]
        with pytest.raises(credits.RequestError) as err:
            credits.metered_completion(cookie, uid(), payload, never)
        assert err.value.status == 503
    monkeypatch.setenv("STUDIO_OSE_SUPPORT_BPS", "0")
    assert (
        credits.metered_completion(cookie, uid(), payload, Mock(return_value=RAW))[1]["amount_microusd"]
        == 1155
    )


def test_fractional_micro_usd_rounding():
    assert credits.cost(1, 0, 0, 1, 0, 0) == 1
    for base, bps, fee in ((1, 500, 0), (20, 500, 1), (21, 500, 1), (264, 500, 13), (0, 500, 0), (1, 0, 0)):
        assert credits.support_fee(base, bps) == fee
