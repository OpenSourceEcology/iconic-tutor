# ICHL module authoring

Use this workspace to turn a module's source material into editable definitions, run its compilers, inspect the generated files, and record the questions that need a contributor. The first supported compiler builds ICHL-015, a plain 48 × 96-inch 2×6 wall frame with either 16- or 24-inch stud spacing. Existing construction records and contributor attribution stay attached to the project.

[Watch the 21-second spacing-change and drawing-repair walkthrough](https://opensourceecology.github.io/iconic-tutor/media/ichl-wall-walkthrough.mp4) · [Download OC16](https://github.com/OpenSourceEcology/iconic-cad/raw/refs/heads/main/ichl_wall/examples/OC16.zip) · [Download OC24](https://github.com/OpenSourceEcology/iconic-cad/raw/refs/heads/main/ichl_wall/examples/OC24.zip)

## Start with the tutor

[Open the public module walkthrough](https://opensourceecology.github.io/iconic-tutor/coach.html) to explore the wall without installing software. Compare OC16 and OC24, open the published drawings and cut lists, and keep field notes. To talk to the AI and generate your own files, open the workshop link from your organizer, enter your invitation, and create a project. In a personal Studio, open [the local tutor](http://127.0.0.1:8766/coach.html).

Choose **OSE AI** and describe what you see as a builder. For example, ask “Which cut-list line corresponds to this stud?” or “The two fastening sources disagree. What evidence should I bring back?” Check the cited build record. Inspect and confirm any proposed edit before the tutor regenerates the files. Keep unresolved evidence visible in your handoff. [Hosting the tutor for a group](coach-workshop.md)

## Run locally

Install Git, Python 3.11 or newer, and Node.js 22 or newer. From a terminal run

```sh
git clone https://github.com/OpenSourceEcology/iconic-tutor.git
cd iconic-tutor
python3 scripts/setup_ichl.py
python3 scripts/studio_server.py
```

Open [Module authoring](http://127.0.0.1:8766/author.html). Setup downloads the exact Iconic CAD revision in [compiler.lock.json](../library/ichl/compiler.lock.json) into `reports/ichl-cad`. The compiler produces native FreeCAD files locally using Iconic CAD's member and solid generators. A desktop CAD installation is optional. Developers working on both repositories can set `STUDIO_ICONIC_ROOT` to their CAD checkout before starting Studio.

Each save creates a project revision. The single-user local server stores projects and generated files in `~/.local/share/iconic-tutor/authoring.sqlite3`. Set `STUDIO_AUTHORING_DB` to choose another database. On reopening the app, select the project under **Resume a project**. Use its private handoff ZIP to exchange the saved instance, full source records, coach conversation, project notes, reports and wiki draft with a trusted collaborator.

The bundled registry contains 303 modules. All support source intake and saved workstream notes. **Refresh from the wiki** retrieves the chosen module's canonical page and registry reference when available. For an existing Wikibot installation, set `STUDIO_WIKIBOT_EVIDENCE_DB` and `STUDIO_WIKIBOT_SNAPSHOT` to import a named snapshot when creating a project. Sources and their revisions travel with the export.

To ask the AI tutor for an edit, configure `STUDIO_LLM_BASE_URL` and `STUDIO_LLM_MODEL` for an OpenAI-compatible Chat Completions service before starting Studio. Supply `STUDIO_LLM_API_KEY` on the backend if the service requires one. A model response includes its evidence and proposed field changes. Accepting the proposal saves a revision. **Generate & validate** then runs the compiler on the saved values. The guided procedures and manual edits also work offline after setup.

## First contributor exercise

1. Choose **ICHL-015 · Wall Framing**, create a project and select **Generate & validate**. In Geometry, inspect the named members. The OC16 example contains four studs and three plates. Compare its cut list with the lumber on the purchasing sheet.
2. Open **Fabrication Drawings** and select the offset of `stud.at16`. Generate, then inspect the exported SVG. This dimension is attached to the named member.
3. In **Parametric CAD Geometry**, change the spacing to 24 inches. You can also ask the live tutor to propose this change and inspect the diff. Regenerate. The OC24 wall has three studs and three plates. The drawing reports that its selected stud is missing.
4. Return to **Fabrication Drawings**, remove the obsolete selection, and select the offset of `stud.at24`. Regenerate. The drawing should pass again. Earlier project revisions retain their outputs.
5. Open **Connections and Connectors**. The standard wall card describes screws, while the earlier wall workflow describes nails. Read the cited records. When a reviewer identifies the applicable schedule, enter the hardware ID, count, installation detail, placements, reviewer, and source. The stud-to-plate joint and the joint between top plates have separate schedules. Regenerate and trace the accepted values into connections, BOM, instructions and the field sheet.
6. In **Quality Control Procedures**, record measurements with specimen identity, method, tolerance and reviewer when available. Unperformed inspections stay pending. A measurement outside tolerance appears as a failure.
7. Open the same saved revision for the publication ZIP and the wiki draft. Unzip a copy to inspect the files under `outputs/`, including the compiler manifest, editable schemas and instances, drawings and any HTML or Python artifacts. `attribution.json` lists the saved source revisions. Review user-entered design evidence, such as reviewer names and measurements, for public release. The private handoff ZIP also contains the coach conversation and project notes. Keep that archive with the project team.
8. After review, upload the **publication ZIP** under the exact `wiki_filename` in `upload-names.json`. The live-source draft reads the current canonical page and preserves its text around the generated section. Preview the proposed change and verify the ZIP download link before saving the wiki edit. The filenames in the workstream table refer to files inside the archive. In the authoring API, use `/api/authoring/projects/{id}/revisions/{version}/publication` to download the reviewed generation again.

## Handoff

| Contributor task | Evidence to bring back |
|---|---|
| Confirm framing details | A source applicable to the selected OC16 or OC24 build, the fastening and interface decisions, and who reviewed them. The scope excludes sheathing, finishes and services. |
| Complete purchasing and field checks | Dated quotes and alternatives, actual stock and kerf assumptions, and measurements from an identified wall. |
| Verify independent use | Have a second person complete the exercise and record where the procedure, prompts, or validation messages need improving. |
| Start another module | Choose its registry entry and save scope, evidence and workstream notes. A new family needs its own compiler, configured examples and output checks before it can generate reviewed assets. |

The eleven software procedures are executable for ICHL-015. With the supplied inputs, geometry, drawings, cut lists and parametric icons pass their software checks. The other seven workstreams emit drafts with specific evidence gaps. Construction review remains pending for both example walls. Invited workshops support private projects, an included model, and an optional prepaid frontier-model test checkout. [Workshop operator guide](coach-workshop.md) · [Credit accounting](tutor-credits.md)

[Canonical ICHL-015 page](https://wiki.opensourceecology.org/wiki/ICHL-015) · [Wall framing records](https://wiki.opensourceecology.org/wiki/Wall_Framing) · [Earlier wall workflow](https://wiki.opensourceecology.org/wiki/Iconic_CAD_Workflow_Example) · [OSE trial criteria](https://wiki.opensourceecology.org/wiki/Iconic_CAD_Lead_Announcement)
