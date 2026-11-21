# Run an OSE Tutor workshop

A participant needs a browser, a workshop address and a private invitation. The operator installs the software once. Each contributor gets their own projects and conversation. The two contribution tasks share a claim board. A draft submitted to the board is visible to other participants.

## Try it on the operator's computer

From the repository root with Python 3.11+ and Node.js 22+ installed, run the commands below. Keep the invitation output private. The workshop directory holds its own SQLite database and should be backed up.

```sh
python3 scripts/setup_ichl.py
python3 scripts/coach_workshop.py --data ~/.local/share/iconic-tutor/workshop invite "First builder"
python3 scripts/coach_workshop.py --data ~/.local/share/iconic-tutor/workshop serve
```

Open [the local workshop](http://127.0.0.1:8770/coach.html), enter the invitation, and choose **Create project**. Select **Wall Framing** for the executable example. Other registered modules offer evidence intake and a walkthrough of their eleven schemas. The operator can issue more invitations while the workshop is running. Reuse a participant's invitation on their own device to resume their projects. Sign out under **AI usage and credits** when finished on a shared device.

**OSE AI** uses the operator's server-side `STUDIO_LLM_BASE_URL`, `STUDIO_LLM_MODEL` and optional `STUDIO_LLM_API_KEY` settings. Choose **Lesson guide** for the written procedure, or **OSE AI** to ask a question in your own words. A proposed project change requires confirmation. A frontier answer uses the configured provider at the displayed rates. [Prepaid test accounts and model setup](tutor-credits.md)

## Invite builders over the web

Use a dedicated HTTPS origin on the workshop operator's reverse proxy. Forward the whole origin to the loopback workshop listener, preserve the original Host header, and allow sufficient time for a model answer or a compile. Run the process under the host's service supervisor. For example, to serve a domain you control, replace the placeholder origin below.

```sh
python3 scripts/coach_workshop.py --data ~/.local/share/iconic-tutor/workshop serve --origin https://tutor.example.org
```

Distribute that origin's `/coach.html` link with an individual invitation for each participant. To link the official GitHub Pages walkthrough to the workshop, set the repository Actions variable `OSE_WORKSHOP_URL` to the full HTTPS coach URL and run the Pages workflow. A static walkthrough and reference files are available to anyone before joining.

The workshop checks project ownership on reads, edits, history, model conversations, artifact downloads and exports. The personal Studio listener has a different purpose and assumes a single local user. The workshop allows four simultaneous expensive operations. Each account has a daily UTC allowance of 40 included AI questions, 12 new projects and 500 saved requests. Frontier requests use the prepaid ledger. Review model capacity and observed session times before expanding a cohort. Account maintenance uses the workshop's `workshop.sqlite3` as `STUDIO_AUTHORING_DB`.

## First session

Give two builders separate invitations. Have one build the OC16 wall, change to OC24, repair the drawing, and take a sourced fastening question to a wiki preview. Have the second builder resume a shared task using its handoff, and record the first step that needed help. Local checks verify the software flow. This exercise measures whether builders can do it independently. [Timed contribution exercise](wiki-contribution-pilot.md)
