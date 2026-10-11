import { smokePerformance } from './smoke-performance.mjs';
import { execFileSync } from 'node:child_process';
import { smokeTeam } from './smoke-team.mjs';
import { smokeArt } from './smoke-art.mjs';
import assert from 'node:assert/strict';
import { smokeControls } from './smoke-controls.mjs';
import { smokeUsability } from './smoke-usability.mjs';
import { smokeDungeons } from './smoke-dungeons.mjs';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

// 通常は既存の playwright を使う。Codex同梱版も利用可。インストールや外部接続は行わない。
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  const bundled = resolve(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  playwright = require(process.env.PLAYWRIGHT_MODULE || bundled);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const html = readFileSync(resolve(root, 'index.html'));
// 旧Git履歴がある場合だけ過去版と比較。現在版の全検証は常に行う。
let baseline=null;
try { execFileSync('git',['cat-file','-e','df0f777:index.html'],{cwd:root,stdio:'ignore'}); baseline=execFileSync('git',['show','df0f777:index.html'],{cwd:root}); } catch {}
const server = createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if(baseline&&req.url.split('?')[0]==='/baseline.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(baseline);return;}
  const path=req.url.split('?')[0];
  if(/^\/assets\/[a-zA-Z0-9_.-]+$/.test(path)){
    try { const data=readFileSync(resolve(root,'.'+path));res.writeHead(200,{'Content-Type':path.endsWith('.json')?'application/json':'image/webp'});res.end(data); }
    catch {res.writeHead(404);res.end();}return;
  }
  if (!['/', '/index.html'].includes(path)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = 'http://127.0.0.1:' + server.address().port;
const errors = [];
const reports = [];
let exportedSave;
let browser;
try {
  browser = await playwright.chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : { channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' }),
  });
  mkdirSync(resolve(root, "screenshots"), {recursive:true});
  await smokePerformance(browser,url,root,errors,!!baseline);
  await smokeArt(browser,url,root,errors);
  await smokeTeam(browser,url,root,errors);
  await smokeUsability(browser,url,root,errors);
  await smokeControls(browser,url,root,errors);
  for (const testCase of [
    { board: '7x6', viewport: { width: 390, height: 844 } },
    { board: '6x5', viewport: { width: 375, height: 667 } },
    { board: '7x6', viewport: { width: 375, height: 667 }, storageDenied: true },
  ]) {
    const context = await browser.newContext({ viewport: testCase.viewport, deviceScaleFactor: 1 });
    // Google Fonts は空のCSSで応答。ゲーム本体のフォールバックも確認し、外部通信を不要にする。
    await context.route('**/*', (route) => {
      if (route.request().url().startsWith(url + '/')) return route.continue();
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => (errors.push(testCase.board + ': ' + error.message), console.error(error.stack)));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(testCase.board + ': ' + message.text()); });
    await page.addInitScript(({ board, storageDenied }) => {
      Date.now = () => 1720000000000;
      if (storageDenied) Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('保存不可', 'SecurityError'); } });
      else localStorage.setItem('rune-overdrive-save-v1', JSON.stringify({
        settings: { board, speed: 'normal', shake: false, flash: true, sfx: false, bgm: false },
        cleared: {}, best: {}, tutorial: true,
      }));
      // 読み込みが待ち時間を超えたあとに loadingdone が届く状況を作る。
      document.fonts.load = () => new Promise(() => {});
    }, testCase);
    await page.goto(url+'/?debug=1', { waitUntil: 'load' });
    await page.evaluate(() => Object.assign(RUNE_DEBUG.settings, { shake: false, flash: true, sfx: false, bgm: false }));
    const migrated = await page.evaluate(() => RUNE_DEBUG.save);
    assert.equal(migrated.version, 2);
    if (!testCase.storageDenied) {
      const stored = await page.evaluate(() => ({ current: JSON.parse(localStorage.getItem('rune-overdrive-save-v2')), old: localStorage.getItem('rune-overdrive-save-v1') }));
      assert.equal(stored.current.version, 2); assert.equal(stored.old, null);
      await page.locator('#titleSettingsBtn').click();
      mkdirSync(resolve(root, 'screenshots'), { recursive: true });
      await page.screenshot({ path: resolve(root, 'screenshots/phase-a-save-' + testCase.viewport.width + 'x' + testCase.viewport.height + '.png') });
      await page.getByRole('button', { name: '閉じる', exact: true }).click();
    }
    await page.locator('#startBtn').click();
    await page.locator('#homeAdventureBtn').click();
    await page.locator('#dungeonList .dcard').first().click();
    await page.waitForFunction(() => window.RUNE_DEBUG?.phase === 'input', { timeout: 15000 });
    const fontRefresh = await page.evaluate(() => {
      const before = RUNE_DEBUG.visuals;
      document.fonts.dispatchEvent(new Event('loadingdone'));
      const after = RUNE_DEBUG.visuals;
      return after.iconRevision > before.iconRevision && before.runeSpr === after.runeSpr;
    });
    assert(fontRefresh, '遅いフォント読み込みでアイコンだけが再生成される');
    const floors = new Set();
    let resizeChecked = false;
    for (let turn = 0; turn < 30; turn++) {
      const before = await page.evaluate(() => ({ phase: RUNE_DEBUG.phase, floor: RUNE_DEBUG.state.floor, turns: RUNE_DEBUG.state.stats.turns }));
      floors.add(before.floor);
      assert.equal(before.phase, 'input', '操作待ちからだけターンを進める');
      await page.evaluate(() => {
        const d = RUNE_DEBUG, rows = d.state.board.length, cols = d.state.board[0].length;
        const colors = rows === 6 ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 5];
        d.setBoard(colors.map((color) => Array(cols).fill(color)));
        d.resolve();
      });
      if (!resizeChecked && testCase.board === '7x6') {
        await page.waitForFunction(() => RUNE_DEBUG.visuals.floaters.some((f) => f.kind === 'dmg'), { timeout: 20000 });
        await page.evaluate(() => { RUNE_DEBUG.clock.paused = true; });
        const beforeResize = await page.evaluate(() => RUNE_DEBUG.visuals.floaters.filter((f) => f.kind === 'dmg'));
        mkdirSync(resolve(root, 'screenshots'), { recursive: true });
        await page.screenshot({ path: resolve(root, 'screenshots/phase-a-390x844.png') });
        await page.setViewportSize({ width: 375, height: 667 });
        await page.waitForFunction(() => RUNE_DEBUG.visuals.layout.W === 375 && RUNE_DEBUG.visuals.layout.H === 667);
        const afterResize = await page.evaluate(() => ({
          floaters: RUNE_DEBUG.visuals.floaters.filter((f) => f.kind === 'dmg'),
          enemies: RUNE_DEBUG.state.enemies.map((e) => ({ x: e.v.x, y: e.v.y })),
          cell: RUNE_DEBUG.visuals.layout.cell,
        }));
        assert.equal(afterResize.floaters.length, beforeResize.length, 'サイズ変更中に数字が消えない');
        for (const f of afterResize.floaters) {
          const origin = afterResize.enemies[f.anchor.index];
          assert(Math.abs(f.point.x - origin.x - f.anchor.dx * afterResize.cell) < 1e-6);
          assert(Math.abs(f.point.y - origin.y - f.anchor.dy * afterResize.cell) < 1e-6);
        }
        await page.screenshot({ path: resolve(root, 'screenshots/phase-a-375x667.png') });
        await page.evaluate(() => { RUNE_DEBUG.clock.paused = false; });
        resizeChecked = true;
      }
      await page.waitForFunction((previous) =>
        RUNE_DEBUG.state.stats.turns > previous &&
        (RUNE_DEBUG.phase === 'input' || !document.querySelector('#result').classList.contains('hidden')),
      before.turns, { timeout: 30000 });
      if (await page.locator('#result').isVisible()) break;
    }
    assert.equal(await page.locator('#resTitle').textContent(), 'CLEAR!', 'ダンジョン1を最後までクリアする');
    assert.equal(floors.size, 4, '4フロアをすべて通る');
    const result = await page.evaluate(() => ({ stats: RUNE_DEBUG.state.stats, hp: RUNE_DEBUG.state.teamHp, floor: RUNE_DEBUG.state.floor + 1 }));
    assert(result.stats.turns > 0 && result.stats.totalDmg > 0 && result.hp > 0);
    const growth = await page.evaluate(() => {
      const d = RUNE_DEBUG, exp = d.state.earnedExp;
      return { exp, claimed: d.state.rewardClaimed, save: d.save, expected: d.logic.gainExperience({lv:1,exp:0,skillLv:1}, exp).after };
    });
    assert.equal(growth.claimed, true);
    assert.equal(growth.save.crystal, 60);
    assert.deepEqual(growth.save.dungeons.d1.stars,[true,true,true]);
    assert.equal(growth.save.dungeons.d1.firstRewarded, true);
    for (const id of ['akane','mizuha','yomogi','ruka','nocto']) assert.deepEqual(growth.save.roster[id], growth.expected);
    const beforeSkip = await page.evaluate(() => RUNE_DEBUG.save);
    if (await page.locator('#skipRewardsBtn').isVisible()) await page.locator('#skipRewardsBtn').click();
    await page.waitForFunction(() => document.querySelector('#skipRewardsBtn').classList.contains('hidden'));
    assert.deepEqual(await page.evaluate(() => RUNE_DEBUG.save), beforeSkip, '演出のスキップで報酬が増えない');
    assert.equal(await page.locator('.reward-member').count(), 5);
    if (!testCase.storageDenied) {
      await page.setViewportSize(testCase.viewport);
      await page.evaluate(() => { document.querySelector('#result').scrollTop = 0; });
      assert((await page.locator('#resTitle').boundingBox()).y >= 0, '結果画面の先頭からスクロールできる');
      await page.screenshot({path:resolve(root,'screenshots/phase-c1-result-'+testCase.viewport.width+'x'+testCase.viewport.height+'.png')});
    }
    reports.push({ board: testCase.board, storageDenied: !!testCase.storageDenied, ...result, exp: growth.exp, level: growth.expected.lv });
    if (!testCase.storageDenied && !exportedSave) {
      await page.locator('#toSelectBtn').click();
      await page.locator('#homeAdventureBtn').click();
      await page.locator('#partyList .member button').first().click();
      await page.getByRole('button', { name: 'スキル強化（結晶30）', exact: true }).click();
      assert.equal(await page.evaluate(() => RUNE_DEBUG.save.roster.akane.skillLv), 2);
      assert.equal(await page.evaluate(() => RUNE_DEBUG.save.crystal), 30);
      await page.locator('#detailBackBtn').click();
      await page.locator('#selSettingsBtn').click();
      await page.getByRole('button', { name: 'セーブを書き出す', exact: true }).click();
      exportedSave = await page.getByRole('textbox', { name: '書き出したセーブデータ' }).inputValue();
      assert.equal(JSON.parse(exportedSave).dungeons.d1.cleared, true);
    }
    console.log('PASS: ' + testCase.board + (testCase.storageDenied ? ' 保存不可' : '') + ' ダンジョン1 CLEAR');
    await context.close();
  }
  // 別ブラウザ相当の空の保存先で、UIから読み込み・不正入力・再読み込みを確認する。
  const destination = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await destination.route('**/*', (route) => route.request().url().startsWith(url + '/') ? route.continue() : route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const importPage = await destination.newPage();
  importPage.on('pageerror', (error) => errors.push('import: ' + error.message));
  importPage.on('console', (message) => { if (message.type() === 'error') errors.push('import: ' + message.text()); });
  await importPage.goto(url+'/?debug=1');
  await importPage.locator('#titleSettingsBtn').click();
  await importPage.getByRole('button', { name: 'セーブを読み込む', exact: true }).click();
  await importPage.getByRole('textbox', { name: '読み込むセーブデータ' }).fill(exportedSave);
  await importPage.getByRole('button', { name: 'このセーブを読み込む', exact: true }).click();
  assert.deepEqual(await importPage.evaluate(() => RUNE_DEBUG.save), JSON.parse(exportedSave));
  await importPage.getByRole('button', { name: '設定へ戻る', exact: true }).click();
  await importPage.getByRole('button', { name: 'セーブを読み込む', exact: true }).click();
  await importPage.getByRole('textbox', { name: '読み込むセーブデータ' }).fill('{}');
  await importPage.getByRole('button', { name: 'このセーブを読み込む', exact: true }).click();
  assert.deepEqual(await importPage.evaluate(() => RUNE_DEBUG.save), JSON.parse(exportedSave), '不正入力で記録を失わない');
  await importPage.reload();
  assert.deepEqual(await importPage.evaluate(() => RUNE_DEBUG.save), JSON.parse(exportedSave), '再起動しても保存される');
  await destination.close();

  // C前半: 実際のクリアで加入し、UIで3編成・育成・新スキルのバトルを確認する。
  async function settleViewport(page, viewport) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  const c1 = await browser.newContext({hasTouch:true,viewport:{width:390,height:844},deviceScaleFactor:1});
  await c1.route('**/*', route => route.request().url().startsWith(url+'/') ? route.continue() : route.fulfill({status:200,contentType:'text/css',body:''}));
  const cPage = await c1.newPage();
  cPage.on('pageerror',error=>{errors.push('phase-c: '+error.message);console.error(error.stack);});
  cPage.on('console',message=>{if(message.type()==='error')errors.push('phase-c1: '+message.text());});
  await cPage.goto(url+'/?debug=1');
  async function importFixture(data) {
    await cPage.getByRole('button',{name:'セーブを読み込む',exact:true}).click();
    await cPage.getByRole('textbox',{name:'読み込むセーブデータ'}).fill(JSON.stringify(data));
    await cPage.getByRole('button',{name:'このセーブを読み込む',exact:true}).click();
    await cPage.getByRole('button',{name:'設定へ戻る',exact:true}).click();
    await cPage.getByRole('button',{name:'閉じる',exact:true}).click();
  }
  const seedSave=await cPage.evaluate(()=>{
    const data=RUNE_DEBUG.logic.createSave();
    Object.assign(data.settings,{speed:'fastest',shake:false,flash:true,sfx:false,bgm:false});
    for(const member of Object.values(data.roster))member.lv=30;
    data.seen.tutorial=true;
    data.dungeons.d1={cleared:true,stars:[false,false,false],best:{'7x6':8},firstRewarded:true};
    return data;
  });
  await cPage.locator('#titleSettingsBtn').click();
  await importFixture(seedSave);
  await cPage.locator('#startBtn').click();
  async function clearCurrent() {
    await cPage.waitForFunction(()=>RUNE_DEBUG.phase==='input');
    for(let turn=0;turn<40;turn++) {
      const previous=await cPage.evaluate(()=>RUNE_DEBUG.state.stats.turns);
      await cPage.evaluate(()=>{
        const d=RUNE_DEBUG, colors=d.state.board.length===6?[0,1,2,3,4,5]:[0,1,2,3,5];
        d.setBoard(colors.map(color=>Array(d.state.board[0].length).fill(color)));d.resolve();
      });
      await cPage.waitForFunction(last=>RUNE_DEBUG.state.stats.turns>last && (RUNE_DEBUG.phase==='input'||!document.querySelector('#result').classList.contains('hidden')),previous,{timeout:30000});
      if(await cPage.locator('#result').isVisible())break;
    }
    assert.equal(await cPage.locator('#resTitle').textContent(),'CLEAR!');
    if(await cPage.locator('#skipRewardsBtn').isVisible())await cPage.locator('#skipRewardsBtn').click();
    await cPage.waitForFunction(()=>document.querySelector('#skipRewardsBtn').classList.contains('hidden'));
  }
  for(const [index,id,name] of [[1,'kagura','カグラ'],[2,'shizuku','シズク']]) {
    await cPage.locator('#homeAdventureBtn').click();
    await cPage.locator('#dungeonList .dcard').nth(index).click();
    await clearCurrent();
    assert.equal(await cPage.evaluate(id=>RUNE_DEBUG.save.roster[id].lv,id),1);
    assert((await cPage.locator('.join-card').textContent()).includes(name+' が仲間になった'));
    const once=await cPage.evaluate(()=>RUNE_DEBUG.save);
    if(index===1) {
      await cPage.setViewportSize({width:390,height:844});
      await cPage.locator('.join-card').scrollIntoViewIfNeeded();
      await cPage.screenshot({path:resolve(root,'screenshots/phase-c1-join-390x844.png')});
    }
    await cPage.locator('#toSelectBtn').click();
    assert.deepEqual(await cPage.evaluate(()=>RUNE_DEBUG.save),once);
    console.log('PASS: ダンジョン'+(index+1)+' CLEAR → '+name+'加入');
  }
  // 既存v2のクリア記録で加入が補完されることを確認（新ダンジョンの実クリアは別ケース）。
  const full=await cPage.evaluate(()=>{
    const data=RUNE_DEBUG.save;
    for(const id of ['d4','d5','d6'])data.dungeons[id]={cleared:true,stars:[false,false,false],best:{},firstRewarded:true};
    return data;
  });
  await cPage.locator('#homeSettingsBtn').click();
  await importFixture(full);
  assert.equal(await cPage.evaluate(()=>Object.keys(RUNE_DEBUG.save.roster).length),10);
  await cPage.locator('#homeTeamBtn').tap();
  await cPage.locator('.team-tab[data-index="1"]').tap();
  for(const [slot,id] of ['kagura','shizuku','tsubaki','hikari','crow'].entries()) {
    await cPage.locator('.slot[data-slot="'+slot+'"]').tap();
    await cPage.locator('#teamContent .roster-card[data-id="'+id+'"]').tap();
    await cPage.locator('#equipMemberBtn').tap();
  }
  assert.deepEqual(await cPage.evaluate(()=>RUNE_DEBUG.save.teams[1].members),['kagura','shizuku','tsubaki','hikari','crow']);
  await cPage.locator('.team-tab[data-index="2"]').tap();
  await cPage.locator('.slot[data-slot="0"]').tap();
  await cPage.locator('#teamContent .roster-card[data-id="yomogi"]').tap();
  await cPage.locator('#equipMemberBtn').tap();
  for(let slot=4;slot>=1;slot--) {
    await cPage.locator('.slot[data-slot="'+slot+'"]').tap();await cPage.locator('#removeMemberBtn').tap();
  }
  assert.deepEqual(await cPage.evaluate(()=>RUNE_DEBUG.save.teams[2].members),['yomogi']);
  assert.equal(await cPage.locator('#removeMemberBtn').isDisabled(),true);
  // 空き枠の最後を選んでも左詰めで追加され、既にいる仲間は重複しない。
  await cPage.locator('.slot[data-slot="4"]').tap();await cPage.locator('#teamContent .roster-card[data-id="akane"]').tap();
  await cPage.locator('#equipMemberBtn').tap();
  assert.deepEqual(await cPage.evaluate(()=>RUNE_DEBUG.save.teams[2].members),['yomogi','akane']);
  await cPage.locator('.slot[data-slot="0"]').tap();await cPage.locator('#teamContent .roster-card[data-id="akane"]').tap();
  await cPage.locator('#equipMemberBtn').tap();
  assert.deepEqual(await cPage.evaluate(()=>RUNE_DEBUG.save.teams[2].members),['akane','yomogi']);
  await cPage.locator('.team-tab[data-index="1"]').tap();
  for(const viewport of [{width:390,height:844},{width:375,height:667}]) {
    await settleViewport(cPage, viewport);
    await cPage.screenshot({path:resolve(root,'screenshots/phase-c1-team-'+viewport.width+'x'+viewport.height+'.png')});
    assert.equal(await cPage.locator('#teamContent .roster-card').count(),10);
    assert.equal(await cPage.locator('#teamContent header').count(),1);
    assert(await cPage.evaluate(() => document.querySelector('#team').scrollWidth <= innerWidth),'編成画面が横にはみ出さない');
    assert((await cPage.locator('.slot').first().getAttribute('aria-label')).includes('リーダー'));
  }
  const teams=await cPage.evaluate(()=>RUNE_DEBUG.save.teams);
  await cPage.reload();await cPage.locator('#startBtn').click();
  assert.deepEqual(await cPage.evaluate(()=>RUNE_DEBUG.save.teams),teams,'3編成が再起動後も保存される');
  for(const viewport of [{width:390,height:844},{width:375,height:667}]) {
    await settleViewport(cPage, viewport);
    await cPage.screenshot({path:resolve(root,'screenshots/phase-c1-home-'+viewport.width+'x'+viewport.height+'.png')});
    await cPage.locator('#homeRosterBtn').click();await cPage.locator('#rosterContent .roster-card[data-id="crow"]').click();
    await cPage.screenshot({path:resolve(root,'screenshots/phase-c1-detail-'+viewport.width+'x'+viewport.height+'.png')});
    assert((await cPage.locator('#detailContent').textContent()).includes('10コンボ以上で攻撃6倍'));
    await cPage.locator('#detailBackBtn').click();await cPage.locator('#rosterHomeBtn').click();
  }
  await cPage.setViewportSize({width:390,height:844});
  await cPage.locator('#homeAdventureBtn').click();await cPage.locator('#dungeonList .dcard').first().click();
  await cPage.waitForFunction(()=>RUNE_DEBUG.phase==='input');
  assert.deepEqual(await cPage.evaluate(()=>RUNE_DEBUG.state.party.map(m=>m.id)),['kagura','shizuku','tsubaki','hikari','crow']);
  const actualTeam=await cPage.evaluate(()=>({hp:RUNE_DEBUG.state.teamMax,rcv:RUNE_DEBUG.state.rcv}));
  const prepared=await cPage.evaluate(()=>RUNE_DEBUG.logic.prepareTeam(RUNE_DEBUG.save));
  assert.equal(actualTeam.hp,prepared.teamMax);assert.equal(actualTeam.rcv,prepared.rcv);
  for(let member=0;member<5;member++) {
    const point=await cPage.evaluate(member=>{
      const d=RUNE_DEBUG;d.state.party[member].cd=0;d.setSeed(77);
      window.skillExpected=d.logic.resolveSkill(d.snapshot(),{member},d.logic.makeRngs(77)).next;
      return d.visuals.layout.icons[member];
    },member);
    await cPage.mouse.click(point.x,point.y);
    await cPage.getByRole('button',{name:'使う',exact:true}).click();
    await cPage.waitForFunction(()=>RUNE_DEBUG.phase==='input');
    const observed=await cPage.evaluate(()=>RUNE_DEBUG.snapshot()),expected=await cPage.evaluate(()=>window.skillExpected);
    for(const key of ['board','party','enemies','buffs','timeBonus','moveTime'])assert.deepEqual(observed[key],expected[key],'新スキル'+member+'の演出と計算の一致 '+key);
  }
  await cPage.screenshot({path:resolve(root,'screenshots/phase-c1-new-party-390x844.png')});
  await clearCurrent();
  console.log('PASS: 3編成保存・仲間10体・全5新スキル発動・新編成でダンジョン1 CLEAR');

  // C中盤の妨害: ロック入力・毒ダメージ・暗闇の実際の盤面受け渡しを確認。
  await cPage.locator('#toSelectBtn').click();await cPage.locator('#homeAdventureBtn').click();await cPage.locator('#dungeonList .dcard').first().click();
  await cPage.waitForFunction(()=>RUNE_DEBUG.phase==='input');
  for(const viewport of [{width:390,height:844},{width:375,height:667}]) {
    await settleViewport(cPage,viewport);
    const points=await cPage.evaluate(()=>{
      const d=RUNE_DEBUG,l=d.visuals.layout;
      let board=d.logic.makeBoard(false,d.logic.mulberry32(5));
      board=d.logic.applyRuneCondition(board,'lock',[[2,2]]);
      board=d.logic.applyRuneCondition(board,'poison',[[0,0],[0,1],[0,2]]);
      board=d.logic.applyRuneCondition(board,'dark',[[4,0],[4,1],[4,2],[4,3],[4,4],[4,5],[4,6],[5,0]]);
      d.setBoard(board);d.state.teamHp=d.state.teamMax;d.view.teamHp=d.state.teamMax;
      for(const e of d.state.enemies){e.hp=e.maxHp=1e9;e.atk=0;e.cd=e.turn=99;e.v.hp=e.v.ghost=e.hp;}
      return [0,1,2,4].map(c=>({x:l.bx+(c+.5)*l.cell,y:l.by+2.5*l.cell}));
    });
    const original=await cPage.evaluate(()=>JSON.stringify(RUNE_DEBUG.view.board));
    await cPage.mouse.move(points[2].x,points[2].y);await cPage.mouse.down();
    await cPage.mouse.move(points[3].x,points[3].y);await cPage.mouse.up();
    assert.equal(await cPage.evaluate(()=>JSON.stringify(RUNE_DEBUG.view.board)),original,'ロックをつかめない');
    await cPage.screenshot({path:resolve(root,'screenshots/phase-c2-runes-'+viewport.width+'x'+viewport.height+'.png')});
    await cPage.mouse.move(points[0].x,points[0].y);await cPage.mouse.down();await cPage.mouse.move(points[3].x,points[3].y);
    const moved=await cPage.evaluate(()=>{
      const d=RUNE_DEBUG;
      
      d.setSeed(77);
      const board=d.view.board.map(row=>row.map(o=>({c:o.c,p:o.p,...d.logic.runeFlags(o)})));
      window.hazardExpected=d.logic.resolveTurn({...d.snapshot(),board},{},d.logic.makeRngs(77)).next;
      return {lockMoved:board[2][1].lock===true,heldFree:!board[2][4].lock,from:board[2][0].c,turns:d.state.stats.turns};
    });
    assert.equal(moved.lockMoved,true,'通過した鎖は入れ替わって前のマスへ');
    assert.equal(moved.heldFree,true,'つかんだルーンは鎖を通り抜ける');
    await cPage.mouse.up();
    await cPage.waitForFunction(last=>RUNE_DEBUG.state.stats.turns>last&&RUNE_DEBUG.phase==='input',moved.turns,{timeout:30000});
    const observed=await cPage.evaluate(()=>RUNE_DEBUG.snapshot()),expected=await cPage.evaluate(()=>window.hazardExpected);
    assert.deepEqual(observed.board,expected.board,'実入力でも状態が計算と一致');
    assert.equal(observed.teamHp,expected.teamHp,'毒ダメージが計算と一致');
    assert(observed.teamHp<observed.teamMax);
    await cPage.evaluate(()=>{
      const d=RUNE_DEBUG,base=d.logic.makeBoard(false,d.logic.mulberry32(5));
      d.setBoard(d.logic.applyRuneCondition(base,'dark',[[1,1],[2,3]]));
    });
    for(let turn=1;turn<=2;turn++) {
      const previous=await cPage.evaluate(()=>{const d=RUNE_DEBUG,last=d.state.stats.turns;d.resolve();return last;});
      await cPage.waitForFunction(last=>RUNE_DEBUG.state.stats.turns>last&&RUNE_DEBUG.phase==='input',previous,{timeout:15000});
      assert.equal(await cPage.evaluate(()=>RUNE_DEBUG.view.board[1][1].dark||0),2-turn,'暗闇が2回で解除される');
    }
  }
  console.log('PASS: ロックの実入力・毒ダメージ・暗闇2ターン・両画面サイズ');


  // 制御した敵を同じ戦闘・同じ出来事再生へ入れ、計算結果と表示が一致するか確認。
  for(const skill of [
    {id:'lock',when:'turn:1'}, {id:'poison',when:'turn:1'}, {id:'dark',when:'turn:1'},
    {id:'absorb',when:'turn:1',attr:0}, {id:'comboAbsorb',when:'turn:1',min:7},
    {id:'damageCap',when:'turn:1',limit:1000}, {id:'endure',when:'turn:1'}, {id:'regen',when:'turn:1'},
    {id:'transform',when:'depleted',to:{hpRate:.25,attr:0,atk:0,turn:99,phaseName:'第二形態',form:2}},
    {id:'attrChange',when:'every:3'}
  ]) {
    const turn=await cPage.evaluate(skill=>{
      const d=RUNE_DEBUG,old=d.state.enemies[0],base=d.logic.makeBoard(false,d.logic.mulberry32(5));
      d.setBoard(base);d.state.teamHp=d.state.teamMax;
      d.state.enemies[0]={kind:old.kind,name:'検証用の敵',attr:2,hp:490000,maxHp:1000000,atk:0,def:0,
        turn:99,cd:99,acts:0,boss:false,enraged:false,elapsed:skill.id==='attrChange'?2:0,skills:[skill],v:old.v};
      if(skill.id==='transform'){const {v,...enemy}=d.state.enemies[0];Object.assign(d.state.enemies[0],d.logic.hitEnemy(enemy,999999,{attr:0,combos:10}).enemy);}
      Object.assign(old.v,{hp:d.state.enemies[0].hp,maxHp:1000000,ghost:d.state.enemies[0].hp,form:1,dead:false,dying:false,alpha:1,statuses:{},attr:2,phaseName:''});
      d.state.enemies.slice(1).forEach(e=>{e.hp=0;e.v.dead=true;});
      d.setSeed(77);
      window.enemyExpected=d.logic.resolveTurn(d.snapshot(),{},d.logic.makeRngs(77));
      const last=d.state.stats.turns;d.resolve();return last;
    },skill);
    await cPage.waitForFunction(last=>RUNE_DEBUG.state.stats.turns>last&&RUNE_DEBUG.phase==='input',turn,{timeout:20000});
    const check=await cPage.evaluate(()=>{
      const d=RUNE_DEBUG,expected=window.enemyExpected,enemy=d.state.enemies[0];
      return {board:d.snapshot().board,view:d.view.board.map(row=>row.map(o=>({c:o.c,p:o.p,...d.logic.runeFlags(o)}))),
        enemy:{attr:enemy.attr,hp:enemy.hp,form:enemy.form||1,statuses:enemy.statuses||{}},
        display:{attr:enemy.v.attr,hp:enemy.v.hp,statuses:enemy.v.statuses||{}},
        expected:{board:expected.next.board,enemy:{attr:expected.next.enemies[0].attr,hp:expected.next.enemies[0].hp,
          form:expected.next.enemies[0].form||1,statuses:expected.next.enemies[0].statuses||{}}},
        events:expected.events.map(e=>e.id || e.t)};
    });
    assert(check.events.includes(skill.id),skill.id+'の技イベント');
    assert.deepEqual(check.board,check.expected.board);
    assert.deepEqual(check.view,check.expected.board,skill.id+'の盤面表示');
    assert.deepEqual(check.enemy,check.expected.enemy);
    assert.equal(check.display.attr,check.enemy.attr);
    assert.equal(check.display.hp,check.enemy.hp);
    assert.deepEqual(check.display.statuses,check.enemy.statuses);
  }
  // 吸収・コンボ不足・上限・根性・再生の着弾後の表示も実際のターンを通す。
  for(const kind of ['absorb','comboAbsorb','damageCap','endure','regen']) {
    const turn=await cPage.evaluate(kind=>{
      const d=RUNE_DEBUG,e=d.state.enemies[0];
      window.enemyFullParty ||= d.state.party;
      d.state.party=kind==='endure'?[window.enemyFullParty[0]]:window.enemyFullParty;
      const statuses={
        absorb:{absorb:{attr:d.state.party[0].attr,turns:3}},
        comboAbsorb:{comboAbsorb:{min:999,turns:3}},
        damageCap:{damageCap:{limit:1000,turns:null}},
        endure:{endure:{from:.5,used:false,turns:null}},
        regen:{regen:{rate:.05,turns:null}}
      };
      e.hp=kind==='endure'?1000:500000;e.maxHp=kind==='endure'?1000:1000000;e.skills=[];e.statuses=statuses[kind];
      e.endureUsed=false;e.cd=99;e.atk=0;
      e.v.hp=e.hp;e.v.maxHp=e.maxHp;e.v.ghost=e.hp;e.v.statuses=d.logic.cloneData(e.statuses);e.v.dead=false;e.v.dying=false;
      // 根性の後続攻撃で即死しないよう、このケースでは1体だけが攻撃する盤面。
      const base=d.logic.makeBoard(false,d.logic.mulberry32(5));
      if(kind==='endure')for(let c=0;c<3;c++)base[0][c]={c:d.state.party[0].attr,p:false};
      else for(let r=0;r<6;r++)for(let c=0;c<7;c++)base[r][c]={c:r,p:false};
      d.setBoard(base);d.state.teamHp=d.state.teamMax;
      if(kind==='endure')d.state.od.active=false;
      d.setSeed(77);window.enemyExpected=d.logic.resolveTurn(d.snapshot(),{},d.logic.makeRngs(77));
      const last=d.state.stats.turns;d.resolve();return last;
    },kind);
    await cPage.waitForFunction(last=>RUNE_DEBUG.state.stats.turns>last&&RUNE_DEBUG.phase==='input',turn,{timeout:20000});
    const values=await cPage.evaluate(()=>{
      const d=RUNE_DEBUG,e=d.state.enemies[0],expected=window.enemyExpected;
      return {hp:e.hp,display:e.v.hp,expected:expected.next.enemies[0].hp,events:expected.events.map(e=>e.t)};
    });
    assert.equal(values.hp,values.expected);assert.equal(values.display,values.expected);
    if(kind==='absorb')assert(values.events.includes('absorbed'));
    if(kind==='endure'){assert(values.events.includes('endured'));assert.equal(values.hp,1);}
    if(kind==='regen')assert(values.events.includes('enemyRegen'));
  }
  const preempt=await cPage.evaluate(async()=>{
    const d=RUNE_DEBUG,e=d.state.enemies[0];
    d.setBoard(d.logic.makeBoard(false,d.logic.mulberry32(5)));
    e.skills=[{id:'lock',when:'preempt'}];e.skillUsed={};e.preemptDone=false;
    const turns=d.state.stats.turns;await d.preempt();
    const first=d.snapshot().board.filter(row=>row).flat().filter(o=>o.lock).length;
    await d.preempt();
    return {turns,before:turns,after:d.state.stats.turns,first,second:d.snapshot().board.flat().filter(o=>o.lock).length,
      display:d.view.board.flat().filter(o=>o.lock).length,phase:d.phase};
  });
  assert.equal(preempt.first,6);assert.equal(preempt.second,6);assert.equal(preempt.display,6);
  assert.equal(preempt.after,preempt.before);assert.equal(preempt.phase,'input');
  await cPage.evaluate(()=>{
    const d=RUNE_DEBUG,e=d.state.enemies[0];e.statuses={absorb:{attr:0,turns:3},comboAbsorb:{min:7,turns:3},damageCap:{limit:1000,turns:null},endure:{from:.5,used:false,turns:null},regen:{rate:.05,turns:null}};
    e.v.statuses=d.logic.cloneData(e.statuses);e.v.phaseName='状態アイコン検証';e.v.cd=2;
  });
  for(const viewport of [{width:390,height:844},{width:375,height:667}]) {
    await settleViewport(cPage,viewport);
    await cPage.screenshot({path:resolve(root,'screenshots/phase-c2-enemy-'+viewport.width+'x'+viewport.height+'.png')});
  }
  console.log('PASS: 敵の全10技と先制・着弾後の吸収／上限／根性／再生・状態表示の一致');
  await c1.close();

  await smokeDungeons(browser,url,root,errors);
  assert.deepEqual(errors, [], 'ブラウザのエラーが0件');
  console.log('PASS: ダンジョン1を両盤面サイズでクリア。エラー0件。');
  console.log(JSON.stringify(reports, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
}
