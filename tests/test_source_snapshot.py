"""The bundled housing source is identifiable and unchanged."""
import hashlib
import json
from pathlib import Path


def test_bundled_source_matches_manifest():
    source = Path(__file__).resolve().parents[1] / "upstream/iconic-cad"
    manifest = json.loads((source / "source.json").read_text())
    assert manifest["revision"] == "54fb9503c10f6cd3eabcc5e8ead30f7ebb26ba75"
    for name, digest in manifest["files_sha256"].items():
        assert hashlib.sha256((source / name).read_bytes()).hexdigest() == digest, name
