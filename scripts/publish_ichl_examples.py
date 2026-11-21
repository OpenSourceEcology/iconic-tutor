"""Publish the wall example archives and index their contents from their manifests."""
import hashlib
from html import escape
from io import BytesIO
import json
from pathlib import Path, PurePosixPath
from string import Template
import subprocess
from urllib.parse import quote
from zipfile import ZipFile

import setup_ichl


def publish_variant(root, target, revision, variant):
    data = subprocess.check_output([
        "git", "-C", root / "reports/ichl-cad", "show",
        f"{revision}:ichl_wall/examples/{variant}.zip",
    ])
    with ZipFile(BytesIO(data)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        hashes = manifest["hashes"]
        expected = set(hashes) | {"manifest.json"}
        if sorted(expected) != sorted(archive.namelist()) or manifest["variant"] != f"ICHL-015-{variant}":
            raise ValueError(f"{variant} archive differs from its manifest")
        linked = {name for row in manifest["workstreams"] for name in row["files"]}
        if linked | {"instance.json", "manifest.json"} != expected:
            raise ValueError(f"{variant} workstream inventory differs from archive")
        for name in expected:
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError(f"Invalid package path: {name}")
            content = archive.read(name)
            if name in hashes and hashlib.sha256(content).hexdigest() != hashes[name]:
                raise ValueError(f"{variant}/{name} failed its manifest checksum")
            output = target / variant / path
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(content)
    (target / f"{variant}.zip").write_bytes(data)
    return manifest


def file_link(variant, name):
    label = {"definitions": "Schema", "instances": "Configured inputs"}.get(name.split("/")[0], name)
    return f'<a href="{quote(variant + "/" + name)}">{escape(label)}</a>'


def stream_cell(variant, row):
    status = row["status"]
    labels = {"ready_for_review": "Ready for review", "blocked": "Blocked", "invalid": "Invalid"}
    links = " · ".join(file_link(variant, name) for name in row["files"])
    gaps = ""
    if row["gaps"]:
        items = "".join(f"<li>{escape(item)}</li>" for item in row["gaps"])
        gaps = f"<details><summary>Open questions</summary><ul>{items}</ul></details>"
    return f'<td><strong class="{escape(status)}">{labels[status]}</strong><div>{links}</div>{gaps}</td>'


def publish(root, target):
    pin = json.loads((root / "library/ichl/compiler.lock.json").read_text())
    if not (root / "reports/ichl-cad/.git").exists():
        setup_ichl.main()
    variants = ("OC16", "OC24")
    target.mkdir(parents=True)
    manifests = {v: publish_variant(root, target, pin["revision"], v) for v in variants}
    previews = []
    for variant, manifest in manifests.items():
        spacing = manifest["spacing_in"]
        previews.append(
            f'<section><h2>{variant} · {spacing}-inch spacing</h2>'
            f'<a href="{variant}/drawing.svg"><img src="{variant}/drawing.svg" '
            f'alt="Fabrication drawing for the wall frame with {spacing}-inch stud spacing"></a>'
            f'<p><a href="{variant}.zip" download>Download complete ZIP</a> · '
            f'<a href="{variant}/instance.json">Wall instance</a> · '
            f'<a href="{variant}/manifest.json">Validation manifest</a></p></section>'
        )
    rows = []
    for left, right in zip(manifests["OC16"]["workstreams"], manifests["OC24"]["workstreams"], strict=True):
        if left["id"] != right["id"]:
            raise ValueError("Wall packages list different workstreams")
        rows.append(f'<tr id="{escape(left["id"])}"><th scope="row">{escape(left["title"])}</th>'
                    + stream_cell("OC16", left) + stream_cell("OC24", right) + "</tr>")
    template = Template((root / "scripts/templates/ichl-index.html").read_text())
    source = pin["repository"].removesuffix(".git") + "/tree/" + pin["revision"] + "/ichl_wall"
    (target / "index.html").write_text(template.substitute(
        source_url=escape(source), previews="\n".join(previews), rows="\n".join(rows)
    ), encoding="utf-8")
