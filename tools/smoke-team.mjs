import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {loadLogic,plain} from './load-logic.mjs';

export async function smokeTeam(browser,url,root,errors){
 const {logic,chars}=loadLogic(),save=plain(logic.createSave());
 save.roster.akane.lv=20;save.roster.kagura={lv:12,exp:0,skillLv:1};
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:1});
 await context.route('**/*',route=>route.request().url().startsWith(url+'/')?route.continue():route.fulfill({status:200,contentType:'text/css',body:''}));
 await context.addInitScript(data=>{if(!localStorage.getItem('rune-overdrive-save-v2'))localStorage.setItem('rune-overdrive-save-v2',JSON.stringify(data));},save);
 const page=await context.newPage();
 page.on('pageerror',e=>errors.push('team panel: '+e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push('team panel: '+m.text());});
 await page.goto(url+'/?debug=1');
 await page.waitForFunction(()=>window.RUNE_DEBUG?.assets.done);
 await page.locator('#startBtn').click();await page.locator('#homeTeamBtn').click();
 const saved=await page.evaluate(()=>RUNE_DEBUG.save);
 const panel=page.locator('#teamMemberPanel');
 const stats=async id=>{
  const ch=chars.find(ch=>ch.id===id),m=logic.growCharacter(ch,save.roster[id]);
  for(const stat of ['hp','atk','rcv'])assert.equal(await panel.locator('[data-stat="'+stat+'"]').textContent(),Number(m[stat]).toLocaleString('en-US'),id+' '+stat);
  const text=await panel.textContent();
  for(const value of [ch.name,ch.leader.name,ch.leader.desc,m.skill.name,m.skill.desc,'Lv'+m.lv,'溜め '+m.skill.turns+'ターン'])assert(text.includes(value),value);
  assert.equal(await panel.locator('.emblem').count(),1);
 };
 await stats('akane');
 assert((await panel.textContent()).includes('次に覚える技：Lv25 超必殺「緋焔乱舞」／7連鎖で発動'));
 assert((await panel.textContent()).includes('必殺技「紅蓮斬」'));
 assert.equal(await panel.locator('.growth .g-lv').allTextContents().then(lvs=>lvs.includes('Lv35')),false,'次より先の技は一覧に出さない');
 await page.locator('.slot[data-slot="1"]').click();await stats('mizuha');
 await page.locator('#teamContent .roster-card[data-id="crow"]').click();await stats('crow');
 assert.equal(await page.locator('#equipMemberBtn').isDisabled(),true);
 assert((await panel.textContent()).includes('加入条件：ダンジョン6クリアで加入'));
 assert.deepEqual(await page.evaluate(()=>RUNE_DEBUG.save),saved,'未加入のプレビューで保存を変えない');
 await page.locator('#teamDetailBtn').click();assert.equal(await page.locator('#detail').isVisible(),true);
 await page.locator('#detailBackBtn').click();assert.equal(await page.locator('#team').isVisible(),true);
 assert.equal(await panel.getAttribute('data-id'),'crow');
 assert.equal(await page.locator('.slot[data-slot="1"]').getAttribute('aria-pressed'),'true');
 await page.locator('#teamContent .roster-card[data-id="akane"]').click();await stats('akane');
 assert.deepEqual(await page.evaluate(()=>RUNE_DEBUG.save),saved,'加入済みの選択も編成を変えない');
 await page.locator('#equipMemberBtn').click();
 assert.deepEqual(await page.evaluate(()=>RUNE_DEBUG.save.teams[0].members),['mizuha','akane','yomogi','ruka','nocto']);
 const equipped=await page.evaluate(()=>RUNE_DEBUG.save);
 await page.locator('.slot[data-slot="1"]').click();
 await page.locator('#teamDetailBtn').click();await page.locator('#detailBackBtn').click();
 assert.equal(await panel.getAttribute('data-id'),'akane');
 for(const viewport of [{width:390,height:844},{width:375,height:667}]){
  await page.setViewportSize(viewport);await panel.scrollIntoViewIfNeeded();
  assert(await page.evaluate(()=>document.querySelector('#team').scrollWidth<=innerWidth),'画面が横にはみ出さない');
  assert(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth),'能力パネルが横にはみ出さない');
  for(const selector of ['#equipMemberBtn','#teamDetailBtn'])assert((await page.locator(selector).boundingBox()).height>=44);
  await page.screenshot({path:resolve(root,'screenshots/visual-growth-team-'+viewport.width+'x'+viewport.height+'.png')});
  await panel.screenshot({path:resolve(root,'screenshots/visual-growth-panel-'+viewport.width+'x'+viewport.height+'.png')});
 }
 await page.reload();await page.locator('#startBtn').click();
 assert.deepEqual(await page.evaluate(()=>RUNE_DEBUG.save),equipped,'確定した編成は再読込後も保存される');

 // 既存のタップ検証に続けて実入力でドラッグを検証する。
 await page.locator('#homeTeamBtn').click();
 const members=()=>page.evaluate(()=>RUNE_DEBUG.save.teams[0].members);
 const band=page.locator('#teamDragBand'),ghost=page.locator('#teamDragGhost');
 const card=id=>'#teamContent .roster-card[data-id="'+id+'"]';
 const slot=n=>'#teamContent .slot[data-slot="'+n+'"]';
 const center=async selector=>{const b=await page.locator(selector).boundingBox();assert(b,selector);return {x:b.x+b.width/2,y:b.y+b.height/2};};
 async function beginDrag(selector){
  await page.locator(selector).scrollIntoViewIfNeeded();await page.waitForTimeout(90);
  const p=await center(selector);await page.mouse.move(p.x,p.y);await page.mouse.down();
  await page.waitForTimeout(100);assert.equal(await band.isVisible(),false,'0.25秒未満はつかまない');
  await band.waitFor({state:'visible',timeout:2000});assert.equal(await ghost.isVisible(),true);
  return p;
 }
 async function releaseAt(point){await page.mouse.move(point.x,point.y,{steps:4});await page.mouse.up();await band.waitFor({state:'hidden'});assert.equal(await ghost.isVisible(),false);}
 async function dropSlot(source,n){await beginDrag(source);const p=await center(slot(n));await page.mouse.move(p.x,p.y,{steps:4});assert.equal(await page.locator(slot(n)).evaluate(el=>el.classList.contains('drop-over')),true);await page.mouse.up();await band.waitFor({state:'hidden'});}
 async function dropList(n){await beginDrag(slot(n));await page.locator(card('akane')).scrollIntoViewIfNeeded();const p=await center(card('akane'));await releaseAt(p);}
 const equippedBeforeDrag=await page.evaluate(()=>RUNE_DEBUG.save);
 await beginDrag(card('akane'));
 assert.equal(await band.getAttribute('data-id'),'akane');
 const bandText=await band.textContent();
 for(const text of ['アカネ','Lv20','紅蓮変換 5T','紅閃','紅蓮斬','次 Lv25 緋焔乱舞'])assert(bandText.includes(text),text);
 assert(!bandText.includes('紅蓮天墜'));assert.equal(await band.locator('.team-drag-line').count(),3);
 assert.deepEqual(await page.evaluate(()=>RUNE_DEBUG.save),equippedBeforeDrag,'運んでいる間は保存不変');
 const first=await center(slot(0));await releaseAt(first);
 assert.deepEqual(await members(),['akane','mizuha','yomogi','ruka','nocto'],'一覧から既に編成中の仲間を交換');
 await dropSlot(card('kagura'),1);assert.deepEqual(await members(),['akane','kagura','yomogi','ruka','nocto'],'一覧から加入済みの別の仲間を入れる');
 assert.equal(await page.locator('#teamMemberPanel').getAttribute('data-id'),'kagura');
 await dropSlot(slot(3),0);assert.deepEqual(await members(),['ruka','kagura','yomogi','akane','nocto'],'枠同士の並べ替え');
 assert.equal(await page.evaluate(()=>RUNE_DEBUG.save.teams[0].leader),'ruka','左端をリーダーとして保存');
 await dropList(2);assert.deepEqual(await members(),['ruka','kagura','akane','nocto'],'枠から一覧へ戻すと外す');
 const unchanged=await page.evaluate(()=>RUNE_DEBUG.save);
 await beginDrag(card('mizuha'));await releaseAt({x:3,y:300});assert.deepEqual(await page.evaluate(()=>RUNE_DEBUG.save),unchanged,'枠・一覧以外は元に戻す');
 await beginDrag(card('crow'));assert((await band.textContent()).includes('クロウ'));assert((await band.textContent()).includes('Lv1'));assert.equal(await page.locator('#teamContent .drop-ready').count(),0,'未加入は落とせる枠なし');
 await releaseAt(await center(slot(0)));assert.deepEqual(await page.evaluate(()=>RUNE_DEBUG.save),unchanged);
 assert((await page.locator('#toast').textContent()).includes('ダンジョン6クリアで加入'));
 await beginDrag(card('akane'));
 const bounds=await page.evaluate(()=>{const s=document.querySelector('#team .team-slots').getBoundingClientRect();return {top:s.bottom+9,bottom:innerHeight-12,width:innerWidth};});
 const beforeDown=await page.locator('#team').evaluate(el=>el.scrollTop);await page.mouse.move(bounds.width/2,bounds.bottom);await page.waitForTimeout(350);
 const afterDown=await page.locator('#team').evaluate(el=>el.scrollTop);assert(afterDown>beforeDown+10,'一覧下端で自動スクロール');
 await page.mouse.move(bounds.width/2,bounds.top);await page.waitForTimeout(350);assert((await page.locator('#team').evaluate(el=>el.scrollTop))<afterDown-10,'一覧上端で自動スクロール');
 await releaseAt({x:3,y:300});assert.deepEqual(await page.evaluate(()=>RUNE_DEBUG.save),unchanged,'自動スクロールだけでは保存を変えない');
 // 解除・画面の外への移動も保存しない。
 await beginDrag(card('akane'));await page.keyboard.press('Escape');await page.mouse.up();assert.equal(await band.isVisible(),false);assert.deepEqual(await page.evaluate(()=>RUNE_DEBUG.save),unchanged);
 await dropList(3);await dropList(2);await dropList(1);assert.deepEqual(await members(),['ruka']);
 const lastMember=await page.evaluate(()=>RUNE_DEBUG.save);await dropList(0);assert.deepEqual(await page.evaluate(()=>RUNE_DEBUG.save),lastMember,'最後の1体は外せない');
 assert((await page.locator('#toast').textContent()).includes('最後の1体'));
 await dropSlot(card('akane'),4);await dropSlot(card('mizuha'),4);assert.deepEqual(await members(),['ruka','akane','mizuha'],'空き枠は左詰めで追加');
 // 実タッチで長押し前の縦移動をスクロールにし、その後の長押しドラッグを通す。
 const cdp=await context.newCDPSession(page);
 const touch=async(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(p=>({...p,id:1,radiusX:2,radiusY:2,force:1}))});
 await page.locator(card('akane')).evaluate(el=>el.scrollIntoView({block:'center'}));await page.waitForTimeout(120);
 const touchBefore=await page.evaluate(()=>RUNE_DEBUG.save),start=await center(card('akane')),scrollBefore=await page.locator('#team').evaluate(el=>el.scrollTop);
 await touch('touchStart',[start]);await page.waitForTimeout(25);
 for(let i=1;i<=4;i++){await touch('touchMove',[{x:start.x,y:start.y-i*16}]);await page.waitForTimeout(15);}
 await touch('touchEnd',[]);await page.waitForTimeout(320);
 assert.equal(await band.isVisible(),false,'長押し前の縦移動で帯を出さない');assert((await page.locator('#team').evaluate(el=>el.scrollTop))>scrollBefore+10,'指で従来の一覧スクロール');assert.deepEqual(await page.evaluate(()=>RUNE_DEBUG.save),touchBefore);
 await page.locator(card('akane')).evaluate(el=>el.scrollIntoView({block:'center'}));await page.waitForTimeout(100);
 const held=await center(card('akane'));await touch('touchStart',[held]);await band.waitFor({state:'visible',timeout:2000});
 const target=await center(slot(0));for(let i=1;i<=4;i++){await touch('touchMove',[{x:held.x+(target.x-held.x)*i/4,y:held.y+(target.y-held.y)*i/4}]);await page.waitForTimeout(20);}
 assert.equal(await band.isVisible(),true,'長押し後はスクロールではなく指に追従');await touch('touchEnd',[]);await band.waitFor({state:'hidden'});
 assert.deepEqual(await members(),['akane','ruka','mizuha'],'指の長押しで交換');
 for(const viewport of [{width:390,height:844},{width:375,height:667}]){
  await page.setViewportSize(viewport);await page.emulateMedia({reducedMotion:viewport.width===375?'reduce':'no-preference'});
  await beginDrag(card('akane'));
  const dimensions=await band.evaluate(el=>{const r=el.getBoundingClientRect(),slots=document.querySelector('#team .team-slots').getBoundingClientRect();return {height:r.height,width:r.width,left:r.left,right:r.right,limit:innerHeight*.2,slotsTop:slots.top,bottom:r.bottom,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,overflow:getComputedStyle(el).overflowY,screenOverflow:document.querySelector('#team').scrollWidth>innerWidth};});
  assert(dimensions.height<=dimensions.limit+.01);assert(dimensions.height<=120);assert.equal(dimensions.width,viewport.width);assert(dimensions.left>=0&&dimensions.right<=viewport.width);assert(dimensions.slotsTop>dimensions.bottom);assert.equal(dimensions.overflow,'hidden');assert.equal(dimensions.screenOverflow,false);
  await page.screenshot({path:resolve(root,'screenshots/team-drag-'+viewport.width+'x'+viewport.height+'.png')});
  if(viewport.width===375)assert.equal(await ghost.evaluate(el=>getComputedStyle(el).boxShadow),'none','動き軽減では分身の影なし');
  await releaseAt({x:3,y:300});
 }
 const dragSaved=await page.evaluate(()=>RUNE_DEBUG.save);
 await page.reload();await page.locator('#startBtn').click();assert.deepEqual(await page.evaluate(()=>RUNE_DEBUG.save),dragSaved,'ドラッグの編成とリーダーは再読込でも保存');
 await page.locator('#homeTeamBtn').click();await page.locator(card('akane')).click();assert.equal(await panel.getAttribute('data-id'),'akane','普通のタップの能力パネルを維持');
 assert.equal(await band.isVisible(),false);assert.equal(await page.locator('#equipMemberBtn').isEnabled(),true);
 console.log('PASS: 編成ドラッグの追加・交換・並べ替え・外す・最後の1体・取消・未加入・上下自動スクロール・実タッチ・帯20%と保存');
 await context.close();
 console.log('PASS: 編成パネルの能力・未加入・選択と確定・詳細から戻る・390/375px');
}
