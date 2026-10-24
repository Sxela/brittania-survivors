import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,GAME_DEFAULTS} from '../game/core.mjs';
// These mechanics tests interact with creatures on the tick they spawn.
GAME_DEFAULTS.enemyArrival=0;
import {placeGoldOre,MINING_STRIKE_SECONDS,areaOreBudget,miningBonuses,oreInMeleeRange,tickGoldOre} from '../game/mining.mjs';
import {mapPoint} from '../game/map-regions.mjs';
import {rollZoneSpells,buyZoneSpell} from '../game/zone-run.mjs';
function fixture(){const g=new Game({}, {seed:15});g.enemies=[];g.spawnClock=g.attackClock=g.novaClock=g.chainClock=99999;g.player.gold=0;g.pickups=[{id:g.nextId++,x:25,y:0,z:0,radius:18,kind:'ore',value:10,strikes:1,progress:0,mining:false}];return g;}
function tick(g,seconds,input={}){for(let i=0;i<Math.round(seconds*60);i++)g.update(1/60,input);}

test('varied deposits replace the expected lost monster gold and grow with area progression',()=>{
 const g=fixture();g.pickups=[];const points=Array.from({length:80},(_,n)=>({x:200+n*180,y:100}));
 Object.defineProperty(g,'zonePlan',{value:{bossAt:120,waveEvery:30,waveMin:25,waveMax:50,growth:5},configurable:true});
 const budget=areaOreBudget(g);assert.equal(budget,208);
 assert.equal(placeGoldOre(g,points,'first'),32);assert.ok(new Set(g.pickups.map(p=>p.value)).size>1);
 assert.ok(Math.abs(g.pickups.reduce((sum,p)=>sum+p.value*p.strikes,0)-budget)<=2);
 assert.deepEqual(new Set(g.pickups.map(p=>p.rockVariant)),new Set([0,1,2]));
 const groups=Map.groupBy(g.pickups,p=>p.clusterId);assert.equal(groups.size,8);for(const group of groups.values()){assert.equal(group.length,4);assert.ok(group.every(p=>p.strikes===1&&Math.hypot(p.x-group[0].x,p.y-group[0].y)<=63));}
 const snapshot=g.snapshot(),restored=Game.restore({},snapshot);assert.deepEqual(restored.pickups,g.pickups);
 g.zoneRun={index:8};g.pickups=[];assert.equal(placeGoldOre(g,points,'later'),48);
});

test('an equipped pickaxe and Mining skill improve mining without changing stored ore value',()=>{
 const g=fixture(),tool={uid:999,id:'gargoyles-pickaxe',itemId:0xe86,slot:'weapon',skillBonuses:[{skill:'Mining',value:10}]};
 g.inventory.push(tool);g.equipment.weapon=tool.uid;
 assert.deepEqual(miningBonuses(g),{speed:1.3,yield:1.25});
 tick(g,2.32);assert.equal(g.player.gold,13);assert.equal(g.pickups.length,0);
 assert.equal(g.equipped('weapon'),tool);
});

test('ordinary coin rewards are reduced while boss and champion payouts remain larger',()=>{
 const g=fixture();g.pickups=[];g.random=()=>.06;
 const ordinary=g.spawnEnemy();g.hurtEnemy(ordinary,1e6);assert.equal(g.pickups.filter(p=>p.kind==='gold').length,0);
 const captain=g.spawnEnemy();captain.captain=true;g.hurtEnemy(captain,1e6);assert.ok(g.player.gold>=6);
 const before=g.player.gold,boss=g.spawnEnemy();boss.boss=true;g.hurtEnemy(boss,1e6);assert.ok(g.player.gold-before>=15);
});
test('ore is stationary, ignores magnets, and depletes after one strike with no repeat payout',()=>{
 const g=fixture();g.upgrades.magnet=20;tick(g,2.5);assert.equal(g.player.gold,0);assert.equal(g.pickups[0].x,25);tick(g,.5);assert.equal(g.player.gold,10);assert.equal(g.pickups.length,0);tick(g,9);assert.equal(g.player.gold,10);
});
test('mining range is the same or any adjacent original tile, including diagonals and tile corners',()=>{
 const center=mapPoint(.5,.5);
 for(let a=-2;a<=2;a++)for(let b=-2;b<=2;b++)assert.equal(oreInMeleeRange(center,mapPoint(a+.5,b+.5)),Math.max(Math.abs(a),Math.abs(b))<=1);
 assert.equal(oreInMeleeRange(mapPoint(.01,.01),mapPoint(1.99,1.99)),true,'adjacent tiles can be farther than the old pixel radius');
 assert.equal(oreInMeleeRange(mapPoint(.99,.99),mapPoint(2.01,.99)),false,'nearby pixels can still be two original tiles away');
 const g=fixture();Object.assign(g.player,center);Object.assign(g.pickups[0],mapPoint(2.01,.99));tick(g,3);assert.equal(g.player.gold,0);Object.assign(g.pickups[0],mapPoint(1.99,1.99));tick(g,3);assert.equal(g.player.gold,10);
});
test('walking around a nearby ore keeps mining active and pays once when its HP reaches zero',()=>{
 const g=fixture(),ore=g.pickups[0];
 for(let n=0;n<6;n++){tick(g,.25,{x:1});tick(g,.25,{x:-1});}
 assert.equal(g.player.gold,10);assert.equal(ore.hp,0);assert.equal(ore.collected,true);assert.equal(g.pickups.length,0);
 tick(g,3,{x:1});assert.equal(g.player.gold,10);
});
test('moving closer to another rock does not restart the current reachable mining target',()=>{
 const g=fixture(),first=g.pickups[0];g.pickups.push({...first,id:g.nextId++,x:-5,mining:false});
 tickGoldOre(g,1);assert.equal(g.pickups[1].mining,true);g.player.x=20;tickGoldOre(g,1);
 assert.equal(g.pickups[1].mining,true);assert.equal(g.pickups[1].progress,2);assert.equal(first.progress,0);
});

test('older multi-strike rocks convert to one strike without losing remaining rewards or progress',()=>{
 const g=fixture();g.pickups[0].strikes=3;g.pickups[0].progress=1;
 const restored=Game.restore({},g.snapshot());tick(restored,.5);assert.equal(restored.pickups[0].strikes,1);assert.equal(restored.pickups[0].value,30);assert.ok(restored.pickups[0].progress>1);tick(restored,1.5);assert.equal(restored.player.gold,30);assert.equal(restored.pickups.length,0);
});

test('leaving tile range or losing floor access or sight pauses mining without healing the rock',()=>{
 const g=fixture(),ore=g.pickups[0];ore.hp=ore.maxHp=2;tick(g,3);assert.equal(ore.hp,1);assert.equal(g.player.gold,0);
 g.player.x=150;tick(g,3);assert.equal(ore.hp,1);assert.equal(ore.progress,0);assert.equal(ore.mining,false);
 g.player.x=0;g.elevationAt=x=>x===g.player.x?20:0;tick(g,3);assert.equal(g.player.gold,0);
 g.elevationAt=()=>0;g.clearSight=()=>false;tick(g,3);assert.equal(g.player.gold,0);assert.equal(ore.hp,1);
 const restored=Game.restore({},g.snapshot());assert.equal(restored.pickups[0].hp,1);assert.equal(restored.pickups[0].maxHp,2);
 g.clearSight=()=>true;tick(g,3);assert.equal(g.player.gold,10);assert.equal(g.pickups.length,0);
});

test('mining keeps enemies active, pauses with the game and preserves exact progress in saves',()=>{
 const g=fixture();const enemy=g.spawnEnemy();Object.assign(enemy,{x:0,y:0,speed:0,damage:10,castClock:999});const hp=g.player.hp;tick(g,.2);assert.ok(g.player.hp<hp);g.enemies=[];g.pause();const progress=g.pickups[0].progress;tick(g,2);assert.equal(g.pickups[0].progress,progress);const restored=Game.restore({},g.snapshot());assert.equal(restored.pickups[0].progress,progress);restored.pause();tick(restored,3-progress+.05);assert.equal(restored.player.gold,10);
});
test('deposits are placed once per area, remain depleted across save/load, and malformed progress fails validation',()=>{
 const g=fixture();g.pickups=[];const points=Array.from({length:20},(_,n)=>({x:200+n*240,y:100}));assert.equal(placeGoldOre(g,points,'area:0'),32);assert.equal(placeGoldOre(g,points,'area:0'),0);g.pickups=[];const restored=Game.restore({},g.snapshot());assert.equal(placeGoldOre(restored,points,'area:0'),0);assert.equal(placeGoldOre(restored,points,'area:1'),32);
 for(const patch of [{progress:Infinity},{strikes:0},{strikes:1.2},{progress:MINING_STRIKE_SECONDS},{value:-1},{hp:0},{hp:2,maxHp:1},{maxHp:Infinity}]){const snapshot=restored.snapshot();Object.assign(snapshot.pickups[0],patch);assert.throws(()=>Game.restore({},snapshot));}
});
test('shop always offers five unique improvements, including before learning spells, and supports repeated purchases until funds run out',()=>{
 const g=new Game({}, {seed:31});g.zoneRun={phase:'spellshop',rerolls:0,index:0};g.player.gold=1000;let spent=0;for(let n=0;n<3;n++){rollZoneSpells(g);assert.equal(g.zoneSpellOffers.length,5);assert.equal(new Set(g.zoneSpellOffers.map(c=>c.id)).size,5);assert.ok(g.zoneSpellOffers.every(c=>c.type!=='spell'||c.upgradeKind));spent+=g.zoneUpgradePrice(g.zoneSpellOffers[0]);assert.equal(buyZoneSpell(g,0),true);assert.equal(g.zoneRun.phase,'spellshop');}assert.equal(g.player.gold,1000-spent);g.player.gold=0;assert.equal(buyZoneSpell(g,0),false);assert.equal(g.player.gold,0);
});
