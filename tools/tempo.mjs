import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const require=createRequire(import.meta.url);
let playwright;
try { playwright=require('playwright'); }
catch(error) {
  if(error.code!=='MODULE_NOT_FOUND')throw error;
  playwright=require(process.env.PLAYWRIGHT_MODULE||resolve(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
}
const root=fileURLToPath(new URL('../',import.meta.url));
const html=readFileSync(resolve(root,'index.html'));
const server=createServer((req,res)=>{
  if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const url='http://127.0.0.1:'+server.address().port;
let browser;
const errors=[],results=[];
try {
  browser=await playwright.chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE}:{channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'})});
  for(const mode of ['normal','forward','od-tap']) {
    const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
    await context.route('**/*',route=>route.request().url().startsWith(url+'/')?route.continue():route.fulfill({status:200,contentType:'text/css',body:''}));
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(mode+': '+error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(mode+': '+message.text());});
    await page.addInitScript(()=>{
      Date.now=()=>1720000000000;
      localStorage.setItem('rune-overdrive-save-v1',JSON.stringify({
        settings:{board:'7x6',speed:'normal',shake:false,flash:true,sfx:false,bgm:false},cleared:{},best:{},tutorial:true,
      }));
    });
    await page.goto(url+'/?debug=1');
    await page.locator('#startBtn').click();
    await page.locator('#homeAdventureBtn').click();
    await page.locator('#dungeonList .dcard').first().click();
    await page.waitForFunction(()=>RUNE_DEBUG.phase==='input');
    const fixture=await page.evaluate(()=>{
      const d=RUNE_DEBUG;
      const rows=Array.from({length:5},(_,r)=>[2*r%6,2*r%6,2*r%6,(2*r+1)%6,(2*r+1)%6,(2*r+1)%6,(2*r+2)%6]);
      rows.push([0,1,2,3,4,5,0]);
      d.setBoard(rows);
      // 敵が生き残り、怒り・大技・通常攻撃を再生する、計測専用の戦況。
      d.state.enemies.forEach((e,i)=>{
        e.maxHp=2000000000;e.hp=1000000000;e.cd=1;e.acts=i===0?2:0;
        e.boss=i===0;e.bigName='確認用の大技';e.atk=i===0?900:450;
        e.v.hp=e.hp;e.v.ghost=e.hp;
      });
      d.state.teamHp=5000;d.view.teamHp=5000;d.view.teamGhost=5000;
      const game=d.snapshot();
      let found;
      for(let seed=1;seed<=10000;seed++){
        const result=d.logic.resolveTurn(game,{},d.logic.makeRngs(seed));
        if(result.events.filter(e=>e.t==='pop').length===20){found={seed,result};break;}
      }
      if(!found)throw new Error('20コンボの再現盤面を作れませんでした');
      if(!found.result.events.some(e=>e.t==='enrage')||!found.result.events.some(e=>e.t==='enemyAtk'&&e.big))throw new Error('怒りと大技がない');
      d.setSeed(found.seed);
      window.tempoExpected=found.result.next;window.tempoSave=d.save;
      return {seed:found.seed,combos:20,estimate:d.estimateDuration(found.result.events)};
    });
    await page.evaluate(()=>{
      window.tempoStarted=performance.now();
      window.tempoRun=RUNE_DEBUG.resolve().then(()=>{
        window.tempoMeasured={seconds:(performance.now()-window.tempoStarted)/1000,clock:{...RUNE_DEBUG.clock.lastTurn},game:RUNE_DEBUG.snapshot(),save:RUNE_DEBUG.save};
      });
    });
    await page.waitForFunction(()=>RUNE_DEBUG.clock.turnActive);
    if(mode==='forward') {
      await page.mouse.click(20,60);
      await page.waitForFunction(()=>RUNE_DEBUG.clock.forwardScale===3);
      mkdirSync(resolve(root,'screenshots'),{recursive:true});
      await page.screenshot({path:resolve(root,'screenshots/phase-a-fast-forward.png')});
    } else if(mode==='od-tap') {
      await page.waitForFunction(()=>RUNE_DEBUG.clock.stop&&RUNE_DEBUG.odOverlay&&!RUNE_DEBUG.odOverlay.end);
      await page.mouse.click(200,550);
      const jump=await page.evaluate(()=>({real:RUNE_DEBUG.clock.real,od:RUNE_DEBUG.odOverlay,forward:RUNE_DEBUG.clock.forwardScale}));
      assert.equal(jump.forward,3);
      assert(jump.real>=jump.od.t0+jump.od.dur*.45,'ODの文字が入る段階まで進む');
    }
    await page.waitForFunction(()=>!!window.tempoMeasured,{},{timeout:15000});
    const result=await page.evaluate(()=>window.tempoMeasured);
    const expected=await page.evaluate(()=>window.tempoExpected);
    for(const key of ['board','party','teamHp','teamMax','enemies','target','od','stats','timeBonus'])assert.deepEqual(result.game[key],expected[key],mode+': 計算結果 '+key);
    assert.deepEqual(result.save,await page.evaluate(()=>window.tempoSave),'演出だけで報酬・セーブが変わらない');
    assert.equal(result.game.stats.maxCombo,20);
    assert.equal(await page.evaluate(()=>RUNE_DEBUG.phase),'input');
    assert.equal(await page.evaluate(()=>RUNE_DEBUG.pending),0,'着弾・撃破を待ち切る');
    assert.equal(await page.evaluate(()=>RUNE_DEBUG.clock.turnScale),1,'ターン倍率をリセット');
    assert.equal(await page.evaluate(()=>RUNE_DEBUG.clock.forwardScale),1,'早送りをリセット');
    assert(result.clock.scale>=1&&result.clock.scale<=2.5);
    assert(Math.abs(result.clock.scale-Math.min(2.5,Math.max(1,fixture.estimate/6)))<1e-9);
    results.push({mode,fixture,seconds:result.seconds,clock:result.clock,game:result.game,save:result.save});
    console.log('MEASURE: '+mode+' '+result.seconds.toFixed(3)+'秒');
    console.log(JSON.stringify({mode,fixture,clock:result.clock}));
    await context.close();
  }
  assert(results[0].seconds<=6,'標準の20コンボは6秒以内: '+results[0].seconds);
  assert(results[1].seconds<=2.5,'タップ早送りは2.5秒以内: '+results[1].seconds);
  for(const result of results.slice(1)){
    assert.deepEqual(result.game,results[0].game,'標準・早送り・ODタップの最終状態が一致');
    assert.deepEqual(result.save,results[0].save);
  }
  assert.deepEqual(errors,[],'ブラウザエラー0件');
  console.log('PASS: 20コンボの時間・早送り・ODタップ・計算結果の一致');
  console.log(JSON.stringify(results.map(({game,save,...report})=>report),null,2));
} finally {
  if(browser)await browser.close();
  await new Promise(done=>server.close(done));
}
