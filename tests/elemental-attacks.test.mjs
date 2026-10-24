import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,GAME_DEFAULTS} from '../game/core.mjs';
// These mechanics tests interact with creatures on the tick they spawn.
GAME_DEFAULTS.enemyArrival=0;
import {tickSpellSystem,spellEnemyMovementMultiplier} from '../game/spell-system.mjs';
function fixture(element='Physical',proc=null){
 const g=new Game({}, {seed:4,archetype:'warrior'});
 const weapon={uid:900,id:'test',name:'Test',slot:'weapon',aosMode:true,power:10,stats:{},damageTypes:{[element]:100},aosAttributes:{AttackChance:100},weaponAttributes:proc?{[proc]:100}:{}};
 g.inventory.push(weapon);g.equipment.weapon=900;
 g.enemies=Array.from({length:3},(_,i)=>({id:100+i,x:i===2?400:i*60,y:0,radius:12,hp:1000,maxHp:1000,resistances:{},damage:1}));
 return g;
}
for(const element of ['Physical','Fire','Cold','Poison','Energy'])test(element+' area procs damage nearby enemies without chaining',()=>{
 const g=fixture('Physical','Hit'+element+'Area'),[target,near,far]=g.enemies;
 g.hurtEnemy(target,100,true);
 assert.equal(target.hp,element==='Physical'?820:827.5);assert.equal(near.hp,element==='Physical'?940:947.5);assert.equal(far.hp,1000);
 if(element==='Fire')assert.ok(near.spellBurnUntil>g.time);
 if(element==='Cold')assert.equal(spellEnemyMovementMultiplier(g,near),.75);
 if(element==='Poison')assert.ok(near.spellPoisonUntil>g.time);
});
test('area procs respect obstruction, range, element resistance and killing blows',()=>{
 const g=fixture('Physical','HitFireArea'),[target,near]=g.enemies;target.hp=1;target.xp=0;g.dropLoot=()=>{};
 near.resistances.Elemental=50;g.hurtEnemy(target,100,true);assert.equal(near.hp,973.75);assert.equal(g.kills,1);
 const blocked=fixture('Physical','HitFireArea');blocked.clearSight=()=>false;blocked.hurtEnemy(blocked.enemies[0],100,true);assert.equal(blocked.enemies[1].hp,1000);
});
test('mixed elemental damage applies proportional statuses and strongest DOT refresh without resetting tick',()=>{
 const g=fixture(),e=g.enemies[0];g.equipped('weapon').damageTypes={Physical:25,Fire:25,Cold:25,Poison:25};
 g.hurtEnemy(e,100,true);assert.equal(e.spellBurnDamage,2.5);assert.equal(e.spellPoisonDamage,2.5);assert.equal(e.spellSlowedUntil,g.time+.75);
 tickSpellSystem(g,.5);const burnTick=e.spellBurnTick,poisonTick=e.spellPoisonTick;
 g.hurtEnemy(e,20,true);assert.equal(e.spellBurnDamage,2.5);assert.equal(e.spellPoisonDamage,2.5);assert.equal(e.spellBurnTick,burnTick);assert.equal(e.spellPoisonTick,poisonTick);
});
test('burn and existing poison ticks cannot renew their duration or trigger area procs',()=>{
 const g=fixture('Fire','HitFireArea'),e=g.enemies[0];g.hurtEnemy(e,100,false,'Fire');g.hurtEnemy(e,100,false,'Poison');
 const burnUntil=e.spellBurnUntil,poisonUntil=e.spellPoisonUntil,hp=e.hp;
 tickSpellSystem(g,2);assert.ok(e.hp<hp);assert.equal(e.spellBurnUntil,burnUntil);assert.equal(e.spellPoisonUntil,poisonUntil);assert.equal(g.enemies[1].hp,1000);
 g.time=10;const done=e.hp;tickSpellSystem(g,1);assert.equal(e.hp,done);assert.equal(spellEnemyMovementMultiplier(g,e),1);
});
test('enemy burn ticks use Explosion artwork while poison keeps its own effect',()=>{
 const g=fixture(),e=g.enemies[0];g.hurtEnemy(e,100,false,'Fire');g.hurtEnemy(e,100,false,'Poison');g.effects=[];
 const hp=e.hp;tickSpellSystem(g,2);
 assert.ok(e.hp<hp);assert.ok(g.effects.some(fx=>fx.kind==='explosion'));assert.ok(g.effects.some(fx=>fx.kind==='poison'));
 assert.equal(g.effects.some(fx=>fx.kind==='fireball'),false);
});
test('elemental spell hits work and new burn state survives saves with validation',()=>{
 const g=new Game({}, {seed:9}),e=g.spawnEnemy();e.hp=e.maxHp=1000;
 g.hurtEnemy(e,100,false,'Fire');g.hurtEnemy(e,100,false,'Cold');
 const restored=Game.restore({},g.snapshot());assert.equal(restored.enemies.find(v=>v.id===e.id).spellBurnUntil,e.spellBurnUntil);assert.equal(spellEnemyMovementMultiplier(restored,restored.enemies.find(v=>v.id===e.id)),.75);
 const bad=g.snapshot();bad.enemies[0].spellBurnDamage=Infinity;assert.throws(()=>Game.restore({},bad));
});
test('mage basic attacks trigger area procs but proc projectiles do not chain',()=>{
 const g=fixture('Physical','HitEnergyArea');g.attackKind='magic';g.player.x=0;g.player.y=0;g.spawnClock=999;g.attackClock=999;g.novaClock=g.chainClock=999;
 const e=g.enemies[0];e.x=30;g.enemies[1].x=90;g.enemies.forEach(e=>{e.speed=0;e.castClock=999;});
 g.projectiles=[{id:1,x:30,y:0,vx:0,vy:0,radius:7,damage:100,life:2,hostile:false,hits:[],pierce:0,kind:'magic',splashRadius:56}];
 g.update(.01);assert.ok(g.enemies[1].hp<940);
});
