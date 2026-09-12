"""Extract saved, visible BREP geometry; never execute code from the source CAD.

Run with the configured FreeCAD Python. Rebuilds the village browser asset.
"""
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile

import FreeCAD as App
import Part

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "library/village/source/cabin-13x13.FCStd"
with zipfile.ZipFile(SOURCE) as archive:
    xml = ET.fromstring(archive.read("Document.xml"))
    shapes = []
    for obj in xml.findall("ObjectData/Object"):
        props = obj.find("Properties")
        shape_file = props.find("Property[@name='Shape']/Part")
        visible = props.find("Property[@name='Visibility']/Bool")
        if shape_file is None or (visible is not None and visible.get("value") == "false"):
            continue
        shape = Part.Shape()
        shape.importBrepFromString(archive.read(shape_file.get("file")).decode())
        placement = props.find("Property[@name='Placement']/PropertyPlacement")
        if placement is not None:
            p = placement.attrib
            shape.Placement = App.Placement(
                App.Vector(*[float(p[k]) for k in ("Px", "Py", "Pz")]),
                App.Rotation(*[float(p[k]) for k in ("Q0", "Q1", "Q2", "Q3")]),
            )
        if shape.isNull() or not shape.isValid() or not shape.Solids or shape.Volume <= 0:
            raise ValueError("Invalid source shape: " + obj.get("name"))
        label = props.find("Property[@name='Label']/String").get("value")
        shapes.append((obj.get("name"), label, shape))

box = Part.makeCompound([s for _, _, s in shapes]).BoundBox
origin = App.Vector(-box.XMin, -box.YMin, -box.ZMin)
parts = []
for name, label, shape in shapes:
    shape.translate(origin)
    points, triangles = shape.tessellate(3)
    color = "#c5a77d"
    if any(word in name.lower() for word in ("osb", "compound", "wedge")):
        color = "#aeb9af"
    if "window" in name.lower():
        color = "#7b9fa5"
    parts.append({"id": name, "label": label, "color": color,
                  "mesh": {"vertices": [v for p in points for v in (p.x, p.y, p.z)],
                           "indices": [v for t in triangles for v in t]},
                  "brep": shape.exportBrepToString(), "volume_mm3": shape.Volume})
asset = {
    "id": "vcs_cabin_13x13_two_story", "source_id": "vcs_cabin_13x13_two_story",
    "domain": "village", "title": "Two-story campus cabin", "stories": 2,
    "bounds": [0, 0, 0, box.XLength, box.YLength, box.ZLength], "parts": parts,
    "source_url": "https://drive.google.com/file/d/1S5qo7H3v_01JHCLFPJ9jUxnRc5wWwqK9/view",
    "source_revision": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
    "source_note": "Saved visible geometry from VCS - Conceptual - Cabin 13x13.FCStd, retrieved 2026-09-12. Two-story source model; no invented story duplication. Dimensions include porch, trim and roof. Source document license field: All rights reserved; not relicensed by this import.",
    "validation": {"solid_count": sum(len(s.Solids) for _, _, s in shapes),
                   "volume_mm3": sum(s.Volume for _, _, s in shapes),
                   "engineering": "Conceptual source model; engineering review pending"},
}
target = ROOT / "web/data/village/cabin.json"
target.write_text(json.dumps(asset, separators=(",", ":")) + "\n")
print(json.dumps({"bounds_mm": asset["bounds"], "parts": len(parts), "validation": asset["validation"], "sha256": asset["source_revision"], "bytes": target.stat().st_size}, indent=2))
