import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {mkdirSync} from 'node:fs';
import {loadLogic,plain} from './load-logic.mjs';

export async function smokeTeamMac(browser,url,root,errors){
 const {logic}=loadLogic(),save=plain(logic.createSave());
 save.roster.akane.lv=20;save.roster.kagura={lv:12,exp:0,skillLv:1};
 const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1});
 await context.route('**/*',route=>route.request().url().startsWith(url+'/')?route.continue():route.fulfill({status:200,contentType:'text/css',body:''}));
 await context.addInitScript(data=>{if(!localStorage.getItem('rune-overdrive-save-v2'))localStorage.setItem('rune-overdrive-save-v2',JSON.stringify(data));},save);
 const page=await context.newPage();
 page.on('pageerror',e=>errors.push('team Mac: '+e.message));page.on('console',m=>{if(m.type()==='error')errors.push('team Mac: '+m.text());});
 const slot=n=>'#team .slot[data-slot="'+n+'"]',card=id=>'#team .roster-card[data-id="'+id+'"]';
 const band=page.locator('#teamDragBand'),ghost=page.locator('#teamDragGhost'),panel=page.locator('#teamMemberPanel');
 const members=()=>page.evaluate(()=>RUNE_DEBUG.save.teams[0].members);
 async function open(){await page.goto(url+'/?debug=1');await page.waitForFunction(()=>RUNE_DEBUG.assets.done);await page.locator('#startBtn').click();await page.locator('#homeTeamBtn').click();}
 async function reset(){await page.evaluate(data=>localStorage.setItem('rune-overdrive-save-v2',JSON.stringify(data)),save);await open();}
 const center=async selector=>{const r=await page.locator(selector).boundingBox();assert(r,selector);return {x:r.x+r.width/2,y:r.y+r.height/2};};
 async function start(selector,offset={x:20,y:20}){
  await page.locator(selector).scrollIntoViewIfNeeded();
  const r=await page.locator(selector).boundingBox(),p={x:r.x+offset.x,y:r.y+offset.y};
  await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+4,p.y);
  await band.waitFor({state:'visible'});assert.equal(await ghost.isVisible(),true);return {r,p};
 }
 async function finish(p){await page.mouse.move(p.x,p.y);await page.mouse.up();await band.waitFor({state:'hidden'});assert.equal(await ghost.isVisible(),false);}
 async function bandFits(){
  const geometry=await band.evaluate(el=>{
   const r=el.getBoundingClientRect(),target=document.querySelector('#team .slot.drop-over'),s=target?.getBoundingClientRect();
   return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,font:parseFloat(getComputedStyle(el).fontSize),rows:el.querySelectorAll('.team-drag-line').length,overlap:!!s&&r.left<s.right&&r.right>s.left&&r.top<s.bottom&&r.bottom>s.top};
  });
  assert(geometry.left>=0&&geometry.top>=0&&geometry.right<=geometry.width&&geometry.bottom<=geometry.height,'帯は画面内');
  assert.equal(geometry.overlap,false,'帯が指している枠を隠さない');assert(geometry.font>=13);assert.equal(geometry.rows,2);
 }
 await open();mkdirSync(resolve(root,'docs/screenshots'),{recursive:true});
 await page.screenshot({path:resolve(root,'docs/screenshots/team-ux-after-1280x800.png')});
 // 4px未満はクリック。1秒静止してもマウスでは長押しを開始しない。
 await page.locator(slot(0)).scrollIntoViewIfNeeded();const p=await center(slot(0));
 await page.mouse.move(p.x,p.y);await page.mouse.down();await page.waitForTimeout(1000);
 assert.equal(await band.isVisible(),false);await page.mouse.move(p.x+3,p.y);assert.equal(await band.isVisible(),false);await page.mouse.up();
 assert.equal(await panel.isVisible(),true);assert.equal(await panel.getAttribute('data-id'),'akane');assert.deepEqual(await members(),save.teams[0].members);
 await page.keyboard.press('Escape');assert.equal(await panel.isVisible(),false);assert.deepEqual(await members(),save.teams[0].members);
 console.log('PASS: Macは待機なし4px開始・3pxの移動と長い静止はクリック・選択をEsc取消');

 // 非中央を掴み、分身が掴んだ位置から飛ばないことも測る。
 await reset();const begun=await start(slot(0));
 const g=await ghost.boundingBox();assert(Math.abs(g.x-(begun.r.x+4))<=1);assert(Math.abs(g.y-begun.r.y)<=1);assert(Math.abs(g.width-begun.r.width)<=1);
 assert.equal(await page.locator(slot(0)).evaluate(el=>getComputedStyle(el).cursor),'grabbing');
 const target=await center(slot(1));await page.mouse.move(target.x,target.y);await bandFits();
 assert.equal(await page.locator(slot(1)).evaluate(el=>el.classList.contains('drop-over')),true);
 assert.equal(await page.locator(card('mizuha')).evaluate(el=>el.classList.contains('team-swap-peer')),true);
 assert((await band.textContent()).includes('紅蓮斬 ／ 次 Lv25 緋焔乱舞'));assert(!(await band.textContent()).includes('紅閃'));
 await page.screenshot({path:resolve(root,'docs/screenshots/team-ux-after-drag-1280x800.png')});
 await finish(target);assert.deepEqual(await members(),['mizuha','akane','yomogi','ruka','nocto']);
 const swapped=await page.evaluate(()=>RUNE_DEBUG.save);await open();assert.deepEqual(await page.evaluate(()=>RUNE_DEBUG.save),swapped,'マウス交換を再読込しても保存');
 console.log('PASS: Macの実マウスで交換・掴んだ位置と分身・相手の光・再読込保存');

 await reset();await page.locator(slot(0)).click();await page.locator(slot(1)).click();
 assert.deepEqual(await members(),['mizuha','akane','yomogi','ruka','nocto']);assert.equal(await panel.isVisible(),false,'クリック交換後はパネルを閉じる');
 await reset();await page.locator(slot(0)).click();await page.locator(card('kagura')).click();
 assert.deepEqual(await members(),['kagura','mizuha','yomogi','ruka','nocto']);assert.equal(await panel.isVisible(),false);
 await reset();await page.locator(card('akane')).click();await page.locator(card('mizuha')).click();
 assert.deepEqual(await members(),['mizuha','akane','yomogi','ruka','nocto']);assert.equal(await panel.isVisible(),false);
 await reset();await page.locator(card('crow')).click();await page.locator(slot(0)).click();
 assert.deepEqual(await members(),save.teams[0].members);assert((await page.locator('#toast').textContent()).includes('ダンジョン6クリア'));
 await page.keyboard.press('Escape');assert.equal(await panel.isVisible(),false);
 await reset();await page.locator(slot(0)).dblclick();assert.deepEqual(await members(),save.teams[0].members,'同じ仲間の二度押しでは交換しない');
 console.log('PASS: Macのクリック→枠／カードで交換・パネルを閉じる・同じ仲間と未加入は保存不変');

 await reset();await start(slot(0));const unchanged=await page.evaluate(()=>RUNE_DEBUG.save);
 await page.keyboard.press('Escape');await page.mouse.up();assert.equal(await band.isVisible(),false);assert.equal(await ghost.isVisible(),false);assert.deepEqual(await page.evaluate(()=>RUNE_DEBUG.save),unchanged);
 await start(slot(0));await finish({x:3,y:300});assert.deepEqual(await page.evaluate(()=>RUNE_DEBUG.save),unchanged);
 // 上下左右12pxの余裕を実ブラウザでも通す（枠の上端の10px外）。
 await start(slot(0));const halo=await page.locator(slot(1)).boundingBox();await finish({x:halo.x+halo.width/2,y:halo.y-10});
 assert.deepEqual(await members(),['mizuha','akane','yomogi','ruka','nocto']);
 console.log('PASS: MacのEscと枠外は取消・見た目より10px外でも12pxのドロップ範囲で交換');

 await reset();await start(slot(0));
 for(const point of [{x:1270,y:790},{x:1270,y:12},{x:12,y:12},{x:12,y:790},await center(slot(0)),await center(slot(4))]){await page.mouse.move(point.x,point.y);await bandFits();}
 await finish({x:3,y:300});
 for(const selector of [slot(0),card('akane')]){
  assert.equal(await page.locator(selector).evaluate(el=>getComputedStyle(el).cursor),'grab');
  assert.equal(await page.locator(selector).evaluate(el=>getComputedStyle(el).userSelect),'none');
  for(const image of await page.locator(selector+' img').all())assert.equal(await image.getAttribute('draggable'),'false');
 }
 await page.emulateMedia({reducedMotion:'reduce'});await start(slot(0));assert.equal(await ghost.evaluate(el=>getComputedStyle(el).boxShadow),'none');await finish({x:3,y:300});
 assert(await page.evaluate(()=>document.querySelector('#team').scrollWidth<=innerWidth));
 console.log('PASS: Macの帯2行・13px・画面四隅と枠を避ける・標準画像ドラッグ禁止・動き軽減・横はみ出しなし');
 await context.close();
}
