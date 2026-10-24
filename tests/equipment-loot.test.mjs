import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game,GAME_DEFAULTS} from '../game/core.mjs';
// These mechanics tests interact with creatures on the tick they spawn.
GAME_DEFAULTS.enemyArrival=0;
import {rollAosProperty,itemScore,hasGameplayStats} from '../game/equipment.mjs';
const catalog=JSON.parse(readFileSync(new URL('../game/data/catalog.json',import.meta.url)));
const source=id=>catalog.items.find(i=>i.id===id);
const add=(g,id,tier=0)=>{const i=g.makeItem(source(id),source(id).slot,tier);g.inventory.push(i);return g.inventory.length-1;};
test('every discovered item can be created, assigned to its source slot, and saved',()=>{
 const g=new Game(catalog,{seed:17});
 for(const s of catalog.items){const i=g.makeItem(s,s.slot,0);assert.equal(i.slot,s.slot);assert.ok(i.slot in g.equipment);assert.equal(i.itemId>=0,true);g.inventory.push(i);}
 for(const slot of catalog.equipmentSlots){const index=g.inventory.findIndex(i=>i.slot===slot.id&&i.allowMale!==false);assert.ok(index>=0,slot.id);assert.equal(g.equip(index),true);}
 const restored=Game.restore(catalog,g.snapshot());assert.deepEqual(restored.equipment,g.equipment);assert.equal(restored.inventory.length,g.inventory.length);
});
test('predefined artifacts retain their literal AOS properties without random affixes',()=>{
 const g=new Game(catalog,{seed:90});let count=0;
 for(const s of catalog.items.filter(i=>i.artifact)){const i=g.makeItem(s,s.slot,4);assert.equal(i.name,s.name);assert.equal(i.artifact,true);assert.equal(i.rolledProperties,undefined);for(const field of ['aosAttributes','weaponAttributes','armorAttributes','resistances'])for(const[k,v]of Object.entries(s[field]))assert.equal(i[field][k],v,`${s.id} ${field}.${k}`);count++;}
 assert.ok(count>=100);assert.equal(source('armor-of-fortune').aosAttributes.Luck,200);
});
test('random affixes follow AOS family bounds, increments, and loot intensity budgets',()=>{
 const g=new Game(catalog,{seed:5});
 for(const id of ['katana','leather-chest','gold-ring','aegis'])for(let n=0;n<30;n++){
  const s=source(id),i=g.makeItem(s,s.slot,1+n%4);
  for(const roll of i.rolledProperties||[]){assert.ok(roll.value>=roll.min&&roll.value<=roll.max);assert.equal(roll.value%(roll.step||1),0);if(roll.target==='resistances')assert.equal(i.resistances[roll.key],(s.resistances[roll.key]||0)+roll.value);}
  const keys=(i.rolledProperties||[]).map(r=>r.key);assert.ok(keys.filter(k=>/^Hit(?:Physical|Fire|Cold|Poison|Energy)Area$/.test(k)).length<=1);assert.ok(keys.filter(k=>/^Hit(?:MagicArrow|Harm|Fireball|Lightning)$/.test(k)).length<=1);
  if(!i.artifact)assert.ok(i.lootBudget.pack.startsWith('Aos'));
 }
 for(const rules of Object.values(catalog.aosAffixRules.families))for(const r of rules)for(const random of [()=>0,()=>.5,()=>.99999]){const v=rollAosProperty(r,{minIntensity:0,maxIntensity:100},random);assert.ok(v>=r.min&&v<=r.max);}
});
test('two-handed weapons and matching source layers displace conflicting equipment',()=>{
 const g=new Game(catalog,{seed:8});g.equip(add(g,'aegis'));g.equip(add(g,'bow'));assert.equal(g.equipment.offhand,null);g.equip(add(g,'aegis'));assert.equal(g.equipment.weapon,null);
 g.equip(add(g,'short-pants'));g.equip(add(g,'leather-legs'));assert.equal(g.equipment.pants,null);assert.ok(g.equipment.legs);
});
test('autosell reports inferior pickups, keeps new slots and protects predefined items',()=>{
 const g=new Game(catalog,{seed:7});const high=add(g,'katana',4);g.inventory[high].power=99;g.equip(high);
 const low={...structuredClone(g.inventory[high]),uid:g.nextId++,artifact:false,predefined:false,power:1},before=g.inventory.length,gold=g.player.gold;g.collect({kind:'loot',item:low});assert.equal(g.inventory.length,before);assert.ok(g.player.gold>gold);assert.equal(g.drainLootEvents().at(-1).kind,'autosell');
 const ring=g.makeItem(source('gold-ring'),'ring');g.collect({kind:'loot',item:ring});assert.ok(g.inventory.includes(ring));
 g.autosell='common';for(const id of ['aegis','luckblade']){const i=g.makeItem(source(id),source(id).slot,4);g.collect({kind:'loot',item:i});assert.ok(g.inventory.includes(i),id);}
 const restored=Game.restore(catalog,g.snapshot());assert.equal(restored.autosell,'common');
});
test('kills leave one persistent corpse with body, facing and hue and expire cleanly',()=>{
 const g=new Game(catalog,{seed:11}),e=g.enemies[0];e.hue=1153;g.hurtEnemy(e,1e6);g.hurtEnemy(e,1e6);assert.equal(g.corpses.length,1);assert.equal(g.corpses[0].body,e.body);assert.equal(g.corpses[0].hue,1153);
 const r=Game.restore(catalog,g.snapshot());assert.deepEqual(r.corpses,g.corpses);g.corpses[0].life=.05;g.update(.1);assert.equal(g.corpses.length,0);
});
test('AOS hit points and capped resistance change combat and revert on unequip',()=>{
 const g=new Game(catalog,{seed:42});const s={...source('gold-ring'),aosAttributes:{BonusHits:20},resistances:{Physical:100}},i=g.makeItem(s,'ring');g.inventory.push(i);const max=g.player.maxHp;g.equip(g.inventory.length-1);assert.equal(g.player.maxHp,max+20);assert.equal(g.resistances.Physical,70);
 g.player.hp=g.player.maxHp;g.hurtPlayer(10);assert.ok(Math.abs(g.player.hp-(g.player.maxHp-3))<1e-6);g.unequip(g.inventory.length-1);assert.equal(g.player.maxHp,max);
});
test('on-hit AOS properties leech life and spawn original spell projectiles without recursive procs',()=>{
 const g=new Game(catalog,{seed:55}),s={...source('katana'),aosAttributes:{AttackChance:100},weaponAttributes:{HitLeechHits:100,HitFireball:100,HitMagicArrow:100}},i=g.makeItem(s,'weapon');g.inventory.push(i);g.equip(g.inventory.length-1);g.player.hp=50;const enemy=g.enemies[0];enemy.hp=enemy.maxHp=500;enemy.resistances={};g.hurtEnemy(enemy,10,true);assert.equal(g.player.hp,52.75);assert.ok(g.projectiles.some(p=>p.kind==='fireball'&&p.proc));assert.ok(g.projectiles.some(p=>p.kind==='magic'&&p.proc));
});
test('malformed new equipment properties and corpse state are rejected',()=>{
 const g=new Game(catalog,{seed:4}),a=g.snapshot();a.inventory[0].aosAttributes.WeaponDamage=Infinity;assert.throws(()=>Game.restore(catalog,a));const b=g.snapshot();b.corpses=[{body:1,x:0,y:0,dx:1,dy:0,hue:0,life:999,maxLife:35}];assert.throws(()=>Game.restore(catalog,b));
});

test('older saves gain starter clothing and AOS item data while keeping item identities',()=>{
 const g=new Game(catalog,{seed:69}),old=g.snapshot();delete old.gearVersion;old.inventory=old.inventory.filter(i=>i.slot==='weapon');old.equipment={weapon:old.inventory[0].uid,armor:null};delete old.inventory[0].aosMode;delete old.inventory[0].aosAttributes;old.inventory[0].power=4;
 const r=Game.restore(catalog,old);assert.equal(r.inventory[0].uid,old.inventory[0].uid);assert.equal(r.inventory[0].aosMode,true);assert.equal(r.equipment.robe,null);assert.ok(r.equipped('shirt'));assert.equal(Object.keys(r.equipment).length,20);assert.ok(r.equipped('feet'));assert.equal(r.gearVersion,2);assert.equal(r.inventory[0].power,Math.round((source(r.inventory[0].id).stats.AosMinDamage+source(r.inventory[0].id).stats.AosMaxDamage)/2));
});

test('all equipment slots have comparable loot chances despite differing class counts',()=>{const g=new Game(catalog,{seed:61294}),counts={};for(let i=0;i<4000;i++){g.dropLoot({x:0,y:0});const drop=g.pickups.pop();assert.ok(drop,'Every selected loot roll yields an item');const item=drop.item;assert.ok(hasGameplayStats(item),item.id);if(!item.artifact)counts[item.slot]=(counts[item.slot]||0)+1;}const slots=new Set(catalog.items.filter(i=>!i.artifact&&i.lootEligible!==false).map(i=>i.slot));assert.equal(Object.keys(counts).length,slots.size);for(const slot of slots){assert.ok(counts[slot]>130,slot+': '+counts[slot]);assert.ok(counts[slot]<280,slot+': '+counts[slot]);}for(const slot of ['ring','bracelet','earrings','neck','talisman'])assert.ok(counts[slot]>130,slot);});
test('new characters wear a removable shirt instead of a robe',()=>{for(const archetype of ['mage','warrior','ranger']){const g=new Game(catalog,{archetype});assert.equal(g.equipment.robe,null);assert.equal(g.equipped('shirt').id,'shirt');const shirt=g.equipped('shirt');assert.equal(g.unequip(g.inventory.indexOf(shirt)),true);assert.equal(g.equipment.shirt,null);assert.equal(Game.restore(catalog,g.snapshot()).equipment.shirt,null);}});
test('legacy starter robe returns to the backpack once and can still be deliberately worn',()=>{const g=new Game(catalog,{seed:712}),index=add(g,'robe'),robe=g.inventory[index];g.equip(index);const state=g.snapshot();delete state.starterClothingVersion;const restored=Game.restore(catalog,state);assert.equal(restored.equipment.robe,null);assert.ok(restored.inventory.some(i=>i.uid===robe.uid));assert.ok(restored.equipped('shirt'));restored.equip(restored.inventory.findIndex(i=>i.uid===robe.uid));assert.equal(Game.restore(catalog,restored.snapshot()).equipped('robe').uid,robe.uid);});

test('autoequip leaves robes in the pack until the player deliberately wears one',()=>{const g=new Game(catalog,{seed:501,autoequip:true});const robe=g.makeItem(source('robe'),'robe',2);g.acquireItem(robe);assert.equal(g.equipment.robe,null);g.autoEquipInventory();assert.equal(g.equipment.robe,null);assert.equal(g.equip(g.inventory.indexOf(robe)),true);assert.equal(g.equipment.robe,robe.uid);g.unequip(g.inventory.indexOf(robe));g.autoEquipInventory();assert.equal(g.equipment.robe,null);});

test('plain clothing and jewelry loot gain useful source-range AOS stats',()=>{const g=new Game(catalog,{seed:702});for(const id of ['shirt','short-pants','robe','gold-ring','gold-bracelet','gold-earrings','gold-necklace'])for(let i=0;i<20;i++){const item=g.makeLootItem(source(id),source(id).slot,0);assert.ok(hasGameplayStats(item),id);assert.ok(item.tier>=1,id);for(const rule of item.rolledProperties){assert.ok(rule.value>=rule.min&&rule.value<=rule.max);}}});
