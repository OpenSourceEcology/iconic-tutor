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
