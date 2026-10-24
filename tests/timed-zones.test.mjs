import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game,GAME_DEFAULTS} from '../game/core.mjs';
// These mechanics tests interact with creatures on the tick they spawn.
GAME_DEFAULTS.enemyArrival=0;
import {tickZoneRun,enterZoneSpellShop,zonePressure,rollZoneSpells,buyZoneSpell} from '../game/zone-run.mjs';
import {buildZonePacing,timelineEvents} from '../game/zone-pacing.mjs';
import {tickGoldOre,placeGoldOre,syncGoldOre} from '../game/mining.mjs';
import {createLocationMap} from '../game/location-map.mjs';
const rat={id:'rat',className:'Rat',name:'Rat',body:238,stats:{hits:[20,20],damage:[2,2]},adaptation:{hp:20,damage:2,xp:1,speed:20,radius:12}};
const area={id:'rats',name:'Rats',combatClasses:['Rat'],facets:['Trammel'],zoneIds:['rats'],typicalThreat:1,maximumThreat:1};
const catalog={monsters:[rat],areas:[area],zoneMode:true};
function fixture(){const g=new Game(catalog,{seed:22});g.spawnLocation=()=>({x:300,y:300});return g;}
function tick(g,seconds){for(let t=0;t<Math.round(seconds*60);t++)tickZoneRun(g,1/60);}

test('hordes start every 30 seconds independently of kills, then boss arrives at two minutes with enemies still alive',()=>{
 const g=fixture();tickZoneRun(g,0);assert.equal(g.zonePlan.bossAt,120);assert.equal(g.zoneRun.waveIndex,1);tick(g,29);assert.equal(g.zoneRun.waveIndex,1);assert.ok(g.zoneRun.spawned>=25&&g.zoneRun.spawned<=50);assert.equal(g.zoneRun.killed,0);
 tick(g,2);assert.equal(g.zoneRun.waveIndex,2);assert.ok(g.zoneRun.spawned>25);tick(g,88);assert.equal(g.zoneRun.bossSpawned,false);tick(g,2);assert.equal(g.zoneRun.bossSpawned,true);assert.ok(g.enemies.some(e=>!e.zoneBoss&&e.hp>0));
 const boss=g.enemies.find(e=>e.zoneBoss),ordinary=g.spawnEnemy(rat,false,false,{zoneEncounter:true,zoneRole:'reinforcement'});assert.ok(Math.abs(boss.maxHp/ordinary.maxHp-7.5)<.2);assert.ok(Math.abs(boss.damage/ordinary.damage-2.5)<1e-8);
 const before=g.zoneRun.waveIndex;tick(g,31);assert.ok(g.zoneRun.waveIndex>before);g.hurtEnemy(boss,1e9);assert.equal(g.zoneRun.phase,'cleared');assert.ok(g.enemies.length>0);const spawned=g.zoneRun.spawned,baseline=zonePressure(g);tick(g,9);assert.equal(g.zoneRun.waveIndex,g.zoneRun.bossKilledWave);tick(g,2);assert.equal(g.zoneRun.waveIndex,g.zoneRun.bossKilledWave+1);assert.ok(g.zoneRun.spawned>spawned);assert.ok(zonePressure(g).hp>baseline.hp);assert.ok(zonePressure(g).damage>baseline.damage);assert.ok(zonePressure(g).speed>baseline.speed);assert.ok(zonePressure(g).interval<baseline.interval);
 const wave=g.zoneRun.waveIndex;tick(g,8);assert.ok(g.zoneRun.waveIndex>wave);g.hurtEnemy(ordinary,1e9);assert.equal(g.kills,2,'evacuation enemies remain real combatants');const restored=Game.restore(catalog,g.snapshot());restored.spawnLocation=g.spawnLocation;assert.equal(restored.zoneRun.bossKilledAt,g.zoneRun.bossKilledAt);assert.equal(restored.zoneRun.waveIndex,g.zoneRun.waveIndex);assert.equal(restored.enemies.some(e=>e.zoneBoss&&e.hp>0),false);const count=restored.zoneRun.spawned;enterZoneSpellShop(restored);assert.equal(restored.enemies.length,0);tick(restored,60);assert.equal(restored.zoneRun.spawned,count);

});

test('wave state resumes at the same schedule without a population cap and preserves pressure',()=>{
 const g=fixture();tick(g,46);const restored=Game.restore(catalog,g.snapshot());restored.spawnLocation=g.spawnLocation;assert.deepEqual(restored.zoneRun,g.zoneRun);assert.equal(restored.zoneRun.waveIndex,2);tick(restored,15);assert.equal(restored.zoneRun.waveIndex,3);
 tick(restored,300);assert.ok(restored.enemies.length>200);assert.ok(restored.enemies.every(e=>e.speed<=135));assert.ok(zonePressure(restored).hp>1);assert.ok(zonePressure(restored).damage>1);assert.ok(restored.enemies[0].speed>20);
 for(const patch of [{waveRemaining:-1},{waveIndex:-1},{pressureElapsed:Infinity}]){const state=g.snapshot();Object.assign(state.zoneRun,patch);assert.throws(()=>Game.restore(catalog,state));}
});

test('higher source/difficulty brackets monotonically increase duration, wave sizes and spread while first zone stays 120 seconds',()=>{
 const areas=Array.from({length:20},(_,i)=>({...area,id:'a'+i,typicalThreat:2**i})),route=areas.map((a,i)=>({...a,bracket:Math.floor(i*8/20)}));const data={...catalog,areas};
 for(const difficulty of ['easy','normal','hard']){const plans=buildZonePacing(route,data,difficulty);assert.equal(plans[0].bossAt,120);for(let i=1;i<plans.length;i++){assert.ok(plans[i].bossAt>=plans[i-1].bossAt);assert.ok(plans[i].waveSize>=plans[i-1].waveSize);assert.ok(plans[i].spread>=plans[i-1].spread);}assert.deepEqual(timelineEvents(plans[0]),[{time:30,kind:'wave'},{time:60,kind:'wave'},{time:90,kind:'wave'},{time:120,kind:'boss'}]);}
 const hard=buildZonePacing(route,data,'hard'),easy=buildZonePacing(route,data,'easy');assert.ok(hard.at(-1).bossAt>easy.at(-1).bossAt);assert.ok(hard.at(-1).waveSize>easy.at(-1).waveSize);
 const g=fixture(),angles=[];g.spawnLocation=(a,r,b,o)=>{if(!b&&o.zoneRole!=='champion')angles.push(o.spawnAngle);return {x:300,y:300};};tick(g,12);assert.ok(new Set(angles).size>=25);assert.equal(new Set(angles).size,angles.length);const sizes=[];for(let seed=1;seed<20;seed++){const h=new Game(catalog,{seed});h.spawnLocation=g.spawnLocation;tickZoneRun(h,0);sizes.push(h.zoneRun.lastWaveSize);}assert.ok(new Set(sizes).size>5);assert.ok(sizes.every(n=>n>=25&&n<=50));
});

test('legacy quota saves migrate to elapsed progression and strengthen their existing boss only once',()=>{
 const g=fixture();const state=g.snapshot();state.zoneRun={version:2,flowVersion:2,champions:0,index:0,phase:'combat',spawned:60,killed:30,quota:60,bossSpawned:false,bossKilled:false,rerolls:0};const restored=Game.restore(catalog,state);assert.equal(restored.zoneRun.version,4);assert.equal(restored.zoneRun.pressureElapsed,60);assert.equal(restored.zoneRun.waveIndex,3);assert.equal(restored.zoneRun.killed,30);
 g.zoneRun.pressureElapsed=120;tickZoneRun(g,0);const saved=g.snapshot();saved.zoneRun={version:2,flowVersion:2,champions:0,index:0,phase:'combat',spawned:60,killed:60,quota:60,bossSpawned:true,bossKilled:false,rerolls:0};for(const e of saved.enemies){delete e.pressureStats;delete e.zoneBossStatsVersion;if(e.zoneBoss){e.hp=e.maxHp=20;e.damage=2;}}
 const migrated=Game.restore(catalog,saved),boss=migrated.enemies.find(e=>e.zoneBoss);assert.ok(boss.maxHp>=150);assert.equal(Game.restore(catalog,migrated.snapshot()).enemies.find(e=>e.zoneBoss).maxHp,boss.maxHp);
});

test('existing timed bosses lose half their HP once on restore, preserving injury and damage',()=>{
 const g=fixture();g.zoneRun.pressureElapsed=120;tickZoneRun(g,0);const state=g.snapshot(),old=state.enemies.find(e=>e.zoneBoss);old.zoneBossStatsVersion=1;old.maxHp*=2;old.hp=old.maxHp*.4;
 const restored=Game.restore(catalog,state),boss=restored.enemies.find(e=>e.zoneBoss);assert.equal(boss.maxHp,old.maxHp/2);assert.equal(boss.hp,old.hp/2);assert.equal(boss.damage,old.damage);assert.deepEqual(boss.pressureStats,old.pressureStats);assert.equal(boss.hp/boss.maxHp,.4);
 const again=Game.restore(catalog,restored.snapshot()).enemies.find(e=>e.zoneBoss);assert.equal(again.maxHp,boss.maxHp);assert.equal(again.hp,boss.hp);assert.equal(again.damage,boss.damage);
});

test('shop prices rise by rarity, charge exactly the advertised cost, and reject unaffordable offers without changing progress',()=>{
 const g=fixture();g.zoneRun.phase='spellshop';g.player.gold=1000;rollZoneSpells(g);const offer=g.zoneSpellOffers[0];const prices=['common','uncommon','rare','epic','legendary'].map(rarity=>g.zoneUpgradePrice({...offer,rarity}));assert.deepEqual(prices,[25,38,50,75,100]);
 for(const rarity of ['common','uncommon','rare','epic','legendary']){g.zoneSpellOffers=[{...offer,rarity,bonus:{common:.05,uncommon:.10,rare:.15,epic:.25,legendary:.5}[rarity]}];const cost=g.zoneUpgradePrice(g.zoneSpellOffers[0]);g.player.gold=cost-1;const before=structuredClone(g.upgrades);assert.equal(buyZoneSpell(g,0),false);assert.deepEqual(g.upgrades,before);g.player.gold=cost;assert.equal(buyZoneSpell(g,0),true);assert.equal(g.player.gold,0);}
});

test('gold, XP and item pickups float above the hero, aggregate rapid currency gains, and keep feedback bounded',()=>{
 const g=fixture();g.elevationAt=()=>15;g.notifyLoot({kind:'gold',value:10});g.notifyLoot({kind:'gold',value:20});const gold=g.effects.find(e=>e.kind==='reward-text');assert.equal(gold.text,'+30 gold');assert.equal(gold.z,15);g.collect({kind:'xp',value:2});assert.ok(g.effects.some(e=>e.text==='+2 XP'));
 g.notifyLoot({kind:'item',item:{name:'Golden ring'}});assert.ok(g.effects.some(e=>e.text==='Golden ring'));for(let n=0;n<100;n++)g.notifyLoot({kind:'item',item:{name:'Ring '+n}});assert.ok(g.effects.filter(e=>e.kind==='reward-text').length<=8);assert.ok(g.drainLootEvents().length<=64);
});

test('stale ore height is repaired on load or relocation, supports slopes, and rejects a separate floor',()=>{
 const g=fixture();g.pickups=[{id:10,x:25,y:0,z:40,kind:'ore',radius:18,value:10,strikes:4,progress:2,mining:false}];g.player.x=g.player.y=0;g.elevationAt=(x)=>x/5;g.canTraverse=()=>true;g.clearSight=()=>true;syncGoldOre(g);assert.equal(g.pickups[0].z,5);assert.equal(g.pickups[0].progress,0);tickGoldOre(g,3,false);assert.equal(g.player.gold,10);g.canTraverse=()=>false;tickGoldOre(g,3,false);assert.equal(g.player.gold,10);
});

test('ore in all 73 native zones rests on its actual reachable walking floor and can be mined',()=>{
 const source=JSON.parse(readFileSync(new URL('../game/assets/locations/manifest.json',import.meta.url),'utf8'));
 for(const r of source.regions){const map=createLocationMap({regions:[r]},{}),point=map.nearestPlayable(r.spawn.x,r.spawn.y),g=fixture();g.enemies=[];g.pickups=[];g.player.x=point.x+10000;g.player.y=point.y;g.elevationAt=map.elevationAt;g.canStand=(x,y)=>map.isPlayable(x,y);g.canTraverse=map.canTraverse;g.clearSight=()=>true;
  assert.equal(placeGoldOre(g,[point],'test'),1,r.name);const ore=g.pickups[0];ore.z+=40;Object.assign(g.player,point);tickGoldOre(g,3,false);assert.equal(ore.z,map.elevationAt(ore.x,ore.y),r.name);assert.equal(g.player.gold,10,r.name);assert.equal(ore.strikes,3,r.name);
 }
});


test('moongate opens immediately for 30 seconds, persists its countdown and ends a missed evacuation',()=>{
 const g=fixture();g.zoneRun.pressureElapsed=120;tickZoneRun(g,0);g.hurtEnemy(g.enemies.find(e=>e.zoneBoss),1e9);
 assert.equal(g.zoneRun.phase,'cleared');assert.equal(g.zoneProgress().gateRemaining,30);tick(g,12);assert.ok(Math.abs(g.zoneProgress().gateRemaining-18)<1e-6);
 const restored=Game.restore(catalog,g.snapshot());restored.spawnLocation=g.spawnLocation;assert.equal(restored.zoneRun.gateRemaining,g.zoneRun.gateRemaining);restored.pause();tick(restored,100);assert.equal(restored.zoneRun.gateRemaining,g.zoneRun.gateRemaining);restored.pause();tick(restored,17.9);assert.equal(restored.status,'playing');tick(restored,.1);assert.equal(restored.status,'dead');assert.equal(restored.player.hp,0);assert.equal(restored.zoneRun.gateRemaining,0);assert.equal(restored.zoneRun.gateExpired,true);assert.equal(enterZoneSpellShop(restored),false);
 const escaped=Game.restore(catalog,g.snapshot());escaped.spawnLocation=g.spawnLocation;assert.equal(enterZoneSpellShop(escaped),true);tick(escaped,100);assert.equal(escaped.status,'playing');assert.equal(escaped.zoneRun.gateExpired,undefined);
 for(const gateRemaining of [-1,31,Infinity]){const snapshot=g.snapshot();snapshot.zoneRun.gateRemaining=gateRemaining;assert.throws(()=>Game.restore(catalog,snapshot));}
});
