"""Reviewer measurements from immutable submissions and explicitly linked coach receipts."""
from hashlib import sha256
from hmac import compare_digest
import json
import re

from studio_authoring import RequestError, current, timestamp


def claim_scope(db, project, body):
    """Verify an optional claim key before paid inference. Never persist or send the key to a model."""
    task = body.get("pilot_task")
    token = body.get("pilot_claim_token")
    if task is None and token is None:
        return None
    if not isinstance(task, str) or not isinstance(token, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{32,128}", token):
        raise RequestError("Reopen the coach from the task you currently hold.", 403)
    from studio_contributions import _expired
    exists = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='contribution_revisions'").fetchone()
    row = db.execute("SELECT * FROM contribution_revisions WHERE task_id=? ORDER BY version DESC LIMIT 1", (task,)).fetchone() if exists else None
    if (not row or row["status"] != "claimed" or row["project_id"] != project["id"]
            or row["module_id"] != project["module_id"] or row["workstream"] != project["active_workstream"]
            or not compare_digest(row["claim_digest"] or "", sha256(token.encode()).hexdigest())
            or _expired(row, timestamp())):
        raise RequestError("This project has no matching active claim. Reopen the coach from your current task.", 403)
    claim = last_claim(db, task, row["version"])
    if claim is None:
        raise RequestError("This task needs a recorded claim to link a model receipt.", 409)
    return {"task_id": task, "claim_version": claim}


def last_claim(db, task_id, version):
    return db.execute("SELECT MAX(version) FROM contribution_revisions WHERE task_id=? AND version<=? AND action='claim'",
                      (task_id, version)).fetchone()[0]


def money(value):
    return value if type(value) is int and value >= 0 else None


def capture(db, snapshot, project_id, legacy):
    if legacy or not project_id:
        return
    project = current(db, project_id)
    claim = last_claim(db, snapshot["task_id"], snapshot["submission_version"])
    if claim is None:
        return
    scope = {"task_id": snapshot["task_id"], "claim_version": claim}
    receipts = {}
    for message in (project.get("coach") or {}).get("messages", []):
        version = message.get("version")
        if (message.get("role") != "assistant" or message.get("pilot_claim") != scope
                or type(version) is not int or not 0 < version < project["version"]):
            continue
        receipt = message.get("receipt")
        if not isinstance(receipt, dict) or not all(isinstance(receipt.get(k), str) and receipt[k] for k in ("request_id", "provider_id")):
            continue
        # Deduplicate a retried request even if a second snapshot carries its history.
        # Both IDs are private and never returned in the reviewer response.
        key = sha256(json.dumps([receipt["request_id"], receipt["provider_id"]]).encode()).hexdigest()
        receipts[key] = {"model": money(receipt.get("model_cost_microusd")), "charge": money(receipt.get("amount_microusd"))}
    snapshot["_pilot"] = {"project_version": project["version"], "receipts": receipts}


def amounts(notes, key):
    values = [note[key] for note in notes if note.get(key) is not None]
    return {"microusd": sum(values) if values else None, "receipts": len(values)}


def summary(db, actor):
    if not actor.can_review:
        raise RequestError("Pilot measurements require a reviewer invitation.", 403)
    rounds, outcomes, all_receipts = [], {}, {}
    sql = """SELECT s.snapshot, d.outcome FROM review_submissions s
             LEFT JOIN review_decisions d ON d.submission=s.id ORDER BY s.task_id,s.round"""
    for row in db.execute(sql):
        submission = json.loads(row["snapshot"])
        draft = submission.get("draft") or {}
        pin = submission.get("_pilot") or {}
        captured = pin.get("receipts", {})
        # Old snapshots contain cumulative conversations. Only a captured, matching
        # claim is eligible; no fallback to the project's current history or ledger.
        fresh = {key: value for key, value in captured.items() if key not in all_receipts}
        all_receipts.update(fresh)
        outcome = row["outcome"] or "pending"
        outcomes[outcome] = outcomes.get(outcome, 0) + 1
        time = draft.get("active_seconds")
        rounds.append({
            "review_id": submission["id"], "task_id": submission["task_id"], "title": submission["task_title"],
            "module_id": submission["module_id"], "round": submission["round"], "outcome": outcome,
            "assistance": draft.get("assistance") if draft.get("assistance") in ("independent","assisted") else "unreported",
            "active_seconds": time if type(time) is int and time > 0 else None,
            "help": draft.get("help") or None, "project_version": pin.get("project_version"),
            "receipt_count": len(fresh), "model_cost": amounts(fresh.values(), "model"),
            "credit_charge": amounts(fresh.values(), "charge"),
        })
    return {"rounds": rounds, "tasks": len({row["task_id"] for row in rounds}), "outcomes": outcomes,
            "receipt_count": len(all_receipts), "model_cost": amounts(all_receipts.values(), "model"),
            "credit_charge": amounts(all_receipts.values(), "charge")}
