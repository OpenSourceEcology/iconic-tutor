"""Reopen the 3D placement browser export and independently check all transforms."""

import json
import math
import os
from pathlib import Path
import FreeCAD as App
import Part

root = Path(os.environ.get("STUDIO_VERIFY_OUT", "reports/studio-placement"))
project = json.loads((root / "placed.json").read_text())
doc = App.openDocument(str((root / "placed.FCStd").resolve()))
checked = 0
for i, instance in enumerate(project["instances"]):
    asset = next(a for a in project["assets"] if a["id"] == instance["asset_id"])
    rx, ry, rz = instance["rotation"]
    rotation = (
        App.Rotation(App.Vector(0, 0, 1), rz)
        .multiply(App.Rotation(App.Vector(0, 1, 0), ry))
        .multiply(App.Rotation(App.Vector(1, 0, 0), rx))
    )
    placement = App.Placement(App.Vector(*instance["position"]), rotation)
    for j, part in enumerate(asset["parts"]):
        expected = Part.Shape()
        expected.importBrepFromString(part["brep"])
        expected.Placement = placement.multiply(expected.Placement)
        actual = doc.getObject(f"Studio_{i}_{j}").Shape
        assert actual.isValid() and actual.isClosed()
        assert math.isclose(actual.Volume, expected.Volume, abs_tol=1e-5)
        assert actual.cut(expected).Volume + expected.cut(actual).Volume < 1e-4
        checked += 1
App.closeDocument(doc.Name)
print(f"PASS {checked} exported solids with independent FreeCAD XYZ/rotation checks")
