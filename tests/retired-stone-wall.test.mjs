import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game/core.mjs';
import {SPELLS,chooseSpell,newSpellChoices} from '../game/spell-system.mjs';
import {freshProgress,validateProgress} from '../game/progression.mjs';

test('Wall of Stone is not offered and old learned ranks, upgrades and pending milestones migrate safely',()=>{
 const g=new Game({});assert(!SPELLS.some(s=>s.id==='wall-of-stone'));assert.equal(chooseSpell(g,'wall-of-stone').ok,false);assert(!newSpellChoices(g).some(s=>s.spellId==='wall-of-stone'));
 const state=g.snapshot();state.spellLoadout=[{id:'wall-of-stone',rank:3,cooldown:2,active:false,upgradeCount:5,statUpgrades:{area:.25},superUpgrades:[]}];state.pendingSpellSupers=[{spellId:'wall-of-stone',milestone:5}];
 state.spellFields=[{kind:'wall-of-stone',x:0,y:0,angle:0,radius:80,life:3,tick:0,damage:0}];
 const migrated=Game.restore({},state),spell=migrated.spellLoadout[0];assert.equal(spell.id,'paralyze-field');assert.equal(spell.rank,3);assert.equal(spell.statUpgrades.area,.25);assert.equal(migrated.spellFields.length,0);assert.equal(migrated.pendingSpellSupers[0].spellId,'paralyze-field');
 assert.equal(Game.restore({},migrated.snapshot()).spellLoadout[0].id,'paralyze-field');
});
test('retired spell bonuses on insured account gear migrate without invalidating the profile or changing ownership',()=>{
 const profile=freshProgress();profile.account.nextId=2;profile.account.inventory=[{uid:1,accountItemId:1,insured:true,slot:'weapon',id:'wand',name:'Wand',price:20,power:5,defense:0,grantedSpell:'wall-of-stone',spellLevels:{'wall-of-stone':3,'paralyze-field':3}}];profile.account.equipment.mage.weapon=1;
 const migrated=validateProgress(profile,{}),item=migrated.account.inventory[0];assert.equal(item.grantedSpell,'paralyze-field');assert.equal(item.spellLevels['wall-of-stone'],undefined);assert.equal(item.spellLevels['paralyze-field'],3);assert.equal(item.spellLevels['fire-field'],3);assert.equal(migrated.account.equipment.mage.weapon,1);assert.doesNotThrow(()=>validateProgress(migrated,{}));
});

test('an old fixed shop containing a stone-wall upgrade keeps its slots and purchase state on migration',()=>{
 const area={id:'test',name:'Test',combatClasses:[],facets:['Trammel'],zoneIds:['test'],typicalThreat:1,maximumThreat:1},catalog={areas:[area],zoneMode:true};
 const g=new Game(catalog),state=g.snapshot();state.zoneRun.phase='spellshop';state.zoneRun.fixedShopVersion=1;state.zoneRun.bossSpawned=state.zoneRun.bossKilled=true;
 state.spellLoadout=[{id:'wall-of-stone',rank:2,cooldown:0,active:false}];
 state.zoneSpellOffers=[{id:'spell:wall-of-stone:duration',spellId:'wall-of-stone',type:'spell',upgradeKind:'duration',rarity:'rare',bonus:.15,purchased:true},...['power','speed','magnet','armor'].map(id=>({id,type:'passive',rarity:'common',bonus:.05}))];
 const migrated=Game.restore(catalog,state);assert.equal(migrated.zoneSpellOffers.length,5);assert.equal(migrated.zoneSpellOffers[0].spellId,'paralyze-field');assert.equal(migrated.zoneSpellOffers[0].purchased,true);assert.deepEqual(migrated.zoneSpellOffers.slice(1).map(o=>o.id),['power','speed','magnet','armor']);assert.doesNotThrow(()=>Game.restore(catalog,migrated.snapshot()));
});
