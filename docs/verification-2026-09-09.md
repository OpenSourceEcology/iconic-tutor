# Verification — 2026-09-09

The standalone Iconic Tutor checkout was tested with Node 26.8.1, Python 3.11,
FreeCAD 1.1.3 and Playwright 1.63.0 / Chromium on macOS.

- Core JavaScript suite passed; 21 Python tests passed.
- Both complete browser lessons generated real FreeCAD variants, inspected and
  saved drafts, reused them, and exported portable JSON, SVG, CAD and contribution
  packages. Desktop and mobile layout checks passed with no page errors.
- Mouse dragging moved before release, retained the camera and created exactly
  one undo entry. Escape and browser touch-cancel preserved original placement.
  Zoom and Fit plan were checked. Tutor goal/history survived reload; request
  summaries contained no BREP geometry. The transport/persistence check used a
  recorded tutor response.
- Separately, the live local model proposed a supported dimension without changing
  saved geometry. A source question returned both the wiki bearing/spacer note
  and the pinned spacer schema as structured citations.
- Independent FreeCAD reopening checked 114 house solids and 5 machine solids,
  placement/volume/bounds and symmetric differences. Maximum bound discrepancy
  was approximately 9.1e-13 mm. Independent window-opening and spacer-dimension
  checks and both contribution compilers passed.

Raw outputs and screenshots are in ignored `reports/studio-browser`. These
checks verify software and geometry behavior, not structural or assembly fit.

## Machine-task clarity and 3D placement follow-up

The updated browser tests passed with a real Z-gizmo drag, numeric XYZ/rotation,
one-step undo, Escape cancellation, bounding-box stacking, portable reload and
CAD download. A separate FreeCAD check reopened all four exported solids and
independently compared their rotated/translated shapes using symmetric differences.
The existing two full generation journeys and plan/tutor interaction suite still
passed, along with 21 Python tests. Core tests cover rotated plan projection and
stacking already-rotated parts. Desktop/mobile screenshots were inspected.

The machine task now explicitly uses an illustrative 2 mm gap. No new Axis
mating evidence or engineering-fit claim was introduced.

## Motor mounting replacement

The default machine lesson now uses an original adapter plate and frame rails
with a simplified, dimensioned stepper-motor reference. The full house and new
motor generation journeys passed. FreeCAD independently checked 114 house solids
and 8 motor/frame/plate solids, including placement, analytic plate volume,
actual mounting-hole voids and surrounding material, no plate/reference solid
interference, and both restoring contribution compilers.

Browser checks passed for live 60→90 mm resizing, preserved saved geometry,
assembled/exploded display without export changes, nominal hole alignment,
legacy Axis download preservation, responsive layouts, 3D manipulation and
persisted tutor context. The live tutor proposed a 100 mm plate width while the
saved geometry stayed at 90 mm. JavaScript core checks and 22 Python tests passed.
