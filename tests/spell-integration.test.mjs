import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Game,GAME_DEFAULTS} from '../game/core.mjs';
// These mechanics tests interact with creatures on the tick they spawn.
GAME_DEFAULTS.enemyArrival=0;
import {chooseSpell,tickSpellSystem} from '../game/spell-system.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('../game/data/catalog.json',import.meta.url)));
function quiet(){const g=new Game(catalog,{seed:70});g.enemies=[];g.spawnClock=999;g.attackClock=999;g.weaponSpellClock=999;return g;}
test('hostile Fireball actually turns back and damages its own caster without hurting the player',()=>{
 const g=quiet(),enemy=g.spawnEnemy('orc');enemy.x=65;enemy.y=0;enemy.speed=0;enemy.behavior.caster=false;
 chooseSpell(g,'magic-reflection');tickSpellSystem(g,.01);const hp=g.player.hp,sourceHp=enemy.hp;
 const shot={id:g.nextId++,ownerId:enemy.id,spellId:'fireball',kind:'fireball',element:'Fire',x:3,y:0,vx:-195,vy:0,damage:15,life:4,maxLife:4,hostile:true,radius:5};g.projectiles.push(shot);
 g.update(.02);assert.equal(g.player.hp,hp);assert.equal(shot.hostile,false);assert.equal(shot.reflected,true);assert.ok(shot.vx>0);assert.equal(g.spellLoadout[0].reflectionCharges,7);
 g.update(.5);assert.ok(enemy.hp<sourceHp);assert.equal(g.player.hp,hp);
});
test('targeted cast warnings survive save/restore and a moving player dodges the locked spot',()=>{
 const g=quiet();g.time=220;const enemy=g.spawnEnemy('lich');enemy.x=200;enemy.y=0;enemy.speed=0;enemy.castClock=60;
 const cast={id:g.nextId++,ownerId:enemy.id,x:0,y:0,remaining:1.15,delay:1.15,radius:42,spellId:'lightning',kind:'lightning',element:'Energy',damage:30};
 g.pendingEnemyCasts=[cast];g.enemyGlobalCastClock=1.8;g.effects.push({x:0,y:0,radius:42,kind:'enemy-cast',spellId:'lightning',life:1.15,maxLife:1.15});
 const restored=Game.restore(catalog,g.snapshot()),hp=restored.player.hp;restored.player.y=150;restored.update(1);restored.update(.2);
 assert.equal(restored.pendingEnemyCasts.length,0);assert.equal(restored.player.hp,hp);assert.ok(restored.effects.some(e=>e.kind==='lightning'));
 const invalid=g.snapshot();invalid.pendingEnemyCasts[0].spellId='made-up';assert.throws(()=>Game.restore(catalog,invalid));
});
test('early random waves exclude high-skill casters and cap ordinary caster population',()=>{
 const g=quiet();g.time=40;
 for(let n=0;n<300;n++){const enemy=g.spawnEnemy();assert.equal(enemy.behavior.caster,false);g.enemies=[];}
 g.time=150;
 for(let n=0;n<500;n++){g.spawnEnemy();const casters=g.enemies.filter(e=>e.behavior.caster);assert.ok(casters.length<=2);assert.ok(casters.every(e=>e.behavior.magery<80));g.enemies=g.enemies.filter(e=>e.behavior.caster);}
});
test('paralysis stops enemies until damage breaks it; offensive debuffs reduce incoming damage',()=>{
 const g=quiet(),enemy=g.spawnEnemy('orc');enemy.x=200;enemy.y=0;enemy.behavior.caster=false;enemy.spellParalyzedUntil=20;
 g.update(.2);assert.equal(enemy.x,200);g.hurtEnemy(enemy,1);g.update(.2);assert.ok(enemy.x<200);
 g.player.hp=100;g.hitClock=0;g.player.armor=0;enemy.spellWeakenedUntil=g.time+10;g.hurtPlayer(10,'Physical',enemy);assert.equal(g.player.hp,92.4);
});
test('invisibility provides a real escape window and summons use the current map time for collision',()=>{
 const g=quiet(),enemy=g.spawnEnemy('orc');enemy.x=40;enemy.y=0;
 chooseSpell(g,'invisibility');tickSpellSystem(g,.01);const hp=enemy.hp,x=enemy.x;g.attackClock=0;g.update(.2);assert.equal(enemy.hp,hp);assert.equal(enemy.x,x);
 const f=quiet();f.time=350;const target=f.spawnEnemy('orc');target.x=90;target.y=0;let checked=false;f.isPassable=(x,y,time)=>{assert.equal(time,350);checked=true;return true;};
 chooseSpell(f,'air-elemental');tickSpellSystem(f,.1);assert.equal(f.spellFields[0].hue,0x4001);assert.ok(checked);
});

test('retired spell saves migrate loadout ranks, pending choices and obsolete fields',()=>{const g=quiet(),state=g.snapshot();state.spellLoadout=[{id:'mana-drain',rank:4,cooldown:3,active:false},{id:'mana-vampire',rank:2,cooldown:3,active:false},{id:'lightning',rank:1,cooldown:0,active:false}];state.choices=[{id:'spell:mass-dispel',spellId:'mass-dispel',type:'spell',level:1}];state.spellFields=[{kind:'mana-drain',x:0,y:0,angle:0,radius:0,life:4,tick:99,damage:0,restoreMana:30}];const restored=Game.restore(catalog,state);assert.deepEqual(restored.spellLoadout.map(s=>s.rank),[4,2,1]);assert.equal(new Set(restored.spellLoadout.map(s=>s.id)).size,3);assert.ok(restored.spellLoadout.every(s=>!s.id.includes('mana')));assert.equal(restored.spellFields.length,0);assert.notEqual(restored.choices[0].id,'spell:mass-dispel');assert.doesNotThrow(()=>Game.restore(catalog,restored.snapshot()));});
test('player projectile impact splashes once with the original element and no weapon procs',()=>{const g=quiet();for(const [x,y] of [[100,0],[100,40],[100,140]]){const e=g.spawnEnemy('orc');e.x=x;e.y=y;e.speed=0;e.behavior.caster=false;e.hp=e.maxHp=1000;e.resistances={Fire:0,Physical:70};}chooseSpell(g,'fireball');tickSpellSystem(g,.01);const shot=g.projectiles[0];assert.equal(shot.splashRadius,56);shot.x=100;shot.y=0;shot.vx=shot.vy=0;const [a,b,c]=g.enemies;g.update(.01);assert.ok(a.hp<1000);assert.ok(b.hp<1000);assert.ok(Math.abs((1000-b.hp)/(1000-a.hp)-.6)<1e-6);assert.equal(c.hp,1000);assert.equal(g.projectiles.length,0);});

test('retired cures migrate to distinct defensive spells with ranks intact and silence survives saving',()=>{const g=quiet(),state=g.snapshot();state.spellLoadout=[{id:'cure',rank:4,cooldown:2,active:false},{id:'arch-cure',rank:2,cooldown:3,active:false},{id:'heal',rank:1,cooldown:0,active:false}];state.choices=[{id:'spell:cure',spellId:'cure',type:'spell',level:5}];const e=g.spawnEnemy('lich');e.spellSilencedUntil=15;state.enemies=g.snapshot().enemies;const restored=Game.restore(catalog,state);assert.deepEqual(restored.spellLoadout.map(s=>s.rank),[4,2,1]);assert.equal(new Set(restored.spellLoadout.map(s=>s.id)).size,3);assert.ok(restored.spellLoadout.every(s=>['heal','greater-heal','protection','reactive-armor'].includes(s.id)));assert.equal(restored.choices[0].category,'defense');assert.equal(restored.enemies[0].spellSilencedUntil,15);const invalid=restored.snapshot();invalid.enemies[0].spellSilencedUntil=NaN;assert.throws(()=>Game.restore(catalog,invalid));});
