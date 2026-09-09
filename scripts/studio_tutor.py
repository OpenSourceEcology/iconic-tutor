"""Bounded project context and source references for the tutor, without CAD payloads."""

import json

SOURCES = {
    "motor_drawing": {
        "title": "SOYO SY42STH47-1206A motor mounting drawing",
        "url": "https://www.pololu.com/file/0J685/SY42STH47-1206A.pdf",
        "fact": "Drawing 060047000 shows 42.3 mm body width, 47 mm nominal length, 31 mm bolt pitch, four M3 mounting holes, 22 mm boss diameter, 2 mm boss height, 5 mm shaft diameter and 24 mm shaft projection. Our motor is a simplified reference envelope; no supplier CAD is claimed.",
    },
    "axis_build": {
        "title": "Universal CNC Axis: bearing and spacer source note",
        "url": "https://wiki.opensourceecology.org/wiki/Universal_CNC_Axis#Universal_Axis_with_Magnet_Holes_2017",
        "fact": "The build list names 6x12x4 mm flanged bearings. The 2017 section calls for a nominal 1 mm spacer with 6x10x3 mm flanged bearings. This does not verify the newer v20.07 idler interface.",
    },
    "spacer_recipe": {
        "title": "Retained spacer schema: radii and pad length",
        "url": "https://github.com/OpenSourceEcology/vcs-library/blob/9c3f5520c963951961c723f8d7340c9d7c8ddbff/collections/gvcs/library/parts/axis_idler_spacer/schema.py",
        "fact": "The CAD recipe yields OD 19.812 mm, bore 12.7 mm, pad thickness 1.016 mm. The bore exceeds the wiki's named 10 mm bearing OD, so direct bearing contact is not established. These sources need reconciliation before assembly.",
    },
    "window_schema": {
        "title": "Iconic CAD: window wall schema",
        "url": "https://github.com/OpenSourceEcology/iconic-cad/blob/54fb950/library/modules/window_4x8_2x6_36x48/schema.py",
        "fact": "The source is a 48x96 inch wall module with a 36x48 inch rough opening. The demo changes rough opening width, height and sill within a fixed outer wall. Purchased-window dimensions and structural approval are not established by this schema.",
    },
}


def tutor_context(body, source_id):
    """Keep client facts bounded, separate from trusted source evidence."""
    history = body.get("history", [])
    if not isinstance(history, list) or len(history) > 8:
        raise ValueError("Tutor history must contain at most eight messages.")
    messages = []
    for item in history:
        if not isinstance(item, dict) or item.get("role") not in ("user", "assistant"):
            raise ValueError("Invalid tutor history.")
        text = item.get("content")
        if not isinstance(text, str) or len(text) > 1200:
            raise ValueError("Tutor history messages must be short text.")
        messages.append({"role": item["role"], "content": text})
    project = body.get("project", {})
    if not isinstance(project, dict) or len(json.dumps(project)) > 6500:
        raise ValueError("Project summary is too large.")
    allowed = {
        "goal",
        "placed_count",
        "placed_types",
        "selected_instance",
        "candidate",
        "annotations",
        "draft_count",
    }
    if set(project) - allowed:
        raise ValueError("Unexpected project summary fields.")
    keys = (
        ["window_schema"]
        if source_id.startswith(("window", "wall", "door"))
        else ["motor_drawing"]
        if source_id
        in ("nema17_motor_reference", "mount_frame_rails", "motor_mount_plate")
        else ["axis_build", "spacer_recipe"]
    )
    return messages, project, {key: SOURCES[key] for key in keys}


def cited_sources(answer, sources):
    keys = answer.get("sources", [])
    if not isinstance(keys, list) or any(
        not isinstance(k, str) or k not in sources for k in keys
    ):
        raise ValueError("The tutor cited a source outside this lesson.")
    return [
        {"id": key, "title": sources[key]["title"], "url": sources[key]["url"]}
        for key in dict.fromkeys(keys)
    ]
