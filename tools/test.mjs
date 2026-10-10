import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { loadLogic, loadSaveAdapter, loadQualityPolicy, plain } from './load-logic.mjs';

const { logic, config, chars, dungeons } = loadLogic();
function game(overrides = {}) {
  const party = plain(logic.makeParty(chars.slice(0,5)));
  return {
    rules: plain(config),
    board: plain(logic.makeBoard(false, logic.mulberry32(71), config)), party,
    teamMax: 7800, teamHp: 5000, rcv: 810, target: -1, timeBonus: 0, moveTime: 5,
    enemies: [{ attr: 2, hp: 10000000, maxHp: 10000000, def: 150, atk: 700, turn: 2, cd: 2, acts: 0, boss: false, enraged: false }],
    od: { active: false, chain: 0 }, stats: { maxCombo: 0, totalDmg: 0, turns: 0, ods: 0 },
    ...overrides,
  };
}
function tenGroups() {
  const board = Array.from({ length: 5 }, (_, r) => [2 * r % 6, 2 * r % 6, 2 * r % 6, (2 * r + 1) % 6, (2 * r + 1) % 6, (2 * r + 1) % 6, (2 * r + 2) % 6]);
  board.push([0, 1, 2, 3, 4, 5, 0]);
  return board.map((row) => row.map((c) => ({ c, p: false })));
}
function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

test('L字・T字・十字の同色のつながりを1コンボにする', () => {
  for (const [name, cells] of [
    ['L', [[1,1],[2,1],[3,1],[3,2],[3,3]]],
    ['T', [[1,1],[1,2],[1,3],[2,2],[3,2]]],
    ['cross', [[1,2],[2,1],[2,2],[2,3],[3,2]]],
  ]) {
    const board = Array.from({ length: 6 }, () => Array(7).fill(null));
    for (const [r,c] of cells) board[r][c] = { c: 0, p: r === 2 };
    const groups = plain(logic.findGroups(board));
    assert.equal(groups.length, 1, name);
    assert.equal(groups[0].cells.length, 5, name);
    assert.equal(groups[0].shape, name === 'cross' ? 'cross' : '');
    assert.equal(groups[0].plus, cells.filter(([r]) => r === 2).length);
  }
});

test('落下・補充は空きを残さず、元の順序と強化を保ち、連鎖上限から復旧する', () => {
  for (const [rows,cols] of [[6,7],[5,6]]) {
    const board = Array.from({ length: rows }, () => Array(cols).fill(null));
    for (let c=0;c<cols;c++) { board[1][c]={c:c%6,p:true}; board[rows-2][c]={c:(c+1)%6,p:false}; }
    const before=JSON.stringify(board);
    const result=logic.fall(board,true,logic.mulberry32(32),{...config,ROWS:rows,COLS:cols,OD_REFILL_BIAS:rows===6?.3:.4});
    assert.equal(JSON.stringify(board),before,'元の盤面を変えない');
    for (let c=0;c<cols;c++) {
      assert.deepEqual(plain(result.board[rows-2][c]),board[1][c]);
      assert.deepEqual(plain(result.board[rows-1][c]),board[rows-2][c]);
      assert.equal(result.from[rows-2][c],1);
      assert.equal(result.from[rows-1][c],rows-2);
      assert.notEqual(result.board[rows-1][c],board[rows-2][c],'元セルとの参照を共有しない');
      for(let r=0;r<rows-2;r++) assert.equal(result.board[r][c].p,true);
    }
    assert(result.board.flat().every((o)=>o&&o.c>=0&&o.c<6));
  }
  const initial=game({board:tenGroups()});
  const result=logic.resolveTurn(initial,{}, {board:()=>0,enemy:()=>.5});
  assert.equal(result.events.filter((e)=>e.t==='fall').length,config.MAX_WAVES);
  assert.equal(result.events.filter((e)=>e.t==='reshuffle').length,1);
  assert.equal(logic.findGroups(result.next.board).length,0);
});

test('10コンボ目でODが発動し、3ターン継続後に止まる', () => {
  const board=tenGroups();
  assert.equal(logic.findGroups(board).length,10,'初期盤面の10グループ');
  let current=game({board,enemies:[]});
  for(let turn=1;turn<=4;turn++) {
    const result=logic.resolveTurn(current,{board},logic.makeRngs(17));
    if(turn<=3) {
      const pos=result.events.findIndex((e)=>e.t==='od');
      assert(pos>0);
      assert.equal(result.events[pos-1].t,'pop');
      assert.equal(result.events[pos-1].combo,10);
      assert.equal(result.events[pos].extend,turn>1);
      assert.equal(result.next.od.active,true);
      assert.equal(result.next.od.chain,turn);
      assert(result.next.board.flat().every((o)=>o.p));
    } else {
      assert.equal(result.events.some((e)=>e.t==='od'),false);
      assert.equal(result.next.od.active,false);
      assert.equal(result.next.od.chain,0);
    }
    current=result.next;
  }
  const noCombo=game({od:{active:true,chain:1}});
  const stopped=logic.resolveTurn(noCombo,{},logic.makeRngs(3));
  assert.equal(stopped.next.od.active,false,'10コンボに届かないターンは止まる');
});

test('初版4.3の共通ダメージ式で30,937になり、防御とクロスが効く', () => {
  const groups=[{cells:[[0,0],[0,1],[0,2]],plus:0,shape:''},{cells:[[2,0],[2,1],[2,2],[2,3]],plus:0,shape:''}];
  const member={attr:0,atk:1000}, context={combos:8,leaderMult:2.5,od:false,resonance:false,prism:false};
  assert.equal(logic.attackDamage(member,groups,context,{attr:2,def:0}),30937);
  assert.equal(logic.attackDamage(member,groups,context,{attr:2,def:100}),30837);
  assert.equal(logic.attackDamage(member,groups,context,{attr:2,def:100000}),1);
  groups[0].shape='cross';
  assert.equal(logic.attackDamage(member,groups,context,{attr:2,def:100000}),30937);
  assert.equal(logic.attrMult(0,2),2);
  assert.equal(logic.attrMult(0,1),.5);
  assert.equal(logic.attrMult(3,4),2);
  assert.equal(logic.attrMult(4,3),2);
});

test('同じ種・入力で同じ結果になり、入力を変更せず、敵乱数を盤面と分離する', () => {
  const initial=deepFreeze(game({board:tenGroups()})), input=deepFreeze({board:tenGroups(),target:0});
  const before=JSON.stringify({initial,input});
  const a=plain(logic.resolveTurn(initial,input,logic.makeRngs(998)));
  const b=plain(logic.resolveTurn(initial,input,logic.makeRngs(998)));
  assert.deepEqual(a,b);
  assert.equal(JSON.stringify({initial,input}),before);
  const randomA=logic.makeRngs(998),randomB=logic.makeRngs(998);
  for(let i=0;i<100;i++)randomB.enemy();
  const c=plain(logic.resolveTurn(initial,input,randomA)),d=plain(logic.resolveTurn(initial,input,randomB));
  assert.deepEqual(c.next.board,d.next.board,'敵の乱数消費では補充が変わらない');
  assert.deepEqual(c.events.filter(e=>['pop','fall','od','odWave','total'].includes(e.t)),d.events.filter(e=>['pop','fall','od','odWave','total'].includes(e.t)));
  for(const [i,type] of ['convert','time','refresh','heal','delay'].entries()) {
    const ready=game();ready.party.forEach(m=>m.cd=0);
    ready.board[0][0]={c:5,p:true};
    const frozen=deepFreeze(ready),original=JSON.stringify(frozen);
    const result=logic.resolveSkill(frozen,{member:i},logic.makeRngs(99));
    assert.equal(JSON.stringify(frozen),original,type+'で入力を変更しない');
    assert.equal(result.next.party[i].cd,ready.party[i].skill.turns);
    if(type==='convert')assert.equal(result.next.board[0][0].c,0);
    if(type==='time')assert.equal(result.next.moveTime,8);
    if(type==='refresh')assert.equal(logic.findGroups(result.next.board).length,0);
    if(type==='heal')assert.equal(result.next.teamHp,7800);
    if(type==='delay')assert.equal(result.next.enemies[0].cd,4);
  }
});

test('v1をv2へ安全に移行し、報酬の重複を防ぎ、書き出し・読み込みと保存失敗を扱う', () => {
  const legacy={settings:{speed:'fast',board:'6x5',shake:false,flash:true,sfx:false,bgm:false},cleared:{d1:true,d2:true,d3:true},best:{'d1:7x6':12,'d1:6x5':9,'d3:7x6':20},tutorial:true};
  const before=JSON.stringify(legacy), migrated=plain(logic.migrateSave(legacy));
  assert.equal(JSON.stringify(legacy),before);
  assert.equal(migrated.version,2);
  assert.equal(migrated.settings.board,'6x5');
  assert.equal(migrated.settings.speed,'fast');
  assert.equal(migrated.seen.tutorial,true);
  assert.deepEqual(migrated.dungeons.d1.best,{'6x5':9,'7x6':12});
  assert.equal(migrated.dungeons.d3.cleared,true);
  assert.equal(migrated.crystal,90);
  for(const id of ['akane','mizuha','yomogi','ruka','nocto','kagura','shizuku'])assert.deepEqual(migrated.roster[id],{lv:1,exp:0,skillLv:1});
  assert.deepEqual(plain(logic.parseSave(JSON.stringify(migrated))),migrated,'再読込で報酬が増えない');
  assert.throws(()=>logic.parseSave('{"version":99}'));
  assert.throws(()=>logic.parseSave('{}'));
  function storage(fail=false, wrongReadback=false) {
    const values=new Map([['rune-overdrive-save-v1',JSON.stringify(legacy)]]), ops=[];
    return {values,ops,
      getItem(key){ops.push(['get',key]); if(wrongReadback&&key.endsWith('-v2'))return null;return values.get(key)||null;},
      setItem(key,value){ops.push(['set',key]);if(fail)throw new Error('quota');values.set(key,value);},
      removeItem(key){ops.push(['remove',key]);values.delete(key);},
    };
  }
  const ok=storage(), adapter=loadSaveAdapter(ok);
  assert.deepEqual(plain(adapter.saveData),migrated);
  assert.equal(ok.values.has('rune-overdrive-save-v1'),false);
  const setAt=ok.ops.findIndex(op=>op[0]==='set'), removeAt=ok.ops.findIndex(op=>op[0]==='remove');
  assert(removeAt>setAt);
  assert(ok.ops.slice(setAt+1,removeAt).some(op=>op[0]==='get'&&op[1]==='rune-overdrive-save-v2'),'検証してから旧キーを消す');
  const failed=storage(true), unable=loadSaveAdapter(failed);
  assert.equal(unable.saveData.dungeons.d1.cleared,true);
  assert.equal(unable.writeSave(),false);
  assert(failed.values.has('rune-overdrive-save-v1'));
  const wrong=storage(false,true);loadSaveAdapter(wrong);
  assert(wrong.values.has('rune-overdrive-save-v1'),'書き込みを確認できなければ旧キーを残す');
  const other=storage();other.values.clear();
  const imported=loadSaveAdapter(other);
  imported.importSaveText(JSON.stringify(migrated));
  assert.deepEqual(plain(imported.saveData),migrated,'別の保存先へ移せる');
  const original=JSON.stringify(imported.saveData);
  assert.throws(()=>imported.importSaveText('invalid json'));
  assert.equal(JSON.stringify(imported.saveData),original);
  const denied=loadSaveAdapter({getItem(){throw new Error('denied');},setItem(){throw new Error('denied');},removeItem(){throw new Error('denied');}});
  assert.equal(denied.saveData.version,2);
  assert.equal(denied.writeSave(),false);
  const unknown=storage();unknown.values.set('rune-overdrive-save-v2','{"version":99}');
  const protectedSave=loadSaveAdapter(unknown);protectedSave.writeSave();
  assert.equal(unknown.values.get('rune-overdrive-save-v2'),'{"version":99}');
});

test('育成の必要経験値・連続レベルアップ・能力・上限・スキル強化が指示書4.1と一致する', () => {
  assert.equal(logic.expNeeded(1),100); assert.equal(logic.expNeeded(10),3162); assert.equal(logic.expNeeded(49),34300);
  assert.equal(Array.from({length:49},(_,i)=>logic.expNeeded(i+1)).reduce((a,b)=>a+b,0),689513);
  const growth=logic.gainExperience(deepFreeze({lv:1,exp:99,skillLv:1}),1);
  assert.deepEqual(plain(growth.after),{lv:2,exp:0,skillLv:1});
  const max=logic.gainExperience({lv:1,exp:0,skillLv:2},689513);
  assert.equal(max.after.lv,50);assert.equal(max.after.exp,0);assert.equal(max.levels.length,49);
  assert.equal(logic.gainExperience({lv:50,exp:0,skillLv:1},9999).after.exp,0);
  for(const lv of [1,20,50]) {
    const member=logic.growCharacter(chars[0],{lv,exp:7,skillLv:3});
    const atkBoost={1:1,20:1.21,50:1.7602475}[lv];
    for(const stat of ['hp','atk','rcv'])assert.equal(member[stat],Math.round(chars[0][stat]*(1+.03*(lv-1))*(stat==='atk'?atkBoost:1)));
    assert.equal(member.skill.turns,lv<20?4:3);
  }
  const saved=logic.createSave();saved.crystal=110;
  const upgraded=logic.upgradeSkill(deepFreeze(saved),'akane');
  assert.equal(upgraded.cost,30);assert.equal(upgraded.next.crystal,80);assert.equal(saved.crystal,110);
  const maxSkill=logic.upgradeSkill(upgraded.next,'akane');
  assert.equal(maxSkill.next.crystal,0);assert.equal(maxSkill.next.roster.akane.skillLv,3);
  assert.throws(()=>logic.upgradeSkill(maxSkill.next,'akane'));
  assert.throws(()=>logic.upgradeSkill(logic.createSave(),'akane'));
  assert.throws(()=>logic.upgradeSkill(saved,'crow'));
  assert.equal(logic.makeParty([chars[2]],{yomogi:{lv:1,exp:0,skillLv:3}})[0].skill.turns,2);
});

test('倒した敵だけの経験値を全参加者へ与え、初クリア結晶は一度だけで、全滅でも倒した分を受け取る', () => {
  const initial=game({board:tenGroups(),enemies:[{attr:2,hp:1,maxHp:4000,def:0,atk:1,turn:2,cd:2,acts:0}]});
  const resolved=logic.resolveTurn(deepFreeze(initial),{},logic.makeRngs(1));
  assert.equal(resolved.next.earnedExp,200);
  const saved=deepFreeze(logic.createSave()),run={...plain(resolved.next),dungeon:{id:'d1'},boardSize:'7x6'};
  const first=logic.resolveRewards(saved,run,true);
  assert.equal(first.rewards.crystalFirst,30);assert.equal(first.rewards.starCrystal,30);assert.equal(first.rewards.crystal,60);assert.equal(first.next.crystal,60);
  for(const id of ['akane','mizuha','yomogi','ruka','nocto'])assert.deepEqual(plain(first.next.roster[id]),{lv:2,exp:100,skillLv:1});
  assert.equal(saved.crystal,0);
  const second=logic.resolveRewards(first.next,run,true);
  assert.equal(second.rewards.crystal,0);assert.equal(second.next.crystal,60);
  const lost=logic.resolveRewards(saved,run,false);
  assert.equal(lost.next.crystal,0);assert.equal(lost.next.dungeons.d1,undefined);assert.equal(lost.next.roster.akane.lv,2);
  const again=logic.resolveTurn(resolved.next,{},logic.makeRngs(3));
  assert.equal(again.next.earnedExp,200,'撃破済みの敵から二重に経験値を取らない');
});

test('リーダースキル10種の境界と対象属性、HP・回復・操作時間・軽減を正しく計算する', () => {
  assert.equal(chars.length,10);
  assert.deepEqual(plain(chars.slice(5).map(ch=>ch.kanji)),['神','雫','椿','光','鴉']);
  const ch=id=>chars.find(member=>member.id===id),groups=Array.from({length:6},()=>[{}]);
  const mult=(id,override={})=>logic.leaderMult({leader:ch(id).leader,combos:7,byColor:groups,attr:0,plus:0,od:false,...override});
  assert.equal(mult('akane',{combos:6}),2);assert.equal(mult('akane',{combos:7}),3);
  assert.equal(mult('mizuha'),1);assert.equal(mult('yomogi'),1);
  assert.equal(mult('ruka',{plus:1}),1.08);assert.equal(mult('ruka',{plus:12}),1.96);assert.equal(mult('ruka',{plus:13}),2);assert.equal(mult('ruka',{plus:100}),2);
  assert.equal(mult('nocto',{combos:4}),1);assert.equal(mult('nocto',{combos:5}),4);
  assert.equal(mult('kagura',{attr:0}),3.5);assert.equal(mult('kagura',{attr:1}),1);
  assert.equal(mult('shizuku'),4);assert.equal(mult('shizuku',{byColor:[[],...groups.slice(1)]}),1);
  const pairs=groups.map((g,i)=>i===2?[{},{}]:g);
  assert.equal(mult('tsubaki',{byColor:pairs,attr:2}),2.5);assert.equal(mult('tsubaki',{byColor:pairs,attr:1}),1);
  assert.equal(mult('hikari',{od:false}),1);assert.equal(mult('hikari',{od:true}),2);
  assert.equal(mult('crow',{combos:9}),1);assert.equal(mult('crow',{combos:10}),6);
  assert.deepEqual(plain(logic.leaderStats(ch('mizuha').leader)),{hpMult:1,rcvMult:1.5,moveBonus:2,damageTaken:1,odThreshold:10});
  assert.equal(logic.leaderStats(ch('yomogi').leader).hpMult,1.5);assert.equal(logic.leaderStats(ch('yomogi').leader).damageTaken,.8);
  assert.equal(logic.leaderStats(ch('nocto').leader).hpMult,.5);assert.equal(logic.leaderStats(ch('hikari').leader).odThreshold,9);
  const saved=logic.createSave();
  const led=id=>logic.prepareTeam(logic.setTeam(saved,0,[id,...saved.teams[0].members.filter(m=>m!==id)]));
  const tuned=logic.createSave();tuned.roster.akane.lv=2;
  assert.equal(logic.prepareTeam(tuned,0,{...config,STAT_GROWTH:.1}).party[0].hp,1650,'調整用rulesも育成に適用');
  assert.equal(led('akane').teamMax,7800);assert.equal(led('mizuha').rcv,1215);assert.equal(led('yomogi').teamMax,11700);assert.equal(led('nocto').teamMax,3900);
  const guarded=game({party:plain(logic.makeParty([ch('yomogi')])),teamHp:1000});
  guarded.enemies[0].cd=1;
  const resisted=logic.resolveTurn(deepFreeze(guarded),{}, {board:logic.mulberry32(1),enemy:()=>.5});
  assert.equal(resisted.events.find(e=>e.t==='enemyAtk').dmg,560);
  const hikari=game({party:plain(logic.makeParty([ch('hikari')])),board:tenGroups(),enemies:[]});
  const od=logic.resolveTurn(deepFreeze(hikari),{},logic.makeRngs(17));
  const at=od.events.findIndex(e=>e.t==='od');assert.equal(od.events[at-1].combo,9,'ヒカリなら9コンボでOD');
});

test('加入条件d2〜d6、既存v2補完、3編成の切替・左端リーダー・重複や未加入の拒否', () => {
  let saved=logic.createSave();
  for(const [dungeon,id] of [['d2','kagura'],['d3','shizuku'],['d4','tsubaki'],['d5','hikari'],['d6','crow']]) {
    const run={dungeon:{id:dungeon},boardSize:'7x6',stats:{maxCombo:10},earnedExp:0,party:logic.makeParty(chars.slice(0,5))};
    const result=logic.resolveRewards(deepFreeze(saved),run,true);
    assert.deepEqual(plain(result.rewards.joined),[id]);assert.deepEqual(plain(result.next.roster[id]),{lv:1,exp:0,skillLv:1});
    assert.deepEqual(plain(logic.resolveRewards(result.next,run,true).rewards.joined),[]);
    saved=result.next;
  }
  const original=JSON.stringify(saved);
  const one=logic.setTeam(deepFreeze(saved),0,['mizuha','akane','kagura','shizuku','ruka']);
  const two=logic.setTeam(one,1,['yomogi']);
  const three=logic.setTeam(two,2,['hikari','crow','tsubaki','nocto','akane']);
  assert.equal(JSON.stringify(saved),original);
  assert.equal(three.teams.length,3);assert.equal(three.teamIndex,2);assert.equal(three.teams[2].leader,'hikari');
  assert.equal(logic.prepareTeam(three).party[0].id,'hikari');
  assert.deepEqual(plain(logic.parseSave(JSON.stringify(three))),plain(three),'保存後も3編成が残る');
  assert.throws(()=>logic.setTeam(saved,0,[]));assert.throws(()=>logic.setTeam(saved,0,['akane','akane']));
  assert.throws(()=>logic.setTeam(logic.createSave(),0,['crow']));assert.throws(()=>logic.setTeam(saved,3,['akane']));
  assert.throws(()=>logic.setTeam(saved,0,chars.slice(0,6).map(ch=>ch.id)));
  const prior=logic.createSave();prior.dungeons.d2={cleared:true,stars:[false,false,false],best:{'7x6':12},firstRewarded:false};
  const normalized=logic.normalizeSave(deepFreeze(prior));
  assert.equal(normalized.roster.kagura.lv,1);assert.equal(normalized.dungeons.d2.firstRewarded,false);assert.equal(normalized.crystal,0);
});

test('新しい5スキルは純粋・再現可能で、右2列、蒼降下3ターン、半減2ターン、重複なし10強化、防御0の3ターンが働く', () => {
  const ch=id=>chars.find(member=>member.id===id);
  function ready(id,overrides={}) {
    const g=game({party:plain(logic.makeParty([ch(id)])),...overrides});g.party[0].cd=0;return deepFreeze(g);
  }
  const input=ready('kagura'),original=JSON.stringify(input),columns=logic.resolveSkill(input,{member:0},logic.makeRngs(7));
  assert.equal(JSON.stringify(input),original);
  assert.equal(columns.events[0].cells.length,12);
  for(let r=0;r<6;r++)for(let c=0;c<7;c++)assert.equal(columns.next.board[r][c].c,c>=5?0:input.board[r][c].c);
  const sky=logic.resolveSkill(ready('shizuku'),{member:0},logic.makeRngs(7));
  assert.deepEqual(plain(sky.next.buffs.skyfall),{attr:1,turns:3});
  let current=sky.next;
  for(let turn=1;turn<=3;turn++) {
    current=logic.resolveTurn(deepFreeze(current),{},logic.makeRngs(turn)).next;
    assert.equal(current.buffs.skyfall?.turns||0,3-turn);
  }
  const empty=Array.from({length:6},()=>Array(7).fill(null));
  const plainFall=logic.fall(empty,false,logic.mulberry32(99)),skyFall=logic.fall(empty,false,logic.mulberry32(99),config,{attr:1,turns:3});
  assert(skyFall.board.flat().filter(o=>o.c===1).length>plainFall.board.flat().filter(o=>o.c===1).length);
  const shield=logic.resolveSkill(ready('tsubaki'),{member:0},logic.makeRngs(7));
  current=plain(shield.next);current.teamHp=10000;
  current.party[0].leader=chars.find(ch=>ch.id==='yomogi').leader;
  current.enemies[0].turn=1;current.enemies[0].cd=1;
  const damages=[];
  for(let turn=1;turn<=3;turn++) {
    const result=logic.resolveTurn(deepFreeze(current),{}, {board:logic.mulberry32(turn),enemy:()=>.5});
    damages.push(result.events.find(e=>e.t==='enemyAtk').dmg);current=result.next;
  }
  assert.deepEqual(damages,[280,280,560],'半減は2回・リーダー軽減と乗算');
  const light=ready('hikari'),enhance=logic.resolveSkill(light,{member:0},logic.makeRngs(88));
  assert.equal(enhance.events[0].cells.length,10);assert.equal(new Set(enhance.events[0].cells.map(p=>p.join(','))).size,10);
  assert.equal(enhance.next.board.flat().filter(o=>o.p).length,10);
  assert.deepEqual(plain(logic.resolveSkill(light,{member:0},logic.makeRngs(88))),plain(enhance));
  const crow=ready('crow'),zero=logic.resolveSkill(crow,{member:0},logic.makeRngs(1));
  assert.equal(zero.next.enemies[0].def,0);assert.equal(zero.next.enemies[0].defZero.turns,3);
  current=zero.next;
  for(let turn=1;turn<=3;turn++) {
    current=logic.resolveTurn(deepFreeze(current),{},logic.makeRngs(turn)).next;
    assert.equal(current.enemies[0].def,turn<3?0:150);
  }
  const refreshed=plain(zero.next);refreshed.party[0].cd=0;
  const reapplied=logic.resolveSkill(refreshed,{member:0},logic.makeRngs(2));
  assert.equal(reapplied.next.enemies[0].defZero.original,150,'再使用で元の防御を失わない');
  for(const id of ['kagura','shizuku','tsubaki','hikari','crow']) {
    const g=ready(id),before=JSON.stringify(g);
    const result=logic.resolveSkill(g,{member:0},logic.makeRngs(9));
    assert.equal(JSON.stringify(g),before,id+'の入力不変');
    assert.equal(result.next.party[0].cd,ch(id).skill.turns);
    assert.deepEqual(plain(logic.resolveSkill(result.next,{member:0},logic.makeRngs(1))).next,plain(result.next),'CD中は使えない');
  }
});

test('ロックは直接つかめず、通過すると入れ替わり、同色の消去では解除される', () => {
  const board=plain(logic.makeBoard(false,logic.mulberry32(5)));
  board[2][2].lock=true;
  const frozen=deepFreeze(board),before=JSON.stringify(board);
  assert.equal(logic.canSwap(frozen,2,1,2,2),true);
  assert.equal(logic.canSwap(frozen,2,2,2,1),false);
  assert.equal(logic.canSwap(frozen,1,1,2,2),true);
  assert.equal(logic.canSwap(frozen,1,2,2,3),true);
  assert.deepEqual(plain(logic.swapPath(frozen,[2,0],[2,5])),[[2,0],[2,1],[2,2],[2,3],[2,4],[2,5]]);
  assert.deepEqual(plain(logic.swapPath(frozen,[2,2],[2,0])),[[2,2]]);
  assert.equal(logic.canSwap(frozen,0,0,0,1),true);
  const moved=logic.cloneBoard(frozen);
  for(let c=1;c<=5;c++){assert(logic.canSwap(moved,2,c-1,2,c));[moved[2][c-1],moved[2][c]]=[moved[2][c],moved[2][c-1]];}
  assert.equal(moved[2][1].lock,true,'通過した鎖は前のマスへ移動する');
  assert.equal(!!moved[2][5].lock,false,'つかんだルーンは鎖を運ばない');
  assert.equal(JSON.stringify(frozen),before);
  const copied=logic.cloneBoard(frozen);assert.equal(copied[2][2].lock,true);
  const falling=logic.fall([[null],[{c:0,p:false,lock:true}]],false,()=>.5);
  assert.equal(falling.board[1][0].lock,true);
  const matches=tenGroups();matches[0][0].lock=true;
  const result=logic.resolveTurn(deepFreeze(game({board:matches,enemies:[]})),{},logic.makeRngs(17));
  assert.deepEqual(plain(result.events.find(e=>e.t==='pop'&&e.unlocked).unlocked),[[0,0]]);
  assert.equal(result.next.board.flat().some(o=>o.lock),false,'そろった鎖は消える');
});

test('毒は第7色で攻撃せず、消した数×最大HPの3%を受け、毒死なら攻撃と敵の行動を止める', () => {
  for(const count of [3,6,9])assert.equal(logic.poisonDamage(count,7800),count*234);
  const board=plain(logic.makeBoard(false,logic.mulberry32(71)));
  for(let c=0;c<3;c++)board[0][c]={c:6,p:true};
  const original=JSON.stringify(board);
  const g=game({board,rules:{...plain(config),MAX_WAVES:1}});
  const result=logic.resolveTurn(deepFreeze(g),{},logic.makeRngs(9));
  assert.equal(JSON.stringify(board),original);
  const toxic=result.events.find(e=>e.t==='poison');
  assert.equal(toxic.count,3);assert.equal(toxic.dmg,702);assert.equal(toxic.hp,4298);
  assert.equal(result.events.some(e=>e.t==='attack'),false,'毒は攻撃に参加しない');
  assert.equal(result.events.find(e=>e.t==='total').prism,false);
  assert.equal(logic.findGroups(board).find(group=>group.color===6).plus,0);
  const dead=logic.resolveTurn(deepFreeze(game({board,teamHp:100,rules:{...plain(config),MAX_WAVES:1}})),{},logic.makeRngs(9));
  assert.equal(dead.next.teamHp,0);
  assert.equal(dead.events.some(e=>e.t==='attack'||e.t==='enemyAtk'),false);
  const below=[[{c:6,p:false}], [null]];
  const normal=logic.fall(below,true,()=>.9);
  assert.equal(normal.board.flat().filter(o=>o.c===6).length,1,'毒は通常補充やODの偏りでは増えない');
});

test('暗闇は色と消える規則を保ち、移動・落下でも持続し、2回のターン後に戻る', () => {
  const board=plain(logic.makeBoard(false,logic.mulberry32(5))),before=JSON.stringify(board);
  const dark=logic.applyRuneCondition(deepFreeze(board),'dark',[[0,0],[2,3]]);
  assert.equal(JSON.stringify(board),before);assert.equal(dark[0][0].dark,2);assert.equal(dark[0][0].c,board[0][0].c);
  const aged=logic.ageDark(deepFreeze(dark));
  assert.equal(aged.board[0][0].dark,1);assert.equal(dark[0][0].dark,2);
  const expired=logic.ageDark(aged.board);
  assert.equal(expired.board[0][0].dark,undefined);assert.deepEqual(plain(expired.expired),[[0,0],[2,3]]);
  assert.equal(logic.canSwap(dark,0,0,0,1),true,'見えなくても動かせる');
  const f=logic.fall([[{c:1,p:false,dark:2}],[null]],false,()=>.5);
  assert.equal(f.board[1][0].dark,2);
  let current=game({board:dark});
  for(let turn=1;turn<=2;turn++) {
    const result=logic.resolveTurn(deepFreeze(current),{},logic.makeRngs(7));
    assert.equal(result.next.board[0][0].dark,turn===1?1:undefined);
    assert(result.events.some(e=>e.t==='boardStatus'));current=result.next;
  }
  const combo=tenGroups(),hidden=logic.applyRuneCondition(combo,'dark',[[0,0],[0,1],[0,2]]);
  assert.deepEqual(plain(logic.findGroups(hidden)),plain(logic.findGroups(combo)));
  const lockedPoison=logic.applyRuneCondition(logic.applyRuneCondition(board,'lock',[[2,3]]),'poison',[[2,3]]);
  assert.deepEqual(plain(lockedPoison[2][3]),{c:6,p:false,lock:true},'状態を変換時にも維持');
});

test('敵のロック付与は重複なし6個・敵乱数で再現し、先制／毎N／Nターン／HP未満を判定する', () => {
  const g=game();g.enemies[0].skills=[{id:'lock',when:'preempt'}];
  const before=JSON.stringify(g);
  const a=logic.resolveEnemySkills(deepFreeze(g),'preempt',logic.makeRngs(6));
  const b=logic.resolveEnemySkills(g,'preempt',logic.makeRngs(6));
  assert.equal(JSON.stringify(g),before);assert.deepEqual(plain(a),plain(b));
  assert.equal(a.next.board.flat().filter(o=>o.lock).length,6);
  assert.equal(a.events[0].cells.length,6);
  const again=logic.resolveEnemySkills(a.next,'preempt',logic.makeRngs(6));
  assert.equal(again.events.length,0);
  assert.equal(logic.skillDue({elapsed:4,hp:50,maxHp:100},{when:'every:4'},0,'end'),true);
  assert.equal(logic.skillDue({elapsed:3,hp:50,maxHp:100},{when:'every:4'},0,'end'),false);
  assert.equal(logic.skillDue({elapsed:2},{when:'turn:2'},0,'end'),true);
  assert.equal(logic.skillDue({elapsed:3},{when:'turn:2'},0,'end'),false);
  assert.equal(logic.skillDue({hp:50,maxHp:100},{when:'hp:50'},0,'end'),false);
  assert.equal(logic.skillDue({hp:49,maxHp:100},{when:'hp:50'},0,'end'),true);
  assert.equal(logic.skillDue({hp:49,maxHp:100,skillUsed:{0:true}},{when:'hp:50'},0,'end'),false);
  const periodic=game();periodic.enemies[0].skills=[{id:'lock',when:'every:2'}];
  let current=periodic;
  for(let i=1;i<=4;i++) {
    const result=logic.resolveTurn(current,{},logic.makeRngs(i));
    assert.equal(result.events.some(e=>e.t==='enemySkill'),i%2===0);
    current=result.next;
  }
});

test('敵の毒変換は命だけをすべて変え、ロック・暗闇を維持し、強化は除去する', () => {
  const g=game();g.enemies[0].skills=[{id:'poison',when:'preempt'}];
  g.board[0][0]={c:5,p:true,lock:true,dark:2};
  const life=g.board.flat().filter(o=>o.c===5).length;
  const result=logic.resolveEnemySkills(deepFreeze(g),'preempt',logic.makeRngs(7));
  assert.equal(result.events[0].cells.length,life);
  assert.equal(result.next.board.flat().filter(o=>o.c===5).length,0);
  assert.equal(result.next.board.flat().filter(o=>o.c===6).length,life);
  assert.deepEqual(plain(result.next.board[0][0]),{c:6,p:false,lock:true,dark:2});
  for(let r=0;r<6;r++)for(let c=0;c<7;c++)if(g.board[r][c].c!==5)assert.deepEqual(plain(result.next.board[r][c]),g.board[r][c]);
});

test('敵の暗闇は重複なし8個・付与時は2ターンで、2回の攻撃機会が終わると戻る', () => {
  const g=game();g.enemies[0].skills=[{id:'dark',when:'turn:1'}];
  const first=logic.resolveTurn(deepFreeze(g),{},logic.makeRngs(3));
  const event=first.events.find(e=>e.t==='enemySkill');
  assert.equal(event.cells.length,8);assert.equal(new Set(event.cells.map(c=>c.join())).size,8);
  assert.equal(first.next.board.flat().filter(o=>o.dark===2).length,8);
  const second=logic.resolveTurn(first.next,{},logic.makeRngs(3));
  assert.equal(second.next.board.flat().filter(o=>o.dark===1).length,8);
  const third=logic.resolveTurn(second.next,{},logic.makeRngs(3));
  assert.equal(third.next.board.flat().filter(o=>o.dark).length,0);
  assert.equal(third.events.filter(e=>e.t==='enemySkill').length,0);
});

test('属性吸収は指定属性で回復・最大HPまで、別属性は攻撃、付与後3回に効いて解除する', () => {
  const g=game();g.enemies[0].hp=50000;g.enemies[0].maxHp=100000;
  g.enemies[0].skills=[{id:'absorb',when:'preempt',attr:0}];
  const cast=logic.resolveEnemySkills(deepFreeze(g),'preempt',logic.makeRngs(3));
  assert.equal(cast.next.enemies[0].statuses.absorb.turns,3);
  assert(cast.events.some(e=>e.t==='status'&&e.added==='absorb'));
  let en=cast.next.enemies[0];
  const healed=logic.hitEnemy(deepFreeze(en),60000,{attr:0,combos:7});
  assert.equal(healed.enemy.hp,100000);assert.equal(healed.hit.amount,50000);assert.equal(healed.hit.dmg,0);
  assert.equal(logic.hitEnemy(en,1000,{attr:1,combos:7}).enemy.hp,49000);
  let current=cast.next;
  for(let turn=1;turn<=3;turn++) {
    const result=logic.resolveTurn(deepFreeze(current),{},logic.makeRngs(4));
    assert.equal(result.next.enemies[0].statuses.absorb?.turns,turn===3?undefined:3-turn);
    current=result.next;
  }
  assert.equal(logic.hitEnemy(current.enemies[0],1000,{attr:0,combos:7}).enemy.hp,current.enemies[0].hp-1000);
  const attack=game({board:tenGroups()});attack.enemies[0].hp=5000000;
  attack.enemies[0].statuses={absorb:{attr:0,turns:3}};
  const result=logic.resolveTurn(deepFreeze(attack),{},logic.makeRngs(8));
  assert(result.events.some(e=>e.t==='absorbed'&&e.amount>0));
  assert.equal(result.events.find(e=>e.t==='attack').hits[0].dmg,0);
});

test('コンボ吸収は7未満を無効・回復なし、7以上は通し、3ターンで解除する', () => {
  const g=game();g.enemies[0].skills=[{id:'comboAbsorb',when:'preempt',min:7}];
  let current=logic.resolveEnemySkills(g,'preempt',logic.makeRngs(2)).next;
  const enemy=current.enemies[0];
  for(const combos of [0,6,7,8]) {
    const hit=logic.hitEnemy(deepFreeze(enemy),1000,{attr:0,combos});
    assert.equal(hit.enemy.hp,enemy.hp-(combos<7?0:1000));
    assert.equal(hit.hit.blocked===true,combos<7);
    assert.equal(hit.hit.absorbed,undefined);
  }
  for(let turn=1;turn<=3;turn++)current=logic.resolveTurn(current,{},logic.makeRngs(2)).next;
  assert.equal(current.enemies[0].statuses.comboAbsorb,undefined);
});

test('ダメージ上限は味方1体の1回ごとに止まり、小さい攻撃はそのまま通る', () => {
  const g=game();g.enemies[0].skills=[{id:'damageCap',when:'preempt',limit:1000}];
  const cast=logic.resolveEnemySkills(g,'preempt',logic.makeRngs(2));
  const enemy=cast.next.enemies[0];
  for(const damage of [999,1000,1001,100000]) {
    const hit=logic.hitEnemy(deepFreeze(enemy),damage,{attr:0,combos:10});
    assert.equal(hit.hit.dmg,Math.min(damage,1000));assert.equal(hit.hit.capped===true,damage>1000);
  }
  const result=logic.resolveTurn({...cast.next,board:tenGroups()}, {},logic.makeRngs(8));
  const hits=result.events.filter(e=>e.t==='attack').flatMap(e=>e.hits);
  assert(hits.length>1);assert(hits.every(h=>h.dmg<=1000));
  assert.equal(result.next.enemies[0].hp,enemy.hp-hits.reduce((sum,h)=>sum+h.dmg,0));
  assert.equal(result.next.enemies[0].statuses.damageCap.limit,1000,'指定なしの期間は常設');
});

test('根性はHP50%以上の致死打に1回だけHP1で耐え、倒した時だけ経験値を出す', () => {
  const g=game();g.enemies[0].skills=[{id:'endure',when:'preempt'}];
  const cast=logic.resolveEnemySkills(g,'preempt',logic.makeRngs(2)).next;
  for(const hp of [49,50,100]) {
    const enemy={...cast.enemies[0],hp,maxHp:100};
    const result=logic.hitEnemy(deepFreeze(enemy),1000,{attr:0,combos:10});
    assert.equal(result.enemy.hp,hp<50?0:1);
    assert.equal(result.hit.endured===true,hp>=50);
    if(hp>=50) {
      const second=logic.hitEnemy(result.enemy,1000,{attr:0,combos:10});
      assert.equal(second.enemy.hp,0);assert.equal(second.hit.endured,undefined);
    }
  }
  const attack=game({board:tenGroups(),party:[game().party[0]],rules:{...plain(config),MAX_WAVES:1}});
  attack.enemies[0]={...cast.enemies[0],hp:1000,maxHp:1000};
  const first=logic.resolveTurn(deepFreeze(attack),{},logic.makeRngs(8));
  assert.equal(first.next.enemies[0].hp,1);assert.equal(first.next.earnedExp||0,0);
  assert(first.events.some(e=>e.t==='endured'));
  const second=logic.resolveTurn({...first.next,board:tenGroups()}, {},logic.makeRngs(8));
  assert.equal(second.next.enemies[0].hp,0);assert.equal(second.next.earnedExp,50);
  const recast=logic.resolveEnemySkills({...first.next,enemies:[{...first.next.enemies[0],skillUsed:{}}]},'preempt',logic.makeRngs(8));
  assert.equal(recast.next.enemies[0].statuses.endure.used,true,'再付与でも使用済みを戻さない');
});

test('再生は毎ターン最大HPの5%・上限まで回復し、死亡した敵を復活させない', () => {
  const g=game();g.enemies[0].hp=40000;g.enemies[0].maxHp=100000;
  g.enemies[0].skills=[{id:'regen',when:'preempt'}];
  const cast=logic.resolveEnemySkills(deepFreeze(g),'preempt',logic.makeRngs(2));
  let next=logic.resolveTurn(cast.next,{},logic.makeRngs(2));
  assert.equal(next.next.enemies[0].hp,45000);
  assert.equal(next.events.find(e=>e.t==='enemyRegen').amount,5000);
  next=logic.resolveTurn({...cast.next,enemies:[{...cast.next.enemies[0],hp:99000}]}, {},logic.makeRngs(2));
  assert.equal(next.next.enemies[0].hp,100000);assert.equal(next.events.find(e=>e.t==='enemyRegen').amount,1000);
  next=logic.resolveTurn({...cast.next,enemies:[{...cast.next.enemies[0],hp:0}]}, {},logic.makeRngs(2));
  assert.equal(next.next.enemies[0].hp,0);assert.equal(next.events.some(e=>e.t==='enemyRegen'),false);
});

test('先制は登場後に技1つだけ・再発動なしで、操作前に通常攻撃やターン消費をしない', () => {
  const g=game();g.enemies[0].skills=[{id:'lock',when:'preempt'},{id:'poison',when:'preempt'}];
  const result=logic.resolveEnemySkills(deepFreeze(g),'preempt',logic.makeRngs(2));
  assert.equal(result.events.filter(e=>e.t==='enemySkill').length,1);
  assert.equal(result.events[0].id,'lock');
  assert.equal(result.next.teamHp,g.teamHp);assert.equal(result.next.stats.turns,0);
  assert.equal(result.next.enemies[0].cd,g.enemies[0].cd);
  assert.equal(result.events.some(e=>e.t==='enemyAtk'),false);
  assert.equal(logic.resolveEnemySkills(result.next,'preempt',logic.makeRngs(2)).events.length,0);
  assert.equal(logic.resolveTurn(result.next,{},logic.makeRngs(2)).events.some(e=>e.t==='enemySkill'),false);
});

test('形態変化はHP50%未満で1回だけ・HPを維持し、形態別の技と攻撃間隔へ切り替える', () => {
  const g=game();g.enemies[0]={...g.enemies[0],hp:50,maxHp:100,cd:9,skills:[
    {id:'transform',when:'hp:50',to:{attr:0,atk:2000,turn:1,form:2,phaseName:'第二形態'}},
    {id:'dark',when:'every:1',phase:2},
    {id:'transform',when:'hp:25',phase:2,to:{attr:4,atk:2500,turn:2,form:3,phaseName:'第三形態'}}
  ]};
  let result=logic.resolveTurn(deepFreeze(g),{},logic.makeRngs(5));
  assert.equal(result.events.some(e=>e.id==='transform'),false);
  result=logic.resolveTurn({...result.next,enemies:[{...result.next.enemies[0],hp:49}]}, {},logic.makeRngs(5));
  const enemy=result.next.enemies[0];
  assert.equal(enemy.hp,49);assert.equal(enemy.form,2);assert.equal(enemy.attr,0);assert.equal(enemy.atk,2000);assert.equal(enemy.turn,1);
  assert(result.events.some(e=>e.id==='dark'),'変化後のパターンに切り替わる');
  assert.equal(result.events.filter(e=>e.id==='transform').length,1);
  const second=logic.resolveTurn(result.next,{},logic.makeRngs(5));
  assert.equal(second.events.some(e=>e.id==='transform'),false);
  const third=logic.resolveTurn({...second.next,enemies:[{...second.next.enemies[0],hp:24}]}, {},logic.makeRngs(5));
  assert.equal(third.next.enemies[0].form,3);assert.equal(third.next.enemies[0].hp,24);
  const regen=logic.resolveTurn({...g,enemies:[{...g.enemies[0],hp:49,statuses:{regen:{rate:.05,turns:null}}}]}, {},logic.makeRngs(5));
  assert.equal(regen.next.enemies[0].hp,54);assert.equal(regen.next.enemies[0].form,2,'再生前の閾値で変化');
});

test('属性変化は3ターンごとに循環し、ダメージ計算の弱点も新属性へ変わる', () => {
  const g=game();g.enemies[0].attr=0;g.enemies[0].skills=[{id:'attrChange',when:'every:3',attrs:[0,1,2]}];
  let current=g;
  for(let turn=1;turn<=9;turn++) {
    const result=logic.resolveTurn(deepFreeze(current),{},logic.makeRngs(3));
    assert.equal(result.next.enemies[0].attr,Math.floor(turn/3)%3);
    assert.equal(result.events.some(e=>e.id==='attrChange'),turn%3===0);
    current=result.next;
  }
  assert.equal(logic.attrMult(0,0),1);assert.equal(logic.attrMult(0,1),.5);assert.equal(logic.attrMult(0,2),2);
  const member=game().party[0],groups=[{cells:[[0,0],[0,1],[0,2]],plus:0,shape:''}];
  const ctx={combos:1,leaderMult:1,od:false,resonance:false,prism:false};
  assert(logic.attackDamage(member,groups,ctx,{attr:2,def:0})>logic.attackDamage(member,groups,ctx,{attr:1,def:0}));
});

test('コア変換でも未消去のロック・暗闇を保持し、ODで残った毒を強化しない', () => {
  const board=plain(logic.makeBoard(false,logic.mulberry32(5)));
  for(let r=0;r<3;r++)for(let c=0;c<3;c++)board[r][c]={c:0,p:false};
  for(let r=0;r<3;r++)board[r][3]={c:r+1,p:false};
  for(let c=0;c<3;c++)board[3][c]={c:c+1,p:false};
  board[5][6]={c:6,p:false,lock:true,dark:2};
  assert(logic.findGroups(board).some(g=>g.shape==='core'));
  // コアの変換位置を末尾へ固定し、元の鎖・暗闇が残ることを確認。
  const result=logic.resolveTurn(game({board,rules:{...plain(config),MAX_WAVES:1}}), {},{board:()=>.99,enemy:()=>.5});
  const converted=result.events.find(e=>e.t==='fall').board[5][6];
  assert.equal(converted.c,0);assert.equal(converted.lock,true);assert.equal(converted.dark,2);
  assert.equal(result.next.board[5][6].lock,true);assert.equal(result.next.board[5][6].dark,1);
  const combo=tenGroups();combo[5][6]={c:6,p:false};
  const od=logic.resolveTurn(game({board:combo,rules:{...plain(config),MAX_WAVES:1}}),{},logic.makeRngs(8));
  assert(od.next.od.active);
  assert.equal(od.next.board.flat().filter(o=>o.c===6).length,1);
  for(const rune of od.next.board.flat())if(rune.c===6)assert.equal(rune.p,false);
});

test('★はクリア・目標ターン・目標コンボを独立判定し、境界と全滅を扱う', () => {
  for(const dungeon of dungeons) {
    const goal=dungeon.starGoals;
    assert.deepEqual(plain(logic.evaluateStars(dungeon,{turns:goal.turns,maxCombo:goal.combo},true)),[true,true,true]);
    assert.deepEqual(plain(logic.evaluateStars(dungeon,{turns:goal.turns+1,maxCombo:goal.combo},true)),[true,false,true]);
    assert.deepEqual(plain(logic.evaluateStars(dungeon,{turns:goal.turns,maxCombo:goal.combo-1},true)),[true,true,false]);
    assert.deepEqual(plain(logic.evaluateStars(dungeon,{turns:1,maxCombo:999},false)),[false,false,false]);
  }
});
test('★報酬は各10・初回30を別に付け、再挑戦／保存読込では重複しない', () => {
  const saved=logic.createSave(),run=game({dungeon:plain(dungeons[0]),boardSize:'7x6',earnedExp:0,stats:{turns:99,maxCombo:5,totalDmg:0,ods:0}});
  const first=logic.resolveRewards(deepFreeze(saved),run,true);
  assert.equal(first.rewards.crystalFirst,30);assert.equal(first.rewards.starCrystal,10);assert.equal(first.next.crystal,40);
  assert.deepEqual(plain(first.next.dungeons.d1.stars),[true,false,false]);
  const combo=logic.resolveRewards(logic.normalizeSave(first.next),{...run,stats:{...run.stats,maxCombo:6}},true);
  assert.equal(combo.rewards.starCrystal,10);assert.deepEqual(plain(combo.next.dungeons.d1.stars),[true,false,true]);
  const fast=logic.resolveRewards(combo.next,{...run,stats:{...run.stats,turns:12}},true);
  assert.equal(fast.rewards.starCrystal,10);assert.equal(fast.next.crystal,60);
  const repeat=logic.resolveRewards(logic.parseSave(JSON.stringify(fast.next)),{...run,stats:{turns:1,maxCombo:99}},true);
  assert.equal(repeat.rewards.crystal,0);assert.equal(repeat.next.crystal,60);
  const failed=logic.resolveRewards(fast.next,run,false);assert.equal(failed.rewards.crystal,0);assert.equal(failed.next.crystal,60);
  const old=logic.migrateSave({settings:{},cleared:{d1:true},best:{'d1:7x6':99}});
  const legacy=logic.resolveRewards(old,run,true);
  assert.equal(legacy.rewards.crystalFirst,0);assert.equal(legacy.rewards.starCrystal,10);assert.equal(legacy.next.crystal,40);
  assert.equal(legacy.next.dungeons.d1.best['7x6'],99,'昔の最大コンボを保ち今回未達成の星を自動付与しない');
});
test('追加ダンジョンは指定の階数・推奨Lv・全フロアの敵データを持ち、技の条件が有効', () => {
  assert.equal(dungeons.length,8);
  assert.deepEqual(plain(dungeons.map(d=>d.floors.length)),[4,4,4,5,5,5,6,6]);
  assert.deepEqual(plain(dungeons.map(d=>d.recommendedLv)),[1,8,18,24,30,36,42,48]);
  const known=['lock','poison','dark','absorb','comboAbsorb','damageCap','endure','regen','transform','attrChange'];
  for(const dungeon of dungeons.slice(3)) {
    const party=logic.makeParty(chars.slice(0,5),Object.fromEntries(chars.slice(0,5).map(ch=>[ch.id,{lv:dungeon.recommendedLv,exp:0,skillLv:1}])));
    const hp=party.reduce((sum,m)=>sum+m.hp,0);
    for(const floor of dungeon.floors)for(const enemy of floor) {
      assert(['sentinel','wisp','golem','boss'].includes(enemy.kind));
      assert(enemy.hp>0 && enemy.atk>0 && enemy.turn>=1 && enemy.attr>=0 && enemy.attr<5);
      assert(enemy.atk*(enemy.bigMult||1)<hp,'推奨Lvで基準の大技1回を耐えられる目安');
      assert(enemy.skills.filter(s=>s.when==='preempt').length<=1,'先制は1体1技');
      for(const skill of enemy.skills) {
        assert(known.includes(skill.id));
        assert(/^(preempt|every:[1-9]\d*|turn:[1-9]\d*|hp:(?:[1-9]\d?|100))$/.test(skill.when));
        if(skill.id==='absorb')assert(skill.attr>=0 && skill.attr<5);
        if(skill.id==='damageCap')assert(skill.limit>0);
      }
    }
    assert(dungeon.floors.at(-1)[0].boss);
    const normal=logic.makeEnemies(dungeon.floors.at(-1),1),large=logic.makeEnemies(dungeon.floors.at(-1),1.5);
    assert.equal(large[0].maxHp,Math.round(normal[0].maxHp*1.5));
    assert.equal(large[0].atk,normal[0].atk);
  }
  assert.deepEqual(plain(dungeons[7].floors.at(-1)[0].skills.filter(s=>s.id==='transform').map(s=>s.to.form)),[2,3]);
});

test('シミュレーターは鎖を通っても25マス以内・入力不変で、Kを増やしても選んだ初手コンボが減らない', async () => {
  const { choosePath } = await import('./sim-core.mjs');
  const board=plain(logic.makeBoard(false,logic.mulberry32(917),config));board[2][2].lock=true;board[4][4].dark=2;board[0][3].c=6;
  const original=plain(board), small=choosePath(board,30,logic.mulberry32(7),logic),large=choosePath(board,100,logic.mulberry32(7),logic);
  assert(large.score>=small.score);assert(large.path.length>1&&large.path.length<=25);
  const replay=plain(board);
  for(let i=1;i<large.path.length;i++){const [r,c]=large.path[i-1],[nr,nc]=large.path[i];assert(logic.canSwap(replay,r,c,nr,nc));[replay[r][c],replay[nr][nc]]=[replay[nr][nc],replay[r][c]];}
  assert.deepEqual(replay,plain(large.board));assert.deepEqual(board,original);
  assert.equal(large.score,logic.findGroups(large.board).length);
});
test('シミュレーターの同一条件は再現でき、ターン上限や移動不能をクリアに数えない', async () => {
  const { simulateRun, choosePath }=await import('./sim-core.mjs');
  const loaded=loadLogic(),d=loaded.dungeons[0];
  assert.deepEqual(simulateRun(loaded,d,1,171,30,40),simulateRun(loaded,d,1,171,30,40));
  const limit=simulateRun(loaded,d,1,171,100,1);
  assert.equal(limit.clear,false);assert.equal(limit.reason,'turn_limit');
  const locked=Array.from({length:6},()=>Array.from({length:7},()=>({c:0,p:false,lock:true})));
  assert.equal(choosePath(locked,100,logic.mulberry32(7),logic).path.length,0);
});

test('1ダンジョン平均ターンは未クリアも含み、上限は300ターンとして集計する', async () => {
 const {simulateCase}=await import('./sim-core.mjs'),loaded=loadLogic();
 const row=simulateCase(loaded,{dungeon:'d1',level:1,K:30,trials:4,seed:19,maxTurns:1});
 assert.equal(row.avgDungeonTurns,1);assert.equal(row.avgTurns,1);
 assert.equal(row.avgClearTurns,0);assert.equal(row.clears,0);assert.equal(row.timeouts,4);
});
test('画質は2秒平均で1段下げ、57fpsが10秒続いた時だけ上げ、境界まで保留する',()=>{
 const {sampleQuality,config:c}=loadQualityPolicy(),q={level:2,pending:2,seconds:0,frames:0,stable:0};
 const sample=(n,fps,active=true)=>{for(let i=0;i<n;i++)sampleQuality(q,1/fps,active,c);};
 sample(59,30);assert.equal(q.pending,2);
 sample(1,30);assert.equal(q.pending,1);assert.equal(q.level,2);
 sample(120,30);assert.equal(q.pending,1,'Do not queue multiple steps per turn');
 q.level=1;sample(480,60);assert.equal(q.pending,1);
 sample(120,60);assert.equal(q.pending,2);assert.equal(q.level,1);
 q.level=2;sample(120,60);sampleQuality(q,1,false,c);assert.equal(q.stable,0);
 sample(120,60);sampleQuality(q,2,true,c);assert.equal(q.stable,0,'Ignore suspension');
 q.level=q.pending=0;sample(60,30);assert.equal(q.pending,0);
 sample(480,60);sample(110,55);sample(120,60);assert.equal(q.pending,0,'Recovery must be consecutive');
});


test('セリフ設定は旧セーブでオンを補完し、オフも保存・再読込で維持する',()=>{
 const old=plain(logic.createSave());delete old.settings.barks;
 assert.equal(logic.normalizeSave(old).settings.barks,true);
 old.settings.barks=false;assert.equal(logic.parseSave(JSON.stringify(old)).settings.barks,false);
 old.settings.barks='false';assert.equal(logic.normalizeSave(old).settings.barks,true);
 const legacy={settings:{barks:false},cleared:{d1:true},best:{'d1:7x6':12}};
 assert.equal(logic.migrateSave(legacy).settings.barks,false);
 assert.equal(logic.migrateSave(legacy).dungeons.d1.best['7x6'],12);
});

test('連鎖アシストは新規セルだけをそろえ、毒を選ばず、未指定の落下を保つ',()=>{
 const board=deepFreeze([[null,{c:2,p:true,lock:true},{c:2,p:false,dark:2}]]);
 const normal=logic.fall(board,false,()=>.5);
 const assisted=logic.fall(board,false,()=>.5,config,null,{rate:1});
 assert.equal(normal.guided,null);assert.equal(normal.board[0][0].c,3);
 assert.deepEqual(plain(assisted.guided),[0,0]);assert(assisted.from[0][0]<0);
 assert.equal(assisted.board[0][0].c,2);assert.equal(logic.findGroups(assisted.board).length,1);
 assert.deepEqual(plain(assisted.board[0].slice(1)),plain(board[0].slice(1)));
 const poison=[[null,{c:config.POISON_COLOR,p:false},{c:config.POISON_COLOR,p:false}]];
 assert.equal(logic.fall(poison,false,()=>.5,config,null,{rate:1}).guided,null);
 const a=logic.fall(board,false,logic.mulberry32(91),config,null,{rate:1});
 const b=logic.fall(board,false,logic.mulberry32(91),config,null,{rate:1});assert.deepEqual(plain(a),plain(b));
});

test('連鎖アシストは通常とODの上限・減衰・無効化を守る',()=>{
 const rules={...config,CHAIN_ASSIST:1,CHAIN_ASSIST_OD:1,CHAIN_ASSIST_DECAY:1,CHAIN_ASSIST_DECAY_OD:1,CHAIN_ASSIST_MAX:2,CHAIN_ASSIST_MAX_OD:3};
 const run=(od,extra={})=>logic.resolveTurn(game({board:tenGroups(),enemies:[],rules:{...rules,...extra},od:{active:od,chain:0}}),{},{board:()=>0,enemy:()=>.5});
 assert.equal(run(false).events.filter(e=>e.t==='fall'&&e.guided).length,2);
 assert.equal(run(true).events.filter(e=>e.t==='fall'&&e.guided).length,3);
 assert.equal(run(false,{CHAIN_ASSIST_DECAY:0}).events.filter(e=>e.t==='fall'&&e.guided).length,1);
 assert.equal(run(false,{CHAIN_ASSIST_MAX:0}).events.filter(e=>e.t==='fall'&&e.guided).length,0);
});

test('素材の一覧とダブルクリック用の一覧が一致し、登録した画像が存在する',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const source=html.slice(html.indexOf('const ASSET_MANIFEST_FALLBACK ='),html.indexOf('const assets ='));
 const manifest=JSON.parse(readFileSync(new URL('../assets/manifest.json',import.meta.url),'utf8'));
 assert.deepEqual(JSON.parse(vm.runInNewContext(source+'\nJSON.stringify(ASSET_MANIFEST_FALLBACK)')),manifest);
 const files=[...Object.values(manifest.enemies),...Object.values(manifest.bosses)].map(e=>e.file);
 for(const entry of Object.values(manifest.chars))files.push(entry.full,entry.face);
 for(const file of files.filter(Boolean)){assert(file.startsWith('assets/')&&!file.includes('..'));assert(readFileSync(new URL('../'+file,import.meta.url)).length>0);}
});


test('成長能力はLv9／10／20／50の境界と奥義倍率を守る',()=>{
 assert.deepEqual(plain(logic.levelPerks(9)),{atk:1,skillTurn:0,art:1});
 assert.deepEqual(plain(logic.levelPerks(10)),{atk:1.1,skillTurn:0,art:1});
 assert.equal(logic.levelPerks(19).skillTurn,0);
 assert.equal(logic.levelPerks(20).skillTurn,1);
 assert.equal(logic.levelPerks(49).art,1);
 assert.equal(logic.levelPerks(50).art,1.5);
 assert(Math.abs(logic.levelPerks(50).atk-1.7602475)<1e-10);
});

test('Lv20でスキルの溜めが1減り、強化を重ねても最小値を下回らない',()=>{
 for(const ch of chars){
  const before=logic.growCharacter(ch,{lv:19,skillLv:1});
  const after=logic.growCharacter(ch,{lv:20,skillLv:1});
  assert.equal(after.skill.turns,Math.max(config.SKILL_TURN_MIN,before.skill.turns-1));
  assert.equal(logic.growCharacter(ch,{lv:50,skillLv:3}).skill.turns,Math.max(config.SKILL_TURN_MIN,ch.skill.turns-3));
 }
 const ch=plain(chars[0]);ch.skill.turns=2;
 assert.equal(logic.growCharacter(ch,{lv:20,skillLv:3}).skill.turns,config.SKILL_TURN_MIN);
});

test('連鎖技は連鎖数・習得Lv・消した属性・同段階の消去数で選ぶ',()=>{
 const party=[{attr:0,lv:50,artBoost:1.5},{attr:1,lv:15},{attr:2,lv:35}];
 const g=n=>({cells:Array.from({length:n},(_,i)=>[0,i])});
 const colors=[[g(3)],[g(6)],[],[],[],[],[]];
 const frozen=deepFreeze(party), before=JSON.stringify({party,colors});
 assert.equal(logic.pickArt(frozen,colors,2),null);
 assert.equal(logic.pickArt([{attr:0,lv:4}],colors,10),null);
 assert.equal(logic.pickArt([{attr:0,lv:14}],colors,10).tier,1);
 assert.equal(logic.pickArt(frozen,colors,5).member,1,'同段階なら多く消した蒼');
 const top=logic.pickArt(frozen,colors,10);
 assert.equal(top.member,0);assert.equal(top.tier,4);assert.equal(top.mult,9);
 assert.equal(logic.pickArt([{attr:2,lv:50}],colors,10),null,'消していない属性は選ばない');
 for(const [lv,chain,tier] of [[5,3,1],[15,5,2],[25,7,3],[35,10,4]]){
  assert.equal(logic.pickArt([{attr:0,lv}],colors,chain).tier,tier);
  assert.equal(logic.pickArt([{attr:0,lv}],colors,chain-1)?.tier||0,tier-1);
 }
 assert.equal(JSON.stringify({party,colors}),before,'選択で入力を変えない');
});

function artTurn(enemy={},lv=5){
 const initial=game({board:tenGroups(),party:plain(logic.makeParty([chars[0]],{akane:{lv,exp:0,skillLv:1}})),rules:{...plain(config),MAX_WAVES:3},earnedExp:0});
 Object.assign(initial.enemies[0],{atk:0,cd:99,turn:99},enemy);
 return logic.resolveTurn(deepFreeze(initial),{}, {board:()=>0,enemy:()=>.5});
}
test('連鎖技は通常攻撃の前に出て、hits全件が累計ダメージに入る',()=>{
 const result=artTurn(),art=result.events.find(e=>e.t==='art');
 assert(art);assert.equal(art.chains,3);assert.equal(art.tier,1);
 assert(result.events.indexOf(art)<result.events.findIndex(e=>e.t==='attack'));
 const hits=result.events.filter(e=>['art','attack'].includes(e.t)).flatMap(e=>e.hits);
 assert.equal(result.next.stats.totalDmg,hits.reduce((sum,h)=>sum+h.dmg,0));
 assert(art.hits[0].dmg>0);
 assert.equal(artTurn({},4).events.some(e=>e.t==='art'),false);
});
test('連鎖技の撃破経験値は一度だけ加算し、上限・吸収・根性も通常攻撃と同じ',()=>{
 const killed=artTurn({hp:1,maxHp:4000});
 assert.equal(killed.events.find(e=>e.t==='art').hits[0].hp,0);
 assert.equal(killed.next.earnedExp,200);
 assert.equal(killed.events.some(e=>e.t==='attack'),false);
 const again=logic.resolveTurn(killed.next,{}, {board:()=>0,enemy:()=>.5});assert.equal(again.next.earnedExp,200);
 const capped=artTurn({statuses:{damageCap:{limit:100,turns:null}}});
 assert.equal(capped.events.find(e=>e.t==='art').hits[0].dmg,100);
 const absorbed=artTurn({hp:500000,maxHp:1000000,statuses:{absorb:{attr:0,turns:3}}});
 const h=absorbed.events.find(e=>e.t==='art').hits[0];assert.equal(h.absorbed,true);assert.equal(h.dmg,0);assert(h.hp>500000);
 const endured=artTurn({hp:100,maxHp:100,statuses:{endure:{from:.5,used:false,turns:null}}});
 const e=endured.events.find(e=>e.t==='art').hits[0];assert.equal(e.endured,true);assert.equal(e.hp,1);
 assert.equal(endured.next.earnedExp,5,'後続の通常攻撃で倒した分だけ');
});

test('ミュートは旧セーブでオフを補完し、オンを保存して再読込できる',()=>{
 const old=plain(logic.createSave());delete old.settings.mute;
 assert.equal(logic.normalizeSave(old).settings.mute,false);
 old.settings.mute=true;
 assert.equal(logic.parseSave(JSON.stringify(old)).settings.mute,true);
});


test('編成の成長一覧は習得済みと次の連鎖技だけを出し、キャラ別の技名と条件を保つ',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const configData=html.slice(html.indexOf('const CONFIG ='),html.indexOf('// ===== UTIL ====='));
 const artNameSource=html.match(/^function artName\(.*$/m)[0];
 const growthSource=html.slice(html.indexOf('function perkText('),html.indexOf('// 仲間の詳細：立ち絵'));
 const context=vm.createContext({});vm.runInContext(configData+artNameSource+'\n'+growthSource,context);
 const compact=vm.runInContext('growthHtml(CHARS[0],20,true)',context);
 for(const value of ['Lv5','Lv10','Lv15','Lv20','Lv25','紅閃','紅蓮斬','緋焔乱舞','7連鎖で発動','攻撃 +10%','スキルの溜め −1ターン'])assert(compact.includes(value),value);
 assert(!compact.includes('Lv35'));assert(!compact.includes('紅蓮天墜'));
 assert(vm.runInContext('growthHtml(CHARS[0],20)',context).includes('紅蓮天墜'),'詳細画面は全成長一覧を保つ');
 const beginner=vm.runInContext('growthHtml(CHARS[0],1,true)',context);
 assert(beginner.includes('Lv5'));assert(!beginner.includes('Lv15'));
 const max=vm.runInContext('growthHtml(CHARS[0],50,true)',context);assert(max.includes('奥義の威力 ×1.5'));assert(!max.includes('未習得'));
 for(let i=0;i<chars.length;i++)assert(vm.runInContext('growthHtml(CHARS['+i+'],35,true)',context).includes('10連鎖で発動'));
});


test('ゲーム全体のJavaScriptに構文エラーがない',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
});

test('指の時間輪は実時間の残量を使い、画面内に収まり、ドラッグ終了で消える',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const source=html.slice(html.indexOf('function dragTimerGeometry()'),html.indexOf('function drawDragTimer()'));
 const context=vm.createContext({CONFIG:{DRAG_TIMER_RADIUS:13,DRAG_TIMER_OFFSET:34},clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),drag:{x:360,y:820},phase:'input',view:{timing:true,moveLeft:2},state:{moveTime:5},L:{W:375,H:844}});
 vm.runInContext(source,context);
 const timer=plain(vm.runInContext('dragTimerGeometry()',context));
 assert.equal(timer.ratio,.4);assert.equal(timer.remaining,2);assert(timer.x+timer.r<375);assert(timer.y+timer.r<844);
 vm.runInContext('view.moveLeft=1;drag.x=-50;drag.y=-50',context);
 const edge=plain(vm.runInContext('dragTimerGeometry()',context));assert.equal(edge.ratio,.2);assert(edge.x-edge.r>=0);assert(edge.y-edge.r>=0);
 vm.runInContext('view.timing=false',context);assert.equal(vm.runInContext('dragTimerGeometry().remaining',context),5);
 vm.runInContext('drag=null',context);assert.equal(vm.runInContext('dragTimerGeometry()',context),null);
});


test('狙い印は揺れオフ・軽減オン・OSの動き軽減で回転せず、通常設定でだけ回る',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const source=html.slice(html.indexOf('function quietControls()'),html.indexOf('function drawEnemyHud('));
 let reduced=false;const context=vm.createContext({settings:{shake:true,flash:false},reducedMotion:()=>reduced,clock:{real:2}});vm.runInContext(source,context);
 assert.equal(vm.runInContext('targetIndicatorRotation()',context),3);
 for(const expr of ['settings.shake=false','settings.shake=true;settings.flash=true']){vm.runInContext(expr,context);assert.equal(vm.runInContext('targetIndicatorRotation()',context),0);}
 vm.runInContext('settings.flash=false',context);reduced=true;assert.equal(vm.runInContext('targetIndicatorRotation()',context),0);
});


test('長押しの連鎖技一覧は習得済みと次の技を共有の名前・条件で表示する',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const context=vm.createContext({});
 vm.runInContext(html.slice(html.indexOf('const CONFIG ='),html.indexOf('// ===== UTIL ====='))+html.match(/^function artName\(.*$/m)[0]+'\n'+html.slice(html.indexOf('function perkText('),html.indexOf('// 仲間の詳細：立ち絵')),context);
 const panel=vm.runInContext('growthHtml(CHARS[0],20,true,true)',context);
 for(const word of ['紅閃','紅蓮斬','緋焔乱舞','Lv25','3連鎖で発動','5連鎖で発動','7連鎖で発動','未習得'])assert(panel.includes(word),word);
 for(const word of ['攻撃 +','スキルの溜め','Lv35','紅蓮天墜'])assert(!panel.includes(word),word);
 assert(vm.runInContext('growthHtml(CHARS[0],20)',context).includes('攻撃 +10%'),'既存の詳細は能力アップも保つ');
});
