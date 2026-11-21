"""Authoring revisions, exports, provider suggestions and compiler receipts."""
from io import BytesIO
import json
from pathlib import Path
import sys
from zipfile import ZipFile

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import studio_authoring as app


@pytest.fixture
def local(tmp_path, monkeypatch):
    repo = tmp_path / "cad"
    folder = repo / "ichl_wall"
    (folder / "instances").mkdir(parents=True)
    (folder / "catalog.json").write_text('{"module_id":"ICHL-015"}')
    (folder / "instances/OC16.json").write_text(json.dumps({
        "module_id": "ICHL-015", "spacing_in": 16, "drawing_dimensions": ["wall.width"],
    }))
    monkeypatch.setenv("STUDIO_AUTHORING_DB", str(tmp_path / "study.sqlite3"))
    monkeypatch.setenv("STUDIO_ICONIC_ROOT", str(repo))
    for name in ("STUDIO_LLM_BASE_URL", "STUDIO_LLM_MODEL", "STUDIO_FREECAD_PYTHON"):
        monkeypatch.delenv(name, raising=False)
    return folder


def api(method, target, body=None, llm=None):
    return app.dispatch(method, "/api/authoring/" + target, body, llm)


def create(module="ICHL-015"):
    project = api("POST", "projects", {"name": "Parker's wall", "module_id": module})
    return "projects/" + project["id"], project


def fake_provider(base, payload):
    context = json.loads(payload["messages"][1]["content"])
    assert context["sources"][0]["url"].endswith(str(context["sources"][0]["revid"]))
    return {
        "reply": "Try the OC24 reference.", "sources": [context["sources"][0]["id"]],
        "edits": [{"path": "/instance/spacing_in", "value": 24}],
    }


def test_versioned_progress_is_resumable_and_conflicting_writes_do_not_win(local):
    route, original = create()
    state = api("POST", route + "/save", {
        "version": 1, "active_workstream": "connections", "notes": {"connections": "Locate the builder's fastening log."},
    })
    assert api("GET", route) == state
    assert api("GET", route + "/revisions/1")["notes"] == {}
    assert state["evidence"][0]["revid"] and state["history"][0]["version"] == 2
    with pytest.raises(app.RequestError) as error:
        api("POST", route + "/save", {"version": 1, "notes": {"connections": "old tab"}})
    assert error.value.status == 409
    assert api("GET", route)["notes"]["connections"].startswith("Locate")
    assert api("GET", "projects")["projects"][0]["name"] == original["name"]


def test_live_proposal_requires_accept_and_preserves_before_values(local, monkeypatch):
    route, _ = create()
    monkeypatch.setenv("STUDIO_LLM_BASE_URL", "http://local.test")
    monkeypatch.setenv("STUDIO_LLM_MODEL", "test-model")
    p = api("POST", route + "/propose", {"prompt": "Switch spacing", "version": 1}, fake_provider)
    assert p["instance"]["spacing_in"] == 16 and p["proposals"][0]["diff"] == [
        {"path": "/instance/spacing_in", "before": 16, "after": 24},
    ]
    p = api("POST", route + "/accept", {"version": 2, "proposal_id": p["proposals"][0]["id"]})
    assert p["instance"]["spacing_in"] == 24 and p["proposals"][0]["status"] == "accepted"
    with pytest.raises(app.RequestError):
        api("POST", route + "/accept", {"version": 3, "proposal_id": p["proposals"][0]["id"]})
    assert api("GET", route)["version"] == 3


def test_unmatched_citation_or_review_change_never_saved(local, monkeypatch):
    route, _ = create()
    monkeypatch.setenv("STUDIO_LLM_BASE_URL", "http://local.test")
    monkeypatch.setenv("STUDIO_LLM_MODEL", "test-model")
    for response in [
        {"sources": ["invented"], "edits": []},
        {"sources": [], "edits": [{"path": "/instance/fastening", "value": {"reviewer": "bot"}}]},
    ]:
        with pytest.raises(app.RequestError):
            api("POST", route + "/propose", {"prompt": "please help", "version": 1}, lambda *args: {"reply": "Draft", **response})
    assert api("GET", route)["version"] == 1


def test_stale_proposal_does_not_overwrite_manual_edit(local, monkeypatch):
    route, _ = create()
    monkeypatch.setenv("STUDIO_LLM_BASE_URL", "http://local.test")
    monkeypatch.setenv("STUDIO_LLM_MODEL", "test-model")
    proposal = api("POST", route + "/propose", {"prompt": "Switch spacing", "version": 1}, fake_provider)
    instance = {**proposal["instance"], "spacing_in": 24}
    api("POST", route + "/save", {"instance": instance, "version": 2})
    with pytest.raises(app.RequestError) as error:
        api("POST", route + "/accept", {"version": 3, "proposal_id": proposal["proposals"][0]["id"]})
    assert error.value.status == 409


def test_compiler_artifacts_survive_restart_and_stale_build_cannot_be_exported(local):
    # Small executable compiler tests the actual subprocess and receipt contract.
    (local / "__main__.py").write_text("""
import sys, json
from pathlib import Path
target = Path(sys.argv[sys.argv.index("--out")+1]); target.mkdir()
(target / "manifest.json").write_text(json.dumps({"module_id":"ICHL-015","variant":"OC16",
    "workstreams":[{"id":"drawings","status":"invalid","files":["drawing.svg"]}]}))
(target / "drawing.svg").write_text('<svg/>')
sys.exit(2)
""")
    route, initial = create()
    built = api("POST", route + "/generate", {"version": 1})
    assert built["build"]["manifest"]["workstreams"][0]["status"] == "invalid"
    artifact = [r for r in built["build"]["artifacts"] if r["path"] == "drawing.svg"][0]
    assert app.dispatch("GET", artifact["url"], None, None).content == b"<svg/>"
    saved = api("POST", route + "/save", {"notes": {"drawings":"inspect sheet"}, "version": 2})
    assert saved["build"]["stale"] is False
    archive = ZipFile(BytesIO(api("GET", route + "/package").content))
    assert "outputs/drawing.svg" in archive.namelist()
    snapshot = app.source_snapshots("ICHL-015")[0]["text"]
    assert archive.read("wiki-draft.wikitext").decode().startswith(snapshot)
    assert "construction review: pending" in archive.read("wiki-draft.wikitext").decode().lower()
    edited = api("POST", route + "/save", {"instance": {**initial["instance"], "spacing_in": 24}, "version": 3})
    assert edited["build"]["stale"] is True
    with pytest.raises(app.RequestError) as error:
        api("GET", route + "/wiki")
    assert error.value.status == 409
    assert app.dispatch("GET", artifact["url"], None, None).content == b"<svg/>"


def test_live_wiki_preserves_existing_text_and_replaces_only_generated_region(local, monkeypatch):
    route, _ = create()
    original = "Author credits\n{{Original template}}\n"
    monkeypatch.setattr(app, "live_source", lambda module: {"text": original, "revid": 123})
    first = api("GET", route + "/wiki?source=live").content.decode()
    assert first.startswith(original) and "live wiki source: 123" in first
    monkeypatch.setattr(app, "live_source", lambda module: {"text": first + "other text", "revid": 124})
    second = api("GET", route + "/wiki?source=live").content.decode()
    assert second.startswith(original) and second.endswith("other text") and second.count("== Contributor package ==") == 1


def test_second_module_is_intake_only_with_its_own_sources(local):
    route, state = create("ICHL-016")
    assert state["instance"]["module_id"] == "ICHL-016"
    assert any("Registry" in e["title"] for e in state["evidence"])
    draft = api("GET", route + "/wiki").content.decode()
    assert "Module: ICHL-016" in draft and "draft appendix only" in draft
    assert "== Contributor package ==" in draft and len(draft) < 2000
    with pytest.raises(app.RequestError) as error:
        api("POST", route + "/generate", {"version": 1})
    assert error.value.status == 422


def test_named_wikibot_snapshot_is_pinned_per_project(local, tmp_path, monkeypatch):
    path = tmp_path / "wikibot.sqlite3"
    text = "Independent framing log from named snapshot A"
    db = app.sqlite3.connect(path)
    with db:
        db.executescript("""
            CREATE TABLE snapshots(id TEXT,source_id INTEGER);
            CREATE TABLE snapshot_pages(snapshot_id TEXT,page_id INTEGER,ordinal INTEGER);
            CREATE TABLE pages(id INTEGER,source_id INTEGER,title TEXT,revid INTEGER,timestamp TEXT,text TEXT,content_sha256 TEXT);
            INSERT INTO snapshots VALUES('snapshot-a',2);
            INSERT INTO snapshot_pages VALUES('snapshot-a',1,0);
        """)
        db.execute("INSERT INTO pages VALUES(1,2,'ICHL-015',234,'2026-09-01',?,?)", (text, app.sha256(text.encode()).hexdigest()))
    db.close()
    monkeypatch.setenv("STUDIO_WIKIBOT_EVIDENCE_DB", str(path))
    monkeypatch.setenv("STUDIO_WIKIBOT_SNAPSHOT", "snapshot-a")
    route, p = create()
    assert any(s["revid"] == 234 and s["excerpt"] == text for s in p["evidence"])
    path.unlink()
    # Saved revisions and exports continue to resolve against their original sources.
    assert api("GET", route + "/wiki").content.startswith(text.encode())
    assert any(s["revid"] == 234 for s in api("GET", route)["evidence"])

def test_registry_entries_are_available_for_intake_with_module_specific_scope(local):
    catalog = api("GET", "modules")["modules"]
    assert [module["id"] for module in catalog[:2]] == ["ICHL-015", "ICHL-016"]
    assert "ICHL-011" in {m["id"] for m in catalog}  # This registry row includes a check template.
    route, project = create("ICHL-303")
    assert "drywall" in project["instance"]["scope"].lower()
    assert set(project["instance"]) == {"module_id", "scope", "interfaces", "parameters"}
    assert len(project["evidence"]) == 1
    assert "drywall" in project["evidence"][0]["excerpt"].lower()
    with pytest.raises(app.RequestError) as error:
        api("POST", route + "/generate", {"version": 1})
    assert error.value.status == 422
