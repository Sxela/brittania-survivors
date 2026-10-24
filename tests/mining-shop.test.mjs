import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,GAME_DEFAULTS} from '../game/core.mjs';
// These mechanics tests interact with creatures on the tick they spawn.
GAME_DEFAULTS.enemyArrival=0;
import {placeGoldOre,MINING_STRIKE_SECONDS} from '../game/mining.mjs';
import {rollZoneSpells,buyZoneSpell} from '../game/zone-run.mjs';
function fixture(){const g=new Game({}, {seed:15});g.enemies=[];g.spawnClock=g.attackClock=g.novaClock=g.chainClock=99999;g.player.gold=0;g.pickups=[{id:g.nextId++,x:25,y:0,z:0,radius:18,kind:'ore',value:10,strikes:4,progress:0,mining:false}];return g;}
function tick(g,seconds,input={}){for(let i=0;i<Math.round(seconds*60);i++)g.update(1/60,input);}
test('ore is stationary, ignores magnets, pays four slow strikes, and depletes once',()=>{
 const g=fixture();g.upgrades.magnet=20;tick(g,2.5);assert.equal(g.player.gold,0);assert.equal(g.pickups[0].x,25);tick(g,.5);assert.equal(g.player.gold,10);assert.equal(g.pickups[0].strikes,3);tick(g,9);assert.equal(g.player.gold,40);assert.equal(g.pickups.length,0);tick(g,2);assert.equal(g.player.gold,40);
});
test('ore can be mined from one tile away without touching the deposit',()=>{
 const g=fixture();g.pickups[0].x=62;tick(g,3);assert.equal(g.player.gold,10);assert.equal(g.player.x,0);g.pickups[0].x=67;tick(g,3);assert.equal(g.player.gold,10);
});

test('moving, leaving range, changing floors or walls cancels the current strike without giving gold',()=>{
 const g=fixture();tick(g,2);tick(g,.1,{x:1});assert.equal(g.player.gold,0);assert.equal(g.pickups[0].progress,0);g.player.x=0;g.elevationAt=x=>x===g.player.x?20:0;tick(g,4);assert.equal(g.player.gold,0);g.elevationAt=()=>0;g.clearSight=()=>false;tick(g,4);assert.equal(g.player.gold,0);g.clearSight=()=>true;g.player.x=100;tick(g,4);assert.equal(g.player.gold,0);
});
test('mining keeps enemies active, pauses with the game and preserves exact progress in saves',()=>{
 const g=fixture();const enemy=g.spawnEnemy();Object.assign(enemy,{x:0,y:0,speed:0,damage:10,castClock:999});const hp=g.player.hp;tick(g,.2);assert.ok(g.player.hp<hp);g.enemies=[];g.pause();const progress=g.pickups[0].progress;tick(g,2);assert.equal(g.pickups[0].progress,progress);const restored=Game.restore({},g.snapshot());assert.equal(restored.pickups[0].progress,progress);restored.pause();tick(restored,3-progress+.05);assert.equal(restored.player.gold,10);
});
test('deposits are placed once per area, remain depleted across save/load, and malformed progress fails validation',()=>{
 const g=fixture();g.pickups=[];const points=Array.from({length:20},(_,n)=>({x:200+n*240,y:100}));assert.equal(placeGoldOre(g,points,'area:0'),4);assert.equal(placeGoldOre(g,points,'area:0'),0);g.pickups=[];const restored=Game.restore({},g.snapshot());assert.equal(placeGoldOre(restored,points,'area:0'),0);assert.equal(placeGoldOre(restored,points,'area:1'),4);
 for(const patch of [{progress:Infinity},{strikes:0},{strikes:1.2},{progress:MINING_STRIKE_SECONDS},{value:-1}]){const snapshot=restored.snapshot();Object.assign(snapshot.pickups[0],patch);assert.throws(()=>Game.restore({},snapshot));}
});
test('shop always offers five unique improvements, including before learning spells, and supports repeated purchases until funds run out',()=>{
 const g=new Game({}, {seed:31});g.zoneRun={phase:'spellshop',rerolls:0,index:0};g.player.gold=1000;let spent=0;for(let n=0;n<3;n++){rollZoneSpells(g);assert.equal(g.zoneSpellOffers.length,5);assert.equal(new Set(g.zoneSpellOffers.map(c=>c.id)).size,5);assert.ok(g.zoneSpellOffers.every(c=>c.type!=='spell'||c.upgradeKind));spent+=g.zoneUpgradePrice(g.zoneSpellOffers[0]);assert.equal(buyZoneSpell(g,0),true);assert.equal(g.zoneRun.phase,'spellshop');}assert.equal(g.player.gold,1000-spent);g.player.gold=0;assert.equal(buyZoneSpell(g,0),false);assert.equal(g.player.gold,0);
});
