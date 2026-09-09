"""Run with FreeCAD's Python, using STUDIO_REQUEST/STUDIO_RESULT file paths.

Only loads the six fixed library entries. User/model text is never Python code.
The mesh and BREP are derived from the same checked FreeCAD shapes.
"""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
HOUSING = Path(
    os.environ.get("STUDIO_ICONIC_ROOT", ROOT / "upstream/iconic-cad")
).resolve()
sys.path.insert(0, str(HOUSING))
sys.path.insert(0, str(ROOT / "scripts"))
from studio_contract import (
    HOUSE_IDS,
    MACHINE_IDS,
    PARAMETERS,
    defaults,
    validate_parameters,
)


def load_schema(path):
    spec = importlib.util.spec_from_file_location("studio_source_schema", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.SCHEMA


def compile_asset(request):
    import FreeCAD as App
    import Part

    source = request["source_id"]
    if source not in HOUSE_IDS + MACHINE_IDS:
        raise ValueError("Unsupported source entry")
    parameters = request.get("parameters", defaults(source))
    if source in PARAMETERS:
        parameters = validate_parameters(source, parameters)
    elif parameters:
        raise ValueError("Fixed source entry cannot accept parameters")
    doc = App.newDocument("StudioAsset")
    if source in HOUSE_IDS:
        from seh_lib import wall_builder

        schema_path = HOUSING / "library/modules" / source / "schema.py"
        schema = load_schema(schema_path)
        instance = wall_builder.instance_from_schema(schema)
        if source in PARAMETERS:
            aperture = instance["parameters"]["aperture"]
            aperture.update(
                rough_opening_width_in=parameters["opening_width_in"],
                rough_opening_height_in=parameters["opening_height_in"],
                sill_height_in=parameters["sill_height_in"],
            )
            members_request = Path(os.environ["STUDIO_REQUEST"])
            members = subprocess.run(
                [
                    os.environ.get("STUDIO_NODE", "node"),
                    str(ROOT / "scripts/studio_members.mjs"),
                    str(members_request),
                ],
                check=True,
                capture_output=True,
                text=True,
                timeout=15,
            )
            # Process-local member snapshot: no mutation of the source library.
            wall_builder._members_cache = {source: json.loads(members.stdout)}
        objects = wall_builder.build_instance_into_doc(instance, doc)
        source_url = (
            "https://wiki.opensourceecology.org/wiki/Iconic_CAD_Housing_Library"
        )
        snapshot = HOUSING / "source.json"
        source_revision = (
            json.loads(snapshot.read_text())["revision"]
            if snapshot.exists()
            else subprocess.check_output(
                ["git", "-C", str(HOUSING), "rev-parse", "HEAD"], text=True
            ).strip()
        )
        source_note = (
            "Geometry from the Iconic CAD SEH compiler and shared framing enumerator."
        )
        domain = "house"
    else:
        library = Path(os.environ["STUDIO_GVCS_ROOT"]).resolve()
        sys.path.insert(0, str(library))
        import gvcs_geometry

        schema_path = library / "library/parts" / source / "schema.py"
        schema = load_schema(schema_path)
        if source == "axis_idler_spacer":
            schema.update(
                outer_diameter_in=parameters["outer_diameter_mm"] / 25.4,
                inner_diameter_in=parameters["bore_mm"] / 25.4,
                thickness_in=parameters["thickness_mm"] / 25.4,
            )
            objects = gvcs_geometry.compile_spacer(schema, doc)
        else:
            objects = gvcs_geometry.compile_source(schema, doc)
        source_url = "https://wiki.opensourceecology.org/wiki/Universal_CNC_Axis"
        source_revision = subprocess.check_output(
            ["git", "-C", str(library), "rev-parse", "HEAD"], text=True
        ).strip()
        source_note = "Geometry from the retained OSE machine source. Fixed source imports check file hashes; the spacer uses its retained dimensional recipe."
        domain = "machines"
    parts = []
    all_shapes = []
    for obj in objects:
        if "port" in obj.Name.lower() or not hasattr(obj, "Shape"):
            continue
        shape = obj.Shape
        if (
            shape.isNull()
            or not shape.isValid()
            or not shape.isClosed()
            or not shape.Solids
            or shape.Volume <= 0
        ):
            raise ValueError("Invalid solid: " + obj.Name)
        points, triangles = shape.tessellate(0.3 if domain == "machines" else 1)
        parts.append(
            {
                "id": obj.Name,
                "label": obj.Label,
                "color": "#a9b9aa"
                if "osb" in obj.Name.lower()
                else ("#c29b68" if domain == "house" else "#779baa"),
                "mesh": {
                    "vertices": [v for p in points for v in (p.x, p.y, p.z)],
                    "indices": [v for t in triangles for v in t],
                },
                "brep": shape.exportBrepToString(),
                "volume_mm3": shape.Volume,
            }
        )
        all_shapes.append(shape)
    if not parts:
        raise ValueError("Compiler produced no solids")
    box = Part.makeCompound(all_shapes).BoundBox
    code_paths = [
        ROOT / "scripts/studio_compile.py",
        ROOT / "scripts/studio_contract.py",
    ]
    code_paths += (
        [
            HOUSING / "seh_lib/wall_builder.py",
            HOUSING / "web/js/members.js",
            HOUSING / "web/js/constants.js",
            HOUSING / "web/js/systems.js",
            HOUSING / "web/assets/lib/members.json",
            ROOT / "scripts/studio_members.mjs",
        ]
        if domain == "house"
        else [library / "gvcs_geometry.py"]
    )
    recipe = {
        "source_id": source,
        "parameters": parameters,
        "source_revision": source_revision,
        "schema_sha256": hashlib.sha256(schema_path.read_bytes()).hexdigest(),
        "compiler_files_sha256": {
            p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in code_paths
        },
        "freecad_version": ".".join(App.Version()[:3]),
    }
    asset_id = (
        "asset_"
        + hashlib.sha256(json.dumps(recipe, sort_keys=True).encode()).hexdigest()[:16]
    )
    labels = {
        "wall_4x8_2x6_16oc": "Standard wall",
        "window_4x8_2x6_36x48": "Window wall",
        "door_4x8_2x6_38x83": "Door wall",
        "axis_2007_carriage": "Axis carriage",
        "axis_2007_idler": "Axis idler",
        "axis_idler_spacer": "Idler spacer",
    }
    result = {
        "id": asset_id,
        "source_id": source,
        "domain": domain,
        "title": labels[source],
        "parameters": parameters,
        "parameter_specs": {
            k: {"min": v[0], "max": v[1]} for k, v in PARAMETERS.get(source, {}).items()
        },
        "bounds": [box.XMin, box.YMin, box.ZMin, box.XMax, box.YMax, box.ZMax],
        "parts": parts,
        "source_url": source_url,
        "source_revision": source_revision,
        "source_note": source_note,
        "recipe": recipe,
        "validation": {
            "geometry": "passed",
            "engineering": "unreviewed",
            "assembly": "not_assessed",
            "solid_count": sum(len(s.Solids) for s in all_shapes),
            "volume_mm3": sum(s.Volume for s in all_shapes),
            "checks": [
                "Every part is a valid, closed solid with positive volume.",
                "Preview mesh and export BREP were produced from the same shapes.",
            ],
            "freecad_version": ".".join(App.Version()[:3]),
        },
        "license_review": "pending" if domain == "machines" else "source_terms_apply",
    }
    App.closeDocument(doc.Name)
    return result


if __name__ == "__main__":
    try:
        result = compile_asset(
            json.loads(Path(os.environ["STUDIO_REQUEST"]).read_text())
        )
        Path(os.environ["STUDIO_RESULT"]).write_text(
            json.dumps(result, allow_nan=False)
        )
    except Exception as exc:
        Path(os.environ["STUDIO_RESULT"]).write_text(json.dumps({"error": str(exc)}))
        raise
