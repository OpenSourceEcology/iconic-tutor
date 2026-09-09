# Iconic Tutor

Learn by composing a design, changing a source component, inspecting real CAD,
and leaving a reusable contribution. This early OSE demo includes a house
wall-layout lesson and a Universal CNC Axis spacer lesson.

- Smooth icon dragging, pan/zoom, drop snapping, keyboard placement and undo.
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

## Enable real generation

The repository includes a pinned, unchanged subset of Iconic CAD's housing
compiler in `upstream/iconic-cad`. Machine generation uses the existing VCS
library checkout. Install Node 20+ and Python capable of importing FreeCAD/Part.
A tested macOS option is a conda-forge FreeCAD 1.1.3 / Python 3.11 environment.

```sh
git clone https://github.com/OpenSourceEcology/vcs-library.git ../vcs-library
git -C ../vcs-library checkout 9c3f5520c963951961c723f8d7340c9d7c8ddbff
conda create -y -p /absolute/path/freecad-env -c conda-forge --override-channels freecad=1.1.3 python=3.11
export STUDIO_FREECAD_PYTHON=/absolute/path/freecad-env/bin/python
export PYTHONPATH=/absolute/path/freecad-env/lib
export STUDIO_GVCS_ROOT=/absolute/path/vcs-library/collections/gvcs
python3 scripts/studio_server.py
```

For AI questions and parameter proposals, also set `STUDIO_LLM_BASE_URL` and
`STUDIO_LLM_MODEL` to an OpenAI-compatible Chat Completions service supporting
JSON responses. `STUDIO_LLM_API_KEY` is optional and stays on the server.
Start the service after setting these variables. To share over your LAN, add
`--host YOUR_LAN_IP`; the default is loopback.

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

The house is a wall-layout study. The machine parts have no verified mating
transforms. The machine source lesson explicitly exposes the wiki's nominal
1 mm spacer versus the retained CAD's 1.016 mm thickness and a bearing/bore
mismatch. Valid geometry is not assembly or engineering approval. Source CAD
license review remains pending where recorded; see NOTICE.md.

The tutor uses a small curated source set, not general wiki retrieval. It fills
parameter proposals for review; it does not run generated code or publish edits.
Contributions are portable drafts, not automatically installed library entries.

See [the detailed walkthrough](docs/composition-studio.md).
