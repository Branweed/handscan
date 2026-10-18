/*
 * store.js: one data layer for both pages.
 *   - Firebase (Auth + Firestore with offline cache) when shared.js has your config.
 *   - DEMO mode otherwise: sample data in this browser's localStorage, no sign-in.
 *
 * Data model (Firestore):
 *   users/{uid}                    { name, email, role: "admin"|"driver", active, truck, employeeId }
 *   driverLogins/{uid}             { employeeId, name, pin }   office-only: the PIN the app made for each driver
 *   trucks/{code}                  { code, nickname, plates[] }  e.g. W99 = "White 99", plate X78446
 *   manifests/{id}                 one delivery run for a truck:
 *                                  { title, date, truck, driverIds[], driverNames[], status, stops[], stopsDone{}, createdAt, updatedAt }
 *                                  each stop: { id, name, license, address, manifestNo, invoiceNo, packages[{ tag, item, qty, uom, batch, box }] }
 *   manifests/{id}/scans/{autoId}  { tag, stopId, result, at, via, driverId, driverName, otherStopId?, raw? }
 *                                  stopId "load" = a load-check scan at the dock; stopsDone.load = load check finished
 *   settings/access                { code }            office-only: the company code phones enter once
 *   trucks/_drivers                { names[] }         the "Who are you?" list (kept beside the trucks; not a truck)
 *   devices/{uid}                  { code, at, name }  one per approved phone (anonymous sign-in); the office can remove them
 */
import { firebaseConfig, DEMO, uid, driverEmail, makePin, adminEmail } from "./shared.js";

export const FB_VERSION = "10.12.2";
const FB = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;

export function createStore(role) { return DEMO ? demoStore(role) : firebaseStore(); }

/* ============================== Firebase ============================== */
async function firebaseStore() {
  const [appM, A, F] = await Promise.all([import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js")]);
  const app = appM.initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  let db;
  try { db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
  catch (e) { console.warn("Offline cache unavailable, using memory only", e); db = F.getFirestore(app); }
  const list = s => s.docs.map(d => ({ id: d.id, ...d.data(), _pending: d.metadata.hasPendingWrites }));
  const one = s => (s.exists() ? { id: s.id, ...s.data() } : null);
  return {
    demo: false,
    onUser: cb => A.onAuthStateChanged(auth, cb),
    signIn: (email, pw) => A.signInWithEmailAndPassword(auth, email.trim(), pw),
    signOut: () => A.signOut(auth),
    resetPassword: email => A.sendPasswordResetEmail(auth, email.trim()),
    watchProfile: (id, cb, err) => F.onSnapshot(F.doc(db, "users", id), s => cb(one(s)), err),

    // ---- phones: an invisible anonymous sign-in, approved once with the company code ----
    async ready() {
      await auth.authStateReady();
      if (!auth.currentUser) { try { await A.signInAnonymously(auth); } catch (e) { console.warn("anonymous sign-in unavailable", e.code || e); } }
      return auth.currentUser;
    },
    async approvePhone(code, name) {
      if (!auth.currentUser) {
        try { await A.signInAnonymously(auth); }
        catch (e) { const err = new Error("Phone sign-in isn't turned on yet. In Firebase: Authentication → Sign-in method → Anonymous → Enable."); err.code = "setup"; throw err; }
      }
      await F.setDoc(F.doc(db, "devices", auth.currentUser.uid), { code: String(code).trim(), at: Date.now(), name: String(name || "").slice(0, 80) });
    },
    watchDriverNames: (cb, err) => F.onSnapshot(F.doc(db, "trucks", "_drivers"), s => cb(s.exists() ? (s.data().names || []) : null), err),

    // driver: no account, just a truck name
    watchTruckRuns: (truck, cb, err) => F.onSnapshot(F.query(F.collection(db, "manifests"), F.where("truck", "==", truck)), s => cb(list(s)), err),
    watchMyManifests: (id, cb, err) => F.onSnapshot(F.query(F.collection(db, "manifests"), F.where("driverIds", "array-contains", id)), s => cb(list(s)), err),
    watchManifest: (id, cb, err) => F.onSnapshot(F.doc(db, "manifests", id), { includeMetadataChanges: false }, s => cb(one(s), s.metadata.fromCache), err),
    watchScans: (mid, cb, err) => F.onSnapshot(F.collection(db, "manifests", mid, "scans"), { includeMetadataChanges: true }, s => {
      const l = list(s).sort((a, b) => (a.at || 0) - (b.at || 0));
      cb(l, l.filter(x => x._pending).length);
    }, err),
    // Writes are not awaited: offline they wait in the phone's cache and upload when a connection comes back.
    addScan: (mid, scan) => { F.addDoc(F.collection(db, "manifests", mid, "scans"), { ...scan, syncedAt: F.serverTimestamp() }).catch(e => console.warn("scan upload failed", e)); },
    setStopDone: (mid, stopId, info, status) => {
      F.updateDoc(F.doc(db, "manifests", mid), { [`stopsDone.${stopId}`]: info, status, updatedAt: Date.now() }).catch(e => console.warn(e));
    },

    // office
    watchDrivers: (cb, err) => F.onSnapshot(F.query(F.collection(db, "users"), F.where("role", "==", "driver")), s => cb(list(s)), err),
    // Makes a driver login: Employee ID + a 6-digit PIN the app picks. Returns { id, pin }.
    async addDriver({ name, employeeId, truck }) {
      const emp = String(employeeId || "").trim().toUpperCase();
      if (!emp) throw new Error("An Employee ID is needed for the driver's login.");
      const pin = makePin();
      // A second, throwaway Firebase app creates the account so the office stays signed in.
      const sec = appM.initializeApp(firebaseConfig, "add-driver-" + Date.now());
      try {
        const secAuth = A.initializeAuth(sec, { persistence: A.inMemoryPersistence });
        const cred = await A.createUserWithEmailAndPassword(secAuth, driverEmail(emp), pin);
        const id = cred.user.uid;
        await F.setDoc(F.doc(db, "users", id), { name: name.trim(), employeeId: emp, email: driverEmail(emp), truck: (truck || "").trim().toUpperCase(), role: "driver", active: true, createdAt: Date.now() });
        await F.setDoc(F.doc(db, "driverLogins", id), { employeeId: emp, name: name.trim(), pin, createdAt: Date.now() });
        await A.signOut(secAuth);
        return { id, pin };
      } finally { await appM.deleteApp(sec).catch(() => {}); }
    },
    watchLogins: (cb, err) => F.onSnapshot(F.collection(db, "driverLogins"), s => cb(list(s)), err),
    watchTrucks: (cb, err) => F.onSnapshot(F.collection(db, "trucks"), s => cb(list(s)), err),
    saveTruck: (code, { plate, nickname, crew }) => F.setDoc(F.doc(db, "trucks", code), {
      code, ...(nickname ? { nickname } : {}), ...(plate ? { plates: F.arrayUnion(plate) } : {}), ...(crew && crew.length ? { crew } : {}), updatedAt: Date.now() }, { merge: true }),
    watchAdmins: (cb, err) => F.onSnapshot(F.query(F.collection(db, "users"), F.where("role", "==", "admin")), s => cb(list(s)), err),
    // A new office admin: username + password, made with a throwaway Firebase app so you stay signed in.
    async addAdmin({ name, username, password }) {
      const sec = appM.initializeApp(firebaseConfig, "add-admin-" + Date.now());
      try {
        const secAuth = A.initializeAuth(sec, { persistence: A.inMemoryPersistence });
        const cred = await A.createUserWithEmailAndPassword(secAuth, adminEmail(username), password);
        await F.setDoc(F.doc(db, "users", cred.user.uid), { name, username, email: adminEmail(username), role: "admin", active: true, createdAt: Date.now() });
        await A.signOut(secAuth);
      } finally { await appM.deleteApp(sec).catch(() => {}); }
    },
    setDriver: (id, patch) => F.updateDoc(F.doc(db, "users", id), patch),
    // ---- office: company code, approved phones, driver list ----
    watchAccess: (cb, err) => F.onSnapshot(F.doc(db, "settings", "access"), s => cb(s.exists() ? s.data() : null), err),
    setAccessCode: code => F.setDoc(F.doc(db, "settings", "access"), { code: String(code).trim(), updatedAt: Date.now() }),
    watchDevices: (cb, err) => F.onSnapshot(F.collection(db, "devices"), s => cb(list(s).sort((a, b) => (b.at || 0) - (a.at || 0))), err),
    removeDevice: id => F.deleteDoc(F.doc(db, "devices", id)),
    async removeAllDevices() {
      const s = await F.getDocs(F.collection(db, "devices"));
      for (let i = 0; i < s.docs.length; i += 400) { const b = F.writeBatch(db); s.docs.slice(i, i + 400).forEach(d => b.delete(d.ref)); await b.commit(); }
    },
    setDriverNames: names => F.setDoc(F.doc(db, "trucks", "_drivers"), { names, updatedAt: Date.now() }),
    addDriverNames: names => F.setDoc(F.doc(db, "trucks", "_drivers"), { names: F.arrayUnion(...names), updatedAt: Date.now() }, { merge: true }),
    watchAllManifests: (cb, err) => F.onSnapshot(F.query(F.collection(db, "manifests"), F.orderBy("createdAt", "desc"), F.limit(300)), s => cb(list(s)), err),
    async saveManifest(m) { const r = await F.addDoc(F.collection(db, "manifests"), m); return r.id; },
    updateManifest: (id, patch) => F.updateDoc(F.doc(db, "manifests", id), { ...patch, updatedAt: Date.now() }),
    async deleteManifest(id) {
      const s = await F.getDocs(F.collection(db, "manifests", id, "scans"));
      for (let i = 0; i < s.docs.length; i += 400) {
        const b = F.writeBatch(db); s.docs.slice(i, i + 400).forEach(d => b.delete(d.ref)); await b.commit();
      }
      await F.deleteDoc(F.doc(db, "manifests", id));
    },
  };
}

/* ============================== Demo (this browser only) ============================== */
const KEY = "manifest-check-demo:v4";
function seed() {
  const t = n => "1A4FF01000000220000" + String(n).padStart(5, "0");
  const today = new Date(); const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return {
    users: {
      "demo-admin": { name: "Office", email: "office@demo", role: "admin", active: true },
      "demo-driver": { name: "Demo Driver", employeeId: "DEMO1", role: "driver", active: true, truck: "T1" },
      "demo-driver-2": { name: "Second Driver", employeeId: "DEMO2", role: "driver", active: true, truck: "T1" },
    },
    logins: { "demo-driver": { employeeId: "DEMO1", name: "Demo Driver", pin: "123456" }, "demo-driver-2": { employeeId: "DEMO2", name: "Second Driver", pin: "654321" } },
    trucks: { T1: { code: "T1", nickname: "Demo Truck", plates: [], crew: [{ name: "Demo Driver" }, { name: "Second Driver" }] } },
    manifests: {
      "demo-1": {
        date: iso, truck: "T1", driverIds: ["demo-driver", "demo-driver-2"], driverNames: ["Demo Driver", "Second Driver"], status: "assigned",
        createdAt: Date.now(), updatedAt: Date.now(), stopsDone: {},
        stops: [
          { id: "s1", name: "Green Leaf Dispensary", license: "C10-0000123-LIC", address: "12 Main St, Springfield", manifestNo: "0004812337", invoiceNo: "1001", packages: [
            { tag: t(101), item: "Blue Dream Flower 3.5g", qty: "24", uom: "Each", batch: "BD-0921", box: "1" },
            { tag: t(102), item: "Sour Diesel Pre-Roll 1g", qty: "50", uom: "Each", batch: "SD-1003", box: "2" },
            { tag: t(103), item: "OG Kush Bulk Flower", qty: "453.6", uom: "Grams", batch: "OGK-0915", box: "3" },
          ] },
          { id: "s2", name: "Hilltop Wellness", license: "C10-0000456-LIC", address: "88 Ridge Rd, Shelbyville", manifestNo: "0004812338", invoiceNo: "1002", packages: [
            { tag: t(201), item: "Gelato Live Resin Cart 0.5g", qty: "30", uom: "Each", batch: "GL-0930", box: "1" },
            { tag: t(202), item: "Watermelon Gummies 100mg", qty: "40", uom: "Each", batch: "WG-1001", box: "2" },
          ] },
          { id: "s3", name: "Riverside Cannabis Co.", license: "C10-0000789-LIC", address: "4 Water St, Ogdenville", manifestNo: "0004812339", invoiceNo: "1003", packages: [
            { tag: t(301), item: "Wedding Cake Flower 7g", qty: "12", uom: "Each", batch: "WC-0918", box: "1" },
            { tag: t(302), item: "Mint Chocolate Bar 100mg", qty: "20", uom: "Each", batch: "MC-0925", box: "2" },
            { tag: t(303), item: "Shake Trim", qty: "2", uom: "Pounds", batch: "ST-0910", box: "3" },
          ] },
        ],
      },
    },
    scans: {},
  };
}
function demoStore(role) {
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
  let st = load() || seed();
  const subs = new Set();
  const notify = () => subs.forEach(f => { try { f(); } catch (e) { console.error(e); } });
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} notify(); };
  addEventListener("storage", e => { if (e.key === KEY) { st = load() || seed(); notify(); } });
  const watch = fn => { subs.add(fn); fn(); return () => subs.delete(fn); };
  let me = "demo-admin";
  if (role !== "admin") { try { me = localStorage.getItem(KEY + ":as") || "demo-driver"; } catch (e) { me = "demo-driver"; } if (!st.users[me]) me = "demo-driver"; }
  const arr = (o, f = () => true) => Object.entries(o).map(([id, v]) => ({ id, ...v })).filter(f);
  return {
    demo: true,
    reset() { st = seed(); save(); },
    me: () => me,
    demoDrivers: () => arr(st.users, u => u.role === "driver"),
    actAs(id) { try { localStorage.setItem(KEY + ":as", id); } catch (e) {} location.replace(location.pathname); },
    onUser(cb) { setTimeout(() => cb({ uid: me, email: st.users[me].email }), 0); return () => {}; },
    signIn: async () => {}, signOut: async () => {}, resetPassword: async () => {},
    ready: async () => ({ uid: me }),
    async approvePhone(code, name) { (st.devices ||= {})[me] = { code, at: Date.now(), name }; save(); },
    watchDriverNames: cb => watch(() => cb(st.settings && st.settings.drivers ? st.settings.drivers.names : null)),
    watchAccess: cb => watch(() => cb(st.settings && st.settings.access || null)),
    async setAccessCode(code) { ((st.settings ||= {}).access = { code }); save(); },
    watchDevices: cb => watch(() => cb(arr(st.devices || {}))),
    async removeDevice(id) { delete (st.devices || {})[id]; save(); },
    async removeAllDevices() { st.devices = {}; save(); },
    async setDriverNames(names) { ((st.settings ||= {}).drivers = { names }); save(); },
    async addDriverNames(names) { const d = ((st.settings ||= {}).drivers ||= { names: [] }); for (const n of names) if (!d.names.includes(n)) d.names.push(n); save(); },
    watchProfile: (id, cb) => watch(() => cb(st.users[id] ? { id, ...st.users[id] } : null)),
    watchMyManifests: (id, cb) => watch(() => cb(arr(st.manifests, m => (m.driverIds || []).includes(id)))),
    watchTruckRuns: (truck, cb) => watch(() => cb(arr(st.manifests, m => m.truck === truck))),
    watchAdmins: cb => watch(() => cb(arr(st.users, u => u.role === "admin"))),
    async addAdmin({ name, username }) { st.users[uid("u")] = { name, username, role: "admin", active: true, createdAt: Date.now() }; save(); },
    watchManifest: (id, cb) => watch(() => cb(st.manifests[id] ? { id, ...st.manifests[id] } : null, false)),
    watchScans: (mid, cb) => watch(() => cb([...(st.scans[mid] || [])], 0)),
    addScan(mid, scan) { (st.scans[mid] ||= []).push({ id: uid("c"), ...scan }); save(); },
    setStopDone(mid, stopId, info, status) {
      const m = st.manifests[mid]; if (!m) return;
      m.stopsDone = { ...(m.stopsDone || {}), [stopId]: info };
      if (!info) delete m.stopsDone[stopId];
      m.status = status; m.updatedAt = Date.now(); save();
    },
    watchDrivers: cb => watch(() => cb(arr(st.users, u => u.role === "driver"))),
    async addDriver({ name, employeeId, truck }) {
      const id = uid("u"), pin = makePin(), emp = String(employeeId || "").trim().toUpperCase();
      st.users[id] = { name, employeeId: emp, truck: (truck || "").trim().toUpperCase(), role: "driver", active: true, createdAt: Date.now() };
      (st.logins ||= {})[id] = { employeeId: emp, name, pin }; save(); return { id, pin };
    },
    watchLogins: cb => watch(() => cb(arr(st.logins || {}))),
    watchTrucks: cb => watch(() => cb(arr(st.trucks || {}))),
    async saveTruck(code, { plate, nickname, crew }) {
      const t = ((st.trucks ||= {})[code] ||= { code, plates: [] });
      if (nickname) t.nickname = nickname; if (plate && !t.plates.includes(plate)) t.plates.push(plate); if (crew && crew.length) t.crew = crew; save();
    },
    async setDriver(id, patch) { Object.assign(st.users[id], patch); save(); },
    watchAllManifests: cb => watch(() => cb(arr(st.manifests).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)))),
    async saveManifest(m) { const id = uid("m"); st.manifests[id] = m; save(); return id; },
    async updateManifest(id, patch) { Object.assign(st.manifests[id], patch, { updatedAt: Date.now() }); save(); },
    async deleteManifest(id) { delete st.manifests[id]; delete st.scans[id]; save(); },
  };
}
