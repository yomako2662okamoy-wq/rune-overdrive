import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// 最大Lvの検証セーブと確定盤面で、実際の敵データ・技・報酬・進行を通す。
// 難易度調整のシミュレーターではない。敵HP・攻撃・行動は変更しない。
export async function smokeDungeons(browser,url,root,errors) {
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
  await context.route('**/*',route=>route.request().url().startsWith(url+'/')?route.continue():route.fulfill({status:200,contentType:'text/css',body:''}));
  const page=await context.newPage();
  page.on('pageerror',error=>{errors.push('dungeons: '+error.message);console.error(error.stack);});
  page.on('console',message=>{if(message.type()==='error')errors.push('dungeons: '+message.text());});
  await page.addInitScript(()=>{
    Date.now=()=>1720000000000;
    localStorage.setItem('rune-overdrive-save-v1',JSON.stringify({
      settings:{board:'7x6',speed:'fastest',shake:false,flash:true,sfx:false,bgm:false},
      cleared:{d1:true,d2:true,d3:true},best:{},tutorial:true,
    }));
  });
  const shots=async name=>{
    mkdirSync(resolve(root,'screenshots'),{recursive:true});
    for(const viewport of [{width:390,height:844},{width:375,height:667}]) {
      await page.setViewportSize(viewport);
      await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
      assert(await page.evaluate(()=>{
        const active=document.querySelector('.screen:not(.hidden)');
        return !active || active.scrollWidth<=innerWidth;
      }),'画面が横にはみ出さない');
      await page.screenshot({path:resolve(root,'screenshots/phase-c2-'+name+'-'+viewport.width+'x'+viewport.height+'.png')});
    }
  };
  async function playToClear() {
    const floors=new Set(),forms=new Set();
    for(let turn=0;turn<80;turn++) {
      const before=await page.evaluate(()=>({phase:RUNE_DEBUG.phase,floor:RUNE_DEBUG.state.floor,form:RUNE_DEBUG.state.enemies[0]?.form||1}));
      if(await page.locator('#result').isVisible())break;
      assert.equal(before.phase,'input');
      floors.add(before.floor);forms.add(before.form);
      const healing=await page.evaluate(()=>{
        const d=RUNE_DEBUG,m=d.state.party.findIndex(m=>m.id==='ruka');
        return d.state.teamHp<d.state.teamMax*.65 && m>=0 && d.state.party[m].cd===0 ? d.visuals.layout.icons[m]:null;
      });
      if(healing) {
        await page.mouse.click(healing.x,healing.y);
        await page.getByRole('button',{name:'使う',exact:true}).click();
        await page.waitForFunction(()=>RUNE_DEBUG.phase==='input',null,{timeout:15000});
      }
      const last=await page.evaluate(turn=>{
        const d=RUNE_DEBUG,before=d.snapshot().board,boss=d.state.enemies.some(e=>e.hp>0&&e.boss);
        const colors=boss
          ? Array.from({length:5},(_,r)=>[2*r%6,2*r%6,2*r%6,(2*r+1)%6,(2*r+1)%6,(2*r+1)%6,(2*r+2)%6]).concat([[0,1,2,3,4,5,0]])
          : Array.from({length:6},(_,r)=>[...Array(3).fill(r%2===0?0:2),...Array(3).fill(r%2===0?1:3),r<3?4:5]);
        // 鎖・暗闇・残存毒は消さず、色の配置だけをRUNE_DEBUGで用意する。
        d.setBoard(colors.map((row,r)=>row.map((color,c)=>({
          c:before[r][c].c===6?6:color,p:before[r][c].c===6?false:d.state.od.active,...d.logic.runeFlags(before[r][c])
        }))));
        d.setSeed(799+turn);
        const last=d.state.stats.turns;d.resolve();return last;
      },turn);
      await page.waitForFunction(last=>RUNE_DEBUG.state.stats.turns>last&&(RUNE_DEBUG.phase==='input'||RUNE_DEBUG.scene==='result'),last,{timeout:30000});
    }
    assert.equal(await page.locator('#resTitle').textContent(),'CLEAR!','HPを変更せず新ダンジョンを最後まで通す');
    if(await page.locator('#skipRewardsBtn').isVisible())await page.locator('#skipRewardsBtn').click();
    await page.waitForFunction(()=>document.querySelector('#skipRewardsBtn').classList.contains('hidden'));
    const result=await page.evaluate(()=>({id:RUNE_DEBUG.state.dungeon.id,floors:RUNE_DEBUG.state.dungeon.floors.length,stats:RUNE_DEBUG.state.stats,
      record:RUNE_DEBUG.save.dungeons[RUNE_DEBUG.state.dungeon.id],rewards:RUNE_DEBUG.state.rewards,save:RUNE_DEBUG.save}));
    assert.equal(floors.size,result.floors,'全フロアを通る');
    assert.deepEqual(result.record.stars,[true,true,true]);
    assert.equal(await page.locator('.star-card.earned').count(),3);
    return {...result,forms:[...forms]};
  }
  try {
    await page.goto(url+'/?debug=1');await page.locator('#startBtn').click();await page.locator('#homeAdventureBtn').click();
    assert.equal(await page.locator('#dungeonList .dcard').count(),8);
    assert.equal(await page.locator('#dungeonList .dcard').nth(3).isDisabled(),false);
    assert.equal(await page.locator('#dungeonList .dcard').nth(4).isDisabled(),true);
    assert((await page.locator('#dungeonList .dcard').nth(3).textContent()).includes('推奨Lv 24（いまLv1）'));
    await page.locator('#dungeonList .dcard').nth(3).scrollIntoViewIfNeeded();
    await shots('select-lowlevel');
    const fixture=await page.evaluate(()=>{const data=RUNE_DEBUG.save;for(const m of Object.values(data.roster))m.lv=50;return data;});
    await page.locator('#selSettingsBtn').click();
    await page.getByRole('button',{name:'セーブを読み込む',exact:true}).click();
    await page.getByRole('textbox',{name:'読み込むセーブデータ'}).fill(JSON.stringify(fixture));
    await page.getByRole('button',{name:'このセーブを読み込む',exact:true}).click();
    await page.getByRole('button',{name:'設定へ戻る',exact:true}).click();
    await page.getByRole('button',{name:'閉じる',exact:true}).click();
    for(const index of [3,4,5,6,7]) {
      assert.equal(await page.locator('#dungeonList .dcard').nth(index).isDisabled(),false,'前ダンジョンのクリアで解放');
      await page.locator('#dungeonList .dcard').nth(index).click();
      await page.waitForFunction(()=>RUNE_DEBUG.phase==='input',null,{timeout:20000});
      const intro=await page.evaluate(()=>({board:RUNE_DEBUG.snapshot().board,status:RUNE_DEBUG.state.enemies[0].statuses,turns:RUNE_DEBUG.state.stats.turns}));
      assert.equal(intro.turns,0,'先制はターンを消費しない');
      if(index===3||index===7)assert.equal(intro.board.flat().filter(o=>o.lock).length,6);
      if(index===4){assert(intro.board.flat().some(o=>o.c===6));assert(intro.board.flat().every(o=>o.c!==5));}
      if(index===5)assert.equal(intro.board.flat().filter(o=>o.dark===2).length,8);
      if(index===6)assert.deepEqual(intro.status.absorb,{attr:0,turns:3});
      await shots('d'+(index+1)+'-intro');
      const result=await playToClear();
      assert.equal(result.rewards.crystalFirst,30);assert.equal(result.rewards.starCrystal,30);
      const joined=['tsubaki','hikari','crow'][index-3];
      if(joined) {
        assert.deepEqual(result.rewards.joined,[joined]);
        assert.equal(result.save.roster[joined].lv,1);
        assert.equal(await page.locator('.join-card').count(),1);
      } else assert.deepEqual(result.rewards.joined,[]);
      const once=await page.evaluate(()=>RUNE_DEBUG.save);
      await page.locator('.reward-stars').scrollIntoViewIfNeeded();await shots('d'+(index+1)+'-result');
      await page.locator('#toSelectBtn').click();assert.deepEqual(await page.evaluate(()=>RUNE_DEBUG.save),once,'結果の表示で二重付与しない');
      console.log('PASS: '+result.id+' 全'+result.floors+'フロア CLEAR・★3・初回結晶60'+(joined?'・加入 '+joined:'')+'／'+result.stats.turns+'ターン／形態 '+result.forms.join(','));
      await page.locator('#homeAdventureBtn').click();
    }
    const completed=await page.evaluate(()=>RUNE_DEBUG.save);
    await page.reload();await page.locator('#startBtn').click();await page.locator('#homeAdventureBtn').click();
    assert.deepEqual(await page.evaluate(()=>RUNE_DEBUG.save),completed,'再起動後に全ダンジョンの★と加入・結晶が残る');
    assert.equal(await page.locator('.star-line').count(),8);
    assert((await page.locator('#dungeonList .dcard').nth(7).textContent()).includes('★★★'));
    await page.locator('#dungeonList .dcard').nth(7).scrollIntoViewIfNeeded();await shots('select-complete');
    await page.locator('#dungeonList .dcard').nth(3).click();
    await page.waitForFunction(()=>RUNE_DEBUG.phase==='input');
    const repeat=await playToClear();
    assert.equal(repeat.rewards.crystal,0);assert.equal(repeat.save.crystal,completed.crystal);
    assert.deepEqual(repeat.rewards.joined,[]);
    console.log('PASS: ★・3体の加入が保存され、d4再クリアの結晶と加入は重複しない');
  } finally {await context.close();}
}
