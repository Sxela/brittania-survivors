import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game,ENEMY_ARRIVAL_SECONDS,MASTERED_LEVEL_GOLD} from '../game/core.mjs';
import {chooseSpell} from '../game/spell-system.mjs';
import {spellPreview} from '../game/spell-preview.mjs';
import {spellBreakdown,currentStats} from '../game/build-stats.mjs';
import {spellRankParts,rollSpellPower,withGoldFind,EFFECTIVE_RANK_CAP} from '../game/spell-levels.mjs';
import {hasGameplayStats,propertyRows} from '../game/equipment.mjs';
import {strictlyDominates} from '../game/general-mechanics.mjs';
const catalog=JSON.parse(readFileSync(new URL('../game/data/catalog.json',import.meta.url)));
const ring=catalog.items.find(i=>i.id==='gold-ring');
// Distinct slots without a shared native layer, so each test item stays worn.
const wear=(g,{spellLevels,...patch},slot='ring')=>{const item=g.makeItem({...ring,...patch,slot,serverLayer:undefined,serverLayerNumber:undefined},slot);if(spellLevels)item.spellLevels=spellLevels;g.inventory.push(item);g.equip(g.inventory.length-1);return item;};
const fireball=g=>g.spellLoadout.find(s=>s.id==='fireball');

test('effective rank adds item spell levels and school points with separate caps, and unequip reverts',()=>{
 const g=new Game(catalog,{seed:3});chooseSpell(g,'fireball');
 assert.deepEqual(spellRankParts(g,fireball(g)),{learned:1,gear:0,gearRaw:0,school:0,effective:1,capped:false});
 wear(g,{spellLevels:{fireball:2}});wear(g,{spellLevels:{fireball:3},skillBonuses:[{skill:'Magery',value:15}]},'neck');
 const r=spellRankParts(g,fireball(g));
 assert.equal(r.gearRaw,5);assert.equal(r.gear,3);assert.equal(r.school,1.5);assert.equal(r.effective,5.5);
 wear(g,{skillBonuses:[{skill:'EvalInt',value:30}]},'bracelet');
 assert.equal(spellRankParts(g,fireball(g)).school,3);
 assert.equal(spellRankParts(g,{id:'fireball',rank:5}).effective,EFFECTIVE_RANK_CAP);
 assert.equal(spellRankParts(g,{id:'lightning',rank:1}).gear,0,'spell levels are spell specific');
 for(const slot of ['ring','neck','bracelet'])g.unequip(g.inventory.findIndex(i=>i.uid===g.equipment[slot]));
 assert.equal(spellRankParts(g,fireball(g)).effective,1);
 assert.equal(fireball(g).rank,1,'learned rank is never rewritten');
});

test('casting, previews and the breakdown use the same effective rank',()=>{
 const g=new Game(catalog,{seed:4});chooseSpell(g,'fireball');
 const before=spellPreview(g,'fireball',1);
 wear(g,{spellLevels:{fireball:2}});
 const after=spellPreview(g,'fireball',1);
 assert.equal(after.rank,3);assert.ok(Math.abs(after.damage/before.damage-1.5)<1e-9);assert.ok(after.cooldown<before.cooldown);
 const breakdown=spellBreakdown(g,'fireball');
 assert.ok(breakdown.rows.find(r=>r.label==='Damage').base!==breakdown.rows.find(r=>r.label==='Damage').current,'baseline removes equipment ranks');
 assert.ok(breakdown.sources.some(s=>s.startsWith('Effective rank: learned 1 + gear 2')));
 assert.ok(breakdown.lines.some(s=>s.startsWith('Effective rank: 3')));
 // Projectiles carry raw damage; the class channel bonus in the preview applies on impact.
 const castDamage=game=>{const enemy={id:99,x:game.player.x+120,y:game.player.y,hp:1e6,maxHp:1e6,radius:12,resistances:{}};game.enemies=[enemy];game.weaponSpellClock=99;fireball(game).cooldown=0;game.update(1/60,{x:0,y:0});return game.projectiles.find(p=>p.spellId==='fireball').damage;};
 const plain=new Game(catalog,{seed:4});chooseSpell(plain,'fireball');
 assert.ok(Math.abs(castDamage(g)/castDamage(plain)-after.damage/before.damage)<1e-9,'the cast scales exactly like the preview');
 assert.ok(Math.abs(fireball(g).cooldown-after.cooldown)<1e-9);
});

test('rolled spell power only appears on eligible generated items and counts as loot value',()=>{
 let n=0;const random=()=>(n=(n*9301+49297)%233280)/233280;
 const spells=['fireball','lightning','heal'];let levels=0,school=0;
 for(let i=0;i<400;i++){
  const item=rollSpellPower({},'jewelry',3,{random,spells,learned:['fireball']});
  if(item.spellLevels){levels++;for(const v of Object.values(item.spellLevels))assert.ok(v>=1&&v<=3);}
  if(item.skillBonuses?.length){school++;assert.ok(['Magery','EvalInt'].includes(item.skillBonuses[0].skill));assert.ok(item.skillBonuses[0].value<=15);}
 }
 assert.ok(levels>50&&school>50);
 assert.equal(rollSpellPower({},'armor',4,{random,spells}).spellLevels,undefined,'armor does not roll spell levels');
 assert.equal(rollSpellPower({artifact:true},'jewelry',4,{random:()=>0,spells}).spellLevels,undefined,'fixed uniques keep their properties');
 assert.equal(rollSpellPower({},'jewelry',0,{random:()=>0,spells}).spellLevels,undefined);
 const item={slot:'ring',spellLevels:{fireball:2}};
 assert.ok(hasGameplayStats(item));assert.ok(propertyRows(item).some(r=>r.label==='Fireball levels'&&r.value===2));
 assert.ok(strictlyDominates({...ring,slot:'ring',spellLevels:{fireball:2}},{...ring,slot:'ring',spellLevels:{fireball:1}}));
 assert.ok(!strictlyDominates({...ring,slot:'ring',spellLevels:{fireball:2}},{...ring,slot:'ring',spellLevels:{lightning:1}}),'different spells are a tradeoff');
});

test('spell levels survive saves and malformed levels are rejected',()=>{
 const g=new Game(catalog,{seed:5});chooseSpell(g,'fireball');wear(g,{spellLevels:{fireball:2}});
 const restored=Game.restore(catalog,g.snapshot());assert.equal(spellRankParts(restored,fireball(restored)).gear,2);
 for(const levels of [{fireball:4},{fireball:1.5},{'not-a-spell':1},[]]){const s=g.snapshot();s.inventory.at(-1).spellLevels=levels;assert.throws(()=>Game.restore(catalog,s));}
});

test('gold find raises creature and ore gold, caps at 100% and appears in current stats',()=>{
 const g=new Game(catalog,{seed:6});
 assert.equal(withGoldFind(g,10),10);
 wear(g,{aosAttributes:{GoldFind:40}});assert.equal(withGoldFind(g,10),14);
 wear(g,{aosAttributes:{GoldFind:90}},'neck');assert.equal(withGoldFind(g,10),20);
 assert.ok(currentStats(g).rows.some(([label,value])=>label==='Gold find'&&value.startsWith('+100%')));
 const guardianGold=game=>{const before=game.player.gold,boss={id:991,x:game.player.x+40,y:game.player.y,hp:5,maxHp:5,xp:1,boss:true,radius:12,resistances:{}};game.enemies=[boss];game.hurtEnemy(boss,1000);return game.player.gold-before;};
 const plain=guardianGold(new Game(catalog,{seed:6})),found=guardianGold(g);
 assert.ok(plain>0);assert.equal(found,plain*2,'guardian gold is doubled at the cap');
});

test('new creatures materialize for 0.8 s before they move, touch, cast or take damage',()=>{
 const g=new Game(catalog,{seed:8});g.enemies=[];
 const e=g.spawnEnemy();assert.equal(e.arrival,ENEMY_ARRIVAL_SECONDS);
 Object.assign(e,{x:g.player.x,y:g.player.y,damage:50,speed:90});
 const hp=g.player.hp,start={x:e.x,y:e.y},enemyHp=e.hp;
 g.hurtEnemy(e,1000);assert.equal(e.hp,enemyHp,'arriving creatures cannot be hit');
 assert.equal(g.nearest(g.player,1000),null,'targeting ignores arriving creatures');
 g.update(.3,{x:0,y:0});assert.equal(g.player.hp,hp,'no contact damage while arriving');assert.deepEqual({x:e.x,y:e.y},start);
 assert.ok(g.effects.some(f=>f.kind==='teleport'),'arrival is visible');
 const s=g.snapshot();assert.equal(Game.restore(catalog,s).enemies[0].arrival,e.arrival);
 s.enemies[0].arrival=99;assert.throws(()=>Game.restore(catalog,s));
 for(let t=0;t<.6;t+=.05)g.update(.05,{x:0,y:0});
 assert.equal(e.arrival,0);assert.equal(g.nearest(g.player,1000),e);
 g.hurtEnemy(e,1);assert.ok(e.hp<enemyHp);
});

test('a level with no legal choices converts to gold instead of an empty menu, and cannot be rerolled',()=>{
 const g=new Game(catalog,{seed:9});
 g.rollChoices=function(){this.choices=[];};
 g.player.gold=100;g.player.xp=g.player.nextXp;const level=g.player.level;g.checkLevel();
 assert.equal(g.player.level,level+1);assert.equal(g.status,'playing');assert.equal(g.player.gold,100+MASTERED_LEVEL_GOLD);
 g.status='levelup';g.choices=[];assert.equal(g.reroll(),false);assert.equal(g.player.gold,100+MASTERED_LEVEL_GOLD);
});
