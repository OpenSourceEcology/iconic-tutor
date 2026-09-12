# Village tutor

Open https://opensourceecology.github.io/iconic-tutor/village.html or
follow the Village design lesson on the main Iconic Tutor page. The development
server is at `http://100.66.110.49:8766/village.html` on Tailscale. It is also linked from the housing
and machine tutor: “show village” / “design cabins” opens the village workspace.
The service also needs to listen on the Tailscale interface (`--host 100.66.110.49`).
The static web build includes the entire village lesson; no backend is required.

The guided tutor walks through site observations, twelve cabin placements,
shared-space planning and review. Its contextual responses and palette navigation
run locally, independently of the housing/machine LLM service. It is a bounded
lesson guide, not unrestricted AI conversation or live wiki retrieval.

## Use

1. Set site width/depth in feet and record the entrance, sun, terrain and trees.
2. Choose Courtyard or Rows to arrange twelve complete two-story cabins. These
   actions replace the current arrangement and can be undone. Or add cabins one
   at a time from the first icon or Place cabin button. Individual additions use
   the nearest free grid position that meets planning clearance, and fit the view
   so the new cabin is visible. A full site reports a placement error without
   changing the layout. Drag in plan (half-foot snap), edit coordinates,
   rotate in 90-degree increments, or use arrow keys / R with the plan focused.
3. Call up a palette using the selector, search, or tutor requests such as
   “show water icons”, “show energy icons”, “show landscape icons”, “show all icons”.
   The 31 VCS assembly-sheet icons and 301 ICHL registry icons are visible and
   actually disabled. Choose the VCS or ICHL collection, or use site, framing,
   envelope, plumbing, electrical, HVAC, interiors, tools and landscape filters.
   Search accepts labels, wiki target names and stable IDs such as `ICHL-301`.
4. Describe sheltered routes, stairs to upper entries and shared facilities.
5. Review count, full-envelope overlaps, site bounds and user-selected planning
   clearance. Preview the actual CAD in 3D, save/open JSON and export the SVG plan.

In 3D, left drag (or one-finger drag) pans the view by default. Choose **Orbit
view** to rotate around it, or **Pan view** to return. Scroll/pinch zooms, and
Fit view frames the whole village. Move individual cabins in Site plan or with
the selected cabin's East/North coordinate fields. The view instructions change
with the active mode.

Village state and conversation autosave under `iconic-tutor-village-v1` in local
browser storage. Housing and machine IndexedDB sessions remain separate. JSON
files contain site, notes, placements and the exact source revision; reopening
requires that installed cabin revision. The file does not embed the 8 MB geometry.
Invalid imports leave the open project intact. Undo/redo is session-local.

## Retained source

- Requirements: https://docs.google.com/document/d/12_IVKSW9nyVd7IEcWdcFKTnYZS_FlcaYooM3YBeR-Rw/edit
- Specifications folder: https://drive.google.com/drive/folders/1RaxQKtPVD2EWIfH2x34ccKwUKbcFWWv1
- Actual source: https://drive.google.com/file/d/1S5qo7H3v_01JHCLFPJ9jUxnRc5wWwqK9/view
- Presentation: https://docs.google.com/presentation/d/1lhz7eqToB9vXJuHkz3y4ySXMoaB32VcU_R6oFI1ypXw/edit?slide=id.g3f82e373ec9_0_0
- Wiki, cabin image and the 31-icon sheet: https://wiki.opensourceecology.org/wiki/Village_Construction_Set
- ICHL gallery: https://wiki.opensourceecology.org/wiki/301_ICHL_Icons
- ICHL registry: https://wiki.opensourceecology.org/wiki/Registry_for_the_301_ICHL_Icons

The expanded palette retains all 301 registry entries and matching gallery
thumbnails locally, in addition to the 31 VCS assembly references (332 disabled
references total, plus the first placeable cabin). `scripts/import_ichl_icons.py`
rebuilds `web/data/village/ichl-registry.json` and its thumbnail directory using
the explicit registry mappings. Stable registry IDs, labels, wiki targets,
original filenames, source URLs and image hashes are retained. IDs and image
filename numbers are intentionally not treated as interchangeable: `ICHL-301`
maps to `302_Mailbox_with_Address.webp`. All 301 gallery images were matched.
Repeated canonical wiki targets remain separate registry entries. Filter tags
are local navigation aids. The registry labels its scope notes draft hypotheses;
those notes are not imported as verified specifications.

Retrieved 2026-09-12. The supplied `VCS - Conceptual - Cabin 13x13.FCStd` already
contains both stories, front porches and roof. We import its saved visible BREP
shapes, preserving placements, then translate the full envelope to a zero origin.
We do not duplicate a single-story model or substitute a nominal box.

Source SHA-256: `acd52501469f0fb2cd6b00ad7dd29d6c32d3c839fcccb99aa620321dd26f08a7`.
The model contains 28 visible shape objects / 712 solids. Full envelope:
4025.9 × 5308.6 × 6477 mm (13.21 × 17.42 × 21.25 ft), including porch/roof/trim.
The nominal 12×12 module described by the wiki and working document is not the
full envelope of this specific 13×13 implementation.

`scripts/import_village_cabin.py` reproducibly rebuilds `web/data/village/cabin.json`
from `library/village/source/cabin-13x13.FCStd`. It parses XML and BREP without
executing CAD document code. Run with the project's FreeCAD Python and library path.
Geometry and the displayed cabin dimensions are fixed references in this lesson.

The source document's license field says **All rights reserved**, while the wiki
describes open-source intentions. Preserve that discrepancy: this import does not
grant a new license or establish redistribution clearance. The original file is
retained with its metadata. The wiki images retain OSE attribution. The library
is bundled with Iconic Tutor; the separate upstream vcs-library is not modified.

## Scope of checks

Plan footprints use the complete axis-aligned envelope after the supported
quarter-turn rotations. Clearance is a user planning preference, not code or
engineering approval. No terrain, utility networks, access routes, structural
connections or stairs are generated. Shared facilities remain references/notes.
There is no building-cost or occupancy approval claim.

`npm test` includes village layout, transform, overlap and import-validation tests.
`npm run test:village` runs the real browser journey, including both views,
dragging, rotation, undo, palette navigation, save/open, invalid-file preservation,
reload persistence, SVG export and 768/390 px layout checks. Screenshots and its
receipt are written under `reports/village-browser/`.
`scripts/verify_village_freecad.py` independently opens the native source and
compares every imported Part object's bounds, volume and solid count.
`npm run test:village:interaction` checks individual placement without the
HTTPS-only `crypto.randomUUID` API, first-add 3D framing, pan/orbit/zoom,
undo/redo and failed-placement preservation. Set `STUDIO_URL` to the Tailscale
HTTP address to reproduce the remote browser environment.
`scripts/verify_village_navigation.mjs` checks the main-page entry, Foundation
credits, mobile navigation, release-versioned viewer imports and graceful 3D
rendering with an older cached viewer. GitHub Pages CI runs all three village
browser suites against its static artifact before deployment.
