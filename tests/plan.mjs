import fs from 'fs';
import { stopSets, buyerKey } from '/home/claude/handscan/shared.js';
const src=fs.readFileSync('/home/claude/handscan/admin.html','utf8');
const grab=n=>{let i=src.indexOf('async function '+n+'(');if(i<0)i=src.indexOf('function '+n+'(');let d=0,j=src.indexOf('{',i);for(let k=j;;k++){if(src[k]==='{')d++;else if(src[k]==='}'&&--d===0)return src.slice(i,k+1);}};
const A={};const body=grab('applyPlan')+'\n'+grab('markPlanSent')+'\nreturn {applyPlan,markPlanSent};';
const {applyPlan,markPlanSent}=new Function('A','stopSets','buyerKey',body)(A,stopSets,buyerKey);
const upd=[];A.store={updateRouteStop:async(id,p)=>upd.push([id,p])};
A.buyers={'LIC-1':{driverNote:'Back door'}};A.manifests=[{id:'old'}];
A.routeStops=[
 {id:'r1',buyerKey:'LIC-1',license:'LIC-1',name:'One',invoiceNo:'000123',day:'2026-11-03',truck:'W99',order:1},
 {id:'r2',buyerKey:'LIC-2',license:'LIC-2',name:'Two',invoiceNo:'',day:'2026-11-02',truck:'W99',order:0},
 {id:'r3',buyerKey:'LIC-3',name:'Three',invoiceNo:'9',day:'2026-11-02',truck:'W99',order:2,sentRunId:'old',sentTruck:'W99'},
 {id:'r4',buyerKey:'LIC-4',name:'Four',invoiceNo:'',day:'2026-11-02',truck:'W99',order:3}];
const d={date:'2026-11-02',truck:'',stops:[
 {id:'a',name:'Two',license:'lic-2',invoiceNo:''},
 {id:'b',name:'One',license:'LIC-1',sets:[{manifestNo:'M1',invoiceNo:'123'}]},   // invoice match, other day, leading zeros
 {id:'c',name:'Zed',license:'LIC-9'}]};
applyPlan(d);
console.log('order',d.stops.map(s=>s.id).join(','),'truck',d.truck,'note',d.stops.find(s=>s.id==='b').driverNote);
console.log(JSON.stringify(d.plan));
await markPlanSent(d,d.stops.filter(s=>s.id!=='c'),'run1','W99','2026-11-02');console.log(JSON.stringify(upd));
