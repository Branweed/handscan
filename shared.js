// ==========================================================================================
//  STEP 1 — Paste your Firebase web app config here.
//  Firebase console → Project settings → General → "Your apps" → Web app → SDK setup → Config
//  While it still says PASTE_YOUR_API_KEY the app runs in DEMO mode: no accounts, sample data,
//  and everything stays in this browser.
// ==========================================================================================
export const firebaseConfig = {
  apiKey: "AIzaSyBgmmC3mCSgw5htmIfYKv9gVK3VkhRnFgQ",
  authDomain: "handscan-72136.firebaseapp.com",
  projectId: "handscan-72136",
  storageBucket: "handscan-72136.firebasestorage.app",
  messagingSenderId: "870432272595",
  appId: "1:870432272595:web:b4e06f88feecad5156e426",
};
export const DEMO = !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("PASTE");

/* ---------------- Metrc tags ---------------- */
// A Metrc package tag is 24 characters and starts with 1A, e.g. 1A4FF0100000022000000123
export const TAG_RE = /1A[0-9A-Z]{22}/;
export const TAG_RE_G = /1A[0-9A-Z]{22}/g;

// Turns whatever a scanner read (a bare tag, a QR with a URL, a typed tag with spaces) into one comparable tag.
export function normalizeTag(raw) {
  const s = String(raw ?? "").toUpperCase().replace(/[\s​-‍﻿]+/g, "");
  const m = s.match(TAG_RE);
  return m ? m[0] : s.replace(/[^0-9A-Z]/g, "");
}
export const looksLikeTag = t => /^1A[0-9A-Z]{22}$/.test(String(t || ""));

/* ---------------- formatting ---------------- */
export function fmtQty(p) {
  if (!p) return "";
  const q = p.qty === 0 || p.qty ? String(p.qty) : "";
  return [q, p.uom].filter(Boolean).join(" ");
}
export function fmtDate(d) {
  if (!d) return "";
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dt = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(d);
  return isNaN(dt) ? String(d) : dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
export const fmtTime = t => (t ? new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "");
export const uid = (p = "") => p + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6);
export const plural = (n, w, ws = w + "s") => `${n} ${n === 1 ? w : ws}`;

/* ---------------- tiny DOM helper (no innerHTML, so manifest text can't inject markup) ---------------- */
export function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (k === "value" || k === "checked" || k === "disabled" || k === "selected") e[k] = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false && k !== "") e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
// A tag with its last 5 characters in bold — that's the part people actually compare by eye.
export function tagNode(tag, cls = "tag") {
  const t = String(tag || "");
  return h("span", { class: cls }, t.length > 8 ? [t.slice(0, -5), h("b", null, t.slice(-5))] : t);
}
// Replaces a container's content but keeps focus (and cursor) on the input that had it.
export function swap(root, node) {
  const a = document.activeElement, k = a && a.dataset ? a.dataset.k : null;
  let sel = null;
  try { sel = k && a.selectionStart != null ? [a.selectionStart, a.selectionEnd] : null; } catch (e) {}
  root.replaceChildren(node);
  if (k) {
    const n = root.querySelector(`[data-k="${CSS.escape(k)}"]`);
    if (n) { n.focus({ preventScroll: true }); if (sel) try { n.setSelectionRange(sel[0], sel[1]); } catch (e) {} }
  }
}

/* ---------------- scan results ---------------- */
export const RESULT = {
  match: { tone: "ok", title: "✓ Match" },
  duplicate: { tone: "warn", title: "Already scanned" },
  wrong_stop: { tone: "bad", title: "✗ Wrong stop" },
  not_on_manifest: { tone: "bad", title: "✗ Not on this manifest" },
};

// Everything both pages need to know about a manifest's progress, from its list of scans.
export function summarize(m, scans = []) {
  const byTag = new Map(), per = {};
  (m.stops || []).forEach((s, i) => {
    per[s.id] = { matched: new Map(), issues: [], dups: 0 };
    (s.packages || []).forEach(p => { if (!byTag.has(p.tag)) byTag.set(p.tag, { stop: s, pkg: p, index: i }); });
  });
  for (const sc of scans) {
    const r = per[sc.stopId]; if (!r) continue;
    if (sc.result === "match") { if (!r.matched.has(sc.tag)) r.matched.set(sc.tag, sc); }
    else if (sc.result === "duplicate") r.dups++;
    else r.issues.push(sc);
  }
  let total = 0, done = 0;
  for (const s of m.stops || []) { total += (s.packages || []).length; done += per[s.id].matched.size; }
  return { byTag, per, total, done };
}
// A run is what one truck carries: one or more Metrc manifests, each one a stop.
/* ---------------- where an order ships from (one Metrc manifest + WTI per facility) ---------------- */
// Most orders have a set from each facility; both go to the same customer, so they're one stop.
// Add a line here for a new facility. The order here is the order boxes are listed in.
export const ORIGINS = {
  MP281319: { name: "Fall River", short: "FR" },
  MC282112: { name: "Lakeville", short: "LV" },
};
export function originInfo(license, city) {
  const k = String(license || "").toUpperCase().trim();
  if (ORIGINS[k]) return { license: k, ...ORIGINS[k] };
  const name = String(city || "").trim() || k;
  const words = name.split(/\s+/).filter(Boolean);
  const short = (words.length > 1 ? words.map(w => w[0]).join("") : name.slice(0, 2)).toUpperCase();
  return { license: k, name, short: name ? short : "" };
}
export const originRank = lic => { const i = Object.keys(ORIGINS).indexOf(String(lic || "").toUpperCase()); return i < 0 ? 99 : i; };
// The manifest/WTI sets that make up a stop (older runs have just manifestNo/invoiceNo on the stop).
export const stopSets = s => (s.sets && s.sets.length ? s.sets : s.manifestNo ? [{ manifestNo: s.manifestNo, invoiceNo: s.invoiceNo || "" }] : []);
export const stopManifestNos = s => stopSets(s).flatMap(x => String(x.manifestNo || "").split(/[,\s]+/)).filter(Boolean);
export const setText = x => `${x.origin ? x.origin + ": " : ""}Manifest ${x.manifestNo || "—"}${x.invoiceNo ? ` · WTI ${x.invoiceNo}` : ""}`;
export const multiOrigin = s => new Set((s.packages || []).map(p => p.origin).filter(Boolean)).size > 1;
// "LV Box 3" when a stop has boxes from two facilities (each WTI numbers its boxes from 1), else "Box 3"
export const boxLabel = (p, multi) => (p.box ? `${multi && p.originShort ? p.originShort + " " : ""}Box ${p.box}` : "");
export const manifestNos = m => {
  const l = [...new Set((m.stops || []).flatMap(stopManifestNos))];
  return l.length ? l : m.manifestNo ? [m.manifestNo] : [];
};
export const runTitle = m => m.title || [m.truck, fmtDate(m.date)].filter(Boolean).join(" · ") || (m.manifestNo ? `Manifest ${m.manifestNo}` : "Delivery");
export const crewNames = m => (m.driverNames && m.driverNames.length ? m.driverNames : m.driverName ? [m.driverName] : []).join(" & ");
export const driverIdsOf = m => (m.driverIds && m.driverIds.length ? m.driverIds : m.driverId ? [m.driverId] : []);
export const firstName = n => String(n || "").trim().split(/\s+/)[0];
/* ---------------- trucks + driver logins ---------------- */
// The trucks shown as big buttons on the driver app's first screen (more are added as runs are sent to them).
export const KNOWN_TRUCKS = [
  { code: "W99", nickname: "White 99" },
  { code: "BW", nickname: "Berry White" },
  { code: "WW", nickname: "White Widow" },
];
// "Ford, Transit 250 White 99, X78446" → plate "X78446", truck "W99" ("Berry White" → "BW", "White Widow" → "WW")
export function vehicleInfo(v) {
  const parts = String(v || "").split(",").map(x => x.trim()).filter(Boolean);
  const plate = (parts.slice(2).find(x => /^[A-Z0-9-]{4,10}$/i.test(x)) || "").toUpperCase();
  const words = (parts[1] || parts[0] || "").split(/\s+/).filter(Boolean);
  const modelAt = words.findIndex(w => /\d/.test(w));
  const nick = modelAt >= 0 && modelAt < words.length - 1 ? words.slice(modelAt + 1) : words.slice(1);
  const code = nick.map(w => (/^\d+$/.test(w) ? w : w[0].toUpperCase())).join("");
  return { plate, nickname: nick.join(" "), code };
}
// Office admins sign in with a username ("Brandon"); behind the scenes that's this made-up email address.
// An email address typed in full also works.
export const ADMIN_DOMAIN = "admins.handscan.app";
export const adminEmail = u => { const v = String(u || "").trim(); return v.includes("@") ? v : `${v.toLowerCase().replace(/[^a-z0-9._-]/g, "")}@${ADMIN_DOMAIN}`; };
// (Older builds signed drivers in with an Employee ID; drivers now just pick their truck.)
export const DRIVER_DOMAIN = "drivers.handscan.app";
export const driverEmail = id => `${String(id || "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "")}@${DRIVER_DOMAIN}`;
export const makePin = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(100000 + (a[0] % 900000)); };
export const packageCount = m => (m.stops || []).reduce((n, s) => n + (s.packages || []).length, 0);
export const stopIsDone = (m, id) => !!(m.stopsDone && m.stopsDone[id]);

export function downloadCsv(name, rows) {
  const q = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const blob = new Blob([rows.map(r => r.map(q).join(",")).join("\n")], { type: "text/csv" });
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

export function friendlyError(e) {
  const c = (e && (e.code || e.message)) || String(e);
  if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) return "That email or password isn't right.";
  if (/too-many-requests/.test(c)) return "Too many tries. Wait a few minutes and try again.";
  if (/network-request-failed|unavailable|offline/i.test(c)) return "No internet connection. You need one for this step.";
  if (/permission-denied|insufficient permissions/i.test(c)) return "Your account doesn't have access to this. Ask the office to check it.";
  if (/email-already-in-use/.test(c)) return "There's already an account with that email.";
  if (/weak-password/.test(c)) return "The password needs at least 6 characters.";
  return "Something went wrong: " + c;
}
