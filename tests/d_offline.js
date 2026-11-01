const {chromium}=require('playwright');const C=require('./common');
(async()=>{const b=await chromium.launch();const ctx=await b.newContext();const log=[];await C.wire(ctx,log);
const pg=await ctx.newPage();C.watch(pg,'index',log);
await pg.goto(C.BASE+'index.html');
await pg.evaluate(()=>navigator.serviceWorker.ready.then(()=>1));
await pg.waitForTimeout(1500);
console.log('caches:',await pg.evaluate(async()=>{const k=await caches.keys();const c=await caches.open(k[0]);return k.join(',')+' files='+(await c.keys()).length;}));
console.log('controlled:',await pg.evaluate(()=>!!navigator.serviceWorker.controller));
await ctx.setOffline(true);
const t0=Date.now();await pg.reload();await pg.waitForTimeout(2500);
console.log('offline reload ms',Date.now()-t0,'controlled:',await pg.evaluate(()=>!!navigator.serviceWorker.controller));
console.log('body:',(await pg.innerText('body')).replace(/\s+/g,' ').slice(0,200));
// fresh navigation to root while offline
await pg.goto(C.BASE);await pg.waitForTimeout(2000);console.log('root offline:',(await pg.innerText('body')).replace(/\s+/g,' ').slice(0,80));
// tap a truck offline
await pg.goto(C.BASE+'index.html');await pg.waitForTimeout(1500);
await pg.selectOption('select',{index:1}).catch(e=>console.log('sel',e.message));
await pg.click('text=Demo Truck').catch(e=>console.log('click',e.message));await pg.waitForTimeout(1500);
console.log('truck offline:',(await pg.innerText('body')).replace(/\s+/g,' ').slice(0,200));
console.log(log.filter(l=>!l.startsWith('BLOCKED')).join('\n'));await b.close();})();
