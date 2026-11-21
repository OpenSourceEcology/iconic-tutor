"""Exercise invited workshop participants through real HTTP with isolated sessions."""
from contextlib import closing
from functools import partial
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from io import BytesIO
import json
from pathlib import Path
import sys
from threading import Thread
from zipfile import ZipFile

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import coach_workshop as workshop


class Participant:
    def __init__(self, server):
        self.server = server
        self.cookie = ""

    def request(self, target, body=None, expected=200, origin=None):
        host, port = self.server.server_address
        headers = {"Origin": origin or self.server.public_origin}
        if self.cookie:
            headers["Cookie"] = self.cookie
        if body is not None:
            headers["Content-Type"] = "application/json"
        with closing(HTTPConnection(host, port, timeout=10)) as connection:
            connection.request("GET" if body is None else "POST", target,
                               None if body is None else json.dumps(body), headers)
            response = connection.getresponse()
            data = response.read()
            assert response.status == expected, (target, response.status, data[:250])
            assert response.getheader("Cache-Control") == "no-store"
            cookie = response.getheader("Set-Cookie")
            if cookie:
                self.cookie = cookie.split(";", 1)[0]
            if response.getheader("Content-Type").startswith("application/json"):
                return json.loads(data)
            return data

    def sign_in(self, name):
        _, code = workshop.credits.create_account(name)
        result = self.request("/api/credits/login", {"code": code})
        assert result["account_label"] == name
        assert self.cookie
        return self


@pytest.fixture
def server(tmp_path, monkeypatch):
    # configure() selects the workshop DB even if the shell has a personal Studio DB.
    monkeypatch.setenv("STUDIO_AUTHORING_DB", str(tmp_path / "unused.sqlite3"))
    monkeypatch.delenv("STUDIO_FREECAD_PYTHON", raising=False)
    monkeypatch.delenv("STUDIO_PUBLIC_ORIGIN", raising=False)
    workshop.configure(tmp_path / "workshop")
    cad = tmp_path / "cad"
    tool = cad / "ichl_wall"
    (tool / "instances").mkdir(parents=True)
    (tool / "instances" / "OC16.json").write_text('{"module_id":"ICHL-015","spacing_in":16}')
    (tool / "catalog.json").write_text('{"module_id":"ICHL-015"}')
    # Make a small configuration-specific file so historical download contents can be checked.
    (tool / "__main__.py").write_text("""
import json, sys
from pathlib import Path
instance = json.loads(Path(sys.argv[sys.argv.index('--instance')+1]).read_text())
out = Path(sys.argv[sys.argv.index('--out')+1])
out.mkdir()
(out / 'drawing.svg').write_text('<svg><title>OC' + str(instance['spacing_in']) + '</title></svg>')
(out / 'manifest.json').write_text(json.dumps({'module_id':'ICHL-015','variant':'OC'+str(instance['spacing_in']),
    'workstreams':[{'id':'drawings','status':'verified','files':['drawing.svg']}]}))
""")
    monkeypatch.setenv("STUDIO_ICONIC_ROOT", str(cad))
    handler = partial(workshop.Workshop, directory=str(workshop.WEB))
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as service:
        service.public_origin = f"http://127.0.0.1:{service.server_port}"
        thread = Thread(target=service.serve_forever, daemon=True)
        thread.start()
        try:
            yield service
        finally:
            service.shutdown()
            thread.join(timeout=5)


PROJECTS = "/api/authoring/projects"


def create(account, name):
    return account.request(PROJECTS, {"name": name, "module_id": "ICHL-015"})


def test_participants_resume_only_their_own_workshop_projects(server):
    guest = Participant(server)
    guest.request(PROJECTS, expected=401)
    alice = Participant(server).sign_in("Contributor A")
    # Participants can have the same display name; membership follows their account.
    bob = Participant(server).sign_in("Contributor A")
    a_key = alice.request("/api/credits/status")["account_storage_id"]
    b_key = bob.request("/api/credits/status")["account_storage_id"]
    assert a_key != b_key
    assert "account_storage_id" not in guest.request("/api/credits/status")
    a = create(alice, "Alice wall")
    b = create(bob, "Bob wall")
    assert [row["id"] for row in alice.request(PROJECTS)["projects"]] == [a["id"]]
    assert [row["id"] for row in bob.request(PROJECTS)["projects"]] == [b["id"]]
    route = PROJECTS + "/" + a["id"]
    coach = "/api/coach/projects/" + a["id"]
    assert alice.request(coach)["project"]["name"] == "Alice wall"
    discussion = alice.request(coach + "/message", {"version":1, "text":"How do I document this module?", "mode":"guided"})
    assert discussion["project"]["version"] == 2
    assert any(message["text"] == "How do I document this module?" for message in discussion["messages"])
    assert not bob.request("/api/coach/projects/" + b["id"])["messages"]
    for path in (route, route + "/revisions/1", coach, route + "/package", route + "/wiki"):
        bob.request(path, expected=404)
        guest.request(path, expected=401)
    bob.request(route + "/save", {"version":2, "notes":{"geometry":"Bob's review"}}, expected=404)
    assert alice.request(route)["version"] == 2
    bob.request("/api/credits/logout", {})
    bob.request(PROJECTS + "/" + b["id"], expected=401)
    assert alice.request(coach)["project"]["id"] == a["id"]


def test_cross_origin_requests_leave_project_and_session_unchanged(server):
    account = Participant(server).sign_in("Participant")
    p = create(account, "Draft module")
    route = PROJECTS + "/" + p["id"]
    other_site = "https://another-site.example"
    account.request(route, expected=403, origin=other_site)
    account.request(route + "/save", {"version":1,"notes":{"drawings":"example"}}, expected=403, origin=other_site)
    account.request("/api/credits/logout", {}, expected=403, origin=other_site)
    assert account.request("/api/credits/status")["authenticated"]
    assert account.request(route)["version"] == 1


def test_exports_record_revision_and_old_generated_artifact_keeps_its_configuration(server):
    alice = Participant(server).sign_in("Author")
    bob = Participant(server).sign_in("Reviewer")
    p = create(alice, "Two wall configurations")
    route = PROJECTS + "/" + p["id"]
    first = alice.request(route + "/generate", {"version":p["version"]})
    artifact = next(row["url"] for row in first["build"]["artifacts"] if row["path"] == "drawing.svg")
    links = alice.request("/api/coach/projects/" + p["id"])["links"]
    first_exports = route + "/revisions/" + str(first["version"])
    assert links["package"] == first_exports + "/package"
    assert links["wiki"] == first_exports + "/wiki"
    archive = alice.request(links["package"])
    with ZipFile(BytesIO(archive)) as zipped:
        saved = json.loads(zipped.read("project.json"))
        assert saved["id"] == p["id"] and saved["version"] == first["version"]
        assert zipped.read("outputs/drawing.svg") == alice.request(artifact)
        assert f"Tutor project revision: {first['version']}".encode() in zipped.read("wiki-draft.wikitext")
    changed = alice.request(route + "/save", {"version":first["version"], "instance":{**first["instance"],"spacing_in":24}})
    alice.request(route + "/package", expected=409)
    second = alice.request(route + "/generate", {"version":changed["version"]})
    updated = next(row["url"] for row in second["build"]["artifacts"] if row["path"] == "drawing.svg")
    assert updated != artifact
    assert b"OC16" in alice.request(artifact)
    assert b"OC24" in alice.request(updated)
    assert alice.request(route + "/revisions/" + str(first["version"]))["instance"]["spacing_in"] == 16
    assert f"Tutor project revision: {second['version']}".encode() in alice.request(route + "/wiki")
    with ZipFile(BytesIO(alice.request(links["package"]))) as historical:
        assert json.loads(historical.read("project.json"))["version"] == first["version"]
        assert b"OC16" in historical.read("outputs/drawing.svg")
    assert f"Tutor project revision: {first['version']}".encode() in alice.request(links["wiki"])
    for download in (artifact, updated, route + "/package", route + "/wiki", links["package"], links["wiki"]):
        bob.request(download, expected=404)
