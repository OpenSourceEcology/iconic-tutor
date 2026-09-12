# Iconic Tutor

Learn by composing a design, changing a source component, inspecting real CAD,
and leaving a reusable contribution. This early OSE demo includes a house
wall-layout lesson, a motor mounting-plate lesson and a twelve-cabin village lesson.

- Smooth icon dragging, pan/zoom, drop snapping, keyboard placement and undo.
- XYZ movement/rotation handles, exact coordinates, and bounding-box stacking.
- Live plate-size sliders beside the model, assembled/exploded views and visible hole alignment.
- Real FreeCAD variants with a separate before/after view and dimensional report.
- A tutor that remembers the lesson conversation and project goal, sees the
  current composition, and links answers to curated wiki and schema sources.
- Portable projects, FreeCAD exports and contribution ZIPs with provenance.

Derived from Iconic CAD by Collin DeSantis and Open Source Ecology.
See [attribution and source records](NOTICE.md) and [AGPL-3.0](LICENSE).

## Try the composition interface

Python 3.11+ is sufficient for the committed catalog:

```sh
python3 scripts/studio_server.py
```

Open http://localhost:8766/studio.html. The catalog supports composition and
exports without FreeCAD installed. New variant generation requires the setup
below. Without a model, the tutor uses clearly identified guided explanations.

## GitHub Pages

GitHub Pages hosts the browser demo at
`https://opensourceecology.github.io/iconic-tutor/` once the Pages workflow deploys.
It supports both scenes, live plate-size previews, 3D placement, built-in guided
explanations, portable projects and export of existing CAD geometry. It cannot
run the Python/FreeCAD worker or a private model endpoint. The hosted UI labels
this mode and links back to the full local setup.

The `GitHub Pages` workflow checks the code, builds a static artifact, tests it
under the `/iconic-tutor/` subpath and deploys only the web files plus license
notices. Repository Settings → Pages should use **GitHub Actions** as the source.
Future pushes to `main` redeploy automatically.

To verify the Pages artifact locally:

```sh
python3 scripts/build_pages.py
python3 -m http.server 8777 --bind 127.0.0.1 --directory reports/pages-preview
# In another terminal, after installing Playwright/Chromium:
node scripts/verify_pages.mjs
```

Full generation and AI can run on your local machine or a separately hosted
backend. The current backend serves the UI and API together; it is not exposed
by the Pages deployment. API credentials remain outside the static artifact.

## Enable real generation

The repository includes a pinned, unchanged subset of Iconic CAD's housing
compiler in `upstream/iconic-cad` and its own motor-mount geometry recipe. Install Node 20+ and Python capable of importing FreeCAD/Part.
A tested macOS option is a conda-forge FreeCAD 1.1.3 / Python 3.11 environment.

```sh
conda create -y -p /absolute/path/freecad-env -c conda-forge --override-channels freecad=1.1.3 python=3.11
export STUDIO_FREECAD_PYTHON=/absolute/path/freecad-env/bin/python
export PYTHONPATH=/absolute/path/freecad-env/lib
python3 scripts/studio_server.py
```

For AI questions and parameter proposals, also set `STUDIO_LLM_BASE_URL` and
`STUDIO_LLM_MODEL` to an OpenAI-compatible Chat Completions service supporting
JSON responses. `STUDIO_LLM_API_KEY` is optional and stays on the server.
Start the service after setting these variables. To share over your LAN, add
`--host YOUR_LAN_IP`; the default is loopback.

Legacy Axis regeneration requires `STUDIO_GVCS_ROOT` pointing to the
`collections/gvcs` directory in OpenSourceEcology/vcs-library at commit
`9c3f5520c963951961c723f8d7340c9d7c8ddbff`. This is also needed to rebuild the full
catalog, which retains legacy parts for portable-project compatibility.

Regenerate the catalog with `python3 scripts/studio_server.py --bake` after
compiler changes. `STUDIO_ICONIC_ROOT` can point to a complete Iconic CAD checkout
instead of the bundled snapshot. The snapshot manifest identifies its revision
and file hashes; generated recipes retain their actual compiler hashes.

## Verify

```sh
npm ci
npm test
python3 -m pip install -r requirements-dev.txt
python3 -m pytest tests -q
npx playwright install chromium
# With the local FreeCAD service running:
npm run test:browser
"$STUDIO_FREECAD_PYTHON" scripts/verify_studio_freecad.py
```

The browser suites exercise both real generation journeys, exported projects,
continuous dragging, single-step undo, touch cancellation, camera stability,
and tutor persistence. The FreeCAD check reopens the actual browser exports and
independently checks transforms, dimensions, volumes and contribution compilers.
Reports and screenshots are local under `reports/studio-browser`.

## Scope

The house is a wall-layout study. The motor lesson uses a simplified motor
reference based on a supplier drawing and original demo rails/adapter geometry.
A 60 mm plate misses the rails; widening it to 90 mm aligns the outer holes while
preserving the motor pattern. Nominal alignment is checked; material, fasteners,
tolerances and strength remain unreviewed. Previous Axis studies are preserved,
but their spacer mating location remains unresolved. See NOTICE.md.

The tutor uses a small curated source set, not general wiki retrieval. It fills
parameter proposals for review; it does not run generated code or publish edits.
Contributions are portable drafts, not automatically installed library entries.

See [the detailed walkthrough](docs/composition-studio.md).

## Village construction lesson

Open [the village tutor on GitHub Pages](https://opensourceecology.github.io/iconic-tutor/village.html),
also linked from the [main Iconic Tutor page](https://opensourceecology.github.io/iconic-tutor/).
The development server is at `http://100.66.110.49:8766/village.html` on Tailscale.
Arrange twelve two-story cabins using the
supplied FreeCAD model, guided site planning, dynamic icon palettes and plan/3D
views. The 31 VCS assembly icons and 301 ICHL registry icons are loaded with
search and project filters, and are visible but disabled until models are available.
See [village walkthrough and source notes](docs/village-tutor.md).

## Wiki and FreeCAD learning paths

The main page now links two browser-only guided paths:

- [Wiki cleanup and design sharing](https://opensourceecology.github.io/iconic-tutor/learn.html?track=wiki): careful manual edits, wikibot mission selection and proposal review, wiki-page drafts and VCS inclusion requests.
- [FreeCAD and OSE Library Workbench](https://opensourceecology.github.io/iconic-tutor/learn.html?track=freecad): desktop orientation, installation, compiling an entry, applying exposed parameters, validation and schema export.

Both include understanding checks, contextual questions and locally saved progress.
The contribution workspace downloads wikitext/Markdown and opens an unsubmitted
GitHub issue form. It never posts edits, uploads files, runs CAD or installs entries.
Wikibot access may require operator assistance; the lessons remain usable offline
after loading even when that service is unavailable. Draft storage is browser-local,
not account-synced. Download drafts for backup.

Guidance was checked against the wikibot mission/review implementation and the
workbench and VCS contribution guides on 2026-09-12. The workbench's manual install,
document binding and schema export behavior are intentional parts of the lessons.
Run `node scripts/verify_learning.mjs` against the static Pages preview to test both
paths, persistence, safe drafts, downloads, mobile layout and main-page links.
