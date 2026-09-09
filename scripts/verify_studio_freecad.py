"""Independently reopen the actual browser downloads in FreeCAD.

Run with FreeCAD's Python and STUDIO_VERIFY_OUT pointing at browser receipts.
Checks placements using FreeCAD's own Rotation/Placement, source-to-export
symmetric differences, analytic spacer volume, and the contribution compiler.
"""

import importlib.util
import json
import math
import os
from pathlib import Path
import tempfile
import zipfile

import FreeCAD as App
import Part

ROOT = Path(os.environ.get("STUDIO_VERIFY_OUT", "reports/studio-browser")).resolve()


def check_domain(domain):
    project = json.loads((ROOT / (domain + ".json")).read_text())
    assets = {a["id"]: a for a in project["assets"]}
    doc = App.openDocument(str(ROOT / (domain + ".FCStd")))
    checked = 0
    maximum_delta = 0
    for i, inst in enumerate(project["instances"]):
        asset = assets[inst["asset_id"]]
        rx, ry, rz = inst["rotation"]
        rotation = (
            App.Rotation(App.Vector(0, 0, 1), rz)
            .multiply(App.Rotation(App.Vector(0, 1, 0), ry))
            .multiply(App.Rotation(App.Vector(1, 0, 0), rx))
        )
        placement = App.Placement(App.Vector(*inst["position"]), rotation)
        for j, part in enumerate(asset["parts"]):
            expected = Part.Shape()
            expected.importBrepFromString(part["brep"])
            expected.Placement = placement.multiply(expected.Placement)
            actual = doc.getObject(f"Studio_{i}_{j}").Shape
            assert actual.isValid() and actual.isClosed() and actual.Volume > 0
            assert math.isclose(
                actual.Volume, expected.Volume, rel_tol=1e-8, abs_tol=1e-5
            )
            for key in ("XMin", "YMin", "ZMin", "XMax", "YMax", "ZMax"):
                delta = abs(
                    getattr(actual.BoundBox, key) - getattr(expected.BoundBox, key)
                )
                maximum_delta = max(maximum_delta, delta)
                assert delta < 1e-5, (domain, i, j, key, delta)
            assert actual.cut(expected).Volume + expected.cut(actual).Volume < 1e-4
            checked += 1
    assert len([o for o in doc.Objects if hasattr(o, "Shape")]) == checked
    App.closeDocument(doc.Name)
    variant = next(a for a in project["assets"] if a.get("draft"))
    if domain == "machines":
        p = variant["parameters"]
        expected_volume = (
            math.pi
            / 4
            * (p["outer_diameter_mm"] ** 2 - p["bore_mm"] ** 2)
            * p["thickness_mm"]
        )
        assert math.isclose(
            variant["validation"]["volume_mm3"], expected_volume, rel_tol=1e-10
        )
        assert math.isclose(
            variant["bounds"][5] - variant["bounds"][2], 2, abs_tol=1e-8
        )
    else:
        assert variant["parameters"]["opening_width_in"] == 30
        assert math.isclose(
            variant["bounds"][3] - variant["bounds"][0], 48 * 25.4, abs_tol=1e-8
        )
        # Independently test a box through the requested opening: no geometry
        # should occupy the interior of its 30 x 48 inch rough opening.
        hole = Part.makeBox(
            30 * 25.4 - 0.02,
            160,
            48 * 25.4 - 0.02,
            App.Vector(9 * 25.4 + 0.01, -15, 24 * 25.4 + 0.01),
        )
        for part in variant["parts"]:
            shape = Part.Shape()
            shape.importBrepFromString(part["brep"])
            assert shape.common(hole).Volume < 1e-4
    with tempfile.TemporaryDirectory(prefix="studio-contribution-") as tmp:
        target = Path(tmp)
        with zipfile.ZipFile(ROOT / (domain + "-contribution.zip")) as archive:
            for name in archive.namelist():
                assert Path(name).name == name
            archive.extractall(target)
        spec = importlib.util.spec_from_file_location(
            "contribution_compiler", target / "compiler.py"
        )
        compiler = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(compiler)
        doc = App.newDocument("Contribution")
        objects = compiler.compile(
            json.loads((target / "schema.json").read_text()), doc
        )
        assert len(objects) == len(variant["parts"])
        assert math.isclose(
            sum(o.Shape.Volume for o in objects),
            variant["validation"]["volume_mm3"],
            rel_tol=1e-9,
        )
        App.closeDocument(doc.Name)
    return {
        "domain": domain,
        "placed_parts_checked": checked,
        "maximum_bound_delta_mm": maximum_delta,
        "contribution_compiler": "passed",
        "independent_dimensions": "passed",
    }


reports = [check_domain(domain) for domain in ("house", "machines")]
(ROOT / "freecad-receipt.json").write_text(
    json.dumps({"passed": True, "freecad": App.Version(), "reports": reports}, indent=2)
)
print(json.dumps(reports, indent=2))
