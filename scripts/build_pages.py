"""Build a static-only Pages artifact; never copy local settings or backend code."""
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "reports/pages-preview/iconic-tutor"
if TARGET.exists():
    shutil.rmtree(TARGET)
shutil.copytree(ROOT / "web", TARGET)
(TARGET / "deployment.json").write_text(json.dumps({"backend": None}) + "\n")
(TARGET / ".nojekyll").touch()
for name in ("LICENSE", "NOTICE.md"):
    shutil.copy2(ROOT / name, TARGET / name)
print(TARGET)
