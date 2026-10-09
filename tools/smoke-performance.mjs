import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
export async function smokePerformance(browser,url,root,errors){
 const reports=[];
 for(const version of ['before','after']){
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3});
  await context.route('**/*',r=>r.request().url().startsWith(url+'/')?r.continue():r.fulfill({status:200,contentType:'text/css',body:''}));
  const page=await context.newPage();page.on('pageerror',e=>errors.push('performance: '+e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push('performance: '+m.text());});
  await page.addInitScript(()=>{
   Date.now=()=>1720000000000;
   localStorage.setItem('rune-overdrive-save-v1',JSON.stringify({settings:{board:'7x6',speed:'normal',shake:false,flash:true,sfx:false,bgm:false},cleared:{},best:{},tutorial:true}));
   window.profiling=false;window.frameCosts=[];window.gradientCalls=0;
   const raf=window.requestAnimationFrame.bind(window);
   window.requestAnimationFrame=cb=>raf(t=>{const start=performance.now();cb(t);if(window.profiling)window.frameCosts.push(performance.now()-start);});
   for(const name of ['createLinearGradient','createRadialGradient']){
    const original=CanvasRenderingContext2D.prototype[name];
    CanvasRenderingContext2D.prototype[name]=function(...args){
     if(window.profiling&&this.canvas.id==='game')window.gradientCalls++;
     return original.apply(this,args);
    };
   }
  });
  await page.goto(url+(version==='before'?'/baseline.html':'/')+'?debug=1');
  await page.locator('#startBtn').click();await page.locator('#homeAdventureBtn').click();await page.locator('#dungeonList .dcard').first().click();
  await page.waitForFunction(()=>RUNE_DEBUG.phase==='input');
  const fixture=await page.evaluate(()=>{
   const d=RUNE_DEBUG,rows=Array.from({length:5},(_,r)=>[2*r%6,2*r%6,2*r%6,(2*r+1)%6,(2*r+1)%6,(2*r+1)%6,(2*r+2)%6]);
   rows.push([0,1,2,3,4,5,0]);d.setBoard(rows);
   d.state.enemies.forEach((e,i)=>{e.maxHp=2e9;e.hp=1e9;e.cd=1;e.acts=i===0?2:0;e.boss=i===0;e.bigName='QA';e.atk=i===0?900:450;e.v.hp=e.hp;e.v.ghost=e.hp;});
   d.state.teamHp=5000;d.view.teamHp=5000;d.view.teamGhost=5000;
   const game=d.snapshot();let found;
   for(let seed=1;seed<=10000;seed++){const result=d.logic.resolveTurn(game,{},d.logic.makeRngs(seed));if(result.events.filter(e=>e.t==='pop').length===20){found={seed,result};break;}}
   if(!found)throw Error('20 combo fixture missing');
   d.setSeed(found.seed);window.profileExpected=found.result.next;window.profileSave=d.save;
   return {seed:found.seed,combos:20};
  });
  await page.evaluate(()=>{
   window.profiling=true;window.profileStart=performance.now();
   RUNE_DEBUG.resolve().then(()=>{window.profiling=false;window.profileResult={seconds:(performance.now()-window.profileStart)/1000,game:RUNE_DEBUG.snapshot(),save:RUNE_DEBUG.save};});
  });
  await page.waitForFunction(()=>!!window.profileResult,null,{timeout:20000});
  const result=await page.evaluate(()=>({result:profileResult,expected:profileExpected,save:profileSave,costs:frameCosts,gradients:gradientCalls}));
  for(const key of ['board','party','teamHp','teamMax','enemies','target','od','stats','timeBonus'])assert.deepEqual(result.result.game[key],result.expected[key],version+': '+key);
  assert.deepEqual(result.result.save,result.save);
  assert.equal(result.result.game.stats.maxCombo,20);
  result.costs.sort((a,b)=>a-b);
  reports.push({version,fixture,seconds:result.result.seconds,frames:result.costs.length,mainCanvasGradients:result.gradients,cpuP95ms:result.costs[Math.floor(result.costs.length*.95)],cpuMaxMs:result.costs.at(-1),over16ms:result.costs.filter(t=>t>16).length});
  if(version==='before'){assert(result.gradients>0);}
  else{
   assert.equal(result.gradients,0,'No per-frame gradients on main canvas');
   await page.waitForFunction(()=>RUNE_DEBUG.performance.particleAlive===0,null,{timeout:5000});
   const policy=await page.evaluate(()=>{
    const d=RUNE_DEBUG,steps=[];
    // Bring quality to high, then verify pending transitions and retained assets.
    d.qualityBoundary();for(let k=0;k<4;k++){d.qualitySample(1,false);for(let i=0;i<600;i++)d.qualitySample(1/60);d.qualityBoundary();}
    const sprites=d.visuals.runeSpr,revision=d.performance.paintRevision;
    for(let k=0;k<2;k++){
     const before=d.performance;for(let i=0;i<60;i++)d.qualitySample(1/30);
     const queued=d.performance;d.qualityBoundary();const applied=d.performance;
     steps.push({before,queued,applied});
    }
    d.particleProbe(1000);
    return {steps,particles:d.performance,sameSprites:sprites===d.visuals.runeSpr,samePaints:revision===d.performance.paintRevision};
   });
   for(const step of policy.steps){assert.equal(step.queued.quality.level,step.before.quality.level);assert.equal(step.queued.quality.pending,step.before.quality.level-1);assert.equal(step.applied.quality.level,step.queued.quality.pending);}
   assert.equal(policy.particles.dpr,1.5);assert.equal(policy.particles.particleAlive,140);assert.equal(policy.particles.actualParticles,140);
   assert(policy.sameSprites&&policy.samePaints,'Quality change does not rebuild assets');
   await page.screenshot({path:resolve(root,'screenshots/phase-c3-quality-low.png')});
   await page.waitForTimeout(2000);
   assert.equal(await page.evaluate(()=>RUNE_DEBUG.performance.particleAlive),0);
   await page.evaluate(()=>{RUNE_DEBUG.state.od.active=false;RUNE_DEBUG.view.odVisual=false;});
   await page.waitForFunction(()=>RUNE_DEBUG.performance.idle,{},{timeout:10000});
   const count=await page.evaluate(()=>RUNE_DEBUG.performance.drawCount);await page.waitForTimeout(1100);
   const frames=await page.evaluate(()=>RUNE_DEBUG.performance.drawCount)-count;
   assert(frames>=15&&frames<=38,'Idle redraws near 30fps: '+frames);
   const restored=await page.evaluate(()=>{
    const d=RUNE_DEBUG,steps=[];
    for(let k=0;k<2;k++){d.qualitySample(1,false);for(let i=0;i<600;i++)d.qualitySample(1/60);steps.push(d.performance);d.qualityBoundary();}
    return {steps,final:d.performance};
   });
   assert.equal(restored.final.quality.level,2);assert.equal(restored.final.dpr,3);
   reports.push({quality:'low -> medium -> high',idleFramesIn1100ms:frames,particleCap:policy.particles.particleCap});
  }
  await context.close();
 }
 assert.deepEqual(errors,[]);
 writeFileSync(resolve(root,'docs/performance-c3.json'),JSON.stringify({environment:'Desktop Chrome, 390x844, DPR3. CPU time inside rAF callback only; excludes GPU presentation. Not a real mobile-device measurement.',reports},null,2)+'\n');
 console.log('PASS: 20 combos preserve LOGIC/save; cached gradients; 3 quality levels; particle count; idle 30fps');
 console.log(JSON.stringify(reports));
}
