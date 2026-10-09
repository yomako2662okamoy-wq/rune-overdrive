// Bot policy only. Matching, combat, skills and growth use the game's LOGIC.
export function choosePath(board,K,random,logic){
 const starts=[];for(let r=0;r<board.length;r++)for(let c=0;c<board[0].length;c++)if(!board[r][c].lock)starts.push([r,c]);
 // The grabbed rune remains unlocked; any adjacent cell is traversable.
 const graph=board.map((row,r)=>row.map((_,c)=>{
  const list=[];for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++)if((dr||dc)&&board[r+dr]?.[c+dc])list.push([r+dr,c+dc]);return list;
 }));
 let best={board,path:[],score:-1};
 for(let k=0;k<K&&starts.length;k++){
  const b=board.map(row=>row.map(o=>({...o})));let [r,c]=starts[Math.floor(random()*starts.length)];const path=[[r,c]];
  while(path.length<25){
   const neighbors=graph[r][c];
   if(!neighbors.length)break;
   const [nr,nc]=neighbors[Math.floor(random()*neighbors.length)];
   [b[r][c],b[nr][nc]]=[b[nr][nc],b[r][c]];r=nr;c=nc;path.push([r,c]);
  }
  if(path.length<2)continue;
  const score=logic.findGroups(b).length;if(score>best.score)best={board:b,path,score};
 }
 return best;
}
export function simulateRun(loaded,dungeon,level,seed,K=100,maxTurns=200){
 const {logic,config}=loaded,data=logic.createSave();for(const m of Object.values(data.roster))m.lv=level;
 const team=logic.prepareTeam(data),rng=logic.makeRngs(seed),pathRng=logic.mulberry32(seed^0x735a2d97);
 let game={...team,rules:config,board:logic.makeBoard(false,rng.board,config),teamHp:team.teamMax,enemies:[],target:-1,od:{active:false,chain:0},buffs:{},timeBonus:0,stats:{maxCombo:0,totalDmg:0,turns:0,ods:0},earnedExp:0};
 let combos=0,minHp=game.teamHp,reason='clear';
 for(let floor=0;floor<dungeon.floors.length;floor++){
  game.enemies=logic.makeEnemies(dungeon.floors[floor],config.HP_SCALE);game.target=-1;
  game=logic.resolveEnemySkills(game,'preempt',rng).next;
  while(game.teamHp>0&&game.enemies.some(e=>e.hp>0)&&game.stats.turns<maxTurns){
   for(let member=0;member<game.party.length;member++){
    const m=game.party[member];
    if(m.cd===0&&((m.skill.type==='heal'&&game.teamHp<=game.teamMax*.5)||(m.skill.type==='delay'&&game.enemies.some(e=>e.hp>0&&e.cd<=1))))
     game=logic.resolveSkill(game,{member},rng).next;
   }
   const choice=choosePath(game.board,K,pathRng,logic);if(choice.path.length<2){reason='no_path';break;}
   const result=logic.resolveTurn(game,{board:choice.board},rng);game=result.next;
   combos+=result.events.filter(e=>e.t==='pop').length;
   for(const e of result.events)if(['enemyAtk','poison','heal'].includes(e.t))minHp=Math.min(minHp,e.hp);
  }
  if(reason==='no_path'||game.teamHp<=0||game.enemies.some(e=>e.hp>0)){reason=reason==='no_path'?reason:game.teamHp<=0?'defeat':'turn_limit';break;}
 }
 return {clear:reason==='clear',reason,turns:game.stats.turns,combos,ods:game.stats.ods,minHp,minHpPct:100*minHp/game.teamMax};
}
export function simulateCase(loaded,o){
 const d=loaded.dungeons.find(d=>d.id===o.dungeon),level=o.level??d.recommendedLv;
 const runs=Array.from({length:o.trials},(_,i)=>simulateRun(loaded,d,level,(o.seed+i*7919+Number(d.id.slice(1))*104729)>>>0,o.K,o.maxTurns));
 const sum=k=>runs.reduce((s,r)=>s+r[k],0),clears=runs.filter(r=>r.clear).length;
 return {dungeon:d.id,level,K:o.K,trials:runs.length,clears,clearRate:100*clears/runs.length,avgTurns:sum('turns')/runs.length,avgDungeonTurns:sum('turns')/runs.length,avgClearTurns:clears?runs.filter(r=>r.clear).reduce((total,r)=>total+r.turns,0)/clears:0,avgCombos:sum('combos')/Math.max(1,sum('turns')),avgOD:sum('ods')/runs.length,avgMinHP:sum('minHp')/runs.length,avgMinHPPct:sum('minHpPct')/runs.length,minHP:Math.min(...runs.map(r=>r.minHp)),timeouts:runs.filter(r=>r.reason==='turn_limit').length,noPaths:runs.filter(r=>r.reason==='no_path').length,seed:o.seed};
}
