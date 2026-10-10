import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {loadLogic,plain} from './load-logic.mjs';

export async function smokeControls(browser,url,root,errors){
 const {logic}=loadLogic(),save=plain(logic.createSave());
 Object.assign(save.settings,{speed:'normal',shake:true,flash:false,sfx:false,bgm:false,barks:false});
 save.seen.tutorial=true;save.roster.akane.lv=20;
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,reducedMotion:'no-preference'});
 await context.route('**/*',route=>route.request().url().startsWith(url+'/')?route.continue():route.fulfill({status:200,contentType:'text/css',body:''}));
 await context.addInitScript(data=>localStorage.setItem('rune-overdrive-save-v2',JSON.stringify(data)),save);
 const page=await context.newPage();
 page.on('pageerror',e=>errors.push('controls: '+e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push('controls: '+m.text());});
 const scanTargets=async label=>{
  const small=await page.evaluate(()=>[...document.querySelectorAll('button,input,textarea,select,summary,[role="button"]')].flatMap(el=>{
   const rect=el.getBoundingClientRect();if(!el.getClientRects().length || !rect.width || !rect.height)return [];
   return rect.width<43.99||rect.height<43.99?[{name:el.id||el.textContent,width:rect.width,height:rect.height}]:[];
  }));assert.deepEqual(small,[],label+'の押す場所は44px以上');
  assert(await page.evaluate(()=>{
   const screen=document.querySelector('.screen:not(.hidden)'),dialog=document.querySelector('#modal:not(.hidden) .modal-card');
   return (!screen||screen.scrollWidth<=innerWidth)&&(!dialog||dialog.scrollWidth<=dialog.clientWidth);
  }),label+'に横はみ出しがない');
 };
 const resetBoard=async()=>page.evaluate(()=>{
  const d=RUNE_DEBUG;d.cancelInput();d.setBoard(Array.from({length:6},(_,r)=>Array.from({length:7},(_,c)=>(r*2+c)%6)));return d.visuals.layout;
 });
 const cancelDrag=async()=>{await page.evaluate(()=>RUNE_DEBUG.cancelInput());await page.mouse.up();};
 try{
  await page.goto(url+'/?debug=1');await page.waitForFunction(()=>window.RUNE_DEBUG?.assets.done);
  await scanTargets('タイトル');
  // Press feedback and the OS preference apply before entering a dungeon.
  const btn=page.locator('#startBtn'),rect=await btn.boundingBox();
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
  assert.notEqual(await btn.evaluate(el=>getComputedStyle(el).transform),'none');
  assert.notEqual(await btn.evaluate(el=>getComputedStyle(el).boxShadow),'none');
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await btn.evaluate(el=>getComputedStyle(el).transform),'none');
  await page.mouse.up();await page.emulateMedia({reducedMotion:'no-preference'});
  for(const viewport of [{width:390,height:844},{width:375,height:667}]){
   await page.setViewportSize(viewport);await scanTargets('ホーム');
   await page.locator('#homeTeamBtn').click();await scanTargets('編成');
   await page.locator('#teamDetailBtn').click();await scanTargets('詳細');
   await page.locator('#detailBackBtn').click();await page.locator('#teamHomeBtn').click();
   await page.locator('#homeAdventureBtn').click();await scanTargets('冒険');
   await page.locator('#selectHomeBtn').click();
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('#homeAdventureBtn').click();await page.locator('#dungeonList .dcard').first().click();
  await page.waitForFunction(()=>RUNE_DEBUG.phase==='input');
  await page.evaluate(()=>RUNE_DEBUG.state.enemies.forEach(e=>{e.hp=e.maxHp=1e8;e.atk=0;e.cd=e.turn=99;e.v.hp=e.v.ghost=e.hp;}));
  await scanTargets('戦闘');
  let l=await page.evaluate(()=>RUNE_DEBUG.visuals.layout),enemy=await page.evaluate(()=>({x:RUNE_DEBUG.state.enemies[0].v.x,y:RUNE_DEBUG.state.enemies[0].v.y}));
  await page.mouse.click(enemy.x,enemy.y);assert.equal(await page.evaluate(()=>RUNE_DEBUG.state.target),0);
  await page.mouse.click(enemy.x,enemy.y);assert.equal(await page.evaluate(()=>RUNE_DEBUG.state.target),-1);
  await page.mouse.click(enemy.x,enemy.y);assert.equal(await page.evaluate(()=>RUNE_DEBUG.state.target),0);
  await page.waitForTimeout(100);assert((await page.evaluate(()=>RUNE_DEBUG.input.targetRotation))>0);
  // Pause/resume and speed keys invoke the existing operations.
  await page.keyboard.press('p');assert.equal(await page.evaluate(()=>RUNE_DEBUG.clock.paused),true);await scanTargets('一時停止');
  const frozen=await page.evaluate(()=>RUNE_DEBUG.clock.real);await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>RUNE_DEBUG.clock.real),frozen);
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>RUNE_DEBUG.clock.paused),false);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#modalTitle').textContent(),'一時停止');
  await page.keyboard.press('p');assert.equal(await page.locator('#modal').isVisible(),false);
  for(const value of ['fast','fastest','normal']){await page.keyboard.press('s');assert.equal(await page.evaluate(()=>RUNE_DEBUG.settings.speed),value);}
  const mute=await page.evaluate(()=>RUNE_DEBUG.settings.mute);await page.keyboard.press('m');assert.equal(await page.evaluate(()=>RUNE_DEBUG.settings.mute),!mute);
  await page.keyboard.press('m');assert.equal(await page.evaluate(()=>RUNE_DEBUG.settings.mute),mute);
  for(const kind of ['input','textarea','select','editable']){
   await page.evaluate(kind=>{const el=document.createElement(kind==='editable'?'div':kind);el.id='typingProbe';if(kind==='editable')el.contentEditable='true';if(kind==='select')el.innerHTML='<option>x</option>';el.style.cssText='position:absolute;top:60px;left:40px;z-index:50';document.body.append(el);el.focus();},kind);
   const before=await page.evaluate(()=>({speed:RUNE_DEBUG.settings.speed,mute:RUNE_DEBUG.settings.mute,paused:RUNE_DEBUG.clock.paused,forward:RUNE_DEBUG.clock.forwardScale}));
   for(const key of ['Space','p','Escape','s',...(kind==='select'?[]:['m'])])await page.keyboard.press(key);
   assert.deepEqual(await page.evaluate(()=>({speed:RUNE_DEBUG.settings.speed,mute:RUNE_DEBUG.settings.mute,paused:RUNE_DEBUG.clock.paused,forward:RUNE_DEBUG.clock.forwardScale})),before,kind+'入力中はキーが作用しない');
   await page.locator('#typingProbe').evaluate(el=>el.remove());
  }
  // Shared growth labels, 0.4 second threshold, release and cancellation.
  const pos=l.icons[0];await page.evaluate(()=>RUNE_DEBUG.state.party[0].cd=0);
  await page.mouse.move(pos.x,pos.y);await page.mouse.down();await page.waitForTimeout(200);
  assert.equal(await page.locator('#heldInfo').isVisible(),false);
  await page.waitForFunction(()=>!document.querySelector('#heldInfo').classList.contains('hidden'));
  const info=await page.locator('#heldInfo').textContent();
  for(const text of ['紅蓮変換','溜め 5ターン','あと 0ターン','紅閃','紅蓮斬','緋焔乱舞','Lv25','7連鎖で発動'])assert(info.includes(text),text);
  assert(!info.includes('紅蓮天墜'));assert.equal(await page.locator('#modal').isVisible(),false);
  for(const viewport of [{width:390,height:844},{width:375,height:667}]){
   await page.setViewportSize(viewport);await page.screenshot({path:resolve(root,'screenshots/usability-held-'+viewport.width+'x'+viewport.height+'.png')});
   const box=await page.locator('#heldInfo').boundingBox();assert(box.x>=0&&box.x+box.width<=viewport.width);assert(box.y>=0&&box.y+box.height<=viewport.height);
  }
  await page.mouse.up();assert.equal(await page.locator('#heldInfo').isVisible(),false);assert.equal(await page.evaluate(()=>RUNE_DEBUG.state.party[0].cd),0);
  await page.setViewportSize({width:390,height:844});l=await page.evaluate(()=>RUNE_DEBUG.visuals.layout);
  await page.mouse.move(l.icons[0].x,l.icons[0].y);await page.mouse.down();await page.waitForFunction(()=>!document.querySelector('#heldInfo').classList.contains('hidden'));
  await page.evaluate(()=>document.querySelector('#game').dispatchEvent(new PointerEvent('pointercancel',{pointerId:1})));await page.mouse.up();assert.equal(await page.locator('#heldInfo').isVisible(),false);
  await page.evaluate(()=>RUNE_DEBUG.settings.skillConfirm=true);await page.mouse.click(l.icons[0].x,l.icons[0].y);
  assert.equal(await page.locator('#modalTitle').textContent(),'スキルを使う？');await scanTargets('スキル確認');await page.getByRole('button',{name:'やめる',exact:true}).click();
  // Real-time ring remains independent of each animation speed.
  for(const speed of ['normal','fast','fastest']){
   l=await resetBoard();await page.evaluate(speed=>RUNE_DEBUG.settings.speed=speed,speed);
   await page.mouse.move(l.bx+1.5*l.cell,l.by+2.5*l.cell);await page.mouse.down();await page.mouse.move(l.bx+2.5*l.cell,l.by+2.5*l.cell);
   const a=await page.evaluate(()=>RUNE_DEBUG.input);await page.waitForTimeout(160);const b=await page.evaluate(()=>RUNE_DEBUG.input);
   assert(b.drag.trail.length>=2);assert(a.timer.remaining-b.timer.remaining>.07&&a.timer.remaining-b.timer.remaining<.4,speed+'の輪は実時間');
   assert.equal(b.timer.ratio,b.timer.remaining/await page.evaluate(()=>RUNE_DEBUG.state.moveTime));
   await cancelDrag();assert.equal(await page.evaluate(()=>RUNE_DEBUG.input.timer),null);
  }
  // Existing edge clamp now also permits the adjacent edge cell.
  for(const side of ['left','right','top','bottom']){
   l=await resetBoard();const [r,c]=side==='left'?[2,1]:side==='right'?[2,5]:side==='top'?[1,2]:[4,2];
   await page.mouse.move(l.bx+(c+.5)*l.cell,l.by+(r+.5)*l.cell);await page.mouse.down();
   const x=side==='left'?1:side==='right'?389:l.bx+(c+.5)*l.cell,y=side==='top'?l.by-2:side==='bottom'?l.by+l.bh+2:l.by+(r+.5)*l.cell;
   await page.mouse.move(x,y);
   const input=await page.evaluate(()=>RUNE_DEBUG.input);
   assert.equal(input.drag.r,side==='top'?0:side==='bottom'?5:r);assert.equal(input.drag.c,side==='left'?0:side==='right'?6:c);assert(input.drag.swaps>0);
   if(side==='right'){await page.mouse.move(x,l.by+3.5*l.cell);assert.equal(await page.evaluate(()=>RUNE_DEBUG.input.drag.r),3);}
   await cancelDrag();
  }
  // Two genuine touch points; the second must neither swap nor click a button.
  l=await resetBoard();const session=await context.newCDPSession(page),point={id:1,x:l.bx+1.5*l.cell,y:l.by+2.5*l.cell};
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});point.x=l.bx+2.5*l.cell;
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point]});
  const beforeTouch=await page.evaluate(()=>({board:RUNE_DEBUG.snapshot().board,drag:RUNE_DEBUG.input.drag,speed:RUNE_DEBUG.settings.speed}));
  const speedBox=await page.locator('#speedBtn').boundingBox(),second={id:2,x:speedBox.x+speedBox.width/2,y:speedBox.y+speedBox.height/2};
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point,second]});
  second.x=l.bx+4.5*l.cell;second.y=l.by+3.5*l.cell;
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point,second]});
  const afterTouch=await page.evaluate(()=>({board:RUNE_DEBUG.snapshot().board,drag:RUNE_DEBUG.input.drag,speed:RUNE_DEBUG.settings.speed}));
  assert.deepEqual(afterTouch,beforeTouch,'2本目の指で盤面・所有する指・速度を変えない');
  await page.evaluate(()=>RUNE_DEBUG.cancelInput());await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();
  assert.equal(await page.evaluate(()=>RUNE_DEBUG.settings.speed),beforeTouch.speed,'2本目を離しても速度を変えない');
  const scale=await page.evaluate(()=>visualViewport.scale);const enemyNow=await page.evaluate(()=>({x:RUNE_DEBUG.state.enemies[1].v.x,y:RUNE_DEBUG.state.enemies[1].v.y}));
  await page.touchscreen.tap(enemyNow.x,enemyNow.y);await page.touchscreen.tap(enemyNow.x,enemyNow.y);await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>visualViewport.scale),scale,'実ダブルタップで拡大しない');
  // Each setting and OS preference independently makes the target indicator static.
  for(const [shake,flash,reduced] of [[false,false,'no-preference'],[true,true,'no-preference'],[true,false,'reduce']]){
   await page.evaluate(flags=>Object.assign(RUNE_DEBUG.settings,flags),{shake,flash});await page.emulateMedia({reducedMotion:reduced});await page.keyboard.press('s');
   assert.equal(await page.evaluate(()=>RUNE_DEBUG.input.targetRotation),0);
   const box=await page.locator('#speedBtn').boundingBox();await page.mouse.move(box.x+22,box.y+22);await page.mouse.down();
   assert.equal(await page.locator('#speedBtn').evaluate(el=>getComputedStyle(el).transform),'none');
   assert.notEqual(await page.locator('#speedBtn').evaluate(el=>getComputedStyle(el).boxShadow),'none');await page.mouse.up();
  }
  for(const viewport of [{width:390,height:844},{width:375,height:667}]){
   await page.setViewportSize(viewport);l=await resetBoard();await page.evaluate(()=>RUNE_DEBUG.state.target=0);
   assert(l.cell>=44);assert(l.icon+8>=44);
   await page.mouse.move(l.bx+1.5*l.cell,l.by+2.5*l.cell);await page.mouse.down();await page.mouse.move(l.bx+2.5*l.cell,l.by+2.5*l.cell);
   await page.screenshot({path:resolve(root,'screenshots/usability-drag-'+viewport.width+'x'+viewport.height+'.png')});await scanTargets('ドラッグ');await cancelDrag();
  }
  // Space accelerates the existing turn while retaining the full LOGIC result.
  await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>{
   const d=RUNE_DEBUG;d.settings.speed='normal';d.state.target=1;d.setSeed(44);
   const rows=Array.from({length:6},(_,r)=>Array.from({length:7},()=>r%6));d.setBoard(rows);
   window.controlExpected=d.logic.resolveTurn(d.snapshot(),{},d.logic.makeRngs(44)).next;d.resolve();
  });
  await page.waitForFunction(()=>RUNE_DEBUG.phase==='resolve'&&RUNE_DEBUG.clock.turnActive);await page.keyboard.press('Space');
  assert.equal(await page.evaluate(()=>RUNE_DEBUG.clock.forwardScale),await page.evaluate(()=>RUNE_DEBUG.config.FAST_FORWARD));
  await page.waitForFunction(()=>RUNE_DEBUG.phase==='input',null,{timeout:30000});
  const result=await page.evaluate(()=>({actual:RUNE_DEBUG.snapshot(),expected:controlExpected}));
  for(const key of ['board','teamHp','enemies','stats','earnedExp'])assert.deepEqual(result.actual[key],result.expected[key],'Space後の'+key);
  console.log('PASS: 道と実時間輪・敵選択・長押しと解除・キー入力・四辺・実2本指・ダブルタップ・44px・軽減・両画面幅');
 }finally{await context.close();}
}
