const {chromium}=require('playwright');const C=require('./common');
(async()=>{const b=await chromium.launch();const ctx=await b.newContext();const log=[];await C.wire(ctx,log);
for(const p of ['index.html','admin.html','routes.html']){const pg=await ctx.newPage();C.watch(pg,p,log);
 await pg.goto(C.BASE+p);await pg.waitForTimeout(2500);
 const t=(await pg.innerText('body')).replace(/\s+/g,' ').slice(0,300);console.log('==',p,'::',t);await pg.close();}
console.log(log.join('\n'));await b.close();})();
