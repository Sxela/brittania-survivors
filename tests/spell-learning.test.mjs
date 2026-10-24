import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,GAME_DEFAULTS} from '../game/core.mjs';
// These mechanics tests interact with creatures on the tick they spawn.
GAME_DEFAULTS.enemyArrival=0;
import {SPELLS,chooseSpell,newSpellChoices,spellChoices,tickSpellSystem} from '../game/spell-system.mjs';
import {GLOBAL_SPELL_UPGRADES,globalSpellChoices,applyGlobalUpgrade,decorateUpgrade,spellTuning,applyStatUpgrade,chooseSuperUpgrade} from '../game/spell-upgrades.mjs';
import {spellPreview} from '../game/spell-preview.mjs';
const grant=(g,key)=>{const def=GLOBAL_SPELL_UPGRADES.find(d=>d.key===key);assert.equal(applyGlobalUpgrade(g,{id:'global:'+key,globalKey:key,upgradeKind:def.kind,rarity:'common',bonus:def.base}),true);};
test('every fifth level draws three unique unlearned spells, normal levels only upgrade and rerolls preserve the mode',()=>{
 const g=new Game({}, {seed:92});g.player.gold=100000;
 for(let level=2;level<=21;level++){
  g.player.xp=g.player.nextXp;g.checkLevel();assert.equal(g.player.level,level);
  const known=new Set(g.spellLoadout.map(i=>i.id));
  for(let reroll=0;reroll<3;reroll++){
   assert.equal(g.choices.length,3);assert.equal(new Set(g.choices.map(c=>c.id)).size,g.choices.length);
   if(level%5===0){assert.ok(g.choices.every(c=>c.type==='spell'&&!c.upgradeKind&&!known.has(c.spellId)));assert.equal(new Set(g.choices.map(c=>c.category)).size,2);}
   else assert.ok(g.choices.every(c=>c.type!=='spell'||c.upgradeKind&&known.has(c.spellId)));
   assert.equal(g.reroll(),true);
  }
  const index=level%5===0?0:g.choices.findIndex(c=>c.type!=='spell'&&c.type!=='global');assert.equal(g.chooseUpgrade(index),true);
 }
 assert.equal(g.spellLoadout.length,4);
});
test('full books still receive three new spell choices; cancelling keeps progress and replacing resets only that spell',()=>{
 const g=new Game({}, {seed:5});for(const category of ['offense','defense'])for(const s of SPELLS.filter(s=>s.category===category).slice(0,category==='offense'?7:3))chooseSpell(g,s.id);
 const old=g.spellLoadout.find(i=>i.id==='fireball');for(let n=0;n<5;n++)applyStatUpgrade(g,old,{upgradeKind:'damage',rarity:'common',bonus:.05});chooseSuperUpgrade(g,'quick',SPELLS);grant(g,'elemental');
 g.player.level=10;g.status='levelup';g.rollChoices();const index=g.choices.findIndex(c=>c.category==='offense'),offer=g.choices[index],before=structuredClone(g.spellLoadout),gold=g.player.gold;
 assert.equal(g.chooseUpgrade(index).requiresReplacement,true);assert.deepEqual(g.spellLoadout,before);assert.equal(g.player.gold,gold);
 assert.equal(g.chooseUpgrade(index,'heal').ok,false);assert.equal(g.chooseUpgrade(index,old.id),true);
 const replacement=g.spellLoadout.find(s=>s.id===offer.spellId);assert.deepEqual(replacement,{id:offer.spellId,rank:1,cooldown:0,active:false});assert.ok(!g.spellLoadout.some(s=>s.id===old.id));assert.equal(g.globalSpellUpgrades.elemental,.05);
});
test('skipping a new spell consumes just its selection, and excess experience pauses at the next reward',()=>{
 const g=new Game();g.player.level=4;g.player.xp=g.player.nextXp+100000;g.checkLevel();assert.equal(g.player.level,5);const gold=g.player.gold;
 assert.equal(g.skipNewSpell(),true);assert.equal(g.player.level,6);assert.equal(g.status,'levelup');assert.equal(g.choices.length,3);assert.equal(g.skipNewSpell(),false);assert.equal(g.player.gold,gold);assert.equal(g.spellLoadout.length,0);
});
test('shared upgrades use their rarity percentages, affect current and future spells, and never queue Super milestones',()=>{
 const g=new Game();chooseSpell(g,'fireball');chooseSpell(g,'lightning');chooseSpell(g,'heal');
 for(const def of GLOBAL_SPELL_UPGRADES){const choice=globalSpellChoices(g,SPELLS).find(c=>c.globalKey===def.key);if(!choice)continue;const decorated=decorateUpgrade({...g,random:()=>.1,aosBonuses:{}},choice);assert.equal(decorated.bonus,.15);}
 const before=spellPreview(g,'fireball');grant(g,'elemental');grant(g,'area');grant(g,'haste');assert.ok(Math.abs(spellPreview(g,'fireball').damage/before.damage-1.21/1.2)<1e-9);assert.ok(Math.abs(spellPreview(g,'fireball').radius/before.radius-1.05)<1e-9);assert.ok(Math.abs(spellPreview(g,'fireball').cooldown/before.cooldown-1/1.05)<1e-9);
 chooseSpell(g,'energy-bolt');assert.equal(spellTuning(g.spellLoadout.at(-1),g).damage,1);assert.deepEqual(g.pendingSpellSupers,[]);assert.ok(g.spellLoadout.every(i=>i.upgradeCount===undefined));
 const restored=Game.restore({},g.snapshot());assert.deepEqual(restored.globalSpellUpgrades,g.globalSpellUpgrades);assert.equal(spellPreview(restored,'energy-bolt').damage,spellPreview(g,'energy-bolt').damage);
});
test('shared physical, elemental and defensive potency affect only related spells and casts match previews',()=>{
 const g=new Game();for(const id of ['fireball','earthquake','heal','fire-field'])chooseSpell(g,id);g.enemies=[];const e=g.spawnEnemy();e.hp=e.maxHp=100000;e.x=50;e.y=0;
 const fire=spellPreview(g,'fireball').damage,quake=spellPreview(g,'earthquake').damage,heal=spellPreview(g,'heal').healing;
 grant(g,'physical');assert.equal(spellPreview(g,'fireball').damage,fire);assert.equal(spellPreview(g,'heal').healing,heal);assert.equal(spellPreview(g,'earthquake').damage[1],quake[1]/1.05*1.0525);
 grant(g,'potency');assert.equal(spellPreview(g,'heal').healing,heal*1.05);grant(g,'elemental');grant(g,'duration');grant(g,'haste');grant(g,'area');g.player.hp=1;tickSpellSystem(g,.01);
 const shot=g.projectiles.find(p=>p.spellId==='fireball'),field=g.spellFields.find(f=>f.kind==='fire-field');assert.equal(shot.damage*1.21,spellPreview(g,'fireball').damage);assert.ok(Math.abs(field.radius-spellPreview(g,'fire-field').radius)<1e-9);assert.ok(Math.abs(field.life+.01-spellPreview(g,'fire-field').duration)<1e-9);assert.ok(Math.abs(g.spellLoadout.find(i=>i.id==='fireball').cooldown-spellPreview(g,'fireball').cooldown)<1e-9);
});
test('three-choice pending rewards persist exactly; legacy mixed rewards migrate and invalid shared stats are rejected',()=>{
 const g=new Game();g.player.level=5;g.status='levelup';g.rollChoices();const restored=Game.restore({},g.snapshot());assert.deepEqual(restored.choices,g.choices);
 const old=g.snapshot();old.spellLearningVersion=1;old.choices=newSpellChoices(g).slice(0,5);delete old.globalSpellUpgrades;const migrated=Game.restore({},old);assert.equal(migrated.choices.length,3);assert.ok(migrated.choices.every(c=>!c.upgradeKind));
 for(const bad of [{area:-1},{area:Infinity},{unknown:1},[]]){const snap=g.snapshot();snap.globalSpellUpgrades=bad;assert.throws(()=>Game.restore({},snap));}
});
