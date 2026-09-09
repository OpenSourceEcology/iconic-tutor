"""Bounded generation contract shared by the studio server and FreeCAD worker."""

import math

HOUSE_IDS = ("wall_4x8_2x6_16oc", "window_4x8_2x6_36x48", "door_4x8_2x6_38x83")
MOUNT_IDS = ("nema17_motor_reference", "mount_frame_rails", "motor_mount_plate")
MACHINE_IDS = ("axis_2007_carriage", "axis_2007_idler", "axis_idler_spacer") + MOUNT_IDS
PARAMETERS = {
    "motor_mount_plate": {
        "width_mm": (60, 110, 60),
        "height_mm": (60, 90, 60),
        "thickness_mm": (3, 8, 3),
    },
    "window_4x8_2x6_36x48": {
        "opening_width_in": (12, 36, 36),
        "opening_height_in": (12, 48, 48),
        "sill_height_in": (18, 30, 24),
    },
    "axis_idler_spacer": {
        "outer_diameter_mm": (5, 60, 19.812),
        "bore_mm": (1, 50, 12.7),
        "thickness_mm": (0.5, 12, 1.016),
    },
}


def validate_parameters(source_id, values):
    """Demo operating bounds, not approved fabrication ranges."""
    if source_id not in PARAMETERS:
        raise ValueError("This source has fixed geometry in the demo.")
    if not isinstance(values, dict) or set(values) != set(PARAMETERS[source_id]):
        raise ValueError("Supply exactly the supported parameters for this component.")
    result = {}
    for key, (low, high, _) in PARAMETERS[source_id].items():
        value = values[key]
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or not low <= value <= high
        ):
            raise ValueError(
                f"{key} must be between {low} and {high}. These are demo limits."
            )
        result[key] = round(value, 6)
    if (
        source_id == "axis_idler_spacer"
        and result["bore_mm"] >= result["outer_diameter_mm"]
    ):
        raise ValueError("The bore must be smaller than the outer diameter.")
    if (
        source_id.startswith("window")
        and result["sill_height_in"] + result["opening_height_in"] + 7.25 > 93
    ):
        raise ValueError("The opening and header must fit below the top plates.")
    return result


def defaults(source_id):
    return {key: spec[2] for key, spec in PARAMETERS.get(source_id, {}).items()}
