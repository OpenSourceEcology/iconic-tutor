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
    assert submitted["status"] == "ready_for_review" and submitted["awaiting_review"]
    assert submitted["handoffs"][0]["draft"] == submitted["draft"]
    assert submitted["draft"]["source_revisions"] == draft()["source_revisions"]
    with pytest.raises(studio_authoring.RequestError) as waiting:
        claim(version=3,name="Builder B",token=uuid.uuid4().hex)
    assert waiting.value.status==409
    review_id=submitted["reviews"][0]["id"]
    post("/api/contributions/reviews/"+review_id+"/decision",{
        "submission_version":3,"outcome":"open_question","feedback":"Ask the builder which configuration is documented.",
    })
    pickup = claim(version=4, name="Builder B", token=uuid.uuid4().hex)
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
        draft(source_ids=[], source_revisions={}),
        draft(scope=""),
        draft(contributor="Other"),
        draft(kind="answer"),
        draft(assistance="forged"),
        draft(
            kind="answer",
            additional_source="https://wiki.opensourceecology.org/wiki/Iconic_CAD_Workflow_Example#Notes",
        ),
        draft(
            kind="answer",
            additional_source="https://github.com/OpenSourceEcology/iconic-cad/blob/main/web/data/card_templates/standard.json",
        ),
        draft(kind="answer", additional_source="javascript:void(0)"),
        draft(active_seconds=-1),
        draft(additional_source="https://builder:pass@example.org/"),
        draft(lesson_step=""),
    ]:
        with pytest.raises(studio_authoring.RequestError):
            post(WALL + "/submit", {"version": 2, "claim_token": KEY, "draft": edits})
    assert contributions.dispatch("GET", WALL) == saved
    supported = draft(
        kind="answer",
        text="Proposed reading of the field record.",
        additional_source="https://example.org/site-log/observations/7",
    )
    ready = post(WALL + "/submit", {"version": 2, "claim_token": KEY, "draft": supported})
    assert ready["status"] == "ready_for_review"


def test_two_reviewer_decisions_are_serialized_and_pinned_sources_report_drift(monkeypatch):
    claim()
    evidence = draft(kind="answer", additional_source="https://example.org/field-record/wall-3")
    ready = post(WALL + "/submit", {"version": 1, "claim_token": KEY, "draft": evidence})
    route = "/api/contributions/reviews/" + ready["reviews"][0]["id"]
    first = contributions.dispatch("GET", route)
    assert first["effects"]["state"] == "no_project" and first["sources"][0]["excerpt"]
    briefs = contributions.task_briefs()
    briefs["wall-fastening"]["sources"][0]["excerpt"] += " Updated context."
    monkeypatch.setattr(contributions, "task_briefs", lambda: briefs)
    changed = contributions.dispatch("GET", route)
    assert (
        changed["changed_sources"] == [first["sources"][0]["id"]] and changed["sources"] == first["sources"]
    )
    with pytest.raises(studio_authoring.RequestError) as err:
        post(route + "/decision", {"submission_version": 2, "outcome": "accepted", "feedback": "Reviewed"})
    assert err.value.status == 409
    barrier = threading.Barrier(2)

    def decide(outcome):
        barrier.wait(timeout=5)
        try:
            result = post(
                route + "/decision", {"submission_version": 2, "outcome": outcome, "feedback": outcome}
            )
            return result["decision"], 200
        except studio_authoring.RequestError as exc:
            return None, exc.status

    with ThreadPoolExecutor(max_workers=2) as pool:
        attempts = list(pool.map(decide, ["needs_evidence", "open_question"]))
    assert sorted(code for _, code in attempts) == [200, 409]
    chosen = next(r for r, _ in attempts if r)
    assert contributions.dispatch("GET", route)["decision"] == chosen
    assert contributions.dispatch("GET", WALL)["reviews"][0]["decision"] == chosen


def test_pre_upgrade_submissions_retain_original_claim_and_mark_missing_snapshot():
    claim()
    ready = post(WALL + "/submit", {"version": 1, "claim_token": KEY, "draft": draft()})
    with closing(contributions.open_db()) as db:
        # A legacy installation persisted only the contribution revision for each handoff.
        db.execute("DELETE FROM review_submissions")
        db.commit()
    migrated = contributions.dispatch("GET", "/api/contributions/reviews")["reviews"]
    assert len(migrated) == 1
    route = "/api/contributions/reviews/" + migrated[0]["id"]
    saved = contributions.dispatch("GET", route)
    assert saved["effects"]["state"] == "legacy" and not saved["sources"]
    assert saved["draft"]["source_revisions"] == ready["draft"]["source_revisions"]
    with pytest.raises(studio_authoring.RequestError) as err:
        post(
            route + "/decision",
            {"submission_version": 2, "outcome": "accepted", "feedback": "Looks complete"},
        )
    assert err.value.status == 409
    assert (
        post(
            route + "/decision",
            {"submission_version": 2, "outcome": "needs_evidence", "feedback": "Resubmit pinned sources."},
        )["status"]
        == "needs_evidence"
    )
    assert (
        contributions.dispatch("GET", "/api/contributions/reviews")["reviews"][0]["id"] == migrated[0]["id"]
    )


def test_new_independent_evidence_tasks_use_catalog_requirement():
    brief = {
        **contributions.task_briefs()["window-opening"],
        "answer_evidence": "Identify an independently dated quote.",
    }
    source = brief["sources"][0]
    item = {
        "task_id": brief["id"],
        "kind": "answer",
        "text": "A quote was supplied.",
        "scope": "A single project.",
        "contributor": "Builder A",
        "source_ids": [source["id"]],
        "source_revisions": {source["id"]: source["revision"]},
    }
    for url in ["", source["url"]]:
        with pytest.raises(studio_authoring.RequestError):
            contributions.validate_draft({**item, "additional_source": url}, brief, True, "Builder A")
    contributions.validate_draft({**item, "kind": "question"}, brief, True, "Builder A")
    contributions.validate_draft(
        {**item, "additional_source": "https://example.org/quote/1"}, brief, True, "Builder A"
    )
