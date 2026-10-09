import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function smokeArt(browser,url,root,errors){
 const manifest=JSON.parse(readFileSync(resolve(root,'assets/manifest.json'),'utf8'));
 const all=[...new Set([...Object.values(manifest.enemies),...Object.values(manifest.bosses)].map(e=>e.file).concat(Object.values(manifest.chars).flatMap(e=>[e.full,e.face])).filter(Boolean))];
 for(const mode of ['full','none','partial','file']){
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(()=>{
   window.loadedArt=[];const Original=window.Image;
   window.Image=class extends Original{constructor(...args){super(...args);this.addEventListener('load',()=>window.loadedArt.push(this.getAttribute('src')));}};
  });
  const missing=mode==='none'?all:mode==='partial'?[manifest.bosses.d1.file,manifest.chars.akane.full]:[];
  await context.route('**/*',route=>{
   const request=route.request().url();
   if(missing.some(file=>request.endsWith('/'+file)))return route.fulfill({status:200,contentType:'image/webp',body:''});
   if(request.startsWith(url+'/')||request.startsWith('file:'))return route.continue();
   return route.fulfill({status:200,contentType:'text/css',body:''});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push('art '+mode+': '+e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push('art '+mode+': '+m.text());});
  await page.goto(mode==='file'?pathToFileURL(resolve(root,'index.html')).href+'?debug=1':url+'/?debug=1');
  await page.waitForFunction(()=>window.RUNE_DEBUG&&document.querySelector('#assetStatus').textContent==='');
  const loaded=await page.evaluate(()=>loadedArt);
  for(const file of all)assert.equal(loaded.includes(file),!missing.includes(file),mode+': '+file);
  await page.locator('#startBtn').click();await page.locator('#homeAdventureBtn').click();await page.locator('#dungeonList .dcard').first().click();
  await page.waitForFunction(()=>RUNE_DEBUG.phase==='input');
  await page.evaluate(async()=>{
   const d=RUNE_DEBUG;Object.assign(d.settings,{speed:'fastest',sfx:false,bgm:false,barks:false});
   d.state.enemies.forEach(e=>{e.hp=e.maxHp=1e8;e.v.hp=e.v.ghost=e.hp;});
   d.setBoard(d.logic.makeBoard(false,d.logic.mulberry32(37)));d.setSeed(41);
   window.artExpected=d.logic.resolveTurn(d.snapshot(),{},d.logic.makeRngs(41)).next;await d.resolve();
  });
  const result=await page.evaluate(()=>({actual:RUNE_DEBUG.snapshot(),expected:artExpected}));
  for(const key of ['board','teamHp','enemies','stats'])assert.deepEqual(result.actual[key],result.expected[key],mode+': '+key);
  if(mode==='full')for(const viewport of [{width:390,height:844},{width:375,height:667}]){
   await page.setViewportSize(viewport);await page.waitForTimeout(100);
   await page.screenshot({path:resolve(root,'screenshots/art-'+viewport.width+'x'+viewport.height+'.png')});
  }
  await context.close();
 }
 console.log('PASS: 素材あり・なし・一部・file://で画像読込／戦闘結果一致');
}
