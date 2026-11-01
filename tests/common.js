const fs=require('fs');
exports.BASE='http://127.0.0.1:8765/';
exports.wire=async (ctx, log)=>{
  await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'), r=>{
    const u=r.request().url();
    if(u.includes('leaflet.js')) return r.fulfill({body:fs.readFileSync(__dirname+'/leaflet-stub.js','utf8'),contentType:'text/javascript'});
    if(u.includes('leaflet.css')) return r.fulfill({body:'',contentType:'text/css'});
    log.push('BLOCKED '+u.slice(0,90)); return r.abort();
  });
};
exports.watch=(page,name,log)=>{
  page.on('console',m=>{ if(m.type()==='error'||m.type()==='warning') log.push(`[${name}] ${m.type()}: ${m.text().slice(0,200)}`)});
  page.on('pageerror',e=>log.push(`[${name}] PAGEERROR: ${e.message}`));
  page.on('dialog',d=>{log.push(`[${name}] dialog: ${d.message().slice(0,120)}`); d.accept();});
};
