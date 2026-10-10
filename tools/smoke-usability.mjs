import assert from 'node:assert/strict';
import { resolve } from 'node:path';
export async function smokeUsability(browser,url,root,errors) {
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.route('**/*',r=>r.request().url().startsWith(url+'/')?r.continue():r.fulfill({status:200,contentType:'text/css',body:''}));
 const page=await context.newPage();page.on('pageerror',e=>errors.push('UI: '+e.message));
 const close=()=>page.getByRole('button',{name:'閉じる',exact:true}).click();
 await page.goto(url);
 assert.equal(await page.evaluate(()=>typeof window.RUNE_DEBUG),'undefined');
 await page.locator('#titleSettingsBtn').click();assert.equal(await page.locator('#debugOpen').count(),0);await close();
 await page.goto(url+'/?debug=0');assert.equal(await page.evaluate(()=>typeof window.RUNE_DEBUG),'undefined');
 await page.goto(url+'/?debug=1');
 await page.evaluate(()=>Object.assign(RUNE_DEBUG.settings,{sfx:false,bgm:false,shake:false,flash:true,speed:'fastest'}));
 await page.locator('#titleSettingsBtn').click();
 for(const [name,value] of [['つかんだルーンの位置','中'],['敵のHPを数字で表示','オン'],['スキル発動の確認','オフ']])
   await page.getByRole('group',{name,exact:true}).getByRole('button',{name:value,exact:true}).click();
 const saved=await page.evaluate(()=>localStorage.getItem('rune-overdrive-save-v2'));
 await page.locator('#debugOpen').click();await page.locator('#debugUnlock').click();
 const level=page.getByLabel('アカネのレベル',{exact:true});await level.fill('48');await level.dispatchEvent('change');await close();
 await page.locator('#startBtn').click();await page.locator('#homeAdventureBtn').click();
 assert.equal(await page.locator('#dungeonList .dcard:not(:disabled)').count(),8);
 assert.equal(await page.evaluate(()=>RUNE_DEBUG.save.roster.akane.lv),48);
 await page.locator('#dungeonList .dcard').first().click();await page.waitForFunction(()=>RUNE_DEBUG.phase==='input');
 const pos=await page.evaluate(()=>RUNE_DEBUG.visuals.layout.icons[0]);
 await page.evaluate(()=>RUNE_DEBUG.state.party[0].cd=0);
 await page.mouse.move(pos.x,pos.y);await page.mouse.down();await page.waitForTimeout(500);
 assert.match(await page.locator('#heldInfo').innerText(),/リーダー/);
 assert.match(await page.locator('#heldInfo').innerText(),/連鎖技/);
 assert.equal(await page.locator('#modal').isVisible(),false);
 await page.mouse.up();assert.equal(await page.locator('#heldInfo').isVisible(),false);
 assert.equal(await page.evaluate(()=>RUNE_DEBUG.state.party[0].cd),0);
 await page.mouse.click(pos.x,pos.y);await page.waitForFunction(()=>RUNE_DEBUG.phase==='input'&&RUNE_DEBUG.state.party[0].cd>0);
 assert(await page.locator('#modal').evaluate(e=>e.classList.contains('hidden')));
 const enemy=await page.evaluate(()=>RUNE_DEBUG.state.enemies[0].v);
 await page.mouse.move(enemy.x,enemy.y);await page.mouse.down();await page.waitForTimeout(500);await page.mouse.up();
 assert.match(await page.locator('#modalBody').innerText(),/HP.*攻撃/s);await close();
 await page.locator('#speedBtn').click();assert.equal(await page.locator('#speedBtn').innerText(),'×1');
 await page.locator('#speedBtn').click();assert.equal(await page.locator('#speedBtn').innerText(),'×1.5');
 const paths=await page.evaluate(()=>{
  const d=RUNE_DEBUG,c=document.querySelector('#game'),l=d.visuals.layout,results=[];
  const path=[[2,1],[2,2],[2,3],[2,4],[3,4],[3,3],[3,2],[3,1],[4,1],[4,2],[4,3],[4,4]];
  for(const lift of ['small','medium','large'])for(let n=0;n<10;n++){
   d.settings.dragLift=lift;d.setBoard(Array.from({length:6},(_,r)=>Array.from({length:7},(_,c)=>(r*2+c)%6)));
   path.forEach(([r,col],i)=>c.dispatchEvent(new PointerEvent(i?'pointermove':'pointerdown',{pointerId:8,clientX:l.bx+(col+.5)*l.cell,clientY:l.by+(r+.5)*l.cell})));
   results.push({swaps:d.input.drag.swaps,trail:d.input.drag.trail.length,board:d.view.board.map(row=>row.map(o=>o.c))});d.cancelInput();
  }
  for(const [type,x,y] of [['pointerdown',1.5,2.5],['pointermove',2.18,3.18]])c.dispatchEvent(new PointerEvent(type,{pointerId:9,clientX:l.bx+x*l.cell,clientY:l.by+y*l.cell}));
  if(d.input.drag.swaps!==0)throw Error('斜め外側で交換');
  c.dispatchEvent(new PointerEvent('pointermove',{pointerId:9,clientX:l.bx+2.5*l.cell,clientY:l.by+3.5*l.cell}));
  if(d.input.drag.swaps!==1)throw Error('斜め中央で交換できない');d.cancelInput();return results;
 });
 for(const p of paths){assert.equal(p.swaps,11);assert.equal(p.trail,8);assert.deepEqual(p.board,paths[0].board);}
 for(const viewport of [{width:390,height:844},{width:375,height:667}]){
  await page.setViewportSize(viewport);await page.waitForTimeout(100);
  await page.screenshot({path:resolve(root,'screenshots/phase-c3-ui-'+viewport.width+'x'+viewport.height+'.png')});
 }
 assert.equal(await page.evaluate(()=>localStorage.getItem('rune-overdrive-save-v2')),saved);
 await page.goto(url);await page.locator('#startBtn').click();await page.locator('#homeAdventureBtn').click();
 assert.equal(await page.locator('#dungeonList .dcard:not(:disabled)').count(),1);
 await context.close();console.log('PASS: 通常URL非表示・デバッグ保存隔離・長押し・即発動・速度・浮かせ3段階・縦横10回・斜め判定');
}
