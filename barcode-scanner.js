/*
 * barcode-scanner.js: a drop-in barcode scanner for any web page or web app.
 *
 *   import { scanBarcode, scanMany, lookupProduct } from "./barcode-scanner.js";
 *
 *   const hit = await scanBarcode();            // opens the camera, resolves when one code is read
 *   if (hit) console.log(hit.code, hit.format); // e.g. "0041196910759", "ean_13"
 *
 *   const all = await scanMany({ onDetect: h => console.log(h.code) });   // keeps scanning until closed
 *   const product = await lookupProduct(hit.code);                     // free Open Food Facts lookup (food items)
 *
 * How it reads codes:
 *   1. The phone's own barcode reader (BarcodeDetector), built into Chrome on Android, ChromeOS and Mac. Fast and free.
 *   2. If that's missing (iPhone, Firefox, Windows Chrome), it loads ZXing, a free open-source reader, from a CDN.
 *   3. Always available: take a photo of the barcode, or type the numbers under it.
 *
 * Needs: HTTPS (or localhost) for the camera. No other setup. No keys. Works offline once loaded (except the
 * ZXing download and product lookups).
 */

// Where to load the backup reader from (only used when the browser has no built-in barcode reader).
// To host it yourself, download the file and point this at your copy.
export const ZXING_URL = "https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/+esm";

// Common retail codes plus QR. Add "code_39", "itf", "codabar", "data_matrix", "pdf417", "aztec" if you need them.
export const DEFAULT_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"];
const RETAIL = new Set(["ean_13", "ean_8", "upc_a", "upc_e"]);

/* ---------------- small helpers ---------------- */
// UPC-A (12 digits) is the same product as EAN-13 with a leading 0. This gives one number per product.
export function normalizeUpc(code) {
  const c = String(code || "").replace(/\D/g, "");
  return c.length === 12 ? "0" + c : c;
}
// The last digit of an EAN/UPC is a check digit. A misread almost always fails this test.
export function checkDigitOK(code) {
  const c = String(code || "");
  if (!/^\d{8}$|^\d{12,14}$/.test(c)) return false;
  const digits = c.split("").map(Number), check = digits.pop();
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
// Free product info for food and household items (Open Food Facts). Resolves to null when not found.
export async function lookupProduct(code, { timeoutMs = 8000 } = {}) {
  const tryOne = async c => {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(c)}.json?fields=product_name,product_name_en,brands,quantity,image_front_url,categories`, { signal: ctl.signal });
      if (!r.ok) return null;
      const j = await r.json();
      if (!j || j.status !== 1 || !j.product) return null;
      const p = j.product;
      return { code: c, name: p.product_name_en || p.product_name || "", brand: String(p.brands || "").split(",")[0].trim(),
        size: p.quantity || "", image: p.image_front_url || "", categories: p.categories || "" };
    } catch (e) { return null; } finally { clearTimeout(t); }
  };
  const raw = String(code || "").replace(/\D/g, "");
  if (!raw) return null;
  return await tryOne(raw) || (normalizeUpc(raw) !== raw ? await tryOne(normalizeUpc(raw)) : null);
}

/* ---------------- the readers ---------------- */
let nativeFormats = null;
async function nativeReader(formats) {
  if (!("BarcodeDetector" in window)) return null;
  try {
    if (!nativeFormats) nativeFormats = await window.BarcodeDetector.getSupportedFormats().catch(() => formats);
    const use = formats.filter(f => nativeFormats.includes(f));
    if (!use.length) return null;
    const det = new window.BarcodeDetector({ formats: use });
    return async src => (await det.detect(src)).map(b => ({ code: String(b.rawValue || ""), format: b.format || "" }));
  } catch (e) { return null; }
}
let zxingMod = null;
const ZX_FORMAT = { ean_13: "EAN_13", ean_8: "EAN_8", upc_a: "UPC_A", upc_e: "UPC_E", code_128: "CODE_128", code_39: "CODE_39", qr_code: "QR_CODE",
  itf: "ITF", codabar: "CODABAR", data_matrix: "DATA_MATRIX", pdf417: "PDF_417", aztec: "AZTEC" };
async function zxingReader(formats, url) {
  try {
    if (!zxingMod) zxingMod = await import(/* @vite-ignore */ url);
    const Z = zxingMod;
    const hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, formats.map(f => Z.BarcodeFormat[ZX_FORMAT[f]]).filter(x => x !== undefined));
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    const reader = new Z.MultiFormatReader();
    reader.setHints(hints);
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
    const back = Object.fromEntries(Object.entries(ZX_FORMAT).map(([k, v]) => [Z.BarcodeFormat[v], k]));
    return async src => {
      const w = src.videoWidth || src.naturalWidth || src.width, h = src.videoHeight || src.naturalHeight || src.height;
      if (!w || !h) return [];
      const scale = Math.min(1, 1280 / Math.max(w, h));
      canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
      ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
      const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const lum = new Uint8ClampedArray(canvas.width * canvas.height);
      for (let i = 0, j = 0; i < px.length; i += 4, j++) lum[j] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
      try {
        const res = reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(lum, canvas.width, canvas.height))));
        return [{ code: res.getText(), format: back[res.getBarcodeFormat()] || "" }];
      } catch (e) { return []; }   // nothing found in this frame
    };
  } catch (e) { console.warn("barcode-scanner: backup reader didn't load", e); return null; }
}
async function getReader(formats, url) {
  return (await nativeReader(formats)) || (await zxingReader(formats, url));
}

/* ---------------- the scanner screen ---------------- */
const CSS = `
.bcs-scrim{position:fixed;inset:0;z-index:2147483000;background:rgba(10,14,12,.98);display:flex;flex-direction:column;color:#fff;font:16px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.bcs-top{display:flex;align-items:center;gap:10px;padding:14px 16px;padding-top:max(14px,env(safe-area-inset-top))}
.bcs-top b{flex:1;font-size:18px}
.bcs-btn{border:0;border-radius:12px;min-height:44px;padding:0 16px;font:inherit;font-weight:700;background:rgba(255,255,255,.14);color:#fff;cursor:pointer}
.bcs-btn.primary{background:#fff;color:#111}
.bcs-btn:disabled{opacity:.4}
.bcs-view{position:relative;flex:1;min-height:0;margin:0 16px;border-radius:18px;overflow:hidden;background:#000}
.bcs-view video{width:100%;height:100%;object-fit:cover;display:block}
.bcs-aim{position:absolute;left:10%;right:10%;top:34%;height:32%;border:3px solid rgba(255,255,255,.95);border-radius:16px;box-shadow:0 0 0 9999px rgba(0,0,0,.35);transition:border-color .15s}
.bcs-aim.hit{border-color:#4ade80}
.bcs-aim.warn{border-color:#fbbf24}
.bcs-aim.bad{border-color:#f87171}
.bcs-res{text-align:left;border-radius:14px;padding:10px 14px;color:#0b1410;background:#bbf7d0}
.bcs-res.warn{background:#fde68a}
.bcs-res.bad{background:#fecaca}
.bcs-res b{display:block;font-size:17px}
.bcs-res .bcs-l1{font-weight:700;margin-top:2px}
.bcs-res .bcs-ln{font-size:14px;opacity:.85;word-break:break-all}
.bcs-line{position:absolute;left:8%;right:8%;top:50%;height:2px;background:rgba(74,222,128,.9);animation:bcs-sweep 1.6s ease-in-out infinite alternate}
@keyframes bcs-sweep{from{transform:translateY(-38px)}to{transform:translateY(38px)}}
.bcs-msg{padding:10px 16px;text-align:center;min-height:44px}
.bcs-count{display:inline-block;background:#4ade80;color:#052e16;font-weight:800;border-radius:999px;padding:2px 10px;margin-left:6px}
.bcs-row{display:flex;gap:8px;padding:0 16px 10px}
.bcs-row input{flex:1;min-width:0;border:0;border-radius:12px;min-height:44px;padding:0 12px;font:inherit;font-size:16px}
.bcs-bottom{display:flex;gap:8px;padding:0 16px 16px;padding-bottom:max(16px,env(safe-area-inset-bottom))}
.bcs-bottom .bcs-btn{flex:1}
`;
function injectCss() {
  if (document.getElementById("bcs-css")) return;
  const st = document.createElement("style"); st.id = "bcs-css"; st.textContent = CSS; document.head.append(st);
}
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v === true ? "" : v); }
  kids.flat().forEach(k => k != null && e.append(k.nodeType ? k : document.createTextNode(String(k))));
  return e;
}
function tones(freq, dur, count = 1, type = "sine") {
  try {
    const A = window.AudioContext || window.webkitAudioContext; if (!A) return;
    const ac = new A();
    for (let i = 0; i < count; i++) {
      const t0 = ac.currentTime + i * (dur + 0.07), o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0.14, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + dur + 0.01);
    }
    setTimeout(() => ac.close(), (count * (dur + 0.07) + 0.3) * 1000);
  } catch (e) {}
}
const beepOnce = () => tones(1450, 0.12);
/**
 * Sound + vibration for a result. tone: "ok" (one high beep), "warn" (two mid beeps), "bad" (low buzz, long vibration).
 * Exported so pages can give the same feedback for Bluetooth-scanner or typed input.
 */
export function signal(tone = "ok", { beep = true, vibrate = true } = {}) {
  if (beep) tone === "bad" ? tones(220, 0.45, 1, "square") : tone === "warn" ? tones(880, 0.1, 2) : beepOnce();
  if (vibrate) try { navigator.vibrate && navigator.vibrate(tone === "bad" ? [250, 100, 250] : tone === "warn" ? [60, 80, 60] : 60); } catch (e) {}
}

/**
 * Opens the scanner. Options (all optional):
 *   title        "Scan a barcode"
 *   hint         text under the camera
 *   formats      which barcode types to read (see DEFAULT_FORMATS)
 *   continuous   keep scanning after each read (used by scanMany)
 *   onDetect     called with each read { code, format, source }. It may return
 *                { tone: "ok"|"warn"|"bad", title, lines: [..] } to show a colored result card and matching sound.
 *   manualNumeric  numeric keypad for the "type it" box (default true; false for codes with letters)
 *   manualPlaceholder  placeholder for the "type it" box
 *   beep, vibrate  feedback on a read (default true)
 *   allowPhoto, allowManual  show the photo and "type the numbers" fallbacks (default true)
 *   validate     reject EAN/UPC reads whose check digit is wrong (default true)
 *   zxingUrl     where to load the backup reader from
 * Resolves with one { code, format, source } (or null if closed). In continuous mode, resolves with the array.
 */
export function scanBarcode(opts = {}) {
  const o = { title: "Scan a barcode", hint: "", formats: DEFAULT_FORMATS, continuous: false, onDetect: null, beep: true, vibrate: true,
    allowPhoto: true, allowManual: true, validate: true, zxingUrl: ZXING_URL, manualNumeric: true,
    manualPlaceholder: "Or type the numbers under the barcode", ...opts };
  injectCss();
  return new Promise(resolve => {
    let stream = null, timer = 0, done = false, reader = null, last = { code: "", n: 0 }, cool = 0;
    const found = [];
    const video = el("video", { playsinline: true, muted: true, autoplay: true });
    video.muted = true;
    const aim = el("div", { class: "bcs-aim" });
    const msg = el("div", { class: "bcs-msg" }, "Starting the camera…");
    const torchBtn = el("button", { class: "bcs-btn", type: "button", hidden: true, onclick: toggleTorch }, "🔦");
    const manual = el("input", { inputmode: o.manualNumeric ? "numeric" : "text", autocapitalize: o.manualNumeric ? null : "characters",
      autocomplete: "off", spellcheck: "false", placeholder: o.manualPlaceholder, "aria-label": "Barcode", enterkeyhint: "done" });
    const fileIn = el("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, onchange: () => fromPhoto(fileIn.files && fileIn.files[0]) });
    const doneBtn = el("button", { class: "bcs-btn primary", type: "button", onclick: () => finish(null) }, o.continuous ? "Done" : "Close");
    const scrim = el("div", { class: "bcs-scrim", role: "dialog", "aria-modal": "true", "aria-label": o.title },
      el("div", { class: "bcs-top" }, el("b", {}, o.title), torchBtn),
      el("div", { class: "bcs-view" }, video, aim, el("div", { class: "bcs-line" })),
      msg,
      o.allowManual ? el("div", { class: "bcs-row" }, manual, el("button", { class: "bcs-btn", type: "button", onclick: typed }, "Use")) : null,
      el("div", { class: "bcs-bottom" },
        o.allowPhoto ? el("button", { class: "bcs-btn", type: "button", onclick: () => fileIn.click() }, "📷 Photo") : null,
        doneBtn),
      fileIn);
    manual.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); typed(); } });
    const onKey = e => { if (e.key === "Escape") finish(null); };
    document.addEventListener("keydown", onKey);
    document.body.append(scrim);

    function stop() {
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    function finish(hit) {
      if (done) return;
      done = true; stop();
      document.removeEventListener("keydown", onKey);
      scrim.remove();
      resolve(o.continuous ? found : hit);
    }
    function accept(hit) {
      if (o.validate && RETAIL.has(hit.format) && !checkDigitOK(hit.code)) return false;
      let r = null;
      if (o.onDetect) try { r = o.onDetect(hit) || null; } catch (e) { console.error(e); }
      const tone = (r && r.tone) || "ok";
      signal(tone, o);
      aim.classList.remove("hit", "warn", "bad"); aim.classList.add(tone === "ok" ? "hit" : tone);
      setTimeout(() => aim.classList.remove("hit", "warn", "bad"), tone === "ok" ? 400 : 900);
      if (!o.continuous) { finish(hit); return true; }
      found.push(hit);
      if (r && (r.title || r.lines)) {
        const lines = (r.lines || []).filter(Boolean);
        msg.replaceChildren(el("div", { class: `bcs-res ${tone}` }, el("b", {}, r.title || ""),
          lines.map((l, i) => el("div", { class: i === 0 ? "bcs-l1" : "bcs-ln" }, l))));
      } else msg.replaceChildren(document.createTextNode(`Got ${hit.code}`), el("span", { class: "bcs-count" }, String(found.length)));
      cool = Date.now() + 1200;
      return true;
    }
    function typed() {
      const v = manual.value.replace(/\s/g, "");
      if (!v) { manual.focus(); return; }
      const digits = /^\d+$/.test(v);
      if (digits && v.length >= 8 && v.length <= 14 && o.validate && !checkDigitOK(v)) { msg.textContent = "Those numbers don't look right. Check them and try again."; return; }
      manual.value = "";
      accept({ code: v, format: digits ? (v.length === 8 ? "ean_8" : v.length === 12 ? "upc_a" : v.length === 13 ? "ean_13" : "") : "", source: "typed" });
    }
    async function fromPhoto(file) {
      fileIn.value = "";
      if (!file) return;
      msg.textContent = "Reading the photo…";
      try {
        if (!reader) reader = await getReader(o.formats, o.zxingUrl);
        if (!reader) { msg.textContent = "This browser can't read barcodes. Type the numbers instead."; return; }
        const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
        const hits = (await reader(img)).filter(x => x.code);
        URL.revokeObjectURL(img.src);
        const ok = hits.find(x => !(o.validate && RETAIL.has(x.format) && !checkDigitOK(x.code)));
        if (ok) accept({ ...ok, source: "photo" }); else msg.textContent = "No barcode found in that photo. Get closer, fill the frame and try again.";
      } catch (e) { msg.textContent = "Couldn't read that photo."; }
    }
    async function toggleTorch() {
      const track = stream && stream.getVideoTracks()[0];
      if (!track) return;
      const on = !torchBtn.classList.contains("primary");
      try { await track.applyConstraints({ advanced: [{ torch: on }] }); torchBtn.classList.toggle("primary", on); } catch (e) {}
    }
    async function loop() {
      if (done) return;
      try {
        if (video.readyState >= 2 && Date.now() > cool) {
          const hits = (await reader(video)).filter(x => x.code);
          const hit = hits[0];
          if (hit) {
            // 1D barcodes: wait for the same number twice in a row, which rules out most misreads
            const needed = RETAIL.has(hit.format) || /code_|itf|codabar/.test(hit.format) ? 2 : 1;
            last = last.code === hit.code ? { code: hit.code, n: last.n + 1 } : { code: hit.code, n: 1 };
            if (last.n >= needed && !(o.continuous && found.length && found[found.length - 1].code === hit.code && Date.now() < cool + 1500)) {
              last = { code: "", n: 0 };
              if (accept({ ...hit, source: "camera" }) && !o.continuous) return;
            }
          }
        }
      } catch (e) {}
      timer = setTimeout(loop, 120);
    }
    (async () => {
      reader = await getReader(o.formats, o.zxingUrl);
      if (done) return;
      if (!reader) { msg.textContent = "This browser can't read barcodes with the camera. Use a photo or type the numbers."; return; }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg.textContent = "The camera isn't available here (it needs https). Use a photo or type the numbers."; return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch (e) { msg.textContent = "Allow the camera to scan, or use a photo or type the numbers."; return; }
      if (done) { stop(); return; }
      video.srcObject = stream;
      try { await video.play(); } catch (e) {}
      try { const caps = stream.getVideoTracks()[0].getCapabilities ? stream.getVideoTracks()[0].getCapabilities() : {}; if (caps.torch) torchBtn.hidden = false; } catch (e) {}
      msg.textContent = o.hint || (o.continuous ? "Point at each barcode. It reads by itself." : "Point the camera at the barcode. It reads by itself.");
      loop();
    })();
  });
}

/** Keep scanning one item after another. Resolves with every read when the person taps Done. */
export function scanMany(opts = {}) {
  return scanBarcode({ title: "Scan barcodes", ...opts, continuous: true });
}

/** True when the phone's built-in reader is available (no download needed). */
export const hasBuiltInReader = () => "BarcodeDetector" in window;
