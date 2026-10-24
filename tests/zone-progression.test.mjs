import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Game,GAME_DEFAULTS} from '../game/core.mjs';
// These mechanics tests interact with creatures on the tick they spawn.
GAME_DEFAULTS.enemyArrival=0;
import {chooseProgressiveRoute,buildZoneProgression,difficultyAreaCount} from '../game/zone-progression.mjs';
import {lastEnemyGuides} from '../game/guidance.mjs';
import {chooseSpell} from '../game/spell-system.mjs';
import {tickZoneRun} from '../game/zone-run.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('../game/data/catalog.json',import.meta.url)));
const areas=JSON.parse(fs.readFileSync(new URL('../game/data/areas.json',import.meta.url))).areas;
const data={...catalog,areas,zoneMode:true};delete data.areaCount;
test('difficulty routes contain 20, 35, or all unique areas, shuffle within ordered brackets and scale upward',()=>{
 for(const [difficulty,count] of [['easy',20],['normal',35],['hard',areas.length]]){
  const game=new Game(data,{seed:712,difficulty});assert.equal(game.areaRoute.length,count);assert.equal(difficultyAreaCount(areas,difficulty),count);
  assert.equal(new Set(game.areaRoute.map(a=>a.id)).size,count);
  assert.deepEqual(Game.restore(data,game.snapshot()).areaRoute,game.areaRoute);
  const progression=buildZoneProgression(game.areaRoute,data);
  for(let i=1;i<count;i++){assert.ok(game.areaRoute[i].bracket>=game.areaRoute[i-1].bracket);for(const key of ['targetHp','targetDamage','targetXp','gold','loot','magicFind'])assert.ok(progression[i][key]>progression[i-1][key],key);}
 }
 assert.notDeepEqual(chooseProgressiveRoute(areas,areas.length,712),chooseProgressiveRoute(areas,areas.length,713));
});
test('level and shop draws stay mixed over repeated rerolls, with a new passive option',()=>{
 const game=new Game(data,{seed:5});chooseSpell(game,'fireball');chooseSpell(game,'heal');
 for(let i=0;i<100;i++){game.rollChoices();assert.deepEqual(new Set(game.choices.map(c=>c.type||'passive')),new Set(['spell','global','passive']));}
});
test('each wave includes a champion, boss arrives with local escorts, boss death opens evacuation',()=>{
 const rat={id:'zone-test-mage',ranged:true,className:'Rat',name:'Rat',body:238,stats:{hits:[20,20],damage:[2,2]},adaptation:{hp:20,damage:2,xp:1,speed:20,radius:12}};
 const area={id:'rats',name:'Rats',combatClasses:['Rat'],facets:['Trammel'],zoneIds:['rats'],typicalThreat:1,maximumThreat:1,biome:'grass'};
 const game=new Game({monsters:[rat],areas:[area],zoneMode:true,zoneMonsterCount:12,areaCount:1},{seed:2,duration:10});game.spawnLocation=()=>({x:400,y:400});
 let champions=0,boss;
 for(let step=0;step<130&&!boss;step++){
  tickZoneRun(game,1);
  for(const enemy of [...game.enemies].filter(e=>e.hp>0)){if(enemy.zoneBoss){boss=enemy;break;}if(enemy.captain)champions++;game.hurtEnemy(enemy,1e8);}
 }
 assert.equal(champions,5);assert.ok(boss);assert.ok(game.enemies.filter(e=>e.hp>0&&!e.zoneBoss).length>=4);
 game.hurtEnemy(boss,1e8);assert.equal(game.zoneRun.phase,'cleared');
 assert.equal(Game.restore(game.catalog,game.snapshot()).zoneRun.bossKilled,true);
 for(const enemy of game.enemies.filter(e=>e.hp>0))game.hurtEnemy(enemy,1e8);
 assert.equal(game.zoneRun.phase,'cleared');assert.ok(game.zoneRun.killed>12);
 assert.equal(game.zoneSpellOffers.length,0);
});
test('last five remaining enemies get offscreen native arrows only during combat',()=>{
 const game={zoneRun:{index:0,phase:'combat',quota:60,spawned:60},player:{x:0,y:0},enemies:Array.from({length:5},(_,id)=>({id,x:1000,y:id*100,hp:1,zoneIndex:0}))};
 assert.equal(lastEnemyGuides(game,900,700).length,5);game.zoneRun.spawned=59;assert.equal(lastEnemyGuides(game,900,700).length,0);game.zoneRun.spawned=60;game.zoneRun.phase='spellshop';assert.equal(lastEnemyGuides(game,900,700).length,0);
});
