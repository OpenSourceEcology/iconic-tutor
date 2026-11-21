"""Build a static-only Pages artifact; never copy local settings or backend code."""
import json
import os
from urllib.parse import urlsplit
from pathlib import Path
import shutil

from publish_ichl_examples import publish

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "reports/pages-preview/iconic-tutor"
if TARGET.exists():
    shutil.rmtree(TARGET)
shutil.copytree(ROOT / "web", TARGET)
deployment = {"backend": None}
workshop = os.environ.get("OSE_WORKSHOP_URL", "").strip()
if workshop:
    url = urlsplit(workshop)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError("OSE_WORKSHOP_URL must be an HTTPS workshop URL without credentials or a query.")
    deployment["workshop_url"] = workshop
(TARGET / "deployment.json").write_text(json.dumps(deployment) + "\n")
(TARGET / ".nojekyll").touch()
for name in ("LICENSE", "NOTICE.md"):
    shutil.copy2(ROOT / name, TARGET / name)
publish(ROOT, TARGET / "ichl-015")
print(TARGET)
