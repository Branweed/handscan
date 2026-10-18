// Offline support: keeps the app's files on the phone so it opens with no signal.
// Bump VERSION whenever you upload changed files, so phones pick up the new version.
const VERSION = "manifest-check-v7";
const SHELL = ["./", "index.html", "admin.html", "app.css", "shared.js", "store.js", "barcode-scanner.js", "manifest-parser.js", "manifest.webmanifest", "icon.svg"];
const FB = "https://www.gstatic.com/firebasejs/10.12.2/";
const LIBS = [FB + "firebase-app.js", FB + "firebase-auth.js", FB + "firebase-firestore.js"];
const CDN_HOSTS = ["www.gstatic.com", "cdn.jsdelivr.net"];

self.addEventListener("install", e => e.waitUntil((async () => {
  const c = await caches.open(VERSION);
  await c.addAll(SHELL);
  await Promise.all(LIBS.map(u => c.add(u).catch(() => {})));   // fails harmlessly in demo / offline installs
  await self.skipWaiting();
})()));

self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) e.respondWith(networkFirst(req));
  else if (CDN_HOSTS.includes(url.hostname)) e.respondWith(cacheFirst(req));
  // everything else (Firebase sign-in and database traffic) goes straight to the network
});

// App files: try the network (so updates show up), fall back to the saved copy after 3.5 s or when offline.
async function networkFirst(req) {
  const c = await caches.open(VERSION);
  const net = fetch(req).then(res => { if (res && res.ok) c.put(req, res.clone()); return res; });
  const cached = () => c.match(req, { ignoreSearch: true }).then(hit => hit || (req.mode === "navigate" ? c.match("index.html") : null));
  try {
    return await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 3500))]);
  } catch (e) {
    const hit = await cached();
    if (hit) return hit;
    return net;   // nothing saved yet: keep waiting for the network
  }
}
// Versioned libraries never change, so the saved copy is always fine.
async function cacheFirst(req) {
  const c = await caches.open(VERSION);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone());
  return res;
}
