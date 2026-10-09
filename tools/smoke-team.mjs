import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {loadLogic,plain} from './load-logic.mjs';

export async function smokeTeam(browser,url,root,errors){
 const {logic,chars}=loadLogic(),save=plain(logic.createSave());
 save.roster.akane.lv=20;
 const context=await browser.newContext({viewport:{width:390,height:844}});
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
 await context.close();
 console.log('PASS: 編成パネルの能力・未加入・選択と確定・詳細から戻る・390/375px');
}
