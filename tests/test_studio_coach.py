"""Exercise the same project, confirmation and package paths the builder uses."""
from contextlib import closing
from io import BytesIO
import json
import os
from pathlib import Path
import sys
from zipfile import ZipFile

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import studio_coach as app

author = app.author


@pytest.fixture(autouse=True)
def isolate(tmp_path, monkeypatch):
    monkeypatch.setenv("STUDIO_AUTHORING_DB", str(tmp_path / "coach.sqlite3"))
    for prefix in ("STUDIO_LLM_", "STUDIO_FRONTIER_"):
        for key in list(os.environ):
            if key.startswith(prefix):
                monkeypatch.delenv(key)


def create(module="ICHL-016"):
    with closing(author.connect()) as db:
        project = author.create(db, {"name": "Workbench", "module_id": module})
    return app.dispatch("GET", "/api/coach/projects/" + project["id"], None, None)


def post(state, op, model=None, **values):
    return app.dispatch("POST", "/api/coach/projects/" + state["project"]["id"] + "/" + op,
                        {"version": state["project"]["version"], **values}, model, "test-cookie")


def act(state, action, text="Please show me the proposed action"):
    proposed = post(state, "message", text=text, action_id=action)
    return post(proposed, "confirm", proposal_id=proposed["pending"]["id"])


def test_every_workstream_has_a_distinct_procedure_and_example():
    assert {row["workstream"] for row in app.LESSONS if row["workstream"]} == set(author.STREAMS)
    assert len({row["id"] for row in app.LESSONS}) == 17
    assert all(row["prompt"] and row["resources"] and len(row["steps"]) >= 2 for row in app.LESSONS)
    assert "Special:Upload" in json.dumps(app.BY_ID["wiki"])


def test_generic_intake_and_revision_conflict():
    state = create()
    other = create()
    assert len({row["workstream"] for row in state["lessons"] if row["workstream"]}) == 11
    assert "space_24" not in [a["id"] for a in state["actions"]]
    state = post(state, "lesson", lesson_id="interfaces")
    state = post(state, "message", text="Note: Which datum did the window installer use?")
    assert state["pending"]["changes"][0]["path"] == "/notes/interfaces"
    assert state["project"]["notes"] == {} and not other["messages"]
    with pytest.raises(author.RequestError):
        post(other, "confirm", proposal_id=state["pending"]["id"])
    with closing(author.connect()) as db:
        manual = author.current(db, state["project"]["id"])
        author.record(db, manual, "External editor", manual["version"])
    with pytest.raises(author.RequestError) as err:
        post(state, "confirm", proposal_id=state["pending"]["id"])
    assert err.value.status == 409
    refreshed = app.dispatch("GET", "/api/coach/projects/" + state["project"]["id"], None, None)
    assert refreshed["pending"] is None
    saved = act(refreshed, "save_note", "Which datum did the installer use?")
    assert saved["project"]["notes"] == {"interfaces": "Which datum did the installer use?"}


def test_live_context_and_unverifiable_output(monkeypatch):
    monkeypatch.setenv("STUDIO_LLM_MODEL", "installed")
    monkeypatch.setenv("STUDIO_LLM_BASE_URL", "http://local")
    state = post(create(), "lesson", lesson_id="interfaces")
    state = post(state, "message", text="I found a datum.")
    def model(base, payload):
        assert base == "http://local" and payload["model"] == "installed"
        context = json.loads(payload["messages"][-1]["content"])
        assert context["version"] == state["project"]["version"]
        assert context["module_id"] == "ICHL-016" and context["history"][-2]["text"] == "I found a datum."
        return {"reply": "Which drawing establishes that datum?", "sources": [context["sources"][0]["id"]]}
    live = post(state, "message", model, mode="free", text="What would establish that?",
                model_name="paid", base_url="http://ignored")
    msg = live["messages"][-1]
    assert msg["mode"] == "free" and msg["sources"][0]["revision"]
    bogus = lambda *_: {"reply": "I certified your build.", "sources": ["unknown"], "action_id": "approve"}
    fallback = post(live, "message", bogus, mode="free", text="Can you explain?")
    assert fallback["messages"][-1]["mode"] == "guided"
    assert "certified" not in fallback["messages"][-1]["text"]
    assert fallback["pending"] is None


def test_frontier_attaches_metered_receipt_and_never_calls_free(monkeypatch):
    state = create()
    monkeypatch.setenv("STUDIO_FRONTIER_MODEL", "frontier")
    monkeypatch.setenv("STUDIO_FRONTIER_BASE_URL", "https://model.example")
    def meter(cookie, request_id, payload, invoke):
        assert cookie == "test-cookie" and request_id == "request-id" and payload["model"] == "frontier"
        assert payload["max_completion_tokens"] > 0
        return {"choices":[{"message":{"content":"malformed"}}]}, {"amount_microusd": 99}
    monkeypatch.setattr(app.credits, "metered_completion", meter)
    state = post(state, "message", lambda *_: pytest.fail("free mode was invoked"), text="What now?",
                 mode="frontier", request_id="request-id")
    msg = state["messages"][-1]
    assert msg["mode"] == "guided" and msg["receipt"]["amount_microusd"] == 99
    def reject(*_):
        raise author.RequestError("Insufficient credit.", 402)
    monkeypatch.setattr(app.credits, "metered_completion", reject)
    with pytest.raises(author.RequestError) as err:
        post(state, "message", text="Continue", mode="frontier", request_id="another")
    assert err.value.status == 402


def test_confirmed_wall_exercise_with_real_compiler_and_exports():
    if not (author.cad_root() / "ichl_wall/geometry.mjs").is_file():
        pytest.skip("Install the pinned CAD compiler or set STUDIO_ICONIC_ROOT.")
    state = create("ICHL-015")
    state = post(state, "lesson", lesson_id="geometry")
    state = act(state, "generate")
    assert len(state["project"]["build"]["manifest"]["members"]) == 7
    assert any("wall.FCStd" in ref["url"] for ref in state["lesson"]["resources"])
    state = post(state, "lesson", lesson_id="drawings")
    state = act(state, "dimension_at16")
    proposed = post(state, "message", text="Change the spacing to 24 inches.")
    assert proposed["project"]["instance"]["spacing_in"] == 16
    assert proposed["pending"]["action_id"] == "space_24"
    state = post(proposed, "confirm", proposal_id=proposed["pending"]["id"])
    def drawing(state):
        return next(row for row in state["project"]["build"]["manifest"]["workstreams"] if row["id"] == "drawings")
    assert len(state["project"]["build"]["manifest"]["members"]) == 6
    assert drawing(state)["status"] == "invalid"
    bad_artifact = next(item["url"] for item in state["project"]["build"]["artifacts"] if item["path"] == "drawing.svg")
    state = act(state, "repair_dimension")
    assert drawing(state)["status"] == "ready_for_review"
    assert "stud.at24.offset" in state["project"]["instance"]["drawing_dimensions"]
    assert state["project"]["instance"]["fastening"] is None
    package = author.dispatch("GET", state["links"]["package"], None, None)
    with ZipFile(BytesIO(package.content)) as archive:
        assert {"upload-names.json", "wiki-draft.wikitext", "outputs/drawing.svg", "outputs/wall.FCStd"} <= set(archive.namelist())
    assert author.dispatch("GET", bad_artifact, None, None).content
    assert author.dispatch("GET", state["links"]["wiki"], None, None).content


def test_unresolved_fasteners_retain_project_evidence_and_separate_verification(tmp_path, monkeypatch):
    folder = tmp_path / "cad/ichl_wall/instances"
    folder.mkdir(parents=True)
    (folder / "OC16.json").write_text('{"module_id":"ICHL-015","spacing_in":16,"fastening":null}')
    monkeypatch.setenv("STUDIO_ICONIC_ROOT", str(tmp_path / "cad"))
    monkeypatch.setenv("STUDIO_LLM_MODEL", "installed")
    monkeypatch.setenv("STUDIO_LLM_BASE_URL", "http://local")
    state = create("ICHL-015")
    def premature(*args):
        return {"reply": "The newer source decides the issue. Use screws.", "sources": ["standard-wall-card"],
                "verification_id": "schedule"}
    state = post(state, "message", premature, mode="free", text="What screw or nail should I use?")
    msg = state["messages"][-1]
    assert "applicability is unresolved" in msg["text"] and "Use screws" not in msg["text"]
    assert app.VERIFICATION["schedule"] in msg["text"] and msg["mode"] == "free"
    assert {s["id"] for s in msg["sources"]} == {"standard-wall-card", "wall-workflow"}
    state = post(state, "lesson", lesson_id="connections")
    assert any("applicability is unresolved" in step for step in state["lesson"]["steps"])
    state = post(state, "message", text="What goes between the top plates?")
    assert "top-plate lap" in state["messages"][-1]["text"]
    def ordinary(base, payload):
        ctx = json.loads(payload["messages"][-1]["content"])
        assert ctx["fastening_evidence"] is None
        assert ctx["actions"] == []
        return {"reply": "The project keeps your earlier revisions.", "sources": ["workspace-procedure"], "action_id": "save_note"}
    state = post(state, "message", ordinary, mode="free", text="How does my project remember what I wrote yesterday?")
    assert state["messages"][-1]["text"] == "The project keeps your earlier revisions." and state["pending"] is None
    state = post(state, "message", lambda *_: pytest.fail("No paid model call needed for saved file links"),
                 mode="frontier", text="Where can I download my package?")
    reply = state["messages"][-1]
    assert reply["mode"] == "guided" and "available now" in reply["text"]
    assert {s["id"] for s in reply["sources"]} == {"project-zip", "wiki-draft"}
    state = post(state, "message", lambda *_: {"verification_id": "not-an-option"},
                 mode="free", text="Which stud-to-plate fastener?")
    reply = state["messages"][-1]
    assert reply["mode"] == "guided" and "verifiable reply" in reply["text"] and "applicability is unresolved" in reply["text"]


def test_ose_purpose_for_first_time_and_transfer_contributors(tmp_path, monkeypatch):
    folder = tmp_path / "cad/ichl_wall/instances"
    folder.mkdir(parents=True)
    (folder / "OC16.json").write_text('{"module_id":"ICHL-015","spacing_in":16}')
    monkeypatch.setenv("STUDIO_ICONIC_ROOT", str(tmp_path / "cad"))
    wall = post(create("ICHL-015"), "message", text="Why does OSE want my wall notes?")
    msg = wall["messages"][-1]
    assert "a photo of a stud" in msg["text"] and wall["pending"] is None
    assert {s["id"] for s in msg["sources"]} == {"ose-mission", "ose-housing-purpose", "ose-contribution-purpose"}
    for source in msg["sources"]:
        if "revision" in source:
            assert "oldid=" + source["revision"] in source["url"]
        else:
            assert source["reviewed_on"] == "2026-11-21"
    window = post(create("ICHL-016"), "lesson", lesson_id="interfaces")
    window = post(window, "message", text="How does a module help other builders?")
    assert "reference face" in window["messages"][-1]["text"]
    assert window["lesson"]["id"] == "interfaces" and window["pending"] is None
    monkeypatch.setenv("STUDIO_LLM_BASE_URL", "http://local")
    monkeypatch.setenv("STUDIO_LLM_MODEL", "test-installed-model")
    def explain(base, payload):
        context = json.loads(payload["messages"][-1]["content"])
        assert context["module_id"] == "ICHL-016" and context["lesson"]["id"] == "welcome"
        refs = {row["id"]: row for row in context["sources"]}
        assert refs["ose-contribution-purpose"]["revision"] == "339175"
        return {"reply": "A second builder can follow the documented procedure.", "sources": ["ose-contribution-purpose"]}
    window = post(window, "message", explain, mode="free", text="What is OSE's mission?")
    assert window["messages"][-1]["mode"] == "free" and window["messages"][-1]["sources"][0]["revision"] == "339175"
