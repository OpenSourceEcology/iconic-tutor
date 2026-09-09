"""Original motor-adapter exercise built from a documented motor interface."""

import json
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "web/data/studio/motor-mount.json"


def compile_mount(source, params, doc):
    import FreeCAD as App
    import Part

    schema = json.loads(SCHEMA_PATH.read_text())
    motor, fixture, plate = (schema[k] for k in ("motor", "fixture", "plate"))
    objects = []

    def add(name, shape):
        obj = doc.addObject("Part::Feature", name)
        obj.Shape = shape
        objects.append(obj)

    def hole(shape, x, y, radius, z, length):
        return shape.cut(Part.makeCylinder(radius, length, App.Vector(x, y, z)))

    if source == "motor_mount_plate":
        w, h, t = (params[k] for k in ("width_mm", "height_mm", "thickness_mm"))
        shape = Part.makeBox(w, h, t, App.Vector(-w / 2, -h / 2, 0))
        shape = hole(shape, 0, 0, plate["boss_clearance_hole_mm"] / 2, -1, t + 2)
        pitch = motor["bolt_pitch_mm"] / 2
        for x in (-pitch, pitch):
            for y in (-pitch, pitch):
                shape = hole(
                    shape, x, y, plate["motor_clearance_hole_mm"] / 2, -1, t + 2
                )
        edge = plate["frame_hole_edge_offset_mm"]
        for x in (-(w / 2 - edge), w / 2 - edge):
            for y in (-(h / 2 - edge), h / 2 - edge):
                shape = hole(
                    shape, x, y, plate["frame_clearance_hole_mm"] / 2, -1, t + 2
                )
        add("Adapter_plate", shape)
    elif source == "mount_frame_rails":
        w, h, t = (
            fixture[k] for k in ("rail_width_mm", "rail_length_mm", "rail_thickness_mm")
        )
        for index, x in enumerate(
            (
                -fixture["rail_center_spacing_mm"] / 2,
                fixture["rail_center_spacing_mm"] / 2,
            )
        ):
            shape = Part.makeBox(w, h, t, App.Vector(x - w / 2, -h / 2, -t))
            for y in (
                -fixture["rail_hole_pitch_mm"] / 2,
                fixture["rail_hole_pitch_mm"] / 2,
            ):
                shape = hole(
                    shape, x, y, fixture["rail_hole_diameter_mm"] / 2, -t - 1, t + 2
                )
            add(f"Frame_rail_{index + 1}", shape)
    elif source == "nema17_motor_reference":
        w, length = motor["body_width_mm"], motor["body_length_mm"]
        # Cap split is cosmetic; front face is the z=0 interface datum.
        add(
            "Motor_body",
            Part.makeBox(w, w, length - 14, App.Vector(-w / 2, -w / 2, -length + 7)),
        )
        add(
            "Motor_rear_cap", Part.makeBox(w, w, 7, App.Vector(-w / 2, -w / 2, -length))
        )
        front = Part.makeBox(w, w, 7, App.Vector(-w / 2, -w / 2, -7))
        for x in (-15.5, 15.5):
            for y in (-15.5, 15.5):
                front = hole(front, x, y, 1.5, -4.5, 5)
        add("Motor_front_cap", front)
        add("Motor_boss", Part.makeCylinder(11, 2))
        add("Motor_shaft", Part.makeCylinder(2.5, 22, App.Vector(0, 0, 2)))
    else:
        raise ValueError("Unknown mounting component")
    doc.recompute()
    return objects
