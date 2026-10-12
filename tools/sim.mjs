import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,sep} from 'node:path';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {loadLogic} from './load-logic.mjs';
import {simulateCase} from './sim-core.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
if(!isMainThread)parentPort.postMessage(simulateCase(loadLogic(),workerData));
else{
 try{
  const args=process.argv.slice(2);
  if(args.length!==0&&(args.length!==2||args[0]!=='--runs'||!/^\d+$/.test(args[1])))throw Error('Usage: node tools/sim.mjs [--runs 50|200]');
  const o=JSON.parse(readFileSync(resolve(root,'tools/sim-config.json'),'utf8')),{dungeons}=loadLogic();
  if(args.length)o.trials=Number(args[1]);
  o.maxTurns=300;
  if(![30,100,300].includes(o.K)||!Number.isInteger(o.trials)||o.trials<1||!Number.isInteger(o.seed)||!Array.isArray(o.dungeons)||!o.dungeons.length)throw Error('Invalid simulation configuration');
  const tasks=o.dungeons.flatMap(dungeon=>(o.levels||[null]).map(level=>({...o,dungeon,level})));
  const results=[];let cursor=0;
  await Promise.all(Array.from({length:Math.min(3,tasks.length)},async()=>{
   while(cursor<tasks.length){
    const task=tasks[cursor++];if(!dungeons.some(d=>d.id===task.dungeon))throw Error('Unknown dungeon');
    const row=await new Promise((res,rej)=>{const w=new Worker(new URL(import.meta.url),{workerData:task});w.once('message',res);w.once('error',rej);w.once('exit',c=>{if(c)rej(Error('worker exit '+c));});});
    results.push(row);
   }
  }));
  results.sort((a,b)=>a.dungeon.localeCompare(b.dungeon)||a.level-b.level);
  const keys=Object.keys(results[0]),csv=[keys.join(','),...results.map(r=>keys.map(k=>typeof r[k]==='number'&&!Number.isInteger(r[k])?r[k].toFixed(4):r[k]).join(','))].join('\n')+'\n';
  const output=resolve(root,o.output);if(!output.startsWith(resolve(root)+sep))throw Error('Output must stay in project');
  mkdirSync(resolve(root,'docs/sim'),{recursive:true});writeFileSync(output,csv);
  const detail=o.output.replace(/\.csv$/i,'.json');
  writeFileSync(resolve(root,detail),JSON.stringify({conditions:{K:o.K,trials:o.trials,seed:o.seed,maxTurns:o.maxTurns,levels:o.levels||'recommended',turnsAverage:'all runs including failures'},results},null,2)+'\n');
  const byId=Object.fromEntries(results.map(r=>[r.dungeon,r]));
  const clearTargets=[['d1',95,100],['d3',70,85],['d8',49,60]];
  const clearMet=clearTargets.filter(([id,min,max])=>byId[id]&&byId[id].clearRate>=min&&byId[id].clearRate<=max).length;
  // F6の基準を使い、d8だけ今回の3連戦目標（49〜60%／24〜29.4ターン）に合わせる。
  const turnRange=id=>id==='d8'?[24,29.4]:id==='d1'?[12,18]:Number(id.slice(1))<=3?[16,24]:[20,30];
  const turnsMet=results.filter(r=>r.avgDungeonTurns>=turnRange(r.dungeon)[0]&&r.avgDungeonTurns<=turnRange(r.dungeon)[1]).length;
  console.log('SIM: K='+o.K+' / '+o.trials+' runs / 300 turn cap / '+results.length+' cases');
  console.log('TARGETS: clear '+clearMet+'/3, average turns '+turnsMet+'/'+results.length);
  console.log('DETAIL: '+o.output+' ; '+detail);
 }catch(error){
  mkdirSync(resolve(root,'docs/sim'),{recursive:true});writeFileSync(resolve(root,'docs/sim/last-error.log'),String(error.stack||error)+'\n');
  console.log('SIM: FAIL');
  console.log('TARGETS: not measured');
  console.log('DETAIL: docs/sim/last-error.log');
  process.exitCode=1;
 }
}
