# handscan — hand-off for a new chat

Paste this into a new chat (or say "continue handscan, read HANDOFF.md"). Claude updates this file at the end of each work session.
Repo is public: no passwords, driver names or employee IDs here.

## Live
- Driver app: https://branweed.github.io/handscan/
- Office: https://branweed.github.io/handscan/admin.html (on a phone it opens only from the Office / Admin button)
- Code: github.com/Branweed/handscan, GitHub Pages from `main`. A new session may need `add_repo` (push access) first.
- Firebase project `handscan-72136` (free Spark): Email/Password + Anonymous sign-in, Firestore. Rules come from `firestore.rules` and must be pasted into the console and published (console matches repo as of Oct 22 — PIN/device rules removed; Claude can publish them via Chrome by setting the CodeMirror editor).
- How-to doc (OUT OF DATE, still describes PINs): https://claude.ai/code/artifact/475dd7ec-e6aa-433c-b4e6-467191b693a6

## How it works
- Drivers: pick name from dropdown, tap a truck. No PINs. Phones sign in invisibly (Anonymous). Anyone with the link can see runs (accepted).
- Office upload: a truck's MA Metrc manifest PDFs + Apex WTI PDFs together → review → Send to truck. One stop per customer; Fall River (MP281319, FR) and Lakeville (MC282112, LV) sets merge, boxes labelled FR/LV.
- WTI check: every tag checked against the manifest; quantity check divides weight by unit size in the item name (multi-packs too).
- Review page: "WTI check" column per package (✓ Match with WTI # and qty, or ✗ Off / Check with the reason), "X of Y match the WTI" per stop and overall, "Show only problems" toggle. Warnings include item names. The check isn't saved with the run.
- Load check at the dock (Done loading; office sees X of Y loaded). Delivery scans: Match / Wrong stop / Not on manifest / Already scanned. Offline scanning, syncs later, CSV export.
- Office → Trucks & phones: Drivers (add/remove/add back; new names on an uploaded manifest are added as soon as the files are read, and the review page says who), Trucks (add/edit/remove, removed copies in `trucks/_removed`), Office admins (add/remove/change password).

## Scanner (barcode-scanner.js)
- Live camera: 1080p, continuous focus, zoom button (1×/2×/3×, starts 2×, remembered), each frame read 3 ways in turn (center crop, high-contrast crop for sleeve glare, full frame), ~40 ms loop. Code 128/QR accept one read; retail/Code 39 need two. Tip appears after 6 s with no read.
- 📷 Photo: reads every tag in one picture (full photo + 2×2 and 3×3 overlapping tiles + contrast pass on 2×2). Each tag is checked; one card lists them, with the photo showing a numbered green/yellow/red box on each read tag. Realistic: 4–6 tags per photo, up to 8–10 in good conditions.

## Publishing
- Edit, bump `VERSION` in `sw.js` (now `manifest-check-v30`), push. Rule changes also go in the Firebase console.
- Demo mode: apiKey starting with "PASTE" in `shared.js`.
- Claude can't type passwords or create accounts.

## Waiting on Brandon
- Confirm a non-admin account/phone loads trucks (hard refresh if it still shows "can't load trucks").
- Upload a manifest with a new driver and check the name shows in the drivers' list.
- Test at work: scanning through sleeves, zoom/speed, multi-tag photos, new WTI review column.

## Leftovers / later
- Update the how-to doc (names + truck, no PINs, auto-added names, Add back, admin features, new scanner/photo/review features).
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
   - Also hand off early when a batch of work is pushed and the next step is Brandon testing at work, a long-conversation reminder shows up, or the topic moves to another project.
   The hand-off line, one line at the end of the reply: "Good point to start a new chat (about Nk tokens used here): say 'continue handscan' there. HANDOFF.md is up to date."
5. When Brandon says "wrap up": update this file (including this section if the rules changed), push, and confirm in one line.
6. Keep this file short. Replace old status, don't append history. Git log has the history.
