# Manifest Check

Drivers scan each package's Metrc tag at every drop-off and the phone tells them right away whether it belongs there. It shows the item name, quantity or weight, batch and tag. It works with no signal, and the results upload to the office by themselves when the phone is back online.

- **`index.html`** is the driver app. Drivers sign in, pick a manifest, pick the stop, and scan.
- **`admin.html`** is the office page. You upload a truck's manifests and WTIs together, check what was read, and send the run to the truck. You can also manage drivers and trucks, and see results live.

A **run** is one truck's trip. Each Metrc manifest in it is a stop, and every driver on that truck gets the run. Both drivers can scan, and they share one count.

It costs nothing to run: Firebase's free plan plus free hosting (GitHub Pages or Firebase Hosting).

---

## Try it right now (demo mode)

Until you paste your Firebase settings into `shared.js`, everything runs in **demo mode**. There's a sample manifest and no sign-in, and all data stays in that one browser.

1. Upload the whole folder to your host (see step 7), or run it locally with `python3 -m http.server` and open `http://localhost:8000`.
2. Open `index.html` and tap a stop. Tap any package to simulate scanning it, or type a tag such as `1A4FF0100000022000000201` while you're on stop 1 to see a "wrong stop" alert.
3. Open `admin.html` in **another tab of the same browser**:
   - Go to **Drivers & trucks**, add John Gomez and James Stewart, and set their truck to **W99**.
   - Go to **Upload**, select the truck's manifest PDFs and WTI PDFs together, and send the run to **W99**.
4. Back in the driver tab, use **Viewing as** in the yellow bar to switch between John and James. Both see the run and each other's scans.

The camera needs **https** (or `localhost`).

---

## Go live with Firebase (about 15 minutes, free)

1. **Create a project.** Go to [console.firebase.google.com](https://console.firebase.google.com) and click Add project. You can turn Google Analytics off. Stay on the free **Spark** plan.
2. **Turn on sign-in.** Go to Build → Authentication → Get started → Sign-in method, then turn on **Email/Password**.
3. **Create the database.** Go to Build → Firestore Database → Create database, choose **production mode**, and pick the closest location. Then open the **Rules** tab, paste in everything from `firestore.rules`, and click **Publish**.
4. **Connect the app.** Go to Project settings (gear icon) → General → Your apps, click the `</>` (Web) button and register the app. Copy the `firebaseConfig` values into the top of `shared.js`.
5. **Make yourself the office admin.**
   - Go to Authentication → Users → **Add user** and enter your email and a password. Copy the **User UID** it shows.
   - Go to Firestore → **Start collection**, name it `users`, and set the Document ID to the UID you copied. Add these fields:
     - `role` (string) = `admin`
     - `name` (string) = `Brandon`
     - `active` (boolean) = `true`
6. **Allow your website.** Go to Authentication → Settings → **Authorized domains**, then add your site's domain (for example `yourname.github.io`).
7. **Host it.**
   - **GitHub Pages:** create a repo, upload every file in this folder, then go to Settings → Pages and choose Deploy from branch `main`.
   - **Firebase Hosting:** run `firebase init hosting` and then `firebase deploy`.
8. Open `admin.html`, sign in, go to **Drivers & trucks**, and add each driver with their truck (e.g. `W99`), email, and a starting password.

### Driver setup (once per phone)
1. Open the site in **Chrome** and sign in **while connected to the internet**.
2. Open Chrome's ⋮ menu and choose **Add to Home screen / Install app**.
3. Each morning, open the app once on Wi-Fi or data so that day's manifests download. After that it works offline all day, and scans upload automatically when there's signal again.

---

## How scanning works

| What the driver sees | When |
|---|---|
| ✓ **Match** (green, one beep) | The tag is on this stop. The box number, item, quantity/weight, batch and tag are shown. |
| **Already scanned** (yellow, two beeps) | It was already counted at this stop. |
| ✗ **Wrong stop** (red, buzz) | It's on the manifest but for a different stop, and the screen says which one. |
| ✗ **Not on this manifest** (red, buzz) | The tag isn't on the manifest at all. |

- **Camera:** tap **Scan packages** and point at each tag. It reads Code 128, QR, Data Matrix, Code 39 and PDF417. A QR code that holds a link with the tag inside it also works.
- **Bluetooth scanner:** pair it with the phone as a keyboard (HID mode) with **Enter** as the suffix, which is the default on most scanners. Then just scan while a stop is open.
- **Finish stop:** if anything wasn't scanned, the driver confirms, and the office sees exactly what was missing.

## The office page
- **Upload:** select all of a truck's files at once: the Metrc manifest PDFs and the Weight Transfer Invoices (WTIs).
  - Each manifest becomes a stop.
  - Each WTI is matched to its manifest by manifest number. It adds **box numbers**, and every tag is cross-checked. A tag on one but not the other, or a quantity that doesn't match, shows in red before you send.
  - The truck is picked for you from the "Name of Person Transporting" on the manifest, and close spellings count (Gomes = Gomez).
  - You can fix anything in the preview before sending.
- **Runs:** shows live progress, with a ✓, missing or problem status per package, plus who scanned it and when. From here you can send it to a different truck, archive, delete, or **Export results (CSV)**.
- **Drivers & trucks:** add drivers, set or change a driver's truck, or turn an account off. A turned-off driver can't see runs. Changing a truck affects new runs; to update an existing run, change **Sent to** on that run.

### If the PDF reader gets something wrong
It's tuned to the Massachusetts Metrc "Marijuana Transportation Manifest" and to Apex Weight Transfer Invoices. It handles item names that wrap onto several lines, `Shp: 30 ea` quantities, and Source Production Batch. It skips "Source Package" tags. It also handles generic label and table layouts and CSV exports. If yours comes out wrong, click **Copy** under "Text read from the file" and share that text (blank out anything sensitive) so the reader can be adjusted.

---

## Files
| File | What it is |
|---|---|
| `index.html` | Driver app |
| `admin.html` | Office page |
| `shared.js` | **Your Firebase config goes here.** Also contains shared helpers. |
| `store.js` | Firebase (with offline cache) and demo-mode data |
| `manifest-parser.js` | Reads manifest PDFs and CSVs |
| `barcode-scanner.js` | Camera scanner (your module, extended with colored result cards and different sounds) |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | Offline support and the home-screen app |
| `firestore.rules` | Database security rules |

**After updating files** on your host, change `VERSION` at the top of `sw.js` (for example to `-v2`) so phones pick up the new version.

## Good to know
- This is a delivery check, not a Metrc record. The receiving licensee still accepts the transfer in Metrc.
- Scans that haven't uploaded are shown at the top ("Offline · 3 saved on phone"). If a driver tries to sign out with scans still waiting, the app warns them first.
- The free plan's limits (50,000 reads and 20,000 writes a day) are far more than a delivery fleet needs.
