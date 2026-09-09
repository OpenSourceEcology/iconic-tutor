# Iconic Tutor walkthrough

The two lessons join composition, dimensional changes, real FreeCAD generation
and source-aware tutoring.

## Mount a motor to a frame

Open `studio.html?lesson=machines`. A recognizable motor sits between two frame
rails, with a gold adapter plate on its front face. The original 60 × 60 × 3 mm
plate fits the motor but does not reach the frame's mounting holes.

1. Use **Pull apart** to see the plate, motor face and rails. Dashed lines show
   the intended hole axes. **Assembled** restores the display; neither button
   changes exported placements.
2. Drag **Plate width** from 60 to 90 mm. The shape changes immediately at a
   stable camera scale. **Look down at holes** makes the alignment easy to see.
   The four outer holes move to the frame's 76 × 46 mm pattern; the motor's
   31 mm pattern and center opening remain fixed.
3. **Generate & compare** builds checked FreeCAD solids. Compare the two plates
   at a common scale, review dimensions and geometry checks, then save a draft.
4. **Use my saved variant** replaces the original plate in place. The motor and
   rails stay where they are. Export FreeCAD, the portable project or a draft
   contribution package.

Width, height and thickness have number fields and sliders beside the model.
Live previews and saved-draft previews are labeled. They do not overwrite the
placed geometry or exported CAD. Generation creates a checked candidate; reuse
updates the actual assembly. Moving parts manually means their nominal hole
pattern and their actual placement must be checked separately.

### Source and design choices

The simplified motor reference follows the SOYO SY42STH47-1206A drawing
060047000, available from [Pololu](https://www.pololu.com/file/0J685/SY42STH47-1206A.pdf).
Its nominal interface includes a 42.3 mm body, 47 mm length, four M3 holes on a
31 mm square, a 22 mm locating boss, and a 5 mm shaft. Cosmetic cap divisions,
threads, wires and internal geometry are simplified or omitted. This is an
original reference model built from dimensions, not supplier CAD.

The rails and adapter are original demo designs. The rail holes are 76 mm apart
across and 46 mm along the frame. Plate frame holes sit 7 mm in from the edges,
so 90 × 60 mm reaches them. The plate uses 3.4 mm motor clearances, a 23 mm boss
opening and 5.5 mm frame holes. These are explicit exercise design choices;
material, tolerances, fastener length and load capacity remain unreviewed.

The canonical dimensions and source notes are in
`web/data/studio/motor-mount.json`. `scripts/mount_geometry.py` builds the CAD;
`web/js/mount-preview.js` reads the same dimensions for the live browser preview.
The alignment readout checks nominal hole centers, not manufacturing approval.

Previous Axis browser studies are preserved as a downloadable project when this
lesson first opens. Portable Axis files remain viewable and exportable; their
spacer mating location is still unresolved. They are no longer the starter lesson.

## House wall-layout study

Select a window wall in the twelve-module study. Change the rough opening from
36 to 30 inches inside the fixed 48 × 96 inch outer panel. Generate, inspect,
save and replace a window instance. Corners, roof, foundation and structural
engineering are outside this wall-layout exercise.

## Composition controls

The icon plan supports smooth dragging, background pan, scroll zoom, drop
snapping, text/arrow annotations and one-step undo. Arrow keys move a selected
part; R rotates around Z. Escape and cancelled touch restore a drag's starting
position. **Place selected** works without dragging from the palette.

In 3D, **Move XYZ** and **Rotate XYZ** show handles. **Focus selected** helps
inspect small parts. **Position & stack** provides exact world coordinates in
millimeters and rotations in degrees. Z is up; rotations use Rz · Ry · Rx.
The plan projects all eight rotated bounding-box corners.

**Stack above** centers bounding boxes in X/Y and raises the selected box above
another by the chosen gap. It is an arrangement tool, not a mating constraint.
The motor lesson begins with explicit common interface datums and needs no
manual placement to complete its task.

## Run and persist

See [README](../README.md) for Python, Node, FreeCAD and model setup. Without
FreeCAD, the committed catalog still supports composition and exports. Slider
previews also work; creating a checked new variant needs FreeCAD. The current
motor and housing lessons do not require an external machine-library checkout.
Legacy Axis regeneration and rebuilding the full catalog require
`STUDIO_GVCS_ROOT` pointing at the pinned VCS library.

The server binds to loopback by default; use `--host YOUR_LAN_IP` for a LAN demo.
Its API keeps same-origin checks, accepts only supported numeric recipes and
runs one FreeCAD worker at a time. Failed generation preserves the project.
Rebuild the catalog with `python3 scripts/studio_server.py --bake` after compiler
changes; recipes record source, schema and compiler hashes.

Projects embed their assets, meshes, BREPs, placements, goal and annotations.
Browser sessions use IndexedDB. The goal travels in portable JSON; up to twenty
short conversation messages per lesson remain browser-local. Tutor requests
include at most eight prior messages, placed-type counts and selected/candidate
context; they exclude geometry payloads. The tutor uses curated source records,
not general wiki retrieval, and fills parameter proposals for user review.

A contribution ZIP contains the saved geometry, recipe, metadata, report, SVG
icon, wiki draft and a compiler that restores its BREPs. It is a portable draft,
not an automatically installed library entry. Editing its JSON alone does not
regenerate geometry. Sources and pending engineering/license status are retained.

## Verification

```sh
npm test
python3 -m pytest tests -q
npm run test:browser
"$STUDIO_FREECAD_PYTHON" scripts/verify_studio_freecad.py
"$STUDIO_FREECAD_PYTHON" scripts/verify_studio_placement_freecad.py
```

The browser suites cover both complete generation lessons, live resizing,
view-only explosion, old-project preservation, undo, pointer/touch cancellation,
3D positioning, portable reload and CAD/contribution downloads. FreeCAD reopens
the actual exports and independently checks placement, volumes, opening voids,
plate hole locations, motor/rail interference and contribution compilers.
Reports and screenshots are written under ignored `reports/` directories.
