# handscan — hand-off for a new chat

Paste this into a new chat (or say "continue handscan, read HANDOFF.md"). Claude updates this file at the end of each work session.
Repo is public: no passwords, driver names or employee IDs here.

## Live
- Driver app: https://branweed.github.io/handscan/
- Office: https://branweed.github.io/handscan/admin.html (on a phone it opens only from the Office / Admin button)
- Code: github.com/Branweed/handscan, GitHub Pages from `main`. A new session may need `add_repo` (push access) first. A claude.ai chat without push access clones the public repo and hands back the changed files (zip) for Brandon to upload on GitHub.
- Firebase project `handscan-72136` (free Spark): Email/Password + Anonymous sign-in, Firestore. Rules come from `firestore.rules` and must be pasted into the console and published (console matches repo as of Oct 28 — includes Route Board `buyers`/`routeStops`; Claude can publish them via Chrome by setting the CodeMirror editor).
- How-to doc (current as of Nov 1: adds Navigate, driver notes, Route Board office section, Upload using the plan, ✓ Sent / Mark not sent, offline + glare scanning tips): https://claude.ai/code/artifact/475dd7ec-e6aa-433c-b4e6-467191b693a6 — edit it with the Claude Docs connector, not a publish

## How it works
- Drivers: pick name from dropdown, tap a truck. No PINs. Phones sign in invisibly (Anonymous). Anyone with the link can see runs (accepted).
- Office upload: a truck's MA Metrc manifest PDFs + Apex WTI PDFs together → review → Send to truck. One stop per customer; Fall River (MP281319, FR) and Lakeville (MC282112, LV) sets merge, boxes labelled FR/LV.
- WTI check: every tag checked against the manifest; quantity check divides weight by unit size in the item name (multi-packs too).
- Review page: "WTI check" column per package (✓ Match with WTI # and qty, or ✗ Off / Check with the reason), "X of Y match the WTI" per stop and overall, "Show only problems" toggle. Warnings include item names. The check isn't saved with the run.
- Stop screen (v33): "🧭 Navigate" opens Google Maps directions (office-fixed pin if there is one, else the address); the buyer's driver note shows as a 📝 banner (and on the run list).
- Load check at the dock (Done loading; office sees X of Y loaded). Delivery scans: Match / Wrong stop / Not on manifest / Already scanned. Offline scanning, syncs later, CSV export.
- Office → Trucks & phones: Drivers (add/remove/add back; new names on an uploaded manifest are added as soon as the files are read, and the review page says who), Trucks (add/edit/remove, removed copies in `trucks/_removed`), Office admins (add/remove/change password).

## Route Board (routes.html)
- Office page for Brian, linked from the Office tabs ("Route Board"). Same admin sign-in; not a phone page.
- Add invoices: Apex invoice PDFs (read by `parseManifestFile`, then `readInvoice` in routes.html for Buyer/Ship To/License/Invoice #/Delivery date), pasted email text, .eml, or by hand. Review before adding.
- Week board: Unscheduled + Mon–Fri (Sat/Sun only if used); drag cards to days. A card dropped on a one-truck day joins that truck.
- Day view: per-truck tabs, stop list with ▲▼, Suggest stop order (nearest + 2-opt, straight-line), Open in Google Maps (9 waypoints per link, splits into parts), Copy stop list, OpenStreetMap map via Leaflet (jsdelivr), drag a pin to fix a location.
- Addresses are looked up with OpenStreetMap Nominatim (1/s, saved on the buyer; ", MA" added; falls back to the town).
- Firestore (office-only rules): `buyers/{license}` { name, license, address, lat, lng, geo, notes (office), driverNote }, `buyers/_start` (where trucks leave from), `routeStops/{id}` { buyerKey, name, license, address, invoiceNo, day, truck, order }. Watches the last 90 days.
- Upload uses the plan (v33, `applyPlan` in admin.html): stops matched by WTI/invoice # (any day, leading zeros ignored), else license on the delivery date. Stops sorted by the plan's truck and order, unmatched last. The truck is pre-picked from the plan only if the manifest has none; if they differ, the review says so with a "Use W12" button. It also lists stops on another truck and planned stops missing from the files. Each stop gets the buyer's `driverNote` (editable on review) and the pin if fixed by hand (`lat`/`lng`); office `notes` never go on a run. `buyerKey` now lives in shared.js.
- Sent flag (v34): Send to truck marks the matched `routeStops` with `sentRunId`, `sentTruck`, `sentDate`, `sentAt` (`markPlanSent`); deleting the run clears them (`clearPlanSent`). Route Board cards and day list show "✓ Sent on W99"; the edit dialog has "Mark not sent". Upload review warns "Already sent on a run" and leaves sent stops out of "planned but missing". No rule change.
- Next: tune `readInvoice` with a real Apex invoice.

## Scanner (barcode-scanner.js)
- Live camera: 1080p, continuous focus, tap the picture to focus there (3 s, then auto). Zoom button 1×–5× (whatever the phone allows), starts 2×, remembered.
- Formats (v35, `FORMATS` in index.html): Code 128, QR, Code 39 only (data_matrix and pdf417 dropped: they slow the phone's reader).
- Views (v35): every other frame goes to the reader untouched (full frame, the fast Pickup Board way). Frames in between: the view that last read a tag (`bcs-favor`) every other time, else rotate center crop / "tight" (aim box enlarged ~2.4× for far tags) / high-contrast crop (glare).
- Glare: if nothing reads for ~1.1 s, exposure switches between normal and -1 EV; whichever reads is kept and remembered (`bcs-expo`).
- Timing (v31): 15 ms between frames, 0.45 s pause after a read, a tag just read is ignored for 2.5 s so the next tag reads straight away. Code 128/QR accept one read; retail/Code 39 need two. Tip after 6 s with no read.
- 📷 Photo: reads every tag in one picture (full photo + 2×2 and 3×3 overlapping tiles + contrast pass on 2×2), numbered green/yellow/red boxes. 4–6 tags per photo, up to 8–10 in good conditions.
- Not testable here; syntax-checked only. Goal: a tag through plastic in 1–2 s. Brandon timed v31 at ~3 s or more, depending on angle and focus; the Pickup Board scanner (visual-shopping-list `app.js`, plain `det.detect(video)` at 720p, 4 retail formats) felt much faster, so v35 borrows that. If still slow, next ideas: 720p instead of 1080p for the untouched frames, drop Code 39, skip the contrast pass on phones where `bcs-favor` is full.

## Publishing
- Edit, bump `VERSION` in `sw.js` (now `manifest-check-v35`), push. Rule changes also go in the Firebase console.
- Demo mode: apiKey starting with "PASTE" in `shared.js`.
- Claude can't type passwords or create accounts.

## Tested by Claude (Nov 1, demo mode, headless Chromium)
- index/admin/routes load with no console errors. v34 passed end to end: CSV upload matched the plan (order, truck, driver note, "not on plan", "planned but missing"), Send set `sentRunId/sentTruck/sentDate`, Route Board showed "✓ Sent on T1", a second upload warned "Already sent", run delete and "Mark not sent" cleared it. `applyPlan` invoice match (leading zeros, other day) checked in node.
- v35 `nextMode`: every even frame is full; crop/tight/boost all get turns, favor = full handled. Offline: the app shell and a run load from the service worker in offline mode.
- Not testable here: real camera speed, real PDFs, Firebase. No bugs found, so still v35.

## Next chat: do these, in order
1. **Fix what Brandon found testing** (v33–v35 passed a demo test, not tested at work yet). Ask for results first:
   - v35 scanner: time a tag through plastic (goal 1–2 s; was ~3 s), far tags with 3–5× zoom, tap to focus, multi-tag photos. Does any tag type stop reading (QR, older Code 39)? Too dark (glare exposure)?
   - v34 sent flag: send a run planned on the Route Board, check its cards show ✓ Sent; delete a test run and check the flag clears.
   - v33: plan a day on the Route Board (give a buyer a driver note), upload that truck's manifests + WTIs: stop order, truck, warnings, note. On a phone: Navigate opens Maps, the note shows.
   - Non-admin phone loads trucks (hard refresh if "can't load trucks"); a new driver on a manifest shows in the drivers' list; Route Board "Trucks leave from" set.
2. **Tune `readInvoice` with a real Apex invoice.** Brandon is getting one from his laptop: a PDF attached to the chat, or the "Text read from the file" from the Route Board.

## Leftovers / later
- Verify a real Lakeville set. Add RJ as an admin if not done. Check two drivers' employee IDs read from manifests.

## Working style
Batch requests, short replies, low usage, keep it simple for drivers.

## For Claude: when to hand off
Brandon wants long chats split up to save usage. Every chat on this project should:
1. Start by reading this file instead of re-reading the whole repo. Open only the files the task needs.
2. After every push, update this file (version, what changed, what's waiting on Brandon) in the same commit or right after it.
3. Keep a rough running count of tokens used in this chat (Claude doesn't get an exact number, so estimate):
   - about 4 characters = 1 token; a tool result or reply you can see counts at its length.
   - full file reads cost roughly: admin.html 13k, manifest-parser.js 10k, index.html 8k, barcode-scanner.js 7k, store.js 4k, shared.js 3k, this file 1k.
   - a screenshot is about 1–1.5k; each back-and-forth (request, edits, reply) is usually 3–8k on top of file reads.
   - if a counter like "N tokens left" is shown, use how much it has dropped since the chat started.
4. Hand off by token use:
   - Around 60k used: finish the current request, push, update this file, then end the reply with the hand-off line.
   - Around 90k used: stop starting new work. Push what's done, update this file (note anything half-done), and give the hand-off line.
5. Hand off by number of requests too (whichever comes first, tokens or requests):
   - Count Brandon's messages that ask for something (questions or work; "ok"/"thanks" don't count).
   - At 8 requests: after finishing that one, update this file and push, and say a hand-off is coming soon.
   - At 10 requests: hand off. Push, update this file (note anything half-done), and give the hand-off line with the count, e.g. "(10 requests, about 70k tokens)".
   - Also hand off early when a batch of work is pushed and the next step is Brandon testing at work, a long-conversation reminder shows up, or the topic moves to another project.
   The hand-off line, one line at the end of the reply: "Good point to start a new chat (N requests, about Nk tokens used here): paste 'continue handscan, read HANDOFF.md (repo: Branweed/handscan)' there. HANDOFF.md is up to date."
6. When Brandon says "wrap up": update this file (including this section if the rules changed), push, and confirm in one line.
7. Keep this file short. Replace old status, don't append history. Git log has the history.
