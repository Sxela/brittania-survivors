import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,GAME_DEFAULTS} from '../game/core.mjs';
// These mechanics tests interact with creatures on the tick they spawn.
GAME_DEFAULTS.enemyArrival=0;
import { strictlyDominates } from '../game/general-mechanics.mjs';
import { spellChoices,newSpellChoices, chooseSpell } from '../game/spell-system.mjs';

const gear=(uid,slot='head',stats={})=>({uid,id:'test',name:'Test',slot,price:20,power:0,defense:0,aosAttributes:stats,resistances:{},stats:{},allowMale:true,allowFemale:true});

test('final guardians award gold and leave their equipment in a chest',()=>{
  const source={id:'reward',name:'Reward',slot:'head',itemId:1,stats:{},aosAttributes:{Luck:1}};
  const game=new Game({items:[source]},{seed:9});game.autosell='off';
  const enemy=game.spawnEnemy(null,true,true);enemy.hp=1;enemy.resistances={};
  const gold=game.player.gold,count=game.inventory.length;
  game.hurtEnemy(enemy,100000);
  assert.equal(game.player.gold,gold+15);assert.equal(game.inventory.length,count);
  assert.equal(game.pickups.filter(drop=>drop.kind==='loot').length,1);assert.ok(!game.pickups.some(drop=>drop.kind==='gold'));
});

test('safe dominance preserves stat tradeoffs, skills, damage types and restrictions',()=>{
  const damage=gear(1,'weapon',{WeaponDamage:20}),speed=gear(2,'weapon',{WeaponSpeed:5});
  assert.equal(strictlyDominates(damage,speed),false);
  assert.equal(strictlyDominates(gear(3,'weapon',{WeaponDamage:21}),damage),true);
  assert.equal(strictlyDominates({...damage,twoHanded:true},speed),false);
  assert.equal(strictlyDominates({...damage,allowFemale:false},damage),false);
  assert.equal(strictlyDominates({...damage,damageTypes:{Fire:100}},damage),false);
  assert.equal(strictlyDominates(damage,{...speed,skillBonuses:[{skill:'Magery',value:5}]}),false);
  assert.equal(strictlyDominates(damage,{...damage,uid:4}),false);
});

test('acquisition safely equips upgrades and sells dominated backpack items but protects uniques',()=>{
  const game=new Game();game.autosell='off';
  game.acquireItem(gear(100,'head',{Luck:5}));assert.equal(game.equipment.head,100);
  game.acquireItem(gear(101,'head',{BonusHits:1}));assert.equal(game.equipment.head,100);
  game.autosell='inferior';game.acquireItem(gear(102,'head',{Luck:6}));
  assert.equal(game.equipment.head,102);assert.equal(game.inventory.some(i=>i.uid===100),false);
  assert.equal(game.inventory.some(i=>i.uid===101),true);
  game.acquireItem({...gear(103,'head',{Luck:1}),artifact:true});
  assert.equal(game.inventory.some(i=>i.uid===103),true);
});

test('automatic equipment never displaces another hand or mismatched body and honors toggle',()=>{
  const game=new Game();game.autosell='off';game.acquireItem(gear(100,'offhand',{Luck:1}));
  game.acquireItem({...gear(101,'weapon',{WeaponDamage:100}),twoHanded:true});
  assert.equal(game.equipment.offhand,100);assert.notEqual(game.equipment.weapon,101);
  game.acquireItem({...gear(102,'head',{Luck:1}),allowMale:false});assert.equal(game.equipment.head,null);
  game.autoequip=false;game.acquireItem(gear(103,'head',{Luck:100}));assert.equal(game.equipment.head,null);
});

test('paid merchant refresh is explicit, costs gold and is saved',()=>{
  const game=new Game();game.spawnClock=100;game.enemies=[];
  const stock=JSON.stringify(game.shop);for(let i=0;i<46;i++)game.update(1);
  assert.equal(JSON.stringify(game.shop),stock);assert.equal(game.restockShop(),false);
  game.player.gold=100;assert.equal(game.restockShop(),true);assert.equal(game.player.gold,85);assert.equal(game.restockPrice,20);
  assert.equal(Game.restore({},game.snapshot()).restockPrice,20);
});

test('difficulty changes encounter strength, rewards and cadence while preserving deterministic saves',()=>{
  const easy=new Game({}, {difficulty:'easy'}),hard=new Game({}, {difficulty:'hard'});
  const a=easy.enemies[0],b=hard.enemies[0];assert.ok(b.hp>a.hp);assert.ok(b.damage>a.damage);assert.ok(b.xp>a.xp);
  assert.ok(hard.difficultySettings.population>easy.difficultySettings.population);
  assert.equal(Game.restore({},hard.snapshot()).difficulty,'hard');
  const invalid=hard.snapshot();invalid.difficulty='invalid';assert.throws(()=>Game.restore({},invalid));
});

test('powerups heal proportionally, shield damage, accelerate movement, attract experience and expire',()=>{
  const game=new Game();game.enemies=[];game.spawnClock=100;
  game.player.hp=10;game.collect({kind:'heal-percent'});assert.equal(game.player.hp,48.5);
  game.collect({kind:'shield'});const hp=game.player.hp;game.hurtPlayer(40);assert.equal(game.player.hp,hp);assert.equal(game.buffs.shield.value,27);
  game.collect({kind:'haste'});game.update(.5,{x:1});assert.ok(game.player.x>game.player.speed*.5);
  game.collect({kind:'magnet'});game.pickups.push({id:999,x:1000,y:0,kind:'xp',value:1,radius:5});game.update(.1);assert.equal(game.pickups[0].attracted,true);
  const restored=Game.restore({},game.snapshot());assert.equal(restored.activeBuffs.length,3);
  restored.buffs.haste.remaining=.01;restored.update(.1);assert.equal(restored.buffs.haste,undefined);
  game.pickups.push({id:1000,x:1000,y:1000,kind:'gold',value:1,radius:5,life:.01});game.update(.1);assert.equal(game.pickups.some(p=>p.id===1000),false);
  const invalid=game.snapshot();invalid.buffs.shield.remaining=999;assert.throws(()=>Game.restore({},invalid));
});

test('captains bring source-matched escorts and guaranteed rewards without boss progression',()=>{
  const game=new Game({weapons:[{id:'stick',name:'Stick',damage:3}]});game.enemies=[];game.time=34.99;game.spawnClock=100;
  game.update(.1);const captain=game.enemies.find(e=>e.captain);assert.ok(captain);
  assert.equal(game.enemies.filter(e=>e.escortOf===captain.id).length,2);
  assert.ok(game.enemies.filter(e=>e.escortOf===captain.id).every(e=>e.type===captain.type));
  const gold=game.player.gold;game.hurtEnemy(captain,1e6);assert.equal(game.bossesKilled,0);
  assert.ok(game.pickups.some(p=>p.kind==='loot'));assert.equal(game.player.gold,gold+6);
  assert.ok(game.pickups.some(p=>['haste','shield','magnet','heal-percent'].includes(p.kind)));
});

test('camp bonuses apply once, persist through saves and reject malformed ranks',()=>{
  const base=new Game(),game=new Game({}, {legacyBonuses:{power:3,vitality:2,magnet:4}});
  assert.equal(game.player.maxHp,base.player.maxHp+20);assert.equal(game.damageBonus('Elemental').total,20*1.12);
  const restored=Game.restore({},game.snapshot());assert.equal(restored.player.maxHp,game.player.maxHp);assert.equal(restored.damage,game.damage);
  const invalid=game.snapshot();invalid.legacyBonuses.power=6;assert.throws(()=>Game.restore({},invalid));
});

test('official map passability blocks walking and unsafe jump landings, slides along walls and stays outside saves',()=>{
  const game=new Game();game.enemies=[];game.spawnClock=100;
  game.isPassable=(x)=>x<20;game.update(.5,{x:1,y:1});
  assert.ok(game.player.x<20);assert.ok(game.player.y>20);
  game.lastDirection={x:1,y:0};game.dash();game.update(.2);assert.ok(game.player.x<20);
  assert.equal(Object.hasOwn(game.snapshot(),'isPassable'),false);
  assert.equal(Game.restore({},game.snapshot()).isPassable,null);
});

test('level-up replacement stays paused until a matching spell is explicitly selected',()=>{
  const game=new Game();
  for(const id of ['magic-arrow','fireball','lightning','harm','poison','flame-strike','mind-blast'])chooseSpell(game,id);
  game.status='levelup';game.player.level=5;game.choices=newSpellChoices(game).filter(c=>c.spellId==='energy-bolt');
  const pending=game.chooseUpgrade(0);assert.equal(pending.requiresReplacement,true);assert.equal(game.status,'levelup');assert.equal(game.spellLoadout.length,7);
  assert.equal(game.chooseUpgrade(0,'magic-arrow'),true);assert.equal(game.status,'playing');
  assert.ok(game.spellLoadout.some(s=>s.id==='energy-bolt'));assert.equal(game.spellLoadout.some(s=>s.id==='magic-arrow'),false);
});

test('basic magic keeps firing with zero mana and legacy saves discard the resource',()=>{
  const game=new Game();game.enemies=[];const target=game.spawnEnemy();target.x=50;target.y=0;
  game.player.mana=0;game.attack();assert.ok(game.projectiles.length);
  game.attack();assert.equal(game.projectiles.length,2);
  const restored=Game.restore({},game.snapshot());assert.equal(restored.player.mana,undefined);assert.equal(restored.player.maxMana,undefined);
});

test('enemy path hooks steer around walls and report blocked enemies without reporting the player',()=>{
  const game=new Game();game.enemies=[];game.attackClock=100;game.spawnClock=100;
  const enemy=game.spawnEnemy();enemy.x=100;enemy.y=0;
  const behavior=structuredClone(enemy.behavior);game.enemyWaypoint=()=>({x:100,y:100});
  game.update(1/60);assert.equal(enemy.x,100);assert.ok(enemy.y>0);assert.deepEqual(enemy.behavior,behavior);
  let blocked=0;game.isPassable=()=>false;game.blockedActor=actor=>{assert.equal(actor,enemy);blocked++;};
  game.update(1/60,{x:1});assert.equal(blocked,1);
  const saved=game.snapshot();for(const key of ['enemyWaypoint','blockedActor','clearSight'])assert.equal(Object.hasOwn(saved,key),false);
  assert.equal(Game.restore({},saved).enemyWaypoint,null);
});

test('source casters close behind walls and cast only after gaining line of sight',()=>{
  const game=new Game();game.enemies=[];game.attackClock=100;game.spawnClock=100;
  const enemy=game.spawnEnemy({id:'test-mage',name:'Test caster',ranged:true,adaptation:{hp:100,speed:30,damage:5,xp:1,radius:10}});
  enemy.x=200;enemy.y=0;enemy.castClock=0;game.random=()=>0;game.clearSight=()=>false;
  game.update(1/60);assert.equal(game.projectiles.length,0);assert.ok(enemy.x<200);
  game.clearSight=()=>true;game.update(1/60);assert.ok(game.projectiles.some(s=>s.hostile));
  assert.equal(enemy.behavior.caster,true);
});

test('projectiles stop at a blocking map segment instead of damaging creatures through walls',()=>{
  const game=new Game();game.enemies=[];game.attackClock=100;game.spawnClock=100;
  const enemy=game.spawnEnemy();enemy.x=100;enemy.y=0;const hp=enemy.hp;
  game.clearSight=(from,to)=>(from.x<50)===(to.x<50);
  game.projectiles.push({id:game.nextId++,x:0,y:0,vx:200,vy:0,radius:3,damage:100,life:2,hostile:false,hits:[],pierce:0,kind:'magic'});
  game.update(.4);assert.equal(game.projectiles.length,0);assert.equal(enemy.hp,hp);
});

test('every level-up and reroll offers a new passive until all passives are learned',()=>{const g=new Game({}, {seed:173});const passiveIds=['power','haste','vitality','speed','magnet','multishot','regen','armor'];for(const id of ['magic-arrow','fireball','lightning','harm','poison','flame-strike','mind-blast','heal','greater-heal','protection'])chooseSpell(g,id);g.status='levelup';for(let n=0;n<100;n++){g.rollChoices();assert.equal(g.choices.length,3);assert.equal(new Set(g.choices.map(c=>c.id)).size,3);const fresh=g.choices.find(c=>passiveIds.includes(c.id)&&!g.upgrades[c.id]);assert.ok(fresh);if(n<passiveIds.length-1)g.upgrades[fresh.id]=1;}for(const id of passiveIds)g.upgrades[id]=1;g.player.gold=100;assert.equal(g.reroll(),true);assert.ok(g.choices.some(c=>passiveIds.includes(c.id)&&c.level===2));});
test('old pending all-spell choices gain a passive and stale replacement flags are refreshed',()=>{const g=new Game();for(const id of ['magic-arrow','fireball','lightning'])chooseSpell(g,id);g.status='levelup';g.choices=newSpellChoices(g).filter(c=>['energy-bolt','harm','poison'].includes(c.spellId)).map(c=>({...c,requiresReplacement:true}));const legacy=g.snapshot();delete legacy.spellLearningVersion;const restored=Game.restore({},legacy);assert.equal(restored.choices.length,3);assert.ok(restored.choices.some(c=>c.type!=='spell'));assert.ok(restored.choices.filter(c=>c.type==='spell').every(c=>!c.requiresReplacement));const before=structuredClone(restored.spellLoadout);assert.equal(restored.chooseUpgrade(restored.choices.findIndex(c=>c.type!=='spell')),true);assert.deepEqual(restored.spellLoadout,before);assert.equal(restored.status,'playing');});
test('ten-spell loadouts survive save and restore and reject an eighth offensive spell',()=>{const g=new Game();for(const id of ['magic-arrow','fireball','lightning','harm','poison','flame-strike','mind-blast','heal','greater-heal','protection'])chooseSpell(g,id);const restored=Game.restore({},g.snapshot());assert.deepEqual(restored.spellLoadout,g.spellLoadout);const invalid=g.snapshot();invalid.spellLoadout.push({id:'energy-bolt',rank:1,cooldown:0,active:false});assert.throws(()=>Game.restore({},invalid));});
