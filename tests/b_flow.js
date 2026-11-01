const {chromium}=require('playwright');const C=require('./common');
const KEY="manifest-check-demo:v4";
(async()=>{const b=await chromium.launch();const ctx=await b.newContext();const log=[];await C.wire(ctx,log);
const pg=await ctx.newPage();C.watch(pg,'admin',log);
await pg.goto(C.BASE+'admin.html');await pg.waitForTimeout(1500);
// plan: also put Brockton Leaf on Tue/T1 (so one planned stop is missing from the files)
await pg.evaluate(async()=>{const S=await import('./store.js');const s=S.createStore('admin');await s.updateRouteStop('demo-r2',{day:'2026-10-27',truck:'T1',order:2});});
await pg.reload();await pg.waitForTimeout(1500);
const rs=async()=>pg.evaluate(k=>Object.entries(JSON.parse(localStorage.getItem(k)).routes.stops).map(([id,s])=>`${id} ${s.name} day=${s.day} truck=${s.truck} sent=${s.sentRunId||'-'}/${s.sentTruck||'-'}/${s.sentDate||'-'}`).join('\n'),KEY);
console.log('PLAN before:\n'+await rs());
await pg.setInputFiles('input[type=file]',__dirname+'/run.csv');await pg.waitForTimeout(2000);
const txt=(await pg.innerText('body')).replace(/[ \t]+/g,' ');
console.log('REVIEW plan lines:\n'+txt.split('\n').filter(l=>/Route Board|Already sent|Not on the plan|another truck|not in these files|Send to|Stop \d|Taunton|Harbor|Not Planned/.test(l)).slice(0,20).join('\n'));
await pg.click('button.primary:has-text("Send to")');await pg.waitForTimeout(1500);
console.log('PLAN after send:\n'+await rs());
// Route Board
const r=await ctx.newPage();C.watch(r,'routes',log);await r.goto(C.BASE+'routes.html');await r.waitForTimeout(2000);
console.log('ROUTES Sent chips:',(await r.locator('text=/✓ Sent/').allInnerTexts()));
// second upload: only Taunton again -> should warn Already sent; missing should list Brockton but not Harbor Light
await pg.click('text=Upload');await pg.waitForTimeout(500);
await pg.setInputFiles('input[type=file]',__dirname+'/run2.csv');await pg.waitForTimeout(2000);
const t2=(await pg.innerText('body')).replace(/[ \t]+/g,' ');
console.log('REVIEW2:\n'+t2.split('\n').filter(l=>/Route Board order|Already sent|Not on the plan|another truck|not in these files/.test(l)).join('\n'));
await pg.click('text=Discard');await pg.waitForTimeout(500);
// delete the run

const st=await pg.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
const mid=Object.keys(st.manifests).find(x=>x!=='demo-1');
console.log('RUN stops order:',st.manifests[mid].stops.map(s=>s.name+(s.driverNote?' [note:'+s.driverNote+']':'')).join(' | '));
await pg.click('button:has-text("Runs")');await pg.waitForTimeout(500);
await pg.click('text=/T1 · .*Oct 27/');await pg.waitForTimeout(800);
await pg.click('button.danger:has-text("Delete")');await pg.waitForTimeout(1500);
console.log('PLAN after delete:\n'+await rs());
await r.reload();await r.waitForTimeout(1500);
console.log('ROUTES Sent chips after delete:',(await r.locator('text=/✓ Sent/').allInnerTexts()));
console.log(log.join('\n'));await b.close();})();
