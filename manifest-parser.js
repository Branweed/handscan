/*
 * manifest-parser.js: reads Metrc transfer manifests and weight transfer invoices (WTIs) into stops and packages.
 *
 *   const one = await parseManifestFile(file);       // a PDF, a CSV/TSV export, or a .txt
 *   const run = combine([one, two, wti1, wti2]);     // several files → one delivery run
 *   // run → { date, stops: [{ id, name, license, address, manifestNo, invoiceNo,
 *   //          packages: [{ tag, item, qty, uom, batch, box }] }], warnings, transporters, vehicle, files, rawText }
 *
 * Understands:
 *   - Metrc "Marijuana Transportation Manifest" PDFs (one destination per manifest, e.g. Massachusetts):
 *     package header rows, item names that wrap onto 2–3 lines, "Shp: 30 ea", Source Production Batch,
 *     and it ignores Source Package tags.
 *   - Weight Transfer Invoices: Box # | Batch | Item Name | Metrc Tag | Net Qty / Weight, matched to the
 *     manifest by "Metrc Manifest #". They add box numbers and are cross-checked tag by tag.
 *   - Generic "label: value" PDFs, table PDFs, and CSV exports.
 * The office page always shows a preview, so anything it gets wrong can be fixed before sending.
 */
import { TAG_RE, TAG_RE_G, normalizeTag, looksLikeTag, uid, originInfo, originRank } from "./shared.js";

const PDFJS_VER = "4.4.168";
export const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}/build/pdf.min.mjs`;
export const PDFJS_WORKER = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}/build/pdf.worker.min.mjs`;

export async function parseManifestFile(file) {
  const name = file.name || "";
  if (/\.pdf$/i.test(name) || file.type === "application/pdf") {
    const lib = await import(/* @vite-ignore */ PDFJS_URL);
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const lines = await pdfToLines(lib, new Uint8Array(await file.arrayBuffer()));
    if (!lines.length) return finish({ stops: [], warnings: ["This PDF has no readable text. It may be a scan or photo — export it from Metrc as a PDF or CSV instead."] }, "pdf", name, "");
    return parsePdfLines(lines, name);
  }
  return parseText(await file.text(), name);
}
export const parsePdfLines = (lines, name = "") => finish(parseLines(lines), "pdf", name, linesToText(lines));

export function parseText(text, name = "") {
  const rows = parseDelimited(text);
  if (rows) {
    const r = parseTable(rows);
    if (r && countPkgs(r)) return finish(r, "csv", name, text);
  }
  const lines = text.split(/\r?\n/).map((t, i) => ({ segs: splitPlain(t), y: -i * 12, h: 10, page: 1 })).filter(l => l.segs.length);
  return finish(parseLines(lines), "text", name, text);
}

/* ======================= PDF → lines of positioned text segments ======================= */
export async function pdfToLines(lib, data) {
  const pdf = await lib.getDocument({ data, isEvalSupported: false }).promise;
  const out = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.filter(it => it.str && it.str.trim())
      .map(it => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || it.height || 10 }));
    out.push(...groupItems(items, p));
  }
  return out;
}
// Text pieces (x, y from the bottom, width, height) → lines of segments; a wide gap starts a new segment (column).
export function groupItems(items, p = 1) {
  const out = [], rows = [];
  items = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  for (const it of items) {
    const r = rows.find(r => Math.abs(r.y - it.y) <= Math.max(2, it.h * 0.4));
    if (r) r.items.push(it); else rows.push({ y: it.y, h: it.h, items: [it] });
  }
  rows.sort((a, b) => b.y - a.y);
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x);
    const segs = []; let cur = null;
    for (const it of r.items) {
      const gap = cur ? it.x - cur.x1 : Infinity;
      if (cur && gap < it.h * 0.9) {
        cur.t += (gap > it.h * 0.12 && !/\s$/.test(cur.t) && !/^\s/.test(it.s) ? " " : "") + it.s;
        cur.x1 = Math.max(cur.x1, it.x + it.w);
      } else {
        if (cur) segs.push(cur);
        cur = { t: it.s, x0: it.x, x1: it.x + it.w };
      }
    }
    if (cur) segs.push(cur);
    const clean = segs.map(s => ({ ...s, t: s.t.replace(/\s+/g, " ").trim() })).filter(s => s.t);
    if (clean.length) out.push({ segs: clean, y: r.y, h: r.h, page: p });
  }
  return out;
}
const linesToText = lines => lines.map(l => l.segs.map(s => s.t).join("  |  ")).join("\n");
const lineText = l => l.segs.map(s => s.t).join("  ");
function splitPlain(t) {
  return t.split(/\t| {2,}|\s\|\s/).map(s => s.trim()).filter(Boolean).map((s, i) => ({ t: s, x0: i * 100, x1: i * 100 + 50 }));
}

/* ======================= labels ======================= */
// [label pattern, values that mean it's a different field (e.g. "Item Category" isn't the item name)]
const LBL = {
  item: [/^(?:item|product)(?:\s*name)?\b/i, /^(categ|type|strain|weight|unit|count|qty|quantity|details|#|no\b)/i],
  qty: [/^(?:shipped\s*(?:qty|quantity)?|quantity|qty|wholesale\s*qty)\b\.?/i, /^(uom|unit|price|value|received)/i],
  uom: [/^(?:uom|unit\s*of\s*measure|units?)\b/i, /^(price|cost|weight|value)/i],
  batch: [/^(?:source\s*)?(?:production\s*batch|batch)(?:\s*(?:no\.?|number|#|id))?/i, null],
  harvest: [/^(?:source\s*harvests?(?:\s*\(s\))?|harvest(?:\s*batch|\s*name)?)/i, null],
  license: [/^(?:(?:destination|recipient|buyer)\s+)?(?:license|lic\.)(?:\s*(?:no\.?|number|#))?/i, null],
  name: [/^(?:facility|business|company|establishment|legal|buyer)?\s*name\b(?!\s*of\s*person)/i, null],
  address: [/^(?:(?:destination|recipient|delivery)\s*address|address(?!\s*of\s*(?:originating|origin|transporter|shipper)))\b(?:\s*of\s*destination)?/i, null],
};
const DEST_RE = /^(?:\d+\.\s*)?(?:destination|recipient|ship\s*to|consignee|deliver(?:y)?\s*to)\b/i;
const DEST_FIELD_RE = /^(?:license|lic\b|phone|address|city|state|zip|contact|e-?mail)/i;
const ALL_LABELS = [...Object.values(LBL).map(x => x[0]), DEST_RE,
  /^(?:package|tag|lab|source|est\.?|estimated|departure|arrival|route|driver|vehicle|transporter|origin|originating|shipper|phone|manifest|date|gross|weight|price|wholesale|received|invoice|contains|item\s*details)\b/i];
const isLabel = t => /:\s*$/.test(t) || ALL_LABELS.some(re => re.test(t) && t.replace(re, "").replace(/^[\s:#.\-]+/, "").length === 0);
// Lines under a package that are details, not more of the item name.
// ("Contains Retail IDs" isn't listed: a long item name can wrap onto that line, e.g. "… - Sativa - | Sapura".)
// "(Infused (edible))", "(Vape Product)": the item's category printed under its name, not part of the name.
const CATEGORY_RE = /^\([^\d()]*(?:\([^\d()]*\))?[^\d()]*\)$/;
const DETAIL_LINE = /^(?:item\s*details|source\s*(?:harvest|package|production)|org\.?\s*src|lab\s*test\s*(?:result|date)|product\s*rejection|name\s*of\s*person|signature|i\s*confirm|manifest\s*no|metrc|marijuana\s*transportation|all\s*sales|reject\s*product|transfer\s*form)/i;

function labelValue(lines, [re, reject]) {
  for (let li = 0; li < lines.length; li++) {
    const segs = lines[li].segs;
    for (let si = 0; si < segs.length; si++) {
      const t = segs[si].t, m = t.match(re);
      if (!m) continue;
      const rest = t.slice(m[0].length).replace(/^[\s:#.\-–]+/, "").trim();
      if (rest) { if (reject && reject.test(rest)) continue; return rest; }
      if (si + 1 < segs.length) { const v = segs[si + 1].t; if (!isLabel(v) && !(reject && reject.test(v))) return v; continue; }
      // value printed under the label: take the next line's segment closest to the label
      const nx = lines[li + 1];
      if (nx) {
        const cx = (segs[si].x0 + segs[si].x1) / 2;
        const near = nx.segs.reduce((b, s) => (!b || Math.abs((s.x0 + s.x1) / 2 - cx) < Math.abs((b.x0 + b.x1) / 2 - cx) ? s : b), null);
        if (near && !isLabel(near.t) && !TAG_RE.test(near.t)) return near.t;
      }
    }
  }
  return "";
}

/* ======================= quantities ======================= */
const UNIT_WORDS = "Each|Eaches|Ea|Units?|Grams?|Kilograms?|Milligrams?|Pounds?|Ounces?|Milliliters?|Liters?|Fluid\\s*Ounces?";
const UNIT_ABBR = "lbs?|oz|kg|mg|ml|g|l";
const QTY_WORD_RE = new RegExp(`(\\d{1,3}(?:,\\d{3})+|\\d+)(\\.\\d+)?\\s*(${UNIT_WORDS})\\b`, "i");
const QTY_SEG_RE = new RegExp(`^(\\d{1,3}(?:,\\d{3})+|\\d+)(\\.\\d+)?\\s*(${UNIT_WORDS}|${UNIT_ABBR})\\.?$`, "i");
const SHP_RE = /\b(?:Shp|Shipped|Ship)\s*:\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*([A-Za-z]+)?\s*$/i;
function splitQty(v) {
  const s = String(v || "").trim().replace(/^(?:shp|shipped|ship|qty|quantity)\s*:\s*/i, "");
  const m = s.match(/^((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)\s*(.*)$/);
  if (!m) return {};
  const uom = (m[2] || "").split(/[(\[|/]/)[0].trim().replace(/\.$/, "");
  return { qty: m[1].replace(/,/g, ""), uom: uom.length <= 20 ? uom : "" };
}
const UNIT_NAMES = { ea: "Each", each: "Each", eaches: "Each", qty: "Each", unit: "Each", units: "Each", g: "Grams", gram: "Grams", grams: "Grams",
  kg: "Kilograms", mg: "Milligrams", lb: "Pounds", lbs: "Pounds", pound: "Pounds", oz: "Ounces", ounce: "Ounces", ml: "Milliliters", l: "Liters" };
const niceUnit = u => UNIT_NAMES[String(u || "").toLowerCase().trim()] || String(u || "").trim();
function findQty(lines, skip) {
  for (const l of lines) for (const s of l.segs) if (s.t !== skip) { const m = s.t.match(QTY_WORD_RE); if (m) return { qty: (m[1] + (m[2] || "")).replace(/,/g, ""), uom: m[3] }; }
  for (const l of lines) for (const s of l.segs) if (s.t !== skip) { const m = s.t.match(QTY_SEG_RE); if (m) return { qty: (m[1] + (m[2] || "")).replace(/,/g, ""), uom: m[3] }; }
  return null;
}

/* ======================= table header rows ======================= */
const HDR = {
  box: /^(?:box|box\s*#|box\s*no\.?|carton|case\s*#?)$/i,
  tag: /^(?:package|packages|package\s*(?:tag|label|id|#|no\.?)|tag|tag\s*(?:id|#)|metrc\s*tag|metrc\s*package|uid|label)$/i,
  item: /^(?:item|item\s*name|product|product\s*name|description)$/i,
  qty: /^(?:qty|quantity|shipped|shipped\s*qty|shipped\s*quantity|wholesale\s*qty|amount|count|net\s*(?:qty|quantity|weight)(?:\s*\/\s*weight)?|qty\s*\/\s*weight)$/i,
  uom: /^(?:uom|unit|units|unit\s*of\s*measure)$/i,
  batch: /^(?:batch|batch\s*(?:no\.?|number|#|id)|production\s*batch(?:\s*(?:no\.?|number|#))?|lot|lot\s*(?:no\.?|#))$/i,
  harvest: /^(?:source\s*harvests?|harvest|harvest\s*batch)$/i,
  dest: /^(?:destination|recipient|ship\s*to|customer|destination\s*(?:facility|name))$/i,
};
function headerMap(line) {
  if (TAG_RE.test(lineText(line).toUpperCase())) return null;
  const cols = [];
  for (const s of line.segs) {
    // "1. Package | Shipped" → "Package"
    const t = s.t.replace(/^\d+\.\s*/, "").split("|")[0].replace(/[:*]+$/, "").trim();
    for (const [k, re] of Object.entries(HDR)) if (!cols.some(c => c.key === k) && re.test(t)) { cols.push({ key: k, x0: s.x0, x1: s.x1 }); break; }
  }
  const has = k => cols.some(c => c.key === k);
  if (!(has("tag") && (has("item") || has("qty")) && cols.length >= 3)) return null;
  cols.sort((a, b) => a.x0 - b.x0);
  return cols;
}
function colFor(seg, cols) {
  const cx = (seg.x0 + seg.x1) / 2;
  for (let i = 0; i < cols.length; i++) {
    const start = i === 0 ? -Infinity : (cols[i - 1].x1 + cols[i].x0) / 2;
    const end = i === cols.length - 1 ? Infinity : (cols[i].x1 + cols[i + 1].x0) / 2;
    if (cx >= start && cx < end) return cols[i].key;
  }
  return cols[0].key;
}

/* ======================= destinations (stops) ======================= */
const looksLicense = s => /^[A-Z0-9]{1,8}(?:[-‐][A-Z0-9]{1,12}){1,4}$/i.test(s.trim()) && /\d/.test(s);
function destHeader(t) {
  const m = t.match(DEST_RE);
  if (!m) return null;
  const rest = t.slice(m[0].length).replace(/^[\s:#.\-–\/]+/, "");
  if (DEST_FIELD_RE.test(rest)) return null;        // "Destination License Number", "Destination Phone No." are fields
  return rest;
}
// An address may continue on the line above or below, lined up with the value.
function addressNear(lines, j, seg) {
  const parts = [seg.t];
  const lone = l => l && l.segs.length === 1 && Math.abs(l.segs[0].x0 - seg.x0) < 5 && !isLabel(l.segs[0].t) && !TAG_RE.test(l.segs[0].t);
  if (lone(lines[j - 1]) && !/^\d{3}[-.)\s]\d{3}/.test(lines[j - 1].segs[0].t)) parts.unshift(lines[j - 1].segs[0].t);
  if (lone(lines[j + 1])) parts.push(lines[j + 1].segs[0].t);
  return parts.join(", ").replace(/"/g, "");
}
function destinationAt(lines, i) {
  const segs = lines[i].segs;
  for (let si = 0; si < segs.length; si++) {
    let rest = destHeader(segs[si].t);
    if (rest == null) continue;
    const info = { name: "", license: "", address: "" };
    rest = rest.replace(/^(?:\d+\s*(?:of\s*\d+)?|facility|information|info|details)\b[\s:#.\-–]*/i, "")
      .replace(/^(?:buyer\s*)?name\b[\s:#.\-–]*/i, "").trim();
    if (!rest && si + 1 < segs.length && !isLabel(segs[si + 1].t)) rest = segs[si + 1].t;
    if (rest && !isLabel(rest)) { if (looksLicense(rest)) info.license = rest; else info.name = rest; }
    const stopAt = l => TAG_RE.test(lineText(l)) || headerMap(l);
    for (let j = i - 1; j >= Math.max(0, i - 3) && !stopAt(lines[j]); j--) if (!info.license) info.license = labelValue([lines[j]], LBL.license);
    for (let j = i; j < Math.min(lines.length, i + 9); j++) {
      if (j > i && (stopAt(lines[j]) || destHeader(lines[j].segs[0].t) != null)) break;
      if (!info.license) info.license = labelValue([lines[j], lines[j + 1]].filter(Boolean), LBL.license);
      if (!info.name && j > i) info.name = labelValue([lines[j]], LBL.name);
      if (!info.address) {
        const ls = lines[j].segs, k = ls.findIndex(s => LBL.address[0].test(s.t));
        if (k >= 0) {
          const rest2 = ls[k].t.replace(LBL.address[0], "").replace(/^[\s:#.\-–]+/, "").trim();
          if (rest2) info.address = rest2; else if (ls[k + 1]) info.address = addressNear(lines, j, ls[k + 1]);
        }
      }
    }
    if (!info.name && lines[i + 1]) {
      const n = lines[i + 1].segs[0].t;
      if (!isLabel(n) && !TAG_RE.test(n) && !looksLicense(n)) info.name = n;
    }
    if (info.license && !looksLicense(info.license)) info.license = info.license.split(/\s/)[0];
    return info;
  }
  return null;
}

/* ======================= the main line reader ======================= */
export function parseLines(lines) {
  const all = lines.map(lineText).join("\n");
  const out = { manifestNo: findManifestNo(all), invoiceNo: findInvoiceNo(all), date: findDate(all), stops: [], warnings: [],
    kind: /weight\s*transfer\s*invoice/i.test(all) ? "invoice" : "manifest", transporters: [], vehicle: "" };
  // the crew: "Name of Person Transporting | John Gomes | Employee ID of Driver | AR329212"
  for (const l of lines) for (let k = 0; k < l.segs.length - 1; k++) {
    if (/^name\s*of\s*person\s*transporting/i.test(l.segs[k].t)) {
      const name = l.segs[k + 1].t.trim();
      const idAt = l.segs.findIndex((s, j) => j > k && /employee\s*id/i.test(s.t));
      const employeeId = idAt >= 0 && l.segs[idAt + 1] ? l.segs[idAt + 1].t.trim().toUpperCase() : "";
      if (name && !out.transporters.some(t => t.name === name)) out.transporters.push({ name, employeeId });
    }
    if (/^make,?\s*model/i.test(l.segs[k].t) && !out.vehicle) {
      // the plate is often printed on the next line, under the vehicle
      const v = l.segs[k + 1], nx = lines[lines.indexOf(l) + 1];
      const more = nx && nx.page === l.page && nx.segs.length === 1 && Math.abs(nx.segs[0].x0 - v.x0) < 5 ? ", " + nx.segs[0].t : "";
      out.vehicle = (v.t + more).replace(/,\s*,/g, ",").replace(/,\s*$/, "");
    }
  }
  // where it ships from: "Originating License Number | MP281319" (manifest) or "Originating License | MP281319" (WTI)
  out.originLicense = (labelValue(lines, [/^originating\s*license(?:\s*(?:no\.?|number|#))?/i, null]).split(/\s/)[0] || "").toUpperCase();
  for (let i = 0; i < lines.length && !out.originCity; i++) {
    if (!/address\s*of\s*originating|originating\s*address/i.test(lineText(lines[i]))) continue;
    for (const l of [lines[i - 1], lines[i], lines[i + 1]].filter(Boolean)) {
      const m = lineText(l).match(/([A-Za-z][A-Za-z .'-]*),\s*[A-Z]{2}\s+\d{5}/);
      if (m) { out.originCity = m[1].replace(/^.*\s{2,}/, "").trim(); break; }
    }
  }

  const seen = new Set();
  let stop = null, tbl = null, pkg = null, pkgLines = [], srcList = false;
  const getStop = info => {
    const same = s => (info.license && s.license === info.license) || (!info.license && info.name && s.name === info.name);
    const found = out.stops.find(same);
    if (found) { if (!found.address && info.address) found.address = info.address; if (!found.name && info.name) found.name = info.name; return found; }
    const s = { id: uid("s"), name: info.name || "", license: info.license || "", address: info.address || "", packages: [] };
    out.stops.push(s);
    return s;
  };
  const flush = () => { if (pkg) fillFromLabels(pkg, pkgLines); pkg = null; pkgLines = []; };
  const closeTable = () => { if (tbl) assembleItems(tbl); tbl = null; };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], text = lineText(line);
    const hdr = headerMap(line);
    if (hdr) { flush(); closeTable(); tbl = { cols: hdr, pkgs: [], frags: [] }; continue; }
    const dest = destinationAt(lines, i);
    if (dest && !TAG_RE.test(text)) {
      flush(); closeTable(); srcList = false;
      if (dest.name || dest.license) stop = getStop(dest);
      continue;
    }

    // tags on this line that are the package itself (not a source / parent package)
    const tags = [];
    for (let si = 0; si < line.segs.length; si++) {
      const seg = line.segs[si];
      if (tbl && colFor(seg, tbl.cols) !== "tag") continue;
      const before = line.segs.slice(0, si).map(s => s.t).join(" ");
      for (const m of seg.t.toUpperCase().matchAll(TAG_RE_G)) {
        const pre = before + " " + seg.t.slice(0, m.index);
        if (/source|parent|from\s*package|origin/i.test(pre)) continue;
        if (srcList && !pre.trim()) continue;
        tags.push(m[0]);
      }
    }
    if (/source\s*packages?|parent\s*packages?/i.test(text)) srcList = true;
    else if (!TAG_RE.test(text)) srcList = false;

    if (!tags.length) {
      if (pkg) pkgLines.push(line);
      if (tbl && !DETAIL_LINE.test(line.segs[0].t))
        for (const s of line.segs) if (colFor(s, tbl.cols) === "item" && !CATEGORY_RE.test(s.t)) tbl.frags.push({ t: s.t, y: line.y, page: line.page, h: line.h || 10 });
      continue;
    }

    for (const tag of tags) {
      if (seen.has(tag)) { out.warnings.push(`${tag} is listed more than once; kept the first.`); continue; }
      flush();
      pkg = { tag, item: "", qty: "", uom: "", batch: "", box: "" };
      if (tbl) {
        pkg._table = true; pkg._row = { y: line.y, page: line.page, h: line.h || 10, item: "" };
        let destCell = "";
        for (const s of line.segs) {
          const k = colFor(s, tbl.cols), v = s.t;
          if (k === "item") {
            let t = v; const sm = t.match(SHP_RE);           // "…(20Pk) - Wild Shp: 30 ea" printed into one piece
            if (sm) { t = t.slice(0, sm.index).trim(); pkg.qty = sm[1].replace(/,/g, ""); if (sm[2]) pkg.uom = sm[2]; }
            pkg._row.item = (pkg._row.item + " " + t).trim();
          }
          else if (k === "qty") { const q = splitQty(v); if (q.qty) pkg.qty = q.qty; if (q.uom) pkg.uom = q.uom; }
          else if (k === "uom") pkg.uom = v;
          else if (k === "batch") pkg.batch = pkg.batch || v;
          else if (k === "box") pkg.box = v.replace(/^#/, "");
          else if (k === "harvest") pkg.harvest = v;
          else if (k === "dest") destCell = (destCell + " " + v).trim();
        }
        if (destCell) stop = getStop(looksLicense(destCell) ? { license: destCell } : { name: destCell });
        tbl.pkgs.push(pkg);
        pkgLines = [];
      } else {
        const seg = line.segs.find(s => s.t.toUpperCase().includes(tag));
        const at = seg ? seg.t.toUpperCase().indexOf(tag) : -1;
        const tail = seg && at >= 0 ? seg.t.slice(at + tag.length).replace(/^[\s:|\-–]+/, "").trim() : "";
        pkgLines = [{ ...line, segs: line.segs.map(s => (s === seg ? { ...s, t: "Package " + tag } : s)).concat(tail ? [{ t: tail, x0: seg.x1, x1: seg.x1 }] : []) }];
      }
      if (!stop) stop = getStop({ name: "" });
      stop.packages.push(pkg);
      seen.add(tag);
    }
  }
  flush(); closeTable();
  return out;
}

// Item names that wrap: each loose piece in the item column joins the package row nearest to it (above or below).
function assembleItems(tbl) {
  for (const f of tbl.frags) {
    let best = null, bd = Infinity;
    for (const p of tbl.pkgs) {
      if (p._row.page !== f.page) continue;
      const d = Math.abs(p._row.y - f.y);
      if (d < bd) { bd = d; best = p; }
    }
    if (best && bd <= f.h * 2.6) (best._parts ||= []).push(f);
  }
  for (const p of tbl.pkgs) {
    const parts = [{ t: p._row.item, y: p._row.y }, ...(p._parts || [])].filter(x => x.t).sort((a, b) => b.y - a.y);
    p.item = parts.map(x => x.t).join(" ").replace(/\s+/g, " ").trim();
  }
}

function fillFromLabels(pkg, lines) {
  if (!pkg.batch) pkg.batch = labelValue(lines, LBL.batch) || labelValue(lines, LBL.harvest);
  if (pkg._table) return;                     // tables already gave item and quantity
  if (!lines.length) return;
  if (!pkg.item) pkg.item = labelValue(lines, LBL.item);
  if (!pkg.qty) { const q = labelValue(lines, LBL.qty); if (q) { const s = splitQty(q); if (s.qty) { pkg.qty = s.qty; if (s.uom && !pkg.uom) pkg.uom = s.uom; } } }
  if (!pkg.uom) { const u = labelValue(lines, LBL.uom); if (u && u.length <= 20) pkg.uom = u; }
  if (!pkg.item) {
    const cands = lines[0].segs.map(s => s.t).filter(t => !TAG_RE.test(t.toUpperCase()) && !isLabel(t) && !QTY_SEG_RE.test(t) && !/^[\d.,\s#]+$/.test(t) && !/^package\b/i.test(t));
    pkg.item = cands.sort((a, b) => b.length - a.length)[0] || "";
  }
  if (!pkg.qty) { const q = findQty(lines, pkg.item); if (q) { pkg.qty = q.qty; if (!pkg.uom) pkg.uom = q.uom; } }
}

/* ======================= manifest number, invoice number, date ======================= */
function findManifestNo(text) {
  const m = text.match(/Manifest\s*(?:No\.?|Number|#|ID)?\s*[:#]?\s*(\d{5,})/i);
  return m ? m[1] : "";
}
function findInvoiceNo(text) {
  const m = text.match(/Invoice\s*(?:No\.?|Number|#)[ \t]*[:#]?[ \t]*(\d{3,})/i);
  return m ? m[1] : "";
}
function toIso(s) {
  let m = String(s || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = String(s || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
  return "";
}
const DATE = String.raw`(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})`;
function findDate(text) {
  // the day it goes out matters more than the day the manifest was made
  const labels = [String.raw`Departure`, String.raw`Date\s*of\s*Transfer`, String.raw`Delivery\s*Date|Ship(?:ping)?\s*Date`, String.raw`Date\s*Created|Created`, String.raw`Date`];
  for (const l of labels) { const m = text.match(new RegExp(`(?:${l})\\b[^\\d\\n]{0,25}${DATE}`, "i")); if (m) return toIso(m[1]); }
  const m = text.match(new RegExp(DATE));
  return m ? toIso(m[1]) : "";
}

/* ======================= CSV / TSV ======================= */
export function parseDelimited(text) {
  const sample = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 8);
  if (sample.length < 2) return null;
  let best = null, bestScore = 0;
  for (const d of [",", "\t", ";", "|"]) {
    const counts = sample.map(l => splitRow(l, d).length - 1);
    const min = Math.min(...counts);
    if (min >= 1 && min > bestScore) { best = d; bestScore = min; }
  }
  if (!best) return null;
  return text.split(/\r?\n(?=(?:[^"]*"[^"]*")*[^"]*$)/).filter(l => l.trim()).map(l => splitRow(l, best).map(c => c.trim()));
}
function splitRow(line, d) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === d) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
export function parseTable(rows) {
  const ncol = Math.max(...rows.map(r => r.length));
  let tagCol = -1, best = 0;
  for (let c = 0; c < ncol; c++) {
    const n = rows.filter(r => TAG_RE.test(String(r[c] || "").toUpperCase())).length;
    if (n > best) { best = n; tagCol = c; }
  }
  if (tagCol < 0) return null;
  const firstTag = rows.findIndex(r => TAG_RE.test(String(r[tagCol] || "").toUpperCase()));
  let hi = -1;
  for (let i = firstTag - 1; i >= 0; i--) if (rows[i].filter(Boolean).length >= 2) { hi = i; break; }
  const hdr = hi >= 0 ? rows[hi].map(x => String(x || "").trim()) : [];
  const used = new Set([tagCol]);
  const find = (...res) => { for (const re of res) { const i = hdr.findIndex((x, i) => !used.has(i) && re.test(x)); if (i >= 0) { used.add(i); return i; } } return -1; };
  const col = {};
  col.manifest = find(/^(metrc\s*)?manifest(\s*(no\.?|number|#|id))?$/i);
  col.date = find(/departure|ship\s*date|delivery\s*date|^date/i);
  col.box = find(/^box(\s*(#|no\.?))?$/i);
  col.destLic = find(/(destination|recipient|customer).*licen/i, /^licen/i);
  col.destName = find(/^(destination|recipient|customer|ship\s*to)(\s*(facility|name|business))?\s*(name)?$/i, /dispensary|store|retailer|facility/i);
  col.destAddr = find(/address/i);
  col.item = find(/^item(\s*name)?$/i, /^product(\s*name)?$/i, /item/i, /product|description/i);
  col.qty = find(/^(shipped\s*)?(qty|quantity)$/i, /shipped/i, /qty|quantity/i);
  col.uom = find(/uom|unit/i);
  col.batch = find(/production\s*batch/i, /batch/i, /^lot/i);
  col.harvest = find(/harvest/i);
  const out = { manifestNo: "", date: "", stops: [], warnings: [], kind: "manifest" };
  const cell = (r, i) => (i >= 0 ? String(r[i] || "").trim() : "");
  const r0 = rows[firstTag];
  out.manifestNo = cell(r0, col.manifest).replace(/\D/g, "");
  out.date = toIso(cell(r0, col.date));
  const stops = new Map(), seen = new Set();
  for (const r of rows.slice(firstTag)) {
    const tag = (String(r[tagCol] || "").toUpperCase().match(TAG_RE) || [])[0];
    if (!tag) continue;
    if (seen.has(tag)) { out.warnings.push(`${tag} is listed more than once; kept the first.`); continue; }
    seen.add(tag);
    const lic = cell(r, col.destLic), nm = cell(r, col.destName);
    const key = lic || nm || "_";
    if (!stops.has(key)) {
      const s = { id: uid("s"), name: nm, license: lic, address: cell(r, col.destAddr), packages: [], manifestNo: cell(r, col.manifest).replace(/\D/g, "") };
      stops.set(key, s); out.stops.push(s);
    }
    const q = splitQty(cell(r, col.qty));
    stops.get(key).packages.push({
      tag, item: cell(r, col.item), qty: q.qty || "", uom: cell(r, col.uom) || q.uom || "",
      batch: cell(r, col.batch) || cell(r, col.harvest), box: cell(r, col.box),
    });
  }
  return out;
}

/* ======================= tidy up one file ======================= */
const countPkgs = r => (r.stops || []).reduce((n, s) => n + s.packages.length, 0);
const cleanItem = t => String(t || "").replace(/\b(?:Shp|Shipped|Rcv|Received)\s*:\s*[\d.,]+\s*[A-Za-z]*/gi, " ")
  .replace(/^M\d{6,}\s*:\s*/, "").replace(/\s+/g, " ").replace(/\s*[-–]\s*$/, "").trim();
function finish(r, source, fileName, rawText) {
  const stops = (r.stops || []).filter(s => s.packages.length);
  stops.forEach((s, i) => {
    s.id = s.id || uid("s");
    s.manifestNo = s.manifestNo || r.manifestNo || "";
    s.invoiceNo = s.invoiceNo || r.invoiceNo || "";
    if (!s.name) s.name = s.license ? `Stop ${i + 1} (${s.license})` : `Stop ${i + 1}`;
    s.packages = s.packages.map(p => ({ tag: normalizeTag(p.tag), item: cleanItem(p.item), qty: p.qty || "", uom: niceUnit(p.uom),
      batch: (p.batch || p.harvest || "").trim(), box: String(p.box || "").trim() }));
  });
  const kind = r.kind || "manifest";
  const what = kind === "invoice" ? "invoice" : "manifest";
  const warnings = [...new Set(r.warnings || [])];
  const pk = stops.flatMap(s => s.packages);
  if (!pk.length) warnings.unshift(`No Metrc package tags were found in this file. Check that it's a ${what}, or copy the text below so the reader can be adjusted.`);
  const noItem = pk.filter(p => !p.item).length, noQty = pk.filter(p => !p.qty).length, odd = pk.filter(p => !looksLikeTag(p.tag)).length;
  if (noItem) warnings.push(`${noItem} package${noItem > 1 ? "s have" : " has"} no item name.`);
  if (noQty) warnings.push(`${noQty} package${noQty > 1 ? "s have" : " has"} no quantity.`);
  if (odd) warnings.push(`${odd} tag${odd > 1 ? "s don't" : " doesn't"} look like a Metrc tag.`);
  return { kind, manifestNo: r.manifestNo || "", invoiceNo: r.invoiceNo || "", date: r.date || "", stops, warnings, source, fileName, rawText,
    transporters: r.transporters || [], vehicle: r.vehicle || "", origin: originInfo(r.originLicense, r.originCity) };
}

/* ======================= several files → one delivery run ======================= */
const mkey = n => String(n || "").replace(/\D/g, "").replace(/^0+/, "");
// Each file's packages remember which facility and manifest they came from.
function tagOrigin(s, r) {
  const o = r.origin || {};
  s.sets = [{ manifestNo: r.manifestNo || "", invoiceNo: r.kind === "invoice" ? r.invoiceNo || "" : "", origin: o.name || "", originShort: o.short || "", originLicense: o.license || "" }];
  s.packages.forEach(p => { p.manifestNo = r.manifestNo || ""; p.origin = o.name || ""; p.originShort = o.short || ""; });
}
export function combine(input) {
  const results = JSON.parse(JSON.stringify(input));       // the parsed files stay untouched, so more can be added later
  const manifests = results.filter(r => r.kind !== "invoice"), invoices = results.filter(r => r.kind === "invoice");
  const stops = [], warnings = [];
  const from = r => (r.origin && r.origin.name ? ` (${r.origin.name})` : "");
  const label = r => (r.kind === "invoice" ? `WTI ${r.invoiceNo || r.fileName}${from(r)}` : `Manifest ${r.manifestNo || r.fileName}${from(r)}`);
  for (const r of manifests) { r.warnings.forEach(w => warnings.push(`${label(r)}: ${w}`)); r.stops.forEach(s => tagOrigin(s, r)); stops.push(...r.stops); }
  for (const inv of invoices) {
    inv.warnings.forEach(w => warnings.push(`${label(inv)}: ${w}`));
    const target = stops.filter(s => s.sets.some(x => x.manifestNo && mkey(x.manifestNo) === mkey(inv.manifestNo)));
    if (!target.length) {
      if (manifests.length) warnings.push(`${label(inv)} is for manifest ${inv.manifestNo || "?"}, which wasn't uploaded. Using the WTI's list for that stop.`);
      inv.stops.forEach(s => tagOrigin(s, inv)); stops.push(...inv.stops);
      continue;
    }
    const set = target[0].sets.find(x => mkey(x.manifestNo) === mkey(inv.manifestNo));
    if (inv.origin && inv.origin.license && set.originLicense && inv.origin.license !== set.originLicense)
      warnings.push(`⚠ ${label(inv)} says it ships from ${inv.origin.name}, but manifest ${inv.manifestNo} ships from ${set.origin}.`);
    set.invoiceNo = inv.invoiceNo || set.invoiceNo;
    const byTag = new Map(target.flatMap(s => s.packages.map(p => [p.tag, p])));
    const invPkgs = inv.stops.flatMap(s => s.packages), invTags = new Set(invPkgs.map(p => p.tag));
    for (const ip of invPkgs) {
      const p = byTag.get(ip.tag);
      if (!p) { warnings.push(`⚠ ${label(inv)} lists ${ip.tag} (${ip.item || "no name"}) but manifest ${inv.manifestNo} doesn't.`); continue; }
      if (ip.box) p.box = ip.box;
      if (!p.batch && ip.batch) p.batch = ip.batch;
      else if (ip.batch && p.batch && ip.batch.toUpperCase() !== p.batch.toUpperCase()) warnings.push(`${ip.tag}: batch is ${p.batch} on the manifest but ${ip.batch} on the WTI.`);
      if (!p.item && ip.item) p.item = ip.item;
      if (ip.qty && p.qty && Number(ip.qty) !== Number(p.qty)) warnings.push(`⚠ ${ip.tag}: quantity is ${p.qty} ${p.uom} on the manifest but ${ip.qty} ${ip.uom} on ${label(inv)}.`);
    }
    for (const [t, p] of byTag) if (mkey(p.manifestNo) === mkey(inv.manifestNo) && !invTags.has(t))
      warnings.push(`⚠ Manifest ${inv.manifestNo}: ${t} (${p.item || "no name"}) isn't on ${label(inv)}.`);
  }
  // the same tag on two manifests (or the same manifest uploaded twice)
  const seen = new Map();
  for (const s of stops) for (const p of s.packages) {
    const where = `${s.name}${p.origin ? ` (${p.origin})` : ""}`;
    if (seen.has(p.tag)) warnings.push(`⚠ ${p.tag} is on both ${seen.get(p.tag)} and ${where}.`); else seen.set(p.tag, where);
  }
  // one stop per customer: a Fall River set and a Lakeville set for the same order become one stop
  const key = s => String(s.license || "").toUpperCase() || String(s.name || "").toLowerCase();
  const merged = [];
  for (const s of stops) {
    const into = merged.find(m => key(m) === key(s));
    if (!into) { merged.push(s); continue; }
    for (const p of s.packages) if (!into.packages.some(q => q.tag === p.tag)) into.packages.push(p);
    for (const x of s.sets) if (!into.sets.some(y => mkey(y.manifestNo) === mkey(x.manifestNo))) into.sets.push(x);
    if (!into.address && s.address) into.address = s.address;
  }
  for (const s of merged) {
    s.id = uid("s");
    s.sets.sort((a, b) => originRank(a.originLicense) - originRank(b.originLicense));
    const rank = new Map(s.sets.map((x, i) => [mkey(x.manifestNo), i]));
    const r = p => { const v = rank.get(mkey(p.manifestNo)); return v == null ? 99 : v; };
    s.packages = s.packages.map((p, i) => [p, i]).sort((a, b) => r(a[0]) - r(b[0]) || a[1] - b[1]).map(x => x[0]);
    s.manifestNo = s.sets.map(x => x.manifestNo).filter(Boolean).join(", ");
    s.invoiceNo = s.sets.map(x => x.invoiceNo).filter(Boolean).join(", ");
    if (invoices.length) for (const x of s.sets) if (x.manifestNo && !x.invoiceNo)
      warnings.push(`${s.name}: no WTI uploaded for ${x.origin ? x.origin + " " : ""}manifest ${x.manifestNo}, so its boxes have no numbers.`);
  }
  // things that should match across the files of one run
  const plates = [...new Set(manifests.map(r => (r.vehicle || "").replace(/\s+/g, " ").trim()).filter(Boolean))];
  if (plates.length > 1) warnings.push(`⚠ The manifests list different vehicles: ${plates.join(" / ")}. Check they all go on one truck.`);
  const dates = [...new Set(manifests.map(r => r.date).filter(Boolean))];
  if (dates.length > 1) warnings.push(`The manifests have different departure dates (${dates.join(", ")}).`);
  const dated = manifests.find(r => r.date) || invoices.find(r => r.date);
  return {
    date: dated ? dated.date : "",
    stops: merged, warnings: [...new Set(warnings)],
    transporters: [...new Map(results.flatMap(r => r.transporters || []).map(t => [t.employeeId || t.name.toLowerCase(), t])).values()],
    vehicle: (results.find(r => r.vehicle) || {}).vehicle || "",
    files: results.map(r => r.fileName),
    source: results.length > 1 ? "multiple" : (results[0] && results[0].source) || "manual",
    rawText: results.map(r => `===== ${r.fileName} =====\n${r.rawText}`).join("\n\n"),
  };
}
