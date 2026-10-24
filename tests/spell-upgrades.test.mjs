import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game/core.mjs';
import {SPELLS,chooseSpell,spellChoices,applySpellOffer,tickSpellSystem,chainTargets,spellCooldown} from '../game/spell-system.mjs';
import {decorateUpgrade,rollUpgradeRarity,spellTuning,chooseSuperUpgrade,superUpgradeOptions} from '../game/spell-upgrades.mjs';
import {spellPreview,spellOfferPreviewLines} from '../game/spell-preview.mjs';
import {enterZoneSpellShop} from '../game/zone-run.mjs';
function arena(id='fireball'){
 const g=new Game({}, {seed:55});g.enemies=[];g.spawnClock=g.attackClock=999;g.spellLoadout=[];chooseSpell(g,id);
 g.enemies=Array.from({length:5},(_,n)=>({id:20+n,x:80+n*65,y:0,radius:12,hp:1e6,maxHp:1e6,resistances:{},damage:1,speed:0,xp:1,cooldown:0,type:'rat'}));
 return g;
}
function offer(g,kind){const c=spellChoices(g).find(c=>c.spellId===g.spellLoadout[0].id&&c.upgradeKind===kind);assert.ok(c,kind);return {...c,rarity:'common',bonus:kind==='targets'?1:.05};}
test('stat upgrades never add spell ranks or stop at legacy rank caps',()=>{
 const g=arena();for(let n=0;n<12;n++){assert.equal(applySpellOffer(g,offer(g,'damage')).ok,true);if(g.pendingSpellSupers.length)chooseSuperUpgrade(g,'many',SPELLS);}
 assert.equal(g.spellLoadout[0].rank,1);assert.equal(g.spellLoadout[0].upgradeCount,12);assert.ok(spellChoices(g).some(c=>c.upgradeKind==='damage'));
 assert.ok(spellOfferPreviewLines(g,offer(g,'damage')).some(s=>s.includes('Damage:')&&s.includes('\u2192')));
});
test('each stat changes its actual cast behavior and previews use those same values',()=>{
 const g=arena();const initial=spellPreview(g,'fireball');
 for(const kind of ['damage','area','haste'])assert.equal(applySpellOffer(g,offer(g,kind)).ok,true);
 const item=g.spellLoadout[0],preview=spellPreview(g,item.id);tickSpellSystem(g,.01);
 assert.ok(preview.damage>initial.damage);assert.ok(preview.radius>initial.radius);assert.ok(preview.cooldown<initial.cooldown);
 assert.equal(g.projectiles[0].damage*1.2,preview.damage);assert.equal(g.projectiles[0].splashRadius,preview.radius);assert.equal(item.cooldown,preview.cooldown);
 const field=arena('fire-field');applySpellOffer(field,offer(field,'duration'));tickSpellSystem(field,.01);
 assert.ok(field.spellFields[0].life>6);assert.ok(Math.abs(field.spellFields[0].life-(spellPreview(field,'fire-field').duration-.01))<1e-6);
});
test('chain lightning offers targets instead of AoE and really jumps between enemies',()=>{
 const g=arena('chain-lightning');assert.ok(!spellChoices(g).some(c=>c.spellId==='chain-lightning'&&c.upgradeKind==='area'));
 const n=spellPreview(g,'chain-lightning').targets;applySpellOffer(g,offer(g,'targets'));assert.equal(spellPreview(g,'chain-lightning').targets,n+1);
 assert.deepEqual(chainTargets(g,g.enemies[0],4).map(e=>e.id),[20,21,22,23]);
 g.clearSight=(a,b)=>b.id!==22;assert.ok(!chainTargets(g,g.enemies[0],5).some(e=>e.id===22));
});
test('luck improves rarity monotonically and rarity controls additive stat bonuses',()=>{
 for(let i=0;i<100;i++){const r=i/100;const a=rollUpgradeRarity(()=>r),b=rollUpgradeRarity(()=>r,2000);assert.ok(b.factor>=a.factor);}
 const g=arena(),c=offer(g,'damage');g.random=()=>.001;const epic=decorateUpgrade(g,c);assert.equal(epic.rarity,'legendary');assert.equal(epic.bonus,.5);
 const start=spellTuning(g.spellLoadout[0]).damage;applySpellOffer(g,epic);applySpellOffer(g,epic);assert.equal(spellTuning(g.spellLoadout[0]).damage,start+1);
 assert.equal(applySpellOffer(g,{...epic,bonus:99}).ok,false);
});
test('fifth improvement queues a separate, free two-option super choice and persists it',()=>{
 const g=arena();g.player.gold=123;g.player.level=7;
 for(let n=0;n<5;n++)applySpellOffer(g,offer(g,'damage'));
 assert.equal(g.pendingSpellSupers.length,1);assert.equal(g.player.level,7);assert.equal(g.player.gold,123);
 assert.equal(superUpgradeOptions(SPELLS.find(s=>s.id==='fireball')).length,2);
 const restored=Game.restore({},g.snapshot());assert.deepEqual(restored.pendingSpellSupers,g.pendingSpellSupers);
 const time=restored.time;restored.update(.2);assert.equal(restored.time,time);
 assert.equal(chooseSuperUpgrade(restored,'invalid',SPELLS),false);assert.equal(chooseSuperUpgrade(restored,'many',SPELLS),true);
 tickSpellSystem(restored,.01);assert.equal(restored.projectiles.length,2);assert.equal(restored.pendingSpellSupers.length,0);
 for(let n=0;n<5;n++)applySpellOffer(restored,offer(restored,'damage'));assert.equal(restored.pendingSpellSupers[0].milestone,10);
});
test('extra fields and summons survive concurrent casts instead of replacing each other',()=>{
 for(const id of ['fire-field','fire-elemental']){
  const g=arena(id);for(let n=0;n<5;n++)applySpellOffer(g,offer(g,'damage'));chooseSuperUpgrade(g,'many',SPELLS);tickSpellSystem(g,.01);
  assert.equal(g.spellFields.filter(f=>f.kind===id).length,2);
 }
});
test('bad upgrade and super state are rejected on restore',()=>{
 const g=arena();applySpellOffer(g,offer(g,'damage'));const bad=g.snapshot();bad.spellLoadout[0].statUpgrades.area=NaN;assert.throws(()=>Game.restore({},bad));
 const bad2=g.snapshot();bad2.pendingSpellSupers=[{spellId:'fireball',milestone:5}];assert.throws(()=>Game.restore({},bad2));
});
test('partial and full loadouts only offer stat improvements in upgrade draws',()=>{
 const g=arena();assert.ok(spellChoices(g).every(c=>c.upgradeKind));
 for(const category of ['offense','defense'])for(const s of SPELLS.filter(s=>s.category===category).slice(0,category==='offense'?7:3))if(!g.spellLoadout.some(i=>i.id===s.id))chooseSpell(g,s.id);
 // fireball is in the first seven offensive definitions.
 assert.equal(g.spellLoadout.length,10);assert.ok(spellChoices(g).every(c=>c.upgradeKind));
});

test('capped stat bonuses disappear instead of offering upgrades that do nothing',()=>{
 const g=arena();g.spellLoadout[0].statUpgrades={area:3,haste:19};
 assert.ok(!spellChoices(g).some(c=>c.spellId==='fireball'&&['area','haste'].includes(c.upgradeKind)));
});
test('duration and casting upgrades improve defensive buff uptime',()=>{
 const g=arena('protection');applySpellOffer(g,offer(g,'duration'));applySpellOffer(g,offer(g,'haste'));tickSpellSystem(g,.01);
 const item=g.spellLoadout[0];assert.equal(item.activeRemaining,31.5);assert.ok(item.cooldown<45);assert.ok(item.cooldown>item.activeRemaining);
});

test('permanently maintained buffs stop offering redundant duration and casting cards',()=>{
 const g=arena('protection');g.spellLoadout[0].statUpgrades={duration:2};
 assert.ok(spellChoices(g).filter(c=>c.spellId==='protection').every(c=>c.upgradeKind==='damage'));
});
