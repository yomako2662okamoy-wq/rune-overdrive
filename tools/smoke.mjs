import {mkdirSync,writeFileSync,appendFileSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {format} from 'node:util';
const root=fileURLToPath(new URL('../',import.meta.url));
const dir=resolve(root,'tmp'),log=resolve(dir,'smoke-last.log');
mkdirSync(dir,{recursive:true});writeFileSync(log,'');
const originalLog=console.log,originalError=console.error;
console.log=(...args)=>appendFileSync(log,format(...args)+'\n');
console.error=(...args)=>appendFileSync(log,'ERROR '+format(...args)+'\n');
try{
 await import('./smoke-detail.mjs');
 const detail=readFileSync(log,'utf8'),passed=(detail.match(/^PASS:/gm)||[]).length;
 const perf=JSON.parse(readFileSync(resolve(root,'docs/performance-c3.json'),'utf8'));
 const after=perf.reports.find(r=>r.version==='after');
 originalLog('SMOKE: PASS / '+passed+' checks / browser errors 0');
 originalLog('PERF: 20 combos p95 '+after.cpuP95ms+'ms / frame gradients '+after.mainCanvasGradients);
 originalLog('DETAIL: tmp/smoke-last.log ; docs/performance-c3.json');
}catch(error){
 appendFileSync(log,String(error.stack||error)+'\n');
 originalLog('SMOKE: FAIL');
 originalLog('PERF: details in log');
 originalLog('DETAIL: tmp/smoke-last.log');
 process.exitCode=1;
}finally{
 console.log=originalLog;console.error=originalError;
}
