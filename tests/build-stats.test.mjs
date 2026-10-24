import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game/core.mjs';
import {SPELLS,chooseSpell} from '../game/spell-system.mjs';
import {spellPreview} from '../game/spell-preview.mjs';
import {spellBreakdown,currentStats} from '../game/build-stats.mjs';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('spell inspection reconciles base, additive upgrades, passive, active buff and separate item damage without mutation',()=>{
 const g=new Game();chooseSpell(g,'fireball');
 g.inventory.push({uid:1234,slot:'weapon',power:10,aosMode:true,stats:{},aosAttributes:{ElementalDamage:40}});g.equipment.weapon=1234;
 g.spellLoadout.find(s=>s.id==='fireball').statUpgrades={damage:.5,haste:.25};
 g.globalSpellUpgrades={elemental:.15,haste:.1};g.heroStatUpgrades={power:.2};
 g.spellLoadout.push({id:'cunning',rank:1,cooldown:0,active:true,activeRemaining:20});
 const before=g.snapshot(),detail=spellBreakdown(g,'fireball'),preview=spellPreview(g,'fireball');
 close(preview.damage,35*1.4*1.5*(1+.2*(1+.4+.15+.2+.1)));
 const damage=detail.rows.find(r=>r.label==='Damage');
 assert.equal(Number(damage.base),25*1.4*1.2);assert.equal(Number(damage.current),Number(preview.damage.toFixed(2)));
 for(const source of ['Spell upgrades · Damage / potency: +50%','Shared upgrades · Elemental damage bonus: +15%','Passives · Damage bonus: +20%','Active spell buffs / legacy · Damage bonus: +10%','Equipment · Elemental damage bonus: +40%'])assert.ok(detail.sources.some(line=>line.includes(source)),source);
 assert.deepEqual(g.snapshot(),before);
});

test('every spell exposes actual previews with no fake weapon damage on healing or earthquake',()=>{
 const g=new Game();g.spellLoadout=SPELLS.map(s=>({id:s.id,rank:1,cooldown:0,statUpgrades:{damage:.25,area:.1,haste:.15,duration:.1}}));
 g.globalSpellUpgrades={haste:.15};
 for(const spell of SPELLS){
  const detail=spellBreakdown(g,spell.id);assert.ok(detail.rows.some(r=>r.label==='Cooldown'),spell.id);
  assert.ok(!/NaN|undefined/.test(JSON.stringify(detail)),spell.id);
  const cooldown=detail.rows.find(r=>r.label==='Cooldown');assert.equal(cooldown.current,Number(spellPreview(g,spell.id).cooldown.toFixed(2))+' s');
 }
 for(const id of ['heal','earthquake'])assert.ok(!spellBreakdown(g,id).sources.some(s=>s.includes('Weapon power')));
 assert.equal(spellBreakdown(g,'not-a-spell'),null);
});

test('resistance inspection includes wards and passive caps and predicts the actual received hit',()=>{
 const g=new Game();
 assert.deepEqual(currentStats(g).resistance.map(r=>r.base),[5,20]);
 g.inventory.push({uid:987,slot:'chest',aosMode:true,resistances:{Physical:60,Fire:40,Cold:20,Poison:20,Energy:0}});g.equipment.chest=987;
 g.heroStatUpgrades={armor:.1};g.spellLoadout=[{id:'reactive-armor',rank:1,active:true,activeRemaining:30,cooldown:0}];
 const report=currentStats(g),physical=report.resistance[0],elemental=report.resistance[1];
 assert.equal(physical.flat,60);assert.equal(physical.wards,16);assert.equal(physical.total,66.3);assert.equal(physical.effective,66.3);
 assert.equal(elemental.flat,20);assert.equal(elemental.wards,-5);assert.equal(elemental.effective,41);
 const hp=g.player.hp;g.hurtPlayer(100,'Physical');close(hp-g.player.hp,33.7);
 g.heroStatUpgrades.armor=10;assert.equal(currentStats(g).resistance[0].effective,70);
 g.player.hp=100;g.hitClock=0;g.hurtPlayer(100,'Fire');close(100-g.player.hp,30);
});
