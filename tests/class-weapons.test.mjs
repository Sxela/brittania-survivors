import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game} from '../game/core.mjs';
import {classChannelBases,damageIncrease,combatAffixRules} from '../game/combat-types.mjs';
import {applyWeaponIdentity,WEAPON_TRAITS} from '../game/weapon-traits.mjs';
import {attributesOf,propertyRows} from '../game/equipment.mjs';
import {chooseSpell,spellChoices,spellHud,tickSpellSystem} from '../game/spell-system.mjs';
import {applyStatUpgrade,applyGlobalUpgrade,globalSpellChoices} from '../game/spell-upgrades.mjs';
import {spellPreview} from '../game/spell-preview.mjs';
import {spellBreakdown} from '../game/build-stats.mjs';
import {strictlyDominates} from '../game/general-mechanics.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const enemy=()=>({id:777,x:100,y:0,hp:10000,maxHp:10000,radius:12,damage:1,speed:0,xp:0,cooldown:0,type:'rat',resistances:{}});
function worn(g,attributes={}){const i={uid:900,id:'test',slot:'ring',name:'Test',power:0,defense:0,price:1,aosAttributes:attributes};g.inventory.push(i);g.equipment.ring=i.uid;return i;}
const wand={id:'fireball-wand',name:'Fireball Wand',slot:'weapon',itemId:3570,stats:{MinDamage:9,MaxDamage:11,Speed:40},aosAttributes:{},weaponAttributes:{}};

test('naked class resistances and channel damage bonuses use the requested class bases',()=>{
 for(const [archetype,expected]of [['mage',{Physical:5,Elemental:20}],['warrior',{Physical:20,Elemental:5}],['archer',{Physical:12,Elemental:12}]]){
  const g=new Game({}, {archetype});assert.deepEqual(classChannelBases(g),expected);assert.deepEqual(g.resistances,expected);
  for(const channel of ['Physical','Elemental']){close(damageIncrease(g,channel),1+expected[channel]/100);g.hitClock=0;g.player.hp=100;g.player.armor=0;g.hurtPlayer(100,channel);close(100-g.player.hp,100-expected[channel]);}
 }
});
test('mage 5% physical base becomes 7.5% with +50%; all percentage sources add and flat item points remain separate',()=>{
 const g=new Game(),item=worn(g,{ResistPhysicalBonus:50,PhysicalDamage:50});
 close(g.resistances.Physical,7.5);close(g.damageBonus('Physical').total,7.5);
 item.aosAttributes.ResistPhysicalBonus+=5;item.aosAttributes.PhysicalDamage+=5;
 g.heroStatUpgrades={armor:.5,power:.5};item.aosAttributes.ResistPhysicalFlat=3;item.aosAttributes.PhysicalDamageFlat=3;
 close(g.resistances.Physical,5*(1+.55+.5)+3);close(g.damageBonus('Physical').total,5*(1+.55+.5)+3);
 const e=enemy();g.enemies=[e];g.hurtEnemy(e,100,false,'Physical');close(10000-e.hp,100*(1+(5*2.05+3)/100));
 item.aosAttributes.ResistPhysicalFlat=1000;assert.equal(g.resistances.Physical,70);
 assert.ok(propertyRows(item).some(r=>r.label.includes('flat points')));assert.ok(propertyRows(item).some(r=>r.label.includes('% of class base')));
});
test('weapon autocast follows shared damage, area and haste without a spell slot or individual progression',()=>{
 const g=new Game({weapons:[wand]});g.enemies=[enemy()];
 assert.equal(g.equipped('weapon').id,'fireball-wand');assert.equal(g.weaponSpell.id,'fireball');assert.equal(g.spellLoadout.length,0);assert.deepEqual(spellChoices(g),[]);
 const base=spellPreview(g,'fireball',1,g.weaponSpell);g.heroStatUpgrades={power:.5,haste:.5};g.globalSpellUpgrades={elemental:.5,haste:.25,area:.25};
 const current=spellPreview(g,'fireball',1,g.weaponSpell);close(current.damage/base.damage,1.4/1.2);close(current.radius/base.radius,1.25);close(current.cooldown,3.5/1.75);
 tickSpellSystem(g,.01);const shot=g.projectiles.find(p=>p.spellId==='fireball');assert.ok(shot);const hp=g.enemies[0].hp;g.hurtEnemy(g.enemies[0],shot.damage,false,'Fire');close(hp-g.enemies[0].hp,current.damage);
 assert.equal(applyStatUpgrade(g,g.weaponSpell,{upgradeKind:'damage',rarity:'common'}),false);assert.equal(g.weaponSpell.rank,1);assert.equal(g.spellLoadout.length,0);
 assert.ok(spellHud(g).some(s=>s.id==='weapon:fireball'&&s.weaponGranted));assert.ok(spellBreakdown(g,'weapon:fireball').sources.some(s=>s.includes('no individual upgrades')));
 assert.ok(globalSpellChoices(g,[{id:'fireball',category:'offense',cooldown:3.5,name:'Fireball'}]).some(s=>s.globalKey==='elemental'));
});
test('learning the same spell does not transfer its progress to the weapon; unequip stops casting and swapping cannot reset the cooldown',()=>{
 const g=new Game({weapons:[wand]});g.enemies=[enemy()];chooseSpell(g,'fireball');g.spellLoadout[0].statUpgrades={damage:1,haste:1};
 const fixed=spellPreview(g,'fireball',1,g.weaponSpell);assert.ok(spellPreview(g,'fireball').damage>fixed.damage);
 tickSpellSystem(g,.01);const clock=g.weaponSpellClock;g.unequip(g.inventory.findIndex(i=>i.uid===g.equipment.weapon));assert.equal(g.weaponSpell,null);
 g.projectiles=[];g.spellLoadout=[];tickSpellSystem(g,.1);assert.equal(g.projectiles.length,0);g.equip(0);close(g.weaponSpellClock,clock-.1);tickSpellSystem(g,.01);assert.equal(g.projectiles.length,0);
 const restored=Game.restore({weapons:[wand]},g.snapshot());close(restored.weaponSpellClock,g.weaponSpellClock);assert.equal(restored.weaponSpell.id,'fireball');
 const invalid=g.snapshot();invalid.inventory[0].grantedSpell='mana-drain';assert.throws(()=>Game.restore({weapons:[wand]},invalid));
});
test('weapon traits preserve literal native unique properties and provide active arcane, area, speed and leech bonuses',()=>{
 const catalog=JSON.parse(readFileSync(new URL('../game/data/catalog.json',import.meta.url),'utf8')),g=new Game(catalog,{archetype:'warrior'}),seen=new Map();
 for(const source of catalog.weapons){const item=g.makeItem(source,'weapon',0);if(item.weaponTrait&&!seen.has(item.weaponTrait))seen.set(item.weaponTrait,{item,source});}
 assert.equal(seen.size,4);
 for(const [trait,{item,source}]of seen){
  assert.deepEqual(item.weaponAttributes,source.weaponAttributes||{});assert.deepEqual(item.weaponBonuses,WEAPON_TRAITS[trait].attributes);
  g.inventory=[item];g.equipment={weapon:item.uid};const b=attributesOf(item);for(const [key,n]of Object.entries(WEAPON_TRAITS[trait].attributes))assert.ok(b[key]>=n);
  const before=g.snapshot();applyWeaponIdentity(item);assert.deepEqual(g.snapshot(),before);
  g.enemies=[enemy(),{...enemy(),id:778,x:150}];g.random=()=>0;g.player.hp=10;
  if(trait==='arcane'){g.applyWeaponProperties(g.enemies[0],10);assert.ok(g.projectiles.some(p=>p.proc&&p.kind==='fireball'));}
  if(trait==='sweeping'){g.applyWeaponProperties(g.enemies[0],10);assert.ok(g.enemies[1].hp<10000);}
  if(trait==='vampiric'){g.applyWeaponProperties(g.enemies[0],10);assert.ok(g.player.hp>10);}
  if(trait==='swift'){const interval=g.attackInterval;item.weaponBonuses={};assert.ok(g.attackInterval>interval);}
 }
 const rules=combatAffixRules([{target:'aosAttributes',key:'WeaponDamage',min:1,max:50}],{slot:'weapon'});assert.ok(rules.some(r=>r.key==='PhysicalDamageFlat'));assert.ok(rules.some(r=>r.key==='ResistPhysicalBonus'));
});
test('old weapon saves adopt traits once, preserve roll RNG and retain the new identity on repeated restore',()=>{
 const g=new Game({weapons:[wand]}),old=g.snapshot();delete old.weaponIdentityVersion;delete old.weaponSpellClock;delete old.inventory[0].grantedSpell;delete old.inventory[0].weaponIdentityVersion;
 const restored=Game.restore({weapons:[wand]},old);assert.equal(restored.weaponSpell.id,'fireball');assert.equal(restored.rng,old.rng);assert.equal(restored.weaponSpellClock,0);
 assert.deepEqual(Game.restore({weapons:[wand]},restored.snapshot()).snapshot(),restored.snapshot());
});
test('autosell preserves different weapon spells and distinguishes flat resistance from relative bonuses',()=>{
 const a={slot:'weapon',power:10,grantedSpell:'fireball'},b={slot:'weapon',power:50,grantedSpell:'lightning'};
 assert.equal(strictlyDominates(b,a),false);
 const ring={slot:'ring',power:0,resistances:{Physical:5},aosAttributes:{ResistPhysicalBonus:50}};
 assert.equal(strictlyDominates({...ring,aosAttributes:{ResistPhysicalBonus:5}},ring),false);
 assert.equal(strictlyDominates({...ring,aosAttributes:{ResistPhysicalBonus:55}},ring),true);
 assert.equal(strictlyDominates({...ring,resistances:{Physical:10},aosAttributes:{}},ring),false);
});
