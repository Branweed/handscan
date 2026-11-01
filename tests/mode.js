const fs=require('fs');const src=fs.readFileSync('/home/claude/handscan/barcode-scanner.js','utf8');
const MODES=eval(src.match(/const MODES = (\[[^\]]*\]);/)[1]);
const body=src.slice(src.indexOf('    function nextMode()'),src.indexOf('    async function toggleTorch'));
for(const fav of [-1,0,1,2,3]){
  const run=new Function('MODES','favor','let mode=0,tick=0;const FULL=MODES.indexOf("full");'+body+';return Array.from({length:24},()=>nextMode());')(MODES,fav);
  const even=run.filter((_,i)=>i%2===1).every(m=>m===3);  // tick = i+1, even ticks at odd i
  const cnt={};run.forEach(m=>cnt[MODES[m]]=(cnt[MODES[m]]||0)+1);
  console.log('favor',fav<0?'none':MODES[fav],'evenTicksFull',even,JSON.stringify(cnt),run.slice(0,12).map(m=>MODES[m][0]).join(''));
}
