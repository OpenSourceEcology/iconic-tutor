"""Immutable evidence handoffs, compiler comparisons and human review decisions."""

import json
from dataclasses import dataclass
from hashlib import sha256
from uuid import uuid4

import studio_pilot
from studio_authoring import (
    RequestError,
    current,
    encoded,
    fingerprint,
    short_text,
    timestamp,
)


@dataclass(frozen=True)
class ReviewActor:
    account: str | None
    label: str
    can_review: bool


LOCAL = ReviewActor(None, "Local Studio reviewer", True)
OUTCOMES = {"accepted", "needs_evidence", "open_question"}
SCHEMA = """
CREATE TABLE IF NOT EXISTS contribution_claim_accounts (
 task_id TEXT PRIMARY KEY, account TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS review_submissions (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL, version INTEGER NOT NULL, round INTEGER NOT NULL,
 account TEXT, snapshot TEXT NOT NULL, UNIQUE(task_id,version), UNIQUE(task_id,round),
 FOREIGN KEY(task_id,version) REFERENCES contribution_revisions(task_id,version));
CREATE TABLE IF NOT EXISTS review_decisions (
 submission TEXT PRIMARY KEY REFERENCES review_submissions(id), reviewer_account TEXT,
 reviewer TEXT NOT NULL, outcome TEXT NOT NULL, feedback TEXT NOT NULL, decided_at TEXT NOT NULL);
"""


def empty_effects(state):
    return {
        "state": state,
        "before_version": None,
        "after_version": None,
        "stale": False,
        "workstreams": [],
        "metrics": [],
    }


def artifact_hashes(db, project_id, version):
    return {
        row["path"]: sha256(row["data"]).hexdigest()
        for row in db.execute(
            "SELECT path,data FROM artifacts WHERE project=? AND version=?", (project_id, version)
        )
    }


def measured(manifest, field):
    value = manifest.get(field)
    if field in ("members", "available_dimensions"):
        return len(value) if isinstance(value, (list, dict)) else None
    return value if isinstance(value, (int, float, str)) else None


def build_effects(db, project_id):
    if not project_id:
        return empty_effects("no_project")
    project = current(db, project_id)
    versions = [
        row["version"]
        for row in db.execute(
            """SELECT DISTINCT version FROM artifacts WHERE project=? AND version<=?
           ORDER BY version DESC LIMIT 2""",
            (project_id, project["version"]),
        )
    ]
    if not versions:
        return empty_effects("no_build")
    after = current(db, project_id, versions[0])["build"]
    before = current(db, project_id, versions[1])["build"] if len(versions) > 1 else None
    result = empty_effects("compared" if before else "first_build")
    result.update(
        before_version=versions[1] if before else None,
        after_version=versions[0],
        stale=after["instance_hash"] != fingerprint(project["instance"]),
    )
    old_manifest = before["manifest"] if before else {}
    new_manifest = after["manifest"]
    for field, label, unit in (
        ("variant", "Configuration", ""),
        ("spacing_in", "Stud spacing", "in"),
        ("members", "Frame members", ""),
        ("available_dimensions", "Available dimensions", ""),
        ("purchase_total_usd", "Purchasing total", "USD"),
    ):
        first, last = measured(old_manifest, field), measured(new_manifest, field)
        if first is not None or last is not None:
            result["metrics"].append({"label": label, "before": first, "after": last, "unit": unit})
    new_rows = {s["id"]: s for s in after["manifest"]["workstreams"]}
    old_rows = {s["id"]: s for s in before["manifest"]["workstreams"]} if before else {}
    # Hash the actual stored files. Historical compilers need not have emitted a hash manifest.
    after_hashes = artifact_hashes(db, project_id, versions[0])
    before_hashes = artifact_hashes(db, project_id, versions[1]) if before else {}
    for stream in dict.fromkeys([*new_rows, *old_rows]):
        old, new = old_rows.get(stream, {}), new_rows.get(stream, {})
        files = sorted(set(old.get("files", [])) | set(new.get("files", [])))
        old_checks = {c["name"]: c["passed"] for c in old.get("checks", [])}
        new_checks = {c["name"]: c["passed"] for c in new.get("checks", [])}
        result["workstreams"].append(
            {
                "id": stream,
                "before_status": old.get("status"),
                "after_status": new.get("status"),
                "changed_files": [
                    name for name in files if before_hashes.get(name) != after_hashes.get(name)
                ],
                "checks": [
                    {"name": name, "before": old_checks.get(name), "after": new_checks.get(name)}
                    for name in sorted(old_checks.keys() | new_checks.keys())
                ],
                "gaps_before": old.get("gaps", []),
                "gaps_after": new.get("gaps", []),
            }
        )
    return result


def record_submission(db, brief, row, actor=None, legacy=False):
    draft = json.loads(row["draft"]) if row["draft"] else {}
    sources = [] if legacy else [s for s in brief["sources"] if s["id"] in draft["source_ids"]]
    round_number = db.execute(
        "SELECT COALESCE(MAX(round),0)+1 FROM review_submissions WHERE task_id=?", (row["task_id"],)
    ).fetchone()[0]
    snapshot = {
        "id": uuid4().hex,
        "task_id": row["task_id"],
        "task_title": brief["title"],
        "module_id": row["module_id"],
        "workstream": row["workstream"],
        "submitted_at": row["updated_at"],
        "contributor": row["contributor"],
        "submission_version": row["version"],
        "round": round_number,
        "draft": draft,
        "sources": sources,
        "effects": empty_effects("legacy") if legacy else build_effects(db, row["project_id"]),
    }
    studio_pilot.capture(db, snapshot, row["project_id"], legacy)
    db.execute(
        "INSERT INTO review_submissions VALUES(?,?,?,?,?,?)",
        (
            snapshot["id"],
            row["task_id"],
            row["version"],
            round_number,
            actor.account if actor else None,
            encoded(snapshot),
        ),
    )


def initialize(db, briefs):
    db.executescript(SCHEMA)
    missing = """SELECT r.* FROM contribution_revisions r LEFT JOIN review_submissions s
                 ON (s.task_id,s.version)=(r.task_id,r.version)
                 WHERE r.action='submit' AND s.id IS NULL ORDER BY r.task_id,r.version"""
    if db.execute(missing + " LIMIT 1").fetchone():
        with db:
            db.execute("BEGIN IMMEDIATE")
            for row in db.execute(missing):
                brief = briefs.get(row["task_id"], {"title": row["task_id"]})
                record_submission(db, brief, row, legacy=True)


SELECT = """SELECT s.account,s.snapshot,d.reviewer,d.outcome,d.feedback,d.decided_at
            FROM review_submissions s LEFT JOIN review_decisions d ON d.submission=s.id"""


def view(row, briefs, detailed, actor):
    data = json.loads(row["snapshot"])
    data.pop("_pilot", None)
    data["decision"] = (
        {k: row[k] for k in ("reviewer", "outcome", "feedback", "decided_at")} if row["outcome"] else None
    )
    data["status"] = row["outcome"] or "pending"
    data["can_decide"] = (
        actor.can_review and not row["outcome"] and not (actor.account and actor.account == row["account"])
    )
    if detailed:
        current_sources = {s["id"]: s for s in briefs.get(data["task_id"], {}).get("sources", [])}
        saved = {s["id"]: s for s in data["sources"]}
        data["changed_sources"] = [
            key
            for key, rev in data["draft"].get("source_revisions", {}).items()
            if str(current_sources.get(key, {}).get("revision", "")) != rev
            or (key in saved and saved[key] != current_sources.get(key))
        ]
    else:
        for key in ("draft", "sources", "effects"):
            del data[key]
    return data


def listing(db, actor, briefs, task_id=None):
    where, params = [], []
    if not actor.can_review:
        where.append("s.account=?")
        params.append(actor.account)
    if task_id:
        where.append("s.task_id=?")
        params.append(task_id)
    sql = SELECT + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY s.rowid DESC"
    return [view(row, briefs, False, actor) for row in db.execute(sql, params)]


def route(db, method, path, body, actor, briefs, decision_applied):
    if path == ["pilot"] and method == "GET":
        return studio_pilot.summary(db, actor)
    if not path and method == "GET":
        return {
            "can_review": actor.can_review,
            "reviewer_label": actor.label if actor.can_review else "",
            "reviews": listing(db, actor, briefs),
        }
    deciding = len(path) == 2 and path[1] == "decision" and method == "POST"
    if not (len(path) == 1 and method == "GET" or deciding):
        raise RequestError("Unknown review route.", 404)
    if deciding:
        if not actor.can_review:
            raise RequestError("A workshop reviewer invitation is required.", 403)
        db.execute("BEGIN IMMEDIATE")
    row = db.execute(SELECT + " WHERE s.id=?", (path[0],)).fetchone()
    if not row or not actor.can_review and (not actor.account or row["account"] != actor.account):
        raise RequestError("Unknown review handoff.", 404)
    record = view(row, briefs, True, actor)
    if not deciding:
        return record
    if (
        type(body.get("submission_version")) is not int
        or body["submission_version"] != record["submission_version"]
        or record["decision"]
    ):
        raise RequestError("This review changed. Reload its saved decision.", 409)
    if actor.account and actor.account == row["account"]:
        raise RequestError("Ask a second workshop reviewer to review your own handoff.", 403)
    outcome = body.get("outcome")
    if outcome not in OUTCOMES:
        raise RequestError("Choose a review outcome.")
    feedback = short_text(body.get("feedback"), 3000, "Reviewer feedback").strip()
    if outcome == "accepted" and (record["changed_sources"] or record["effects"]["state"] == "legacy"):
        raise RequestError(
            "Recheck the sources and resubmit a current evidence snapshot before accepting.", 409
        )
    if outcome == "accepted" and record["effects"]["stale"]:
        raise RequestError("Regenerate the edited project before accepting its output comparison.", 409)
    if outcome == "accepted" and record["draft"].get("kind") == "question":
        raise RequestError("Keep the question open or request the evidence that would answer it.", 422)
    db.execute(
        "INSERT INTO review_decisions VALUES(?,?,?,?,?,?)",
        (path[0], actor.account, actor.label, outcome, feedback, timestamp()),
    )
    decision_applied(db, record, outcome)
    db.commit()
    return view(db.execute(SELECT + " WHERE s.id=?", (path[0],)).fetchone(), briefs, True, actor)
