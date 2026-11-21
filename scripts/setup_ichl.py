"""Install the CAD revision used by the housing tutor in reports/ichl-cad."""

import json
from pathlib import Path
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]


def git(directory, *args):
    return subprocess.check_output(["git", "-C", directory, *args], text=True).strip()


def main():
    pin = json.loads((ROOT / "library/ichl/compiler.lock.json").read_text())
    node = shutil.which("node")
    if not node or int(subprocess.check_output([node, "-p", "process.versions.node.split('.')[0]"], text=True)) < 22:
        raise SystemExit("Install Node.js 22 or newer for the CAD member generator.")
    target = ROOT / "reports/ichl-cad"
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if git(target, "rev-parse", "HEAD") == pin["revision"] and not git(target, "status", "--porcelain"):
            print(f"CAD compiler is ready in {target}")
            return
        raise SystemExit(f"Existing checkout differs from the pin. Move {target} aside and run setup again.")
    with tempfile.TemporaryDirectory(dir=target.parent) as tmp:
        stage = Path(tmp) / "checkout"
        stage.mkdir()
        git(stage, "init", "--quiet")
        git(stage, "remote", "add", "origin", pin["repository"])
        git(stage, "fetch", "--quiet", "--depth=1", "origin", pin["revision"])
        git(stage, "checkout", "--quiet", "--detach", "FETCH_HEAD")
        if git(stage, "rev-parse", "HEAD") != pin["revision"]:
            raise SystemExit("The fetched CAD revision differs from the requested commit.")
        stage.rename(target)
    print(f"Installed the pinned CAD compiler in {target}")


if __name__ == "__main__":
    main()
