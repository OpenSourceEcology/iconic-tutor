"""Shared contribution tasks on one Studio server. The static page stores its drafts separately."""

from contextlib import closing
from datetime import datetime, timedelta
from hashlib import sha256
from hmac import compare_digest
from ipaddress import ip_address
import json
import re
import sqlite3
from urllib.parse import parse_qs, unquote, urlsplit

import studio_review as review
from studio_authoring import ROOT, RequestError, connect, encoded, read_json, short_text, timestamp


CATALOG = ROOT / "web/data/contributions/tasks.json"
CLAIM_DURATION = timedelta(days=7)
DRAFT_TEXT_LIMITS = {
    "contributor": 100,
    "text": 3000,
    "scope": 3000,
    "help": 3000,
    "lesson_step": 300,
    "lesson_feedback": 3000,
    "additional_source": 2000,
}
STATES = {"claim": "claimed", "save": "claimed", "release": "open", "submit": "ready_for_review"}


def task_briefs():
    return {task["id"]: task for task in read_json(CATALOG)["tasks"]}


def open_db(briefs=None):
    db = connect()
    db.execute("""
        CREATE TABLE IF NOT EXISTS contribution_revisions (
            task_id TEXT NOT NULL, version INTEGER NOT NULL,
            action TEXT NOT NULL, status TEXT NOT NULL,
            contributor TEXT NOT NULL, claim_digest TEXT,
            project_id TEXT REFERENCES projects(id), updated_at TEXT NOT NULL,
            draft TEXT, module_id TEXT NOT NULL, workstream TEXT NOT NULL,
            PRIMARY KEY(task_id, version)
        )
    """)
    review.initialize(db, task_briefs() if briefs is None else briefs)
    return db


def _expired(record, now):
    return record["status"] == "claimed" and (
        datetime.fromisoformat(record["updated_at"]) + CLAIM_DURATION <= datetime.fromisoformat(now)
    )


def current_task(db, brief):
    row = db.execute(
        "SELECT * FROM contribution_revisions WHERE task_id=? ORDER BY version DESC LIMIT 1",
        (brief["id"],),
    ).fetchone()
    if row:
        return dict(row)
    return {
        "task_id": brief["id"], "module_id": brief["module_id"], "workstream": brief["workstream"],
        "version": 0, "status": "open", "contributor": "", "claim_digest": None,
        "project_id": None, "updated_at": None, "draft": None,
    }


def summary(row, now):
    result = {key: row[key] for key in (
        "task_id", "module_id", "workstream", "version", "status", "contributor", "project_id", "updated_at",
    )}
    result["awaiting_review"] = row["status"] == "ready_for_review"
    result["claim_expires_at"] = None
    if _expired(row, now):
        result["status"] = "open"
    elif row["status"] == "claimed":
        result["claim_expires_at"] = (datetime.fromisoformat(row["updated_at"]) + CLAIM_DURATION).isoformat()
    return result


def saved_draft(row, brief, now):
    result = summary(row, now)
    result["draft"] = json.loads(row["draft"]) if row["draft"] else None
    saved_sources = (result["draft"] or {}).get("source_revisions", {})
    revisions = {s["id"]: str(s["revision"]) for s in brief["sources"]}
    result["changed_sources"] = [key for key, saved in saved_sources.items() if revisions.get(key) != saved]
    return result


def detail(db, row, brief, now, actor=review.LOCAL):
    result = saved_draft(row, brief, now)
    history = db.execute(
        """SELECT * FROM contribution_revisions WHERE task_id=? AND action IN ('release','submit','expire')
           ORDER BY version DESC""", (row["task_id"],),
    )
    result["handoffs"] = [saved_draft(entry, brief, now) for entry in history]
    result["reviews"] = review.listing(db, actor, {brief["id"]:brief}, brief["id"])
    return result


def claim_digest(body):
    token = body.get("claim_token")
    if not isinstance(token, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{32,128}", token):
        raise RequestError("A browser claim key is required.", 403)
    return sha256(token.encode()).hexdigest()


def same_reference(url, source):
    """Recognize the pinned files and common current-page links without fetching volunteer URLs."""
    candidate, original = urlsplit(url), urlsplit(source["url"])
    host, path = candidate.hostname, unquote(candidate.path).rstrip("/")
    if host == original.hostname and path == unquote(original.path).rstrip("/") and candidate.query == original.query:
        return True
    if source.get("kind") == "wiki" and host == original.hostname:
        query = parse_qs(candidate.query)
        if source["revision"] in query.get("oldid", []):
            return True
        title = source["wiki_page"].replace("_", " ")
        if path.startswith("/wiki/"):
            return path.removeprefix("/wiki/").replace("_", " ") == title
        return path == "/index.php" and any(t.replace("_", " ") == title for t in query.get("title", []))
    if source.get("kind") == "git" and host in {"github.com", "raw.githubusercontent.com"}:
        repo = "/".join(original.path.split("/")[:3]) + "/"
        return path.lower().startswith(repo.lower()) and path.endswith("/" + source["repo_path"])
    return False


def validate_draft(draft, brief, submitting, holder):
    if not isinstance(draft, dict) or draft.get("task_id") != brief["id"]:
        raise RequestError("Choose a draft for this task.")
    kind = draft.get("kind")
    if kind not in ("answer", "question"):
        raise RequestError("Choose a proposed answer or an open question.")
    assistance = draft.get("assistance", "unreported")
    if assistance not in ("unreported", "independent", "assisted"):
        raise RequestError("Choose how much help the contribution required.")
    normalized = {"task_id": brief["id"], "kind": kind}
    if "assistance" in draft:
        normalized["assistance"] = assistance
    for name, limit in DRAFT_TEXT_LIMITS.items():
        value = short_text(draft.get(name, ""), limit, name.replace("_", " "), empty=True)
        if "\x00" in value:
            raise RequestError(f"Remove the null character in {name}.")
        normalized[name] = value.strip()
    link = normalized["additional_source"]
    if link:
        parsed = urlsplit(link)
        if (parsed.scheme not in ("http", "https") or not parsed.hostname
                or parsed.username or parsed.password or any(c.isspace() for c in link)):
            raise RequestError("Enter a complete HTTP or HTTPS evidence URL without sign-in details.")
    seconds = draft.get("active_seconds", 0)
    if type(seconds) is not int or not 0 <= seconds <= 31_536_000:
        raise RequestError("Invalid active time.")
    normalized["active_seconds"] = seconds
    selected = draft.get("source_ids", [])
    revisions = draft.get("source_revisions", {})
    if (not isinstance(selected, list) or len(selected) > 64
            or any(not isinstance(s, str) or not re.fullmatch(r"[a-zA-Z0-9_.-]{1,100}", s) for s in selected)
            or {"__proto__", "constructor", "prototype"}.intersection(selected)
            or len(set(selected)) != len(selected) or not isinstance(revisions, dict)
            or set(revisions) != set(selected)):
        raise RequestError("Each selected source must have its saved revision.")
    normalized["source_ids"] = list(selected)
    normalized["source_revisions"] = {s: short_text(revisions[s], 160, "source revision", empty=True) for s in selected}
    if submitting:
        if not normalized["text"] or not normalized["scope"] or normalized["contributor"] != holder:
            raise RequestError("Enter the observation or question, its scope, and the name on this claim.")
        if normalized["lesson_feedback"] and not normalized["lesson_step"]:
            raise RequestError("Identify the teaching step for the suggested correction.")
        if not selected and not link:
            raise RequestError("Cite at least one source before requesting review.")
        if (brief.get("answer_evidence") or brief["id"] == "wall-fastening") and kind == "answer":
            if not link or any(same_reference(link, s) for s in brief["sources"]):
                raise RequestError("Cite an additional build-specific record, or submit the uncertainty as a question.")
        current = {s["id"]: str(s["revision"]) for s in brief["sources"]}
        for source in selected:
            if current.get(source) != revisions[source]:
                raise RequestError("A cited source has changed. Recheck the evidence before requesting review.", 409)
    return normalized


def append_revision(db, row, action):
    row["version"] += 1
    db.execute(
        """INSERT INTO contribution_revisions
           (task_id, version, action, status, contributor, claim_digest, project_id, updated_at, draft,
            module_id, workstream)
           VALUES (:task_id,:version,:action,:status,:contributor,:claim_digest,:project_id,:updated_at,
                   :draft,:module_id,:workstream)""",
        {**row, "action": action},
    )


def mutate(db, brief, action, body, actor):
    # Serialize before checking the version so competing claims cannot both succeed.
    db.execute("BEGIN IMMEDIATE")
    row = current_task(db, brief)
    expected = body.get("version")
    if type(expected) is not int or expected != row["version"]:
        raise RequestError("This task changed. Reload its latest version before saving.", 409)
    digest = claim_digest(body)
    now = timestamp()
    if action == "claim":
        if row["status"] == "ready_for_review":
            raise RequestError("The submitted handoff is awaiting a reviewer decision.", 409)
        if row["status"] == "claimed":
            if not _expired(row, now):
                raise RequestError("This task is already claimed. See its current handoff.", 409)
            row.update(status="open", claim_digest=None, updated_at=now)
            append_revision(db, row, "expire")
        holder = actor.label if actor.account else short_text(body.get("contributor"), 100, "volunteer name").strip()
        project_id = body.get("project_id", row["project_id"])
        if actor.account and project_id is not None and not db.execute(
            "SELECT 1 FROM workshop_projects WHERE project=? AND account=?", (project_id,actor.account)
        ).fetchone():
            if "project_id" in body:
                raise RequestError("Unknown workshop project.",404)
            project_id = None
        if project_id is not None:
            short_text(project_id, 100, "project ID")
            project = db.execute("SELECT module_id FROM projects WHERE id=?", (project_id,)).fetchone()
            if not project or project["module_id"] != brief["module_id"]:
                raise RequestError("Choose a Studio project for the module named in this task.")
        if project_id != row["project_id"]:
            row["draft"] = None
        row.update(project_id=project_id, contributor=holder, claim_digest=digest)
        db.execute("DELETE FROM contribution_claim_accounts WHERE task_id=?", (brief["id"],))
        if actor.account:
            db.execute("INSERT INTO contribution_claim_accounts VALUES(?,?)", (brief["id"],actor.account))
    else:
        if row["status"] != "claimed" or not compare_digest(digest, row["claim_digest"] or ""):
            raise RequestError("Use the browser holding this claim to update its shared draft.", 403)
        if actor.account:
            bound = db.execute("SELECT account FROM contribution_claim_accounts WHERE task_id=?", (brief["id"],)).fetchone()
            if bound and bound["account"] != actor.account:
                raise RequestError("Sign in with the workshop account holding this claim.",403)
            if row["project_id"] and not db.execute(
                "SELECT 1 FROM workshop_projects WHERE project=? AND account=?", (row["project_id"],actor.account)
            ).fetchone():
                raise RequestError("Unknown workshop project.",404)
            if not bound:  # A valid pre-upgrade claim can be bound to its signed-in holder.
                db.execute("INSERT INTO contribution_claim_accounts VALUES(?,?)", (brief["id"],actor.account))
            row["contributor"] = actor.label
        if "project_id" in body and body["project_id"] != row["project_id"]:
            raise RequestError("This task belongs to a different Studio project.", 409)
        if action != "release" or "draft" in body:
            supplied = body.get("draft")
            if actor.account and isinstance(supplied,dict):
                supplied = {**supplied,"contributor":actor.label}
            draft = validate_draft(supplied, brief, action == "submit", row["contributor"])
            row["draft"] = encoded(draft)
        if action != "save":
            row["claim_digest"] = None
    row.update(status=STATES[action], updated_at=now)
    append_revision(db, row, action)
    if action == "submit":
        review.record_submission(db, brief, row, actor)
    result = detail(db, row, brief, now, actor)
    db.commit()
    return result


def update_after_review(db, record, outcome):
    row = db.execute("SELECT * FROM contribution_revisions WHERE task_id=? ORDER BY version DESC LIMIT 1",
                     (record["task_id"],)).fetchone()
    if row["version"] == record["submission_version"] and row["status"] == "ready_for_review":
        updated = dict(row,status=outcome,updated_at=timestamp())
        append_revision(db,updated,"review")


def dispatch(method, target, body=None, actor=review.LOCAL):
    pieces = urlsplit(target).path.rstrip("/").split("/")[1:]
    if pieces[:2] != ["api", "contributions"] or len(pieces)<3:
        raise RequestError("Unknown contribution endpoint.", 404)
    tasks = task_briefs()
    with closing(open_db(tasks)) as db:
        if pieces[2] == "reviews":
            return review.route(db,method,pieces[3:],body,actor,tasks,update_after_review)
        if pieces[2] != "tasks":
            raise RequestError("Unknown contribution endpoint.",404)
        if method == "GET" and len(pieces) == 3:
            now = timestamp()
            result = {"tasks": [summary(current_task(db, brief), now) for brief in tasks.values()]}
        elif len(pieces) < 4 or pieces[3] not in tasks:
            raise RequestError("Unknown contribution task.", 404)
        elif method == "GET" and len(pieces) == 4:
            brief = tasks[pieces[3]]
            result = detail(db, current_task(db, brief), brief, timestamp(),actor)
        elif method == "POST" and len(pieces) == 5 and pieces[4] in STATES:
            result = mutate(db, tasks[pieces[3]], pieces[4], body,actor)
        else:
            raise RequestError("Unknown contribution action.", 404)
        if actor.account:
            for entry in result.get("tasks", [result, *result.get("handoffs",[])]):
                project_id = entry["project_id"]
                if project_id and not db.execute("SELECT 1 FROM workshop_projects WHERE project=? AND account=?",
                                                  (project_id,actor.account)).fetchone():
                    entry["project_id"] = None
        return result


def handle_contribution(handler, method, body=None, actor=None):
    try:
        if actor is None:
            local_reviewer = ip_address(handler.client_address[0]).is_loopback and ip_address(handler.server.server_address[0]).is_loopback
            actor = review.LOCAL if local_reviewer else review.ReviewActor(None,"",False)
        result = dispatch(method, handler.path, body, actor)
        return handler.json_response(200, result)
    except RequestError as error:
        return handler.json_response(error.status, {"error": str(error)})
    except ValueError as error:
        return handler.json_response(400, {"error": str(error)})
    except (OSError, sqlite3.Error):
        return handler.json_response(503, {"error": "The Studio contribution store is unavailable."})
