import json
import urllib.error
import xml.etree.ElementTree as ET

from scripts import check_contribution_sources as evidence


TASKS = json.loads(evidence.CATALOG.read_text())["tasks"]
GIT, WIKI = TASKS[0]["sources"]


def export(page, version, text):
    root = ET.Element("mediawiki", {"xmlns": "http://www.mediawiki.org/xml/export-0.11/"})
    node = ET.SubElement(root, "page")
    ET.SubElement(node, "title").text = page
    rev = ET.SubElement(node, "revision")
    ET.SubElement(rev, "id").text = version
    ET.SubElement(rev, "text").text = text
    return ET.tostring(root)


def test_pinned_task_contract_and_quotes():
    assert [(t["id"], t["module_id"], t["workstream"], t["wiki_title"]) for t in TASKS] == [
        ("wall-fastening", "ICHL-015", "connections", "Talk:ICHL-015"),
        ("window-opening", "ICHL-016", "interfaces", "Talk:ICHL-016"),
    ]
    for task in TASKS:
        sources = task["sources"]
        assert len({s["id"] for s in sources}) == len(sources)
        assert all(s["applicability"] for s in sources)
    assert all(r["status"] == "pin_ok" for r in evidence.report(TASKS, live=False))


def test_wiki_revision_can_move_without_changing_excerpt():
    def check(revision, text):
        data = export(WIKI["wiki_page"], revision, text)
        return evidence.compare_live(WIKI, lambda url: data)[0]

    assert check(WIKI["revision"], WIKI["excerpt"]) == "current"
    assert check("999999", WIKI["excerpt"]) == "revision_changed"
    assert check("999999", "Different words") == "excerpt_missing"
    assert evidence.compare_live(WIKI, lambda url: b"<mediawiki/>") == ("missing", None)


def test_git_checks_file_content_independently_of_unrelated_commits():
    pinned = (evidence.ROOT / GIT["snapshot"]).read_bytes()
    assert evidence.compare_live(GIT, lambda url: pinned)[0] == "current"
    assert evidence.compare_live(GIT, lambda url: pinned + b"\n")[0] == "revision_changed"
    assert evidence.compare_live(GIT, lambda url: b"{}")[0] == "excerpt_missing"


def test_citation_error_and_network_outage_do_not_pass_as_current():
    invalid = {**WIKI, "excerpt": "Fabricated citation."}
    tasks = [{"id": "wall-fastening", "sources": [invalid, WIKI, GIT]}]
    def unavailable(url):
        if "githubusercontent" in url:
            raise urllib.error.HTTPError(url, 404, "Not found", None, None)
        raise TimeoutError("timed out")
    rows = evidence.report(tasks, live=True, fetcher=unavailable)
    assert [r["status"] for r in rows] == ["invalid_pin", "unavailable", "missing"]
    assert all(r["task"] == "wall-fastening" for r in rows)
