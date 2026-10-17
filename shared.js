// ==========================================================================================
//  STEP 1 — Paste your Firebase web app config here.
//  Firebase console → Project settings → General → "Your apps" → Web app → SDK setup → Config
//  While it still says PASTE_YOUR_API_KEY the app runs in DEMO mode: no accounts, sample data,
//  and everything stays in this browser.
// ==========================================================================================
export const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
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
export const manifestNos = m => {
  const l = [...new Set((m.stops || []).map(s => s.manifestNo).filter(Boolean))];
  return l.length ? l : m.manifestNo ? [m.manifestNo] : [];
};
export const runTitle = m => m.title || [m.truck, fmtDate(m.date)].filter(Boolean).join(" · ") || (m.manifestNo ? `Manifest ${m.manifestNo}` : "Delivery");
export const crewNames = m => (m.driverNames && m.driverNames.length ? m.driverNames : m.driverName ? [m.driverName] : []).join(" & ");
export const driverIdsOf = m => (m.driverIds && m.driverIds.length ? m.driverIds : m.driverId ? [m.driverId] : []);
export const firstName = n => String(n || "").trim().split(/\s+/)[0];
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
