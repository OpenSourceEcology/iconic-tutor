# Test the wiki contribution workflow

The [wall fastening task](https://opensourceecology.github.io/iconic-tutor/contribute.html?task=wall-fastening) starts with two sources for a stud-to-plate connection. The [window opening task](https://opensourceecology.github.io/iconic-tutor/contribute.html?task=window-opening) asks what an adjoining module needs to fit. Both work on GitHub Pages in a browser. Each task gives the contributor a question, source excerpts with revisions, limits on their applicability, and a list of outputs affected by a decision.

## Parker's first session

1. Open the wall task and start its timer. Read the scope and the cited sources. Record which build and joint you can speak to.
2. Enter either a proposed answer supported by an independent build or reviewer record, or an open question that another builder can answer. Cite the sources you used. The tutor keeps the proposed result separate from the approved fastening schedule.
3. Open **Help and lesson feedback** when you get stuck. Mark the teaching step, describe the obstacle and edit the suggested correction. Pause the timer when you leave the task.
4. Preview the wikitext. **Copy wikitext** prepares a contribution for the module's public discussion page. The wiki editor handles preview and publication. For a rehearsal, stop after the preview and download the handoff.
5. Give a second person the handoff JSON to resume the same task, or make a lesson link to try the instruction on the window task. The lesson link includes only the originating task, step and proposed instruction. Review the text before sharing it.

## What to observe

| Observation | Record |
|---|---|
| Independent use | Could the first contributor reach a citable answer or an actionable question without coaching? |
| Time and help | What was the measured active time? What step required outside help? |
| Transfer | Could someone else resume the saved work and identify the next action? Did the proposed instruction help on the window task? |
| Wiki review | Could a reviewer identify the build, evidence, and unresolved details in the proposed wikitext? |

One timed session measures one contribution. Record sourcing and reviewer time separately before estimating the effort for an entire module.

## Sharing work

On GitHub Pages, drafts are saved in the current browser. Use a handoff download to move between devices. A contributor can check the module's public discussion before starting. On the same Studio server, the task board can also show a volunteer claim, save a shared draft, and hand work to the next volunteer. A display name identifies a contributor; this service is intended for trusted Studio participants. The module authoring screen links from the matching workstream into its pilot task.

The source catalog pins the wiki revisions and CAD content used in each brief. To check the pins and quotations locally, run `python3 scripts/check_contribution_sources.py`. Add `--live` to check upstream. When a source changes, review the flagged task and update its evidence deliberately. Reopening a draft against updated evidence requires reconciling its citations.

The [proposed ICHL-015 wiki section](wiki-drafts/ICHL-015-contribute.wikitext) contains the public entry links for review.
