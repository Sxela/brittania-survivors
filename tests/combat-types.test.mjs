import test from 'node:test';
import assert from 'node:assert/strict';
import {combatResistances,combatAffixRules,itemResistances} from '../game/combat-types.mjs';
import {Game} from '../game/core.mjs';
import {propertyRows,attributesOf} from '../game/equipment.mjs';
import {spellPreview} from '../game/spell-preview.mjs';
import {spellChoices,chooseSpell} from '../game/spell-system.mjs';
function arena(){const g=new Game({}, {seed:4,archetype:'warrior'});const weapon={uid:900,id:'test',name:'Test',itemId:1,tier:0,price:1,slot:'weapon',aosMode:true,power:10,defense:0,stats:{},damageTypes:{Physical:50,Fire:50},aosAttributes:{AttackChance:100,PhysicalDamage:20,ElementalDamage:40},weaponAttributes:{}};g.inventory.push(weapon);g.equipment.weapon=900;g.enemies=[{id:99,x:0,y:0,radius:12,hp:10000,maxHp:10000,resistances:{Physical:20,Elemental:50}}];return g;}
test('legacy elemental resistance averages four components while new elemental bonuses remain full strength',()=>{
 assert.deepEqual(combatResistances({Physical:[10,30],Fire:40,Cold:20,Poison:0,Energy:20,Elemental:5}),{Physical:20,Elemental:25});
 assert.deepEqual(itemResistances({resistances:{Physical:10,Fire:40},weaponAttributes:{ResistFireBonus:20,ResistElementalBonus:5,ResistPhysicalBonus:2}}),{Physical:10,Elemental:10});
});
test('every elemental identity shares one resistance, physical stays independent, and mixed weapons apply each bonus once',()=>{
 const g=arena(),e=g.enemies[0];
 for(const element of ['Fire','Cold','Poison','Energy']){e.hp=10000;g.hurtEnemy(e,100,false,element);assert.equal(e.hp,9946.5,element);}
 e.hp=10000;g.hurtEnemy(e,100,false,'Physical');assert.equal(e.hp,9900.8);
 e.hp=10000;e.spellBurnUntil=0;g.hurtEnemy(e,100,true);assert.equal(e.hp,9923.65);assert.equal(e.spellBurnDamage,5);
});
test('unified elemental area procs preserve burn and do not multiply triggering-hit damage bonuses twice',()=>{
 const g=arena(),e=g.enemies[0],weapon=g.equipped('weapon');weapon.damageTypes={Fire:100};weapon.weaponAttributes.HitFireArea=100;e.resistances={};
 g.hurtEnemy(e,100,true);assert.equal(e.hp,9839.5);assert.equal(e.spellBurnDamage,10);
});
test('incoming elemental hits all use the same resistance and gear survives save restoration',()=>{
 const g=arena(),w=g.equipped('weapon');w.resistances={Physical:20,Fire:40,Cold:40,Poison:40,Energy:40};
 assert.deepEqual(g.resistances,{Physical:40,Elemental:45});
 for(const element of ['Fire','Cold','Poison','Energy']){g.hitClock=0;g.player.hp=g.player.maxHp;const hp=g.player.hp;g.hurtPlayer(20,element);assert.equal(g.player.hp,hp-Math.max(1,(20-g.armor)*.55));}
 g.enemies=[];assert.deepEqual(Game.restore({},g.snapshot()).resistances,g.resistances);
});
test('item tooltips and new affixes expose two channels while keeping status identities',()=>{
 const item={slot:'weapon',power:10,damageTypes:{Fire:50,Cold:50},resistances:{Fire:20,Cold:20,Poison:20,Energy:20},aosAttributes:{WeaponDamage:20,SpellDamage:10}};
 assert.deepEqual(attributesOf(item),{ElementalDamage:30});
 const rows=propertyRows(item);assert.ok(rows.some(r=>r.key==='resist:Elemental'&&r.value===20));assert.ok(rows.some(r=>r.key==='damage:Elemental'&&r.value===100));assert.ok(rows.some(r=>r.key==='effect:Cold'));assert.ok(!rows.some(r=>/^resist:(Fire|Cold|Poison|Energy)$/.test(r.key)));
 const rules=combatAffixRules(['Fire','Cold','Poison','Energy'].map(key=>({target:'resistances',key,min:1,max:15})),item);assert.equal(rules.filter(r=>r.target==='resistances').length,1);assert.equal(rules[0].key,'Elemental');assert.equal(rules[0].max,15);
});
test('spell previews and upgrade cards distinguish physical from elemental damage',()=>{
 const g=arena();chooseSpell(g,'fireball');chooseSpell(g,'earthquake');
 const preview=spellPreview(g,'fireball');g.equipped('weapon').aosAttributes.ElementalDamage=0;assert.ok(Math.abs(preview.damage/spellPreview(g,'fireball').damage-1.07/1.05)<1e-10);
 const cards=spellChoices(g);assert.ok(cards.some(c=>c.spellId==='fireball'&&c.upgradeLabel==='Elemental damage'));assert.ok(cards.some(c=>c.spellId==='earthquake'&&c.upgradeLabel==='Physical damage'));
});
