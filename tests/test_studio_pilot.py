"""A review round can include only paid coach calls explicitly linked to its active claim."""
from contextlib import closing
import json
from pathlib import Path
import sys
from uuid import uuid4

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import studio_authoring as author
import studio_coach as coach
import studio_contributions as board
import studio_pilot as pilot
import studio_review as review

TASK = "window-opening"
TASK_URL = "/api/contributions/tasks/" + TASK
PILOT = "/api/contributions/reviews/pilot"


def test_claim_bound_metering_two_rounds_and_unrelated_histories(tmp_path, monkeypatch):
    monkeypatch.setenv("STUDIO_AUTHORING_DB", str(tmp_path / "pilot.sqlite"))
    monkeypatch.setenv("STUDIO_FRONTIER_MODEL", "test-frontier")
    monkeypatch.setenv("STUDIO_FRONTIER_BASE_URL", "http://unused")
    supplied_receipts = iter([(900, 1000), (12, 15), (0, 0), (6, 9)])
    def metered(cookie, request_id, payload, invoke):
        model_cost, charge = next(supplied_receipts)
        assert "pilot_claim_token" not in json.dumps(payload) and token not in json.dumps(payload)
        return ({"choices": [{"message": {"content": '{"reply":"Which record identifies the build?","sources":["workspace-procedure"]}'}}]},
                {"request_id":request_id, "provider_id":"response-" + request_id,
                 "model_cost_microusd":model_cost, "amount_microusd":charge})
    monkeypatch.setattr(coach.credits, "metered_completion", metered)
    with closing(author.connect()) as db:
        project = author.create(db, {"module_id": "ICHL-016", "name":"Windows"})
    route = "/api/coach/projects/" + project["id"]
    coach.dispatch("POST", route + "/lesson", {"version":1,"lesson_id":"interfaces"}, None)
    token = uuid4().hex
    def ask(version, **extra):
        return coach.dispatch("POST", route + "/message", {"version":version,"mode":"frontier",
                              "request_id":uuid4().hex,"text":"What evidence would help?",**extra}, None)
    ask(2)  # A paid conversation on this project before the claim is unrelated.
    def claim(version):
        return board.dispatch("POST",TASK_URL + "/claim",{"contributor":"Builder", "claim_token":token,
                              "version":version, "project_id":project["id"]})
    def submit(version, **extra):
        brief = board.task_briefs()[TASK]
        src = brief["sources"][0]
        draft = {"task_id":TASK,"kind":"question","scope":"Window variant","text":"Which face?",
                 "contributor":"Builder","source_ids":[src["id"]],"source_revisions":{src["id"]:src["revision"]},**extra}
        return board.dispatch("POST",TASK_URL + "/submit",{"version":version,"claim_token":token,"draft":draft})

    claim(0)
    with pytest.raises(author.RequestError) as forbidden:
        ask(3,pilot_task=TASK,pilot_claim_token=uuid4().hex)
    assert forbidden.value.status == 403
    ask(3,pilot_task=TASK,pilot_claim_token=token)
    first = submit(1, active_seconds=9,help="I asked the installer.",assistance="assisted")
    first_id = first["reviews"][0]["id"]
    assert "_pilot" not in board.dispatch("GET","/api/contributions/reviews/" + first_id)
    board.dispatch("POST","/api/contributions/reviews/" + first_id + "/decision",
                   {"submission_version":2,"outcome":"needs_evidence","feedback":"Return with a drawing."})
    token = uuid4().hex
    claim(3)
    ask(4,pilot_task=TASK,pilot_claim_token=token)
    submit(4,active_seconds=12,assistance="independent")
    ask(5)  # A late unscoped charge must not change either snapshot.
    report = board.dispatch("GET", PILOT)
    a,b = report["rounds"]
    assert (a["round"],a["outcome"],a["project_version"],a["active_seconds"],a["help"],a["assistance"]) == (
        1,"needs_evidence",4,9,"I asked the installer.","assisted")
    assert (b["round"],b["outcome"],b["project_version"],b["active_seconds"],b["help"],b["assistance"]) == (
        2,"pending",5,12,None,"independent")
    assert [a["model_cost"]["microusd"],b["model_cost"]["microusd"]] == [12,0]
    assert report["model_cost"] == {"receipts":2,"microusd":12} and report["credit_charge"]["microusd"] == 15
    assert report["tasks"] == 1 and report["receipt_count"] == 2
    assert project["id"] not in json.dumps(report) and token not in json.dumps(report)
    with pytest.raises(author.RequestError) as forbidden:
        board.dispatch("GET", PILOT, actor=review.ReviewActor("ordinary","Builder",False))
    assert forbidden.value.status == 403


def test_missing_and_legacy_receipts_are_never_assumed_to_cost_zero(tmp_path, monkeypatch):
    monkeypatch.setenv("STUDIO_AUTHORING_DB", str(tmp_path / "legacy.sqlite"))
    with closing(board.open_db()) as db:
        data = {"id":"r1", "task_id":TASK, "task_title":"Window", "module_id":"ICHL-016","round":1,"draft":{}}
        def insert(version, values):
            sql = """INSERT INTO contribution_revisions VALUES(?,?,'submit','ready_for_review','Builder',NULL,NULL,?,NULL,?,?)"""
            db.execute(sql,(TASK,version,author.timestamp(),"ICHL-016","interfaces"))
            db.execute("INSERT INTO review_submissions VALUES(?,?,?,?,NULL,?)",
                       (values["id"],TASK,version,values["round"],json.dumps(values)))
        pilot.capture(db,data,None,True)
        insert(1,data)
        old_receipt = {"key":{"model":None,"charge":8}}
        for i in (2,3):
            insert(i,{**data,"id":f"r{i}","round":i,"_pilot":{"project_version":2,"receipts":old_receipt}})
        result = pilot.summary(db,review.LOCAL)
    legacy = result["rounds"][0]
    assert legacy["active_seconds"] is None and legacy["assistance"] == "unreported" and legacy["help"] is None
    assert legacy["model_cost"]["microusd"] is None and legacy["credit_charge"]["microusd"] is None
    assert result["model_cost"] == {"receipts":0,"microusd":None}
    assert result["credit_charge"] == {"receipts":1,"microusd":8}
    assert result["rounds"][2]["receipt_count"] == 0
