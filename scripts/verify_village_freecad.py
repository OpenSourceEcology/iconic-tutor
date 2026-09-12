"""Independent native FreeCAD reopening of the retained village source."""
import json
from pathlib import Path
import FreeCAD as App
import Part

ROOT = Path(__file__).resolve().parents[1]
asset = json.loads((ROOT / "web/data/village/cabin.json").read_text())
doc = App.openDocument(str(ROOT / "library/village/source/cabin-13x13.FCStd"))
# Native groups synthesize aggregate shapes. Exclude these to avoid counting
# their children twice. Check actual Part objects against the extracted asset.
objects = [o for o in doc.Objects if o.TypeId.startswith("Part::") and o.Visibility]
box = Part.makeCompound([o.Shape for o in objects]).BoundBox
assert {o.Name for o in objects} == {p["id"] for p in asset["parts"]}
assert max(abs(x-y) for x,y in zip(
    [box.XLength,box.YLength,box.ZLength],asset["bounds"][3:])) < 1e-6
max_delta = 0
for obj in objects:
    source = obj.Shape.copy()
    source.translate(App.Vector(-box.XMin,-box.YMin,-box.ZMin))
    part = next(p for p in asset["parts"] if p["id"] == obj.Name)
    imported = Part.Shape()
    imported.importBrepFromString(part["brep"])
    assert abs(source.Volume-imported.Volume) < 1
    a,b = source.BoundBox, imported.BoundBox
    delta = max(abs(getattr(a,k)-getattr(b,k)) for k in
                ("XMin","XMax","YMin","YMax","ZMin","ZMax"))
    max_delta = max(max_delta,delta)
    assert delta < 1e-6, obj.Name
    assert len(source.Solids) == len(imported.Solids)
assert sum(len(o.Shape.Solids) for o in objects) == asset["validation"]["solid_count"]
receipt = {"passed": True, "objects": len(objects),
           "solids": asset["validation"]["solid_count"],
           "max_bounds_delta_mm": max_delta, "source_sha256": asset["source_revision"]}
target = ROOT / "reports/village-browser/freecad-receipt.json"
target.parent.mkdir(parents=True,exist_ok=True)
target.write_text(json.dumps(receipt,indent=2)+"\n")
print(json.dumps(receipt))
