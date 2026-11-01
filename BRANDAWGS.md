# Brancan & the Brandawgs — hand-off for a new chat

Paste this into a new chat, or say "set up the Brandawgs, read BRANDAWGS.md (repo: Branweed/handscan)".
This chat is only about the agent team. Other handscan work goes in HANDOFF.md.

## Names (Brandon's request, keep in every handoff)
- **Brancan**: the main Claude in the chat. Plans the work, hands out jobs, checks everything before telling Brandon.
- **Brandawgs**: helper agents Brancan sends out on jobs.

## The job
Save the team as agent files in `.claude/agents/` in the Branweed/handscan repo (needs `add_repo` with push access first). Saved agents cost nothing until called.

Each file: frontmatter (`name`, `description`, `tools`), then its job, the files it may touch, and these rules:
- Read HANDOFF.md first; open only the files the job needs.
- Low usage: no exploring, short report (under 200 words).
- Fix only bugs it can show; never change `firestore.rules`; no passwords, driver names or employee IDs in the repo.
- Push with the attribution lines the chat gives; bump `VERSION` in `sw.js` for app changes.
- Report to Brancan, who checks the work before Brandon hears anything. Say plainly what couldn't be tested.

The team:
1. **brandawg-tester**: runs the demo-mode browser tests in `tests/` (see `tests/README.md`), reports PASS/FAIL, fixes only proven bugs.
2. **brandawg-docs**: updates the handscan how-to doc (https://claude.ai/code/artifact/475dd7ec-e6aa-433c-b4e6-467191b693a6) with the Claude Docs connector, never a republish. Plain words for drivers, office parts in their own section.
3. **brandawg-scanner**: tunes `barcode-scanner.js` (frame views, zoom, exposure, formats in `index.html`). Checks frame order with `tests/mode.js`. Can't test a real camera, so it says what Brandon should time at work.

When done: push, add a "Brandawgs" line to HANDOFF.md listing them, and tell Brandon in two lines how to call one (e.g. "Brancan, send brandawg-tester").

## Cost rule
One Brandawg used about 130k tokens on a full test-and-docs job (Nov 1). Brancan only sends one when Brandon asks, one at a time unless he says otherwise, and tells him roughly what it will cost.

## Hand off
Same rules as HANDOFF.md ("For Claude: when to hand off"). Keep this file short and up to date.
