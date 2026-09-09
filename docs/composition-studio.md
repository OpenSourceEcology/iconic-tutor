# Composition Studio demo

The studio joins composition, bounded asset generation, and a short tutor lesson.
Open `studio.html` using the local service below. Links to the existing house editor and machine workbench open the upstream application.

## The two journeys

**House:** start with a twelve-module wall-layout study. Select a window wall,
change its rough opening from 36 to 30 inches, and compare the real framing.
The outer panel stays 48 × 96 inches. Inspect the checks, save the variant to
your palette, and replace a window instance with it.

**Machines:** inspect Universal Axis carriage, idler, and spacer source parts.
Change spacer thickness from 1.016 to 2 mm while retaining its bore and outer
diameter. Inspect the comparison, save a named variant, and place another copy.
The source parts are deliberately separated; the study does not define their
mating transforms.

Both lessons retain original assets. Generated geometry remains a candidate
until the user inspects the report and saves it to their personal palette.
That acknowledgement is not engineering approval. The contribution loop ends
when a saved variant is used in a composition.

The icon composition view supports dragging parts, moving them with arrow keys,
rotation, text labels, and arrow annotations. Its SVG export is a diagram.
Arrows do not create mechanical interfaces. The 3D view and FreeCAD export use
the same placements and generated solids.

## Run locally

Requirements: Python 3.11+, Node 20+, a Python environment able to import
`FreeCAD` and `Part`, and a checkout of the existing public VCS library.
The service itself uses only Python's standard library. A tested macOS option
is a dedicated conda-forge environment:

```sh
conda create -y -p /absolute/path/freecad-env -c conda-forge --override-channels freecad=1.1.3 python=3.11
export STUDIO_FREECAD_PYTHON=/absolute/path/freecad-env/bin/python
export PYTHONPATH=/absolute/path/freecad-env/lib
export STUDIO_GVCS_ROOT=/absolute/path/vcs-library/collections/gvcs
python scripts/studio_server.py --port 8766
```

Open [the local studio](http://localhost:8766/studio.html). The service binds
to loopback by default. To make a demo accessible on a LAN, supply the Mac's
explicit interface address, for example `--host 192.168.37.228`. The API accepts
that configured address and retains its same-origin checks.
It runs a single FreeCAD job at a time, validates supported
numeric parameters before compilation, and checks a receipt rather than
trusting FreeCAD's exit code. Each job has its own temporary files and a
90-second worker timeout. Failed generation preserves the current design.

For the optional live tutor, set these before starting the service:

```sh
export STUDIO_LLM_BASE_URL=http://your-local-model:8000/v1
export STUDIO_LLM_MODEL=your-model-id
# STUDIO_LLM_API_KEY is optional and stays in the server environment.
```

The endpoint must support Chat Completions JSON responses. The model receives
the selected source identity, current parameters, allowed ranges, lesson stage,
and a short source-grounded explanation of the supported components. It can
explain the design or propose a numeric parameter change. A proposal fills the
form; generation remains an explicit user action. The model does not execute
code or edit the wiki. The current tutor uses curated source context and wiki
links, not live wiki search or a general engineering curriculum.

Chat commands such as “show machine parts” and “show housing modules” switch
palettes locally, preserving each study. These navigation actions also work
without a connected model.

Without a model, the guided lesson and suggested explanations work, and the UI
identifies that mode. Without the local generation service, the committed
catalog still supports viewing, composition, diagrams, project loading and
exports; new geometry generation is disabled.

## Assets and persistence

The starter catalog is generated from three existing Iconic CAD housing entries
and three `vcs-library` machine entries. Its recipe records the source revision,
schema hash, compiler-file hashes, parameters, and FreeCAD version. Rebuild with:

```sh
python scripts/studio_server.py --bake
```

The housing worker uses the existing `enumerateMembers()` function and
`seh_lib.wall_builder`; its process-local member override does not edit the
canonical library. The spacer uses `gvcs_geometry.compile_spacer`. Fixed machine
parts use the source compiler's hash checks. Mesh and BREP data come from the
same valid FreeCAD shapes. The studio preview renders those generated meshes,
including the compiler's OSB geometry.

Sessions use IndexedDB. A downloaded project embeds its assets, recipes,
geometry reports, placements, and diagram annotations. It can reopen without
regenerating a variant or relying on another user's draft catalog. Projects
are limited to 25 MB, 60 assets, and 200 instances in this demo. Invalid loads
are rejected before replacing the current project. Browser storage and draft
palettes are local to the browser origin; they are not shared with other users.

A contribution ZIP includes the saved asset, schema, source metadata, report,
BREPs, an SVG icon, a wiki draft, and a compiler that restores those BREPs in
FreeCAD. This is a portable draft package, not an automatically installed
canonical library entry. Its compiler restores the saved variant; editing the
JSON alone does not regenerate solids. Use its source recipe in the studio to
make another dimensional variant. Publication requires the normal library/wiki
review and integration workflow.

## Validation

```sh
python -m pytest tests/test_studio_contract.py -q
node tests/studio_core.mjs
npm ci
npx playwright install chromium
node scripts/verify_studio_browser.mjs
"$STUDIO_FREECAD_PYTHON" scripts/verify_studio_freecad.py
```

The browser verifier requires the local service with FreeCAD connected. It
generates both variants, completes the lessons, tests failure preservation and
portable reloads, downloads the actual CAD/contribution files, and captures
desktop/mobile screenshots. If a live tutor is configured, it also checks that
an AI proposal changes form values without mutating the saved geometry.

The FreeCAD verifier reopens those actual downloads, independently constructs
their transforms, compares source/export volumes, bounds and symmetric
differences, checks the spacer's analytic volume and the window's opening, and
runs both contribution compilers. Receipts are written under
`reports/studio-browser/` (gitignored).

## Deliberate scope

The house is a wall-layout study, with corner/interface details, roof, foundation
and building engineering left unresolved. The machine scene is a source-parts
study. Geometry checks do not approve assembly fit, loads, materials, operating
performance, fabrication or construction. All generated variants retain
engineering-review-pending status and their source terms.

The first generation path varies two established parametric families. New
component families, generated compilers/validators, automatic mating,
collaborative publication, voice, and certification are subsequent work.

## September interaction and tutor pass

Icon composition now follows the pointer continuously, retains its camera after edits,
and records one undo step per drag. Drag the background to pan, scroll to zoom,
and use Fit plan to reframe. Snapping is applied to the movement on release
(1 inch for housing, 1 mm for machines); Alt bypasses it. Escape or a cancelled
touch restores the original placement. Place selected supports touch and keyboard
users without a palette drag.

Variant comparison has its own 3D panel with before/after dimensions, unchanged
parameters, solid-part count and material-volume change. The placed assembly stays
visible. This is geometry comparison, not a cut-list, waste or cost estimate.

The tutor retains up to 20 short messages per lesson in browser storage. Requests
include at most eight prior messages, the project goal, placed-type counts,
selected placement, draft count and current candidate. Meshes/BREPs are excluded.
The goal travels in portable project JSON; conversations remain browser-local.
The model can cite only the lesson's supplied source keys, rendered as source links.
These are curated source records, not unrestricted wiki retrieval.

The machine lesson links the Universal CNC Axis wiki's nominal 1 mm spacer note
for 6x10x3 mm flanged bearings to the retained CAD's 1.016 mm pad. It also surfaces
the 12.7 mm bore / 10 mm bearing OD discrepancy and the newer idler revision.
There is still no verified mating transform or assembly-fit approval.

Additional verification: `node scripts/verify_studio_interaction.mjs` exercises
actual mouse and touch input, cancellation, camera stability, single-step undo,
and persisted tutor context. Its context transport test uses a recorded response;
the existing browser suite separately checks a real model proposal when connected.

## 3D arrangement and the machine task

The machine exercise is explicitly a spacer for an illustrative 2 mm gap. A
section diagram shows the spacer between contact faces around a shaft. Those
faces and the shaft are teaching references, not additional Axis CAD assets.
The 2 mm dimension is chosen for the exercise, not sourced from the Axis assembly.
A real mating location for the retained spacer remains unresolved.

Select a placed part and choose **Move XYZ** or **Rotate XYZ** to drag the 3D
handles. **Focus selected** makes small parts easier to inspect. Z points up;
Escape cancels a drag, and a completed drag is one undo step. **Position & stack**
provides exact world X/Y/Z coordinates in millimeters and rotations in degrees.
Rotations and exported geometry use Rz · Ry · Rx. The plan projects all eight
rotated bounding-box corners, including tilts around X and Y.

**Stack above** centers the selected part's bounding box over another in X/Y and
raises its bottom to the other box's top plus the requested gap. This works with
rotated parts and is an arrangement tool; it does not recognize mating faces,
align bore axes, or create persistent assembly constraints.

Additional checks:

```sh
node scripts/verify_studio_placement.mjs
"$STUDIO_FREECAD_PYTHON" scripts/verify_studio_placement_freecad.py
```

These exercise a real Z-handle drag, numeric rotations, single-step undo,
Escape, stacking, project reload and exported CAD. The independent FreeCAD check
reconstructs placements and compares solids through symmetric differences.
