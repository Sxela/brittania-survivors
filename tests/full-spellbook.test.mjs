import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game/core.mjs';
import {SPELLS,SPELL_CAPACITY,spellChoices,newSpellChoices,chooseSpell} from '../game/spell-system.mjs';
import {rollZoneSpells,rerollZoneSpells,buyZoneSpell} from '../game/zone-run.mjs';
function fullBook(){
 const g=new Game({}, {seed:41});
 for(const [category,count] of Object.entries(SPELL_CAPACITY))for(const s of SPELLS.filter(s=>s.category===category).slice(0,count))chooseSpell(g,s.id);
 return g;
}
test('full book offers learned upgrades across level draws, shops and paid rerolls',()=>{
 const g=fullBook(),known=new Set(g.spellLoadout.map(s=>s.id));
 assert.ok(spellChoices(g).length>=10);
 g.zoneRun={phase:'spellshop',rerolls:0,index:0};g.player.gold=1000000;
 for(let i=0;i<20;i++){
  g.rollChoices();assert.ok(g.choices.some(c=>c.type!=='spell'));
  for(const c of g.choices.filter(c=>c.type==='spell')){assert.ok(known.has(c.spellId));assert.ok(c.upgradeKind);assert.equal(c.requiresReplacement,false);}
  rollZoneSpells(g);assert.ok(g.zoneSpellOffers.every(c=>c.type==='global'||c.type==='passive'||known.has(c.spellId)));
  assert.equal(rerollZoneSpells(g),true);assert.ok(g.zoneSpellOffers.every(c=>c.type==='global'||c.type==='passive'||known.has(c.spellId)));
 }
 const index=g.zoneSpellOffers.findIndex(c=>c.type==='spell'),offered=g.zoneSpellOffers[index].spellId;assert.equal(buyZoneSpell(g,index),true);assert.equal(g.spellLoadout.find(s=>s.id===offered).upgradeCount,1);
});
test('partial books separate new spells and legacy max-rank books offer independent stat improvements',()=>{
 const g=fullBook();g.spellLoadout.pop();assert.ok(newSpellChoices(g).some(c=>!g.spellLoadout.some(s=>s.id===c.spellId)));assert.ok(spellChoices(g).every(c=>c.upgradeKind));
 const full=fullBook();full.spellLoadout.forEach(s=>s.rank=5);assert.ok(spellChoices(full).every(c=>c.upgradeKind));
 full.rollChoices();assert.equal(full.choices.length,3);assert.ok(full.choices.some(c=>c.type!=='spell'));
});
test('stale replacement offers cannot spend gold or replace a full book, including restored level draws',()=>{
 const g=fullBook(),known=structuredClone(g.spellLoadout),s=SPELLS.find(s=>!known.some(k=>k.id===s.id));
 const stale={...s,type:'spell',id:'spell:'+s.id,spellId:s.id,level:1,requiresReplacement:true};
 g.zoneRun={phase:'spellshop',rerolls:0,index:0};g.player.gold=100;g.zoneSpellOffers=[stale];
 assert.equal(buyZoneSpell(g,0,known[0].id),false);assert.equal(g.player.gold,100);
 g.status='levelup';g.rollChoices();g.choices[0]=stale;assert.equal(g.chooseUpgrade(0,known[0].id),false);assert.deepEqual(g.spellLoadout,known);
 g.zoneRun=null;g.zoneSpellOffers=[];
 const restored=Game.restore({},g.snapshot());assert.ok(restored.choices.length);assert.ok(restored.choices.every(c=>c.type!=='spell'||known.some(s=>s.id===c.spellId)));
});
