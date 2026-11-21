"""Shared claims, version-pinned sources and handoffs for small housing-library contributions."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
import sys
import threading
import uuid

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import studio_authoring
import studio_contributions as contributions


WALL = "/api/contributions/tasks/wall-fastening"
WINDOW = "/api/contributions/tasks/window-opening"
KEY = uuid.uuid4().hex


@pytest.fixture(autouse=True)
def isolated_db(monkeypatch, tmp_path):
    monkeypatch.setenv("STUDIO_AUTHORING_DB", str(tmp_path / "studio.sqlite3"))


def post(route, body):
    return contributions.dispatch("POST", route, body)


def claim(path=WALL, version=0, name="Builder A", token=KEY, **values):
    return post(path + "/claim", {"version": version, "contributor": name, "claim_token": token, **values})


def draft(brief_id="wall-fastening", **overrides):
    brief = contributions.task_briefs()[brief_id]
    src = brief["sources"][0]
    return {
        "task_id": brief_id, "kind": "question", "text": "Which build record covers this joint?",
        "contributor": "Builder A", "scope": "OC16, plain 48 × 96-inch frame.",
        "source_ids": [src["id"]], "source_revisions": {src["id"]: src["revision"]},
        "active_seconds": 12, "help": "Which build does the source cover?",
        "lesson_step": "Compare records", "lesson_feedback": "Show the build date alongside each source.",
        **overrides,
    }


def test_independent_work_and_versioned_handoff():
    first = claim()
    assert first["claim_expires_at"] and first["version"] == 1
    assert "claim_token" not in first and "claim_digest" not in first
    second = claim(WINDOW, name="Builder B", token=uuid.uuid4().hex)
    assert second["workstream"] == "interfaces"
    saved = post(WALL + "/save", {"claim_token": KEY, "version": 1, "draft": draft()})
    assert saved["status"] == "claimed" and saved["draft"]["active_seconds"] == 12
    with pytest.raises(studio_authoring.RequestError) as exc:
        post(WALL + "/submit", {"claim_token": KEY, "version": 1, "draft": draft()})
    assert exc.value.status == 409
    submitted = post(WALL + "/submit", {"claim_token": KEY, "version": 2, "draft": draft()})
    assert submitted["status"] == "ready_for_review"
    assert submitted["handoffs"][0]["draft"] == submitted["draft"]
    assert submitted["draft"]["source_revisions"] == draft()["source_revisions"]
    pickup = claim(version=3, name="Builder B", token=uuid.uuid4().hex)
    assert pickup["draft"] == submitted["draft"] and pickup["handoffs"][0]["contributor"] == "Builder A"
    listing = contributions.dispatch("GET", "/api/contributions/tasks")
    assert all("draft" not in record for record in listing["tasks"])
    assert contributions.dispatch("GET", WALL) == pickup


def test_only_one_concurrent_claim_and_display_name_does_not_prove_ownership():
    gate = threading.Barrier(2)
    def try_claim(token):
        gate.wait(timeout=10)
        try:
            claim(token=token)
            return 200, token
        except studio_authoring.RequestError as error:
            return error.status, token
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = dict(pool.map(try_claim, [uuid.uuid4().hex, uuid.uuid4().hex]))
    assert set(responses) == {200, 409}
    with pytest.raises(studio_authoring.RequestError) as exc:
        post(WALL + "/release", {"version": 1, "contributor": "Builder A", "claim_token": responses[409]})
    assert exc.value.status == 403
    state = post(WALL + "/release", {"version": 1, "claim_token": responses[200]})
    assert state["status"] == "open" and state["claim_expires_at"] is None


def test_same_project_resumes_and_new_project_keeps_original_handoff():
    with closing(studio_authoring.connect()) as db:
        # Projects linked to contributions belong to the existing Studio workspace.
        db.executemany("INSERT INTO projects VALUES(?,?,?,?,?)", [
            (name, name, module_id, 1, "2026-01-01") for name, module_id in
            [("p1", "ICHL-015"), ("p2", "ICHL-015"), ("win", "ICHL-016")]
        ])
        db.commit()
    with pytest.raises(studio_authoring.RequestError):
        claim(project_id="win")
    claim(project_id="p1")
    post(WALL + "/release", {"version": 1, "claim_token": KEY, "draft": draft()})
    resumed = claim(version=2)
    assert resumed["project_id"] == "p1" and resumed["draft"]["text"] == draft()["text"]
    post(WALL + "/release", {"version": 3, "claim_token": KEY})
    changed = claim(version=4, project_id="p2")
    assert changed["project_id"] == "p2" and changed["draft"] is None
    assert all(h["project_id"] == "p1" for h in changed["handoffs"])
    assert changed["handoffs"][0]["draft"]["text"] == draft()["text"]


def test_lost_browser_claim_expires_without_losing_the_last_shared_draft(monkeypatch):
    monkeypatch.setattr(contributions, "timestamp", lambda: "2026-01-01T00:00:00+00:00")
    claim()
    post(WALL + "/save", {"version": 1, "claim_token": KEY, "draft": draft()})
    monkeypatch.setattr(contributions, "timestamp", lambda: "2026-01-08T00:00:01+00:00")
    state = contributions.dispatch("GET", WALL)
    assert state["status"] == "open" and state["version"] == 2
    resumed = claim(version=2, name="Builder B", token=uuid.uuid4().hex)
    assert resumed["draft"] == state["draft"] and resumed["handoffs"][0]["draft"] == state["draft"]
    with pytest.raises(studio_authoring.RequestError) as exc:
        post(WALL + "/release", {"version": resumed["version"], "claim_token": KEY})
    assert exc.value.status == 403


def test_submit_requires_checked_evidence_and_a_build_specific_wall_answer():
    claim()
    changed = draft(source_revisions={"standard-wall-card": "old"})
    saved = post(WALL + "/save", {"version": 1, "claim_token": KEY, "draft": changed})
    assert saved["changed_sources"] == ["standard-wall-card"]
    for edits in [
        changed,
        draft(source_ids=[], source_revisions={}), draft(scope=""),
        draft(contributor="Other"), draft(kind="answer"),
        draft(kind="answer", additional_source="https://wiki.opensourceecology.org/wiki/Iconic_CAD_Workflow_Example#Notes"),
        draft(kind="answer", additional_source="https://github.com/OpenSourceEcology/iconic-cad/blob/main/web/data/card_templates/standard.json"),
        draft(kind="answer", additional_source="javascript:void(0)"), draft(active_seconds=-1),
        draft(additional_source="https://builder:pass@example.org/"), draft(lesson_step=""),
    ]:
        with pytest.raises(studio_authoring.RequestError):
            post(WALL + "/submit", {"version": 2, "claim_token": KEY, "draft": edits})
    assert contributions.dispatch("GET", WALL) == saved
    supported = draft(kind="answer", text="Proposed reading of the field record.",
                      additional_source="https://example.org/site-log/observations/7")
    ready = post(WALL + "/submit", {"version": 2, "claim_token": KEY, "draft": supported})
    assert ready["status"] == "ready_for_review"
