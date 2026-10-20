# handscan — hand-off for a new chat

Paste this into a new chat (or say "continue handscan, read HANDOFF.md"). Claude updates this file at the end of each work session.
Repo is public: no passwords, driver names or employee IDs here.

## Live
- Driver app: https://branweed.github.io/handscan/
- Office: https://branweed.github.io/handscan/admin.html (on a phone it opens only from the Office / Admin button)
- Code: github.com/Branweed/handscan, GitHub Pages from `main`. A new session may need `add_repo` (push access) first.
- Firebase project `handscan-72136` (free Spark): Email/Password + Anonymous sign-in, Firestore. Rules come from `firestore.rules` and must be pasted into the console and published.
- How-to doc (OUT OF DATE, still describes PINs): https://claude.ai/code/artifact/475dd7ec-e6aa-433c-b4e6-467191b693a6

## How it works
- Drivers: pick name from dropdown, tap a truck. No PINs. Phones sign in invisibly (Anonymous). Anyone with the link can see runs (accepted).
- Office upload: a truck's MA Metrc manifest PDFs + Apex WTI PDFs together → review → Send to truck. One stop per customer; Fall River (MP281319, FR) and Lakeville (MC282112, LV) sets merge, boxes labelled FR/LV.
- WTI check: every tag checked against the manifest; quantity check divides weight by unit size in the item name (multi-packs too).
- Review page: "WTI check" column per package (✓ Match with WTI # and qty, or ✗ Off / Check with the reason), "X of Y match the WTI" per stop and overall, "Show only problems" toggle. Warnings include item names. The check isn't saved with the run.
- Load check at the dock (Done loading; office sees X of Y loaded). Delivery scans: Match / Wrong stop / Not on manifest / Already scanned. Offline scanning, syncs later, CSV export.
- Office → Trucks & phones: Drivers (add/remove/add back), Trucks (add/edit/remove, removed copies in `trucks/_removed`), Office admins (add/remove/change password).

## Scanner (barcode-scanner.js)
- Live camera: 1080p, continuous focus, zoom button (1×/2×/3×, starts 2×, remembered), each frame read 3 ways in turn (center crop, high-contrast crop for sleeve glare, full frame), ~40 ms loop. Code 128/QR accept one read; retail/Code 39 need two. Tip appears after 6 s with no read.
- 📷 Photo: reads every tag in one picture (full photo + 2×2 and 3×3 overlapping tiles + contrast pass on 2×2). Each tag is checked; one card lists them, with the photo showing a numbered green/yellow/red box on each read tag. Realistic: 4–6 tags per photo, up to 8–10 in good conditions.

## Publishing
- Edit, bump `VERSION` in `sw.js` (now `manifest-check-v29`), push. Rule changes also go in the Firebase console.
- Demo mode: apiKey starting with "PASTE" in `shared.js`.
- Claude can't type passwords or create accounts.

## Waiting on Brandon
- Test at work: scanning through sleeves, zoom/speed, multi-tag photos, new WTI review column.

## Leftovers / later
- Unused PIN code in `store.js` (driverSignIn, savePin, resetPin, devices/pins/access), `admin.html` (accessCard()), and devices/pins/settings rules. `manifest-check/` folder is an old copy.
- Update the how-to doc (names + truck, no PINs, Add back, admin features, new scanner/photo/review features).
- Verify a real Lakeville set. Add RJ as an admin if not done. Check two drivers' employee IDs read from manifests.

## Working style
Batch requests, short replies, low usage, keep it simple for drivers.
