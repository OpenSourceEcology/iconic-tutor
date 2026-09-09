import math
import json
import hashlib
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from studio_contract import defaults, validate_parameters


def test_source_dimensions_and_variant_are_separate():
    original = defaults("axis_idler_spacer")
    proposed = dict(original, thickness_mm=2)
    assert validate_parameters("axis_idler_spacer", proposed)["thickness_mm"] == 2
    assert original["thickness_mm"] == 1.016


@pytest.mark.parametrize("value", [True, None, "2", math.nan, math.inf, -1, 0, 10000])
def test_unusable_dimensions_are_rejected(value):
    with pytest.raises(ValueError):
        validate_parameters(
            "axis_idler_spacer", dict(defaults("axis_idler_spacer"), thickness_mm=value)
        )


def test_bore_cannot_consume_the_part():
    with pytest.raises(ValueError, match="bore"):
        validate_parameters(
            "axis_idler_spacer", dict(defaults("axis_idler_spacer"), bore_mm=20)
        )


def test_recipe_cannot_add_unknown_parameters_or_change_fixed_parts():
    with pytest.raises(ValueError):
        validate_parameters(
            "axis_idler_spacer", dict(defaults("axis_idler_spacer"), run="arbitrary")
        )
    with pytest.raises(ValueError):
        validate_parameters("axis_2007_carriage", {"thickness_mm": 2})


def test_supported_window_variant():
    params = dict(defaults("window_4x8_2x6_36x48"), opening_width_in=30)
    assert validate_parameters("window_4x8_2x6_36x48", params) == params


def test_baked_catalog_matches_current_compiler_files():
    root = Path(__file__).resolve().parents[1]
    catalog = json.loads((root / "web/data/studio/catalog.json").read_text())
    locations = {
        p.name: p
        for p in [
            root / "scripts/studio_compile.py",
            root / "scripts/mount_geometry.py",
            root / "scripts/studio_contract.py",
            root / "scripts/studio_members.mjs",
            root / "upstream/iconic-cad/seh_lib/wall_builder.py",
            root / "upstream/iconic-cad/web/js/members.js",
            root / "upstream/iconic-cad/web/js/constants.js",
            root / "upstream/iconic-cad/web/js/systems.js",
            root / "upstream/iconic-cad/web/assets/lib/members.json",
        ]
    }
    for asset in catalog["assets"]:
        for name, digest in asset["recipe"]["compiler_files_sha256"].items():
            if name in locations:
                assert (
                    hashlib.sha256(locations[name].read_bytes()).hexdigest() == digest
                ), f"Rebake studio catalog: {name} changed"


def test_mount_plate_contract():
    params = dict(defaults("motor_mount_plate"), width_mm=90)
    assert validate_parameters("motor_mount_plate", params) == params
    with pytest.raises(ValueError):
        validate_parameters("motor_mount_plate", dict(params, width_mm=45))
