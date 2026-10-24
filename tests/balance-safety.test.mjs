import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {Game} from '../game/core.mjs';
import {createLocationMap} from '../game/location-map.mjs';
import {mapPoint} from '../game/map-regions.mjs';
import {settleBiome} from '../game/map-navigation.mjs';
import {observeCombat} from '../tools/balance-telemetry.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const enemy=(id,damage)=>({id,type:'rat',x:10,y:0,radius:14,hp:1000,maxHp:1000,speed:0,damage,xp:0,cooldown:999,behavior:{caster:false,archer:false},castClock:999,breathClock:999});
test('simulation telemetry counts recursive area procs on the same target only once',()=>{
 const other={hp:100},target={hp:100},g={player:{hp:100},hitClock:0,hurtPlayer(n){this.player.hp-=n;},hurtEnemy(e,n){e.hp-=n;if(n===10){this.hurtEnemy(e,5);this.hurtEnemy(other,7);}}};
 const totals=observeCombat(g);g.hurtEnemy(target,10);assert.equal(totals.damageDealt,22);assert.equal(target.hp,85);assert.equal(other.hp,93);
});
test('the strongest contact wins the shared hit window regardless of enemy array order',()=>{
 for(const reverse of [false,true]){
  const g=new Game({}, {archetype:'warrior'});g.enemies=[enemy(1,1),enemy(2,40)];if(reverse)g.enemies.reverse();
  g.spawnClock=g.attackClock=999;g.player.hp=100;g.update(1/60);close(g.player.hp,100-(40-2)*.8);
  const hp=g.player.hp;g.update(.1);close(g.player.hp,hp);
 }
});
test('regen recovers fully after escaping damage; combat sustain is capped and the delay survives saves',()=>{
 const g=new Game();g.heroStatUpgrades={regen:10};g.player.hp=50;g.enemies=[];g.spawnClock=g.attackClock=999;
 close(g.baseRegeneration,110);g.hurtPlayer(10);close(g.regeneration,1.1);
 const saved=g.snapshot(),restored=Game.restore({},saved);assert.equal(restored.regenDelay,2);close(restored.regeneration,1.1);
 const hp=g.player.hp;g.update(1);close(g.player.hp,hp+1.1);g.update(1);close(g.regenDelay,0);close(g.regeneration,110);
 const invalid=g.snapshot();invalid.regenDelay=3;assert.throws(()=>Game.restore({},invalid));
});
test('life leech from a crowded attack is bounded without disabling the rolled proc chance',()=>{
 const g=new Game({}, {archetype:'warrior'});g.inventory=[{uid:100,id:'test',slot:'weapon',power:10,defense:0,price:1,name:'Test',aosMode:true,weaponAttributes:{HitLeechHits:100}}];g.equipment.weapon=100;g.random=()=>0;g.player.hp=10;
 const target=enemy(2,1);for(let n=0;n<100;n++)g.applyWeaponProperties(target,1000);close(g.player.hp,13.75);
 g.enemies=[];g.spawnClock=g.attackClock=999;g.update(.5);g.applyWeaponProperties(target,1000);close(g.player.hp,17.5);
 const bad=g.snapshot();bad.lifeLeechClock=1;assert.throws(()=>Game.restore({},bad));
});
test('a starting ranger has a one-second bow interval and arrows penetrate three targets',()=>{
 const bow={id:'bow',name:'Bow',slot:'weapon',stats:{MinDamage:15,MaxDamage:19,Speed:25}};
 const g=new Game({weapons:[bow]}, {archetype:'archer'});close(g.attackInterval,1);g.enemies=[enemy(4,1)];g.attack();assert.equal(g.projectiles[0].pierce,2);
});
test('native corner-trapped enemies regain a route without healing or bypassing walls', {skip:!existsSync('game/assets/mobile-locations/manifest.json')},()=>{
 const index=JSON.parse(readFileSync('game/assets/mobile-locations/manifest.json')),id=Object.keys(index.areas).find(k=>/lizard.*passage/i.test(index.areas[k].name));
 const map=createLocationMap(JSON.parse(readFileSync('game/'+index.areas[id].src)),{});
 const r=map.manifest.regions[0],offset=mapPoint(248-r.sourceX,1552-r.sourceY);
 for(const [x,y]of [[396.6583726155565,1357.3380727911106],[93.90872740849375,1761.0970464303787]]){
  const g=new Game({}, {archetype:'warrior',duration:100000});g.enemies=[];g.spawnClock=g.attackClock=99999;Object.assign(g.player,{x:88+offset.x,y:1562+offset.y});g.isPassable=map.isPlayable;settleBiome(g,map);
  const e={...enemy(1,0),x:x+offset.x,y:y+offset.y,speed:61.3875,hp:500,maxHp:1000};g.enemies=[e];g.hurtPlayer=()=>{};
  for(let n=0;n<60*30;n++){g.update(1/60);assert.ok(g.canStand(e.x,e.y,e.radius*.5));}
  assert.ok(Math.hypot(e.x-g.player.x,e.y-g.player.y)<30);assert.equal(e.hp,500);
 }
});
