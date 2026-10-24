import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,GAME_DEFAULTS} from '../game/core.mjs';
// These mechanics tests interact with creatures on the tick they spawn.
GAME_DEFAULTS.enemyArrival=0;
import {tickZoneRun,enterZoneSpellShop} from '../game/zone-run.mjs';
import {SPELLS,spellChoices,chooseSpell} from '../game/spell-system.mjs';

const creature=(name,boss=false)=>({id:name.toLowerCase(),name,className:name,body:39,stats:{hits:[20,20],damage:[2,2]},adaptation:{tier:1,hp:20,speed:20,damage:2,xp:1,radius:12,...(boss?{bossOnly:true,bossSpawnAt:600}:{})}});
const area=(id,n,combatClasses)=>({id,name:id,combatClasses,facets:['Trammel'],zoneIds:[id],typicalThreat:n,maximumThreat:n,biome:'grass'});
const catalog={zoneMode:true,zoneMonsterCount:2,areaCount:2,areas:[area('first',1,['Rat']),area('last',2,['Orc','Balron'])],monsters:[creature('Rat'),creature('Orc'),creature('Balron',true),creature('Unrelated')]};
function make(){const game=new Game(catalog,{seed:1});game.spawnLocation=()=>({x:400,y:400});return game;}
function clear(game){
 game.zoneRun.pressureElapsed=game.zonePlan.bossAt;tickZoneRun(game,.01);
 const boss=game.enemies.find(enemy=>enemy.zoneBoss);assert.ok(boss);game.hurtEnemy(boss,1e9);return boss;
}

test('timed waves wait for native placement and boss death opens evacuation while spawning continues',()=>{
  const game=new Game(catalog,{seed:1});assert.equal(game.enemies.length,0);
  tickZoneRun(game,5);assert.equal(game.zoneRun.spawned,0);
  game.spawnLocation=()=>({x:400,y:400});const boss=clear(game);
  assert.equal(boss.type,'rat');assert.ok(game.zoneRun.spawned>=0);assert.equal(game.zoneRun.killed,0);
  assert.equal(game.zoneRun.phase,'cleared');assert.equal(game.kills,1);
  const count=game.enemies.length;for(let i=0;i<100;i++)tickZoneRun(game,1);
  assert.ok(game.enemies.length>count);assert.equal(game.spawnEnemy(),null);
});

test('clock never advances native areas, cleared loot persists, manual gate advances then wins',()=>{
  const game=make();clear(game);assert.equal(enterZoneSpellShop(game),true);assert.equal(game.finishZoneSpellShop(),true);
  game.enemies=[];game.time=10000;game.pickups=[{id:8000,x:2000,y:2000,kind:'gold',value:10,life:1}];
  const corpse=game.corpses[0];corpse.life=1;
  game.update(1);assert.equal(game.currentArea().id,'first');assert.equal(game.status,'playing');
  assert.equal(game.pickups[0].life,1);assert.ok(game.corpses.includes(corpse));
  assert.equal(game.advanceZone(),true);assert.equal(game.currentArea().id,'last');assert.equal(game.pickups.length,0);
  assert.equal(game.advanceZone(),false);clear(game);enterZoneSpellShop(game);game.finishZoneSpellShop();assert.equal(game.status,'playing');
  assert.equal(game.advanceZone(),true);assert.equal(game.status,'victory');
});

test('gold spell shop charges purchase and escalating rerolls, never charges failed replacements',()=>{
  const game=make();chooseSpell(game,'fireball');clear(game);enterZoneSpellShop(game);game.player.gold=9;
  const initial=structuredClone(game.zoneSpellOffers);assert.equal(game.rerollZoneSpells(),false);assert.deepEqual(game.zoneSpellOffers,initial);
  game.player.gold=200;assert.equal(game.rerollZoneSpells(),true);assert.equal(game.player.gold,190);assert.equal(game.zoneSpellRerollPrice,15);
  const offensive=SPELLS.filter(spell=>spell.category==='offense');
  game.spellLoadout=[];for(const spell of offensive.slice(0,7))assert.equal(chooseSpell(game,spell.id).ok,true);
  const candidate=offensive.find(spell=>!game.spellLoadout.some(item=>item.id===spell.id));assert.ok(candidate);
  game.zoneSpellOffers=[{...candidate,id:'spell:'+candidate.id,spellId:candidate.id,type:'spell',level:1}];
  const gold=game.player.gold;assert.equal(game.buyZoneSpell(0),false);assert.equal(game.player.gold,gold);
  assert.equal(game.buyZoneSpell(0,game.spellLoadout[0].id),false);assert.equal(game.player.gold,gold);game.zoneSpellOffers=[{...spellChoices(game)[0],rarity:'common'}];
  assert.equal(game.buyZoneSpell(0),true);assert.equal(game.player.gold,gold-25);assert.equal(game.zoneRun.phase,'spellshop');
  const cost=game.zoneUpgradePrice(game.zoneSpellOffers[0]);assert.equal(game.buyZoneSpell(0),true);assert.equal(game.player.gold,gold-25-cost);
  game.finishZoneSpellShop();assert.equal(game.buyZoneSpell(0),false);
});

test('level rerolls cost gold, escalate for each selection, reset on next level',()=>{
  const game=make();game.player.xp=game.player.nextXp;game.checkLevel();game.player.gold=100;
  assert.equal(game.levelRerollPrice,15);assert.equal(game.reroll(),true);assert.equal(game.player.gold,85);assert.equal(game.levelRerollPrice,20);
  game.player.gold=19;const choices=structuredClone(game.choices);assert.equal(game.reroll(),false);assert.deepEqual(game.choices,choices);
  const passive=game.choices.findIndex(choice=>choice.type!=='spell');game.chooseUpgrade(passive);game.player.xp=game.player.nextXp;game.checkLevel();assert.equal(game.levelRerollPrice,15);
});

test('zone state round trips every phase and rejects malformed progression',()=>{
  const game=make();assert.equal(Game.restore(catalog,game.snapshot()).zoneRun.phase,'combat');
  clear(game);assert.deepEqual(Game.restore(catalog,game.snapshot()).zoneSpellOffers,game.zoneSpellOffers);
  enterZoneSpellShop(game);game.finishZoneSpellShop();assert.equal(Game.restore(catalog,game.snapshot()).zoneRun.phase,'ready');
  for(const alter of [s=>s.zoneRun.index=9,s=>s.zoneRun.phase='unknown',s=>s.zoneRun.killed=100,s=>s.zoneRun.bossKilled=false,s=>s.zoneSpellOffers=[{spellId:'fake'}]]){
    const state=game.snapshot();alter(state);assert.throws(()=>Game.restore(catalog,state),/invalid survivor save/);
  }
  const old=new Game({...catalog,zoneMode:false},{seed:1}).snapshot();delete old.zoneRun;delete old.zoneSpellOffers;
  const restored=Game.restore(catalog,old);assert.equal(restored.zoneRun,null);assert.equal(restored.enemies.length,3);
});

test('boss-only areas spawn their guardian and a local champion without unrelated waves',()=>{
  const data={...catalog,areas:[area('boss',1,['Balron'])],areaCount:1};const game=new Game(data);
  game.spawnLocation=()=>({x:400,y:400});assert.equal(game.zonePlan.bossAt,0);tickZoneRun(game,1);
  const boss=game.enemies.find(e=>e.zoneBoss);assert.ok(boss);assert.equal(game.enemies.filter(e=>e.captain).length,1);assert.ok(game.enemies.every(e=>e.type==='balron'));assert.ok(boss.hp>=150);
  const count=game.enemies.length;tickZoneRun(game,100);assert.equal(game.enemies.length,count);game.hurtEnemy(boss,1e9);assert.equal(game.zoneRun.phase,'cleared');
});

test('a nearby moongate keeps its saved position and rejects corrupt gate coordinates',()=>{
  const game=make();clear(game);enterZoneSpellShop(game);game.finishZoneSpellShop();game.zoneRun.gate={x:333,y:444};
  assert.deepEqual(Game.restore(catalog,game.snapshot()).zoneRun.gate,{x:333,y:444});
  const invalid=game.snapshot();invalid.zoneRun.gate.x=Infinity;
  assert.throws(()=>Game.restore(catalog,invalid),/invalid survivor save/);
});


test('finite placement uses each monster body radius instead of oversized generic boss clearance',()=>{
 const game=make(),calls=[];game.spawnLocation=(area,radius,boss)=>{calls.push({radius,boss});return {x:200,y:200};};
 game.spawnEnemy(catalog.monsters[0],false,false,{zoneEncounter:true});
 game.spawnEnemy(catalog.monsters[0],true,false,{zoneEncounter:true});
 assert.deepEqual(calls,[{radius:12,boss:false},{radius:19.200000000000003,boss:true}]);
});


test('clear opens the gate without a shop, preserves loot, then entry opens the sequential shop',()=>{
 const game=make();chooseSpell(game,'fireball');clear(game);const loot=structuredClone(game.pickups);
 assert.equal(game.zoneRun.phase,'cleared');assert.deepEqual(game.zoneSpellOffers,[]);
 assert.equal(game.finishZoneSpellShop(),false);assert.equal(game.advanceZone(),false);assert.equal(game.buyZoneSpell(0),false);
 assert.equal(enterZoneSpellShop(game),true);assert.equal(enterZoneSpellShop(game),false);
 assert.ok(game.zoneSpellOffers.length);assert.deepEqual(game.pickups,loot);
 assert.equal(Game.restore(catalog,game.snapshot()).zoneRun.phase,'spellshop');
 game.finishZoneSpellShop();assert.equal(game.zoneRun.phase,'ready');game.advanceZone();assert.equal(game.zoneRun.phase,'combat');assert.equal(game.pickups.length,0);
});
test('old pre-gate shop saves migrate to loot gathering without spending gold',()=>{
 const game=make();clear(game);enterZoneSpellShop(game);const state=game.snapshot();delete state.zoneRun.flowVersion;
 const restored=Game.restore(catalog,state);assert.equal(restored.zoneRun.phase,'cleared');assert.deepEqual(restored.zoneSpellOffers,[]);assert.equal(restored.player.gold,state.player.gold);assert.deepEqual(restored.pickups,state.pickups);
});
