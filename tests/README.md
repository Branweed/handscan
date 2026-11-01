# Demo-mode browser tests (not part of the app)

Headless Chromium + Playwright, run in a Claude workspace. Nothing here is loaded by the app.

1. Copy the repo to `/home/claude/hs-copy` and in the copy's `shared.js` make the Firebase apiKey start with `PASTE` (demo mode). Never commit that.
2. Serve the copy: `cd /home/claude/hs-copy && python3 -m http.server 8765`
3. Run from this folder: `node a_load.js` (pages load), `node b_flow.js` (plan → upload `run.csv` → send → ✓ Sent → delete clears), `node b2_mark.js` (Mark not sent), `node d_offline.js` (opens offline), `node mode.js` / `node plan.mjs` (scanner frame order, plan matching; these read files from `/home/claude/handscan`).

`common.js` blocks outside requests and stubs Leaflet. Real camera, real PDFs and live Firebase can't be tested this way.
