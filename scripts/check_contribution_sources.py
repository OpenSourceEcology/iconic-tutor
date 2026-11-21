"""Check quoted contribution briefs offline, or compare them with current sources using --live."""

import argparse
import hashlib
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "web/data/contributions/tasks.json"
WIKI = "https://wiki.opensourceecology.org"
GIT = "https://github.com/OpenSourceEcology/iconic-cad"
RAW = "https://raw.githubusercontent.com/OpenSourceEcology/iconic-cad"
INFO = {
    "pin_ok": "The quoted passage is present in the pinned source.",
    "current": "The source matches the pin.",
    "revision_changed": "The source changed. The excerpt survives; review its current context.",
    "excerpt_missing": "The source changed and the quoted passage is missing. Review dependent contributions.",
    "missing": "The live source could not be found. Review its citation.",
}


def digest(content):
    return hashlib.sha256(content).hexdigest()


def validate_pin(source, root):
    snapshot = root / source["snapshot"]
    if source["kind"] == "wiki":
        page = json.loads(snapshot.read_text(encoding="utf-8"))
        if (page["url"], str(page["revid"]), page["title"]) != (
            source["url"], source["revision"], source["wiki_page"]
        ):
            raise ValueError("MediaWiki revision, title or URL differs from the saved snapshot.")
        text = page["text"]
    elif source["kind"] == "git":
        pin = json.loads((root / "library/ichl/compiler.lock.json").read_text())["revision"]
        url = f"{GIT}/blob/{source['revision']}/{source['repo_path']}"
        content = snapshot.read_bytes()
        if pin != source["revision"] or url != source["url"] or digest(content) != source["sha256"]:
            raise ValueError("Git commit, path, URL or content digest differs from the pinned source.")
        text = content.decode("utf-8")
    else:
        raise ValueError("Unknown source type.")
    if not source["excerpt"].strip() or source["excerpt"] not in text:
        raise ValueError("The exact quoted passage is missing from the pinned source.")


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "OSE-Iconic-Tutor/1.0 (contribution evidence check)"})
    with urllib.request.urlopen(req, timeout=15) as response:
        return response.read()


def compare_live(source, fetcher=fetch):
    if source["kind"] == "wiki":
        slug = urllib.parse.quote(source["wiki_page"].replace(" ", "_"), safe="")
        root = ET.fromstring(fetcher(f"{WIKI}/wiki/Special:Export/{slug}"))
        if root.tag.rsplit("}", 1)[-1] != "mediawiki":
            raise ValueError("Expected a MediaWiki export.")
        page = root.find("{*}page")
        if page is None:
            return "missing", None
        if page.findtext("{*}title") != source["wiki_page"]:
            raise ValueError("The live export returned a different page.")
        rev = page.find("{*}revision")
        if rev is None or not rev.findtext("{*}id") or rev.find("{*}text") is None:
            raise ValueError("The live export omitted its revision or content.")
        text = rev.findtext("{*}text") or ""
        version = rev.findtext("{*}id")
        same = version == source["revision"]
    else:
        path = urllib.parse.quote(source["repo_path"], safe="/")
        content = fetcher(f"{RAW}/refs/heads/main/{path}")
        text = content.decode("utf-8")
        version = "sha256:" + digest(content)
        same = digest(content) == source["sha256"]
    if source["excerpt"] not in text:
        return "excerpt_missing", version
    return ("current" if same else "revision_changed"), version


def report(tasks, live, root=ROOT, fetcher=fetch):
    rows = []
    for task in tasks:
        for source in task["sources"]:
            row = dict(task=task["id"], source_id=source["id"], pinned_revision=source["revision"])
            rows.append(row)
            try:
                validate_pin(source, root)
            except (OSError, KeyError, UnicodeError, ValueError) as error:
                row.update(status="invalid_pin", detail=str(error))
                continue
            status, version = "pin_ok", None
            if live:
                try:
                    status, version = compare_live(source, fetcher)
                except (OSError, ValueError, ET.ParseError) as error:
                    if isinstance(error, urllib.error.HTTPError) and error.code in (404, 410):
                        status = "missing"
                    else:
                        row.update(status="unavailable", detail=str(error))
                        continue
            row.update(status=status, current_version=version, detail=INFO[status])
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Read the current wiki revisions and Git files.")
    parser.add_argument("--json", action="store_true", help="Print a machine-readable report.")
    args = parser.parse_args()
    results = report(json.loads(CATALOG.read_text())["tasks"], args.live)
    if args.json:
        print(json.dumps(results, indent=2))
    else:
        for r in results:
            print(f"{r['task']} / {r['source_id']} [{r['status']}] {r['detail']}")
    return int(any(r["status"] not in ("pin_ok", "current") for r in results))


if __name__ == "__main__":
    sys.exit(main())
