import {chooseSpell,tickSpellSystem} from '../game/spell-system.mjs';
import {Game,GAME_DEFAULTS} from '../game/core.mjs';
// These mechanics tests interact with creatures on the tick they spawn.
GAME_DEFAULTS.enemyArrival=0;
﻿import test from 'node:test';
import assert from 'node:assert/strict';
import {initMonsterBehavior,tickMonsterBehavior,tickEnemyCasts,enemyCasterSpawnAllowed,chooseEnemyDamageSpell,ENEMY_TARGET_RANGES} from '../game/monster-behavior.mjs';
function arena(time=200,roll=.5){
 const game={time,nextId:1,random:()=>roll,player:{x:100,y:0,radius:10,hp:100,maxHp:100},enemies:[],projectiles:[],effects:[],spellLoadout:[],hurt:[],hurtPlayer(damage,element){this.hurt.push({damage,element});}};
 const enemy={id:9,x:0,y:0,radius:15,hp:100,maxHp:100,damage:20};
 initMonsterBehavior(game,enemy,{ranged:true});enemy.behavior.magery=100;enemy.mana=enemy.maxMana=200;enemy.castClock=0;game.enemies.push(enemy);
 return {game,enemy};
}

test('a caster reuses its pursuit sight check and cannot cast through a wall',()=>{
 for(const visible of [true,false]){
  const game=new Game({monsters:[{id:'evil-mage',body:400,ranged:true}]});
  game.enemies=[];game.spawnClock=999;game.attackClock=999;game.time=90;
  const enemy=game.spawnEnemy('evil-mage');enemy.x=game.player.x+100;enemy.y=game.player.y;enemy.speed=0;enemy.castClock=0;enemy.mana=enemy.maxMana=200;
  let rays=0;game.clearSight=(a,b)=>{if(a===enemy&&b===game.player)rays++;return visible;};
  game.update(1/60);
  assert.equal(rays,1);assert.equal(game.projectiles.length>0,visible);
 }
});
test('caster wave gates defer ordinary mages and high magery sources',()=>{
 assert.equal(enemyCasterSpawnAllowed({ranged:true},74),false);
 assert.equal(enemyCasterSpawnAllowed({ranged:true},75),true);
 assert.equal(enemyCasterSpawnAllowed({id:'ordinary-melee'},0),true);
});
test('first three minutes use slower aimed projectiles instead of undodgeable targeted spells',()=>{
 const {game,enemy}=arena(90,.5);tickMonsterBehavior(game,enemy,.01);
 assert.equal(game.hurt.length,0);assert.equal(game.pendingEnemyCasts?.length||0,0);
 assert.equal(game.projectiles[0].spellId,'fireball');assert.ok(enemy.castClock>=2.5&&enemy.castClock<=3.7);
 assert.equal(game.projectiles[0].ownerId,enemy.id);assert.ok(game.projectiles[0].vx>0);
});
test('targeted Mind Blast warns on a fixed position before damage and can be dodged',()=>{
 const {game,enemy}=arena();tickMonsterBehavior(game,enemy,.01);
 assert.equal(game.hurt.length,0);assert.equal(game.effects[0].kind,'enemy-cast');
 assert.equal(game.effects[0].spellId,'mind-blast');assert.equal(game.pendingEnemyCasts.length,1);
 tickEnemyCasts(game,.5);assert.equal(game.hurt.length,0);
 game.player.x=250;tickEnemyCasts(game,.7);
 assert.equal(game.hurt.length,0);assert.equal(game.pendingEnemyCasts.length,0);
 assert.equal(game.effects.at(-1).kind,'mind-blast');assert.ok(!game.effects.some(e=>e.kind==='chain'));
});
test('a player who remains inside the telegraph takes one spell after the delay',()=>{
 const {game,enemy}=arena();tickMonsterBehavior(game,enemy,.01);
 tickEnemyCasts(game,1.2);assert.equal(game.hurt.length,1);assert.equal(game.hurt[0].element,'Cold');
 tickEnemyCasts(game,1);assert.equal(game.hurt.length,1);
});
test('global targeted cast interval prevents overlapping mage volleys',()=>{
 const {game,enemy}=arena();tickMonsterBehavior(game,enemy,.01);
 const second={...enemy,id:10,castClock:0,mana:200};game.enemies.push(second);tickMonsterBehavior(game,second,.01);
 assert.equal(game.pendingEnemyCasts.length,1);assert.equal(second.mana,enemy.mana+14);
 tickEnemyCasts(game,1.9);second.castClock=0;tickMonsterBehavior(game,second,.01);
 assert.equal(game.pendingEnemyCasts.length,1);
});
test('blocked line of sight or a dead caster cancels delayed damage',()=>{
 for(const cancel of [(g)=>{g.clearSight=()=>false;},(g,e)=>{e.hp=0;}]){
  const {game,enemy}=arena();tickMonsterBehavior(game,enemy,.01);cancel(game,enemy);tickEnemyCasts(game,2);
  assert.equal(game.hurt.length,0);
 }
 const {game,enemy}=arena();game.clearSight=()=>false;tickMonsterBehavior(game,enemy,.1);
 assert.equal(game.pendingEnemyCasts?.length||0,0);assert.equal(game.projectiles.length,0);
});
test('MageAI table gives Energy Bolt and Explosion their distinct single slots',()=>{
 const {game,enemy}=arena(260);
 for(const [index,id] of [[0,'magic-arrow'],[3,'harm'],[4,'fireball'],[7,'lightning'],[9,'mind-blast'],[10,'energy-bolt'],[11,'explosion'],[12,'flame-strike'],[15,'flame-strike']]){
  game.random=()=>(index+.1)/16;assert.equal(chooseEnemyDamageSpell(game,enemy).id,id);
 }
});


test('targeted spells reflect back to their own caster after the warning',()=>{
 const {game,enemy}=arena();
 game.spellLoadout=[{id:'magic-reflection',rank:1,active:true,activeRemaining:35,reflectionCharges:10,cooldown:20}];
 game.hurtEnemy=(target,damage,weapon,element)=>{target.hp-=damage;game.reflectedElement=element;};
 tickMonsterBehavior(game,enemy,.01);tickEnemyCasts(game,1.2);
 assert.equal(game.hurt.length,0);assert.equal(enemy.hp,76);assert.equal(game.reflectedElement,'Cold');
 assert.equal(game.spellLoadout[0].reflectionCharges,5);assert.equal(game.spellLoadout[0].active,true);
});

test('each targeted spell refuses to begin outside its own range',()=>{
 for(const [id,index] of [['harm',2],['lightning',6],['mind-blast',8],['explosion',11],['flame-strike',12]]){
  const {game,enemy}=arena(300,(index+.1)/16);game.player.x=ENEMY_TARGET_RANGES[id]+1;
  tickMonsterBehavior(game,enemy,.01);
  assert.equal(game.pendingEnemyCasts?.length||0,0,id);
  // Harm already chooses a dodgeable projectile instead when too far away.
  assert.equal(enemy.mana,200,id);
  game.player.x=ENEMY_TARGET_RANGES[id];enemy.castClock=0;
  tickMonsterBehavior(game,enemy,.01);assert.equal(game.pendingEnemyCasts[0].spellId,id);
 }
});

test('leaving range cancels a cast while still inside its warning and removes the warning',()=>{
 const {game,enemy}=arena();game.player.x=ENEMY_TARGET_RANGES['mind-blast']-1;tickMonsterBehavior(game,enemy,.01);
 assert.equal(game.pendingEnemyCasts.length,1);
 game.player.x=ENEMY_TARGET_RANGES['mind-blast']+1;tickEnemyCasts(game,.1);
 assert.equal(game.pendingEnemyCasts.length,0);assert.equal(game.hurt.length,0);
 assert.ok(!game.effects.some(e=>e.kind==='enemy-cast'));
 game.player.x=250;tickEnemyCasts(game,2);assert.equal(game.hurt.length,0);
});

test('caster moving out of range cancels impact even if the player stays at the marked spot',()=>{
 const {game,enemy}=arena();tickMonsterBehavior(game,enemy,.01);enemy.x=-ENEMY_TARGET_RANGES['mind-blast'];
 tickEnemyCasts(game,2);assert.equal(game.pendingEnemyCasts.length,0);assert.equal(game.hurt.length,0);
 assert.ok(!game.effects.some(e=>e.kind==='mind-blast'));
});

test('screen-scale casting keeps the warning dodgeable at long range',()=>{const {game,enemy}=arena();game.player.x=800;tickMonsterBehavior(game,enemy,.01);assert.equal(game.pendingEnemyCasts.length,1);game.player.y=90;tickEnemyCasts(game,1.2);assert.equal(game.hurt.length,0);assert.equal(game.effects.at(-1).kind,'mind-blast');});

test('casters use the restored 2.5 to 3.7 second cadence throughout the run',()=>{for(const time of [90,200,400]){const {game,enemy}=arena(time,.5);tickMonsterBehavior(game,enemy,.01);assert.equal(enemy.castClock,3.1);assert.ok((game.pendingEnemyCasts?.length||game.projectiles.length)>0);}});

test('Feeblemind interrupts and silences multiple nearby casters while distant casters remain dangerous',()=>{
 const {game,enemy}=arena();const second={...enemy,id:10,x:190},far={...enemy,id:11,x:600};game.enemies.push(second,far);
 tickMonsterBehavior(game,enemy,.01);assert.equal(game.pendingEnemyCasts.length,1);
 chooseSpell(game,'feeblemind');game.nearest=()=>enemy;tickSpellSystem(game,.01);
 assert.equal(game.pendingEnemyCasts.length,0);assert.ok(!game.effects.some(e=>e.kind==='enemy-cast'));
 assert.equal(enemy.spellSilencedUntil,204);assert.equal(second.spellSilencedUntil,204);assert.equal(far.spellSilencedUntil,undefined);
 for(const e of [enemy,second]){e.castClock=0;e.hp=30;tickMonsterBehavior(game,e,.1);assert.equal(e.hp,30);}
 assert.equal(game.projectiles.length,0);assert.equal(game.pendingEnemyCasts.length,0);
 game.enemyGlobalCastClock=0;far.castClock=0;tickMonsterBehavior(game,far,.01);assert.equal(game.pendingEnemyCasts.length,1);
 game.pendingEnemyCasts=[];game.enemyGlobalCastClock=0;game.time=205;enemy.hp=100;enemy.castClock=0;tickMonsterBehavior(game,enemy,.01);assert.equal(game.pendingEnemyCasts.length,1);
});
