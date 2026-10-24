import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game/core.mjs';
import {chooseSpell,applySpellOffer,SPELLS} from '../game/spell-system.mjs';
import {UPGRADE_RARITIES,decorateUpgrade,applyGlobalUpgrade,spellTuning} from '../game/spell-upgrades.mjs';
import {spellPreview} from '../game/spell-preview.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} vs ${b}`);
const passive=(g,id,rarity)=>g.applyPassiveUpgrade({id,rarity});

test('all five rarity tiers use the exact requested individual and global percentages',()=>{
 assert.deepEqual(UPGRADE_RARITIES.map(r=>r.statBonus),[.05,.10,.15,.25,.50]);assert.deepEqual(UPGRADE_RARITIES.map(r=>r.globalBonus),[.05,.10,.15,.20,.25]);
 const rolls=[.9,.3,.1,.03,.001],g=new Game();
 for(let i=0;i<5;i++){g.random=()=>rolls[i];for(const kind of ['damage','area','haste','duration'])assert.equal(decorateUpgrade(g,{id:'spell:fire-field:'+kind,spellId:'fire-field',type:'spell',upgradeKind:kind}).bonus,UPGRADE_RARITIES[i].statBonus);assert.equal(decorateUpgrade(g,{id:'power',type:'passive'}).bonus,UPGRADE_RARITIES[i].statBonus);assert.equal(decorateUpgrade(g,{id:'global:area',globalKey:'area',upgradeKind:'area',type:'global'}).bonus,UPGRADE_RARITIES[i].globalBonus);}
});

test('50% plus 5% is 55% of base for passive damage, movement, health, attack speed and pickup radius',()=>{
 for(const id of ['power','speed','vitality','haste','magnet']){const g=new Game(),damage=g.damage,speed=g.player.speed,hp=g.player.maxHp,interval=g.attackInterval;assert.equal(passive(g,id,'legendary'),true);assert.equal(passive(g,id,'common'),true);close(g.heroUpgradeBonus(id),.55);if(id==='power')close(g.damageBonus('Elemental').total,20*1.55);if(id==='speed')close(g.player.speed,speed*1.55);if(id==='vitality')close(g.player.maxHp,hp*1.55);if(id==='haste')close(g.attackInterval,interval/1.55);const restored=Game.restore({},g.snapshot());close(restored.heroUpgradeBonus(id),.55);close(restored.player.speed,g.player.speed);}
});

test('individual spell damage adds against the spell base; shared and hero damage add against the class bonus',()=>{
 const g=new Game();chooseSpell(g,'fireball');const base=spellPreview(g,'fireball').damage;
 for(const rarity of ['legendary','common'])assert.equal(applySpellOffer(g,{spellId:'fireball',upgradeKind:'damage',rarity}).ok,true);
 close(spellPreview(g,'fireball').damage,base*1.55);
 assert.equal(applyGlobalUpgrade(g,{id:'global:elemental',globalKey:'elemental',upgradeKind:'damage',rarity:'common'}),true);close(spellPreview(g,'fireball').damage,base/1.2*1.55*1.21);
 passive(g,'power','legendary');passive(g,'power','common');close(spellPreview(g,'fireball').damage,base/1.2*1.55*1.32);
 const restored=Game.restore({},g.snapshot());close(spellPreview(restored,'fireball').damage,base/1.2*1.55*1.32);
});

test('Super tradeoffs are additive too, and repeated common bonuses do not accumulate rounding drift',()=>{
 const g=new Game();chooseSpell(g,'fireball');const item=g.spellLoadout[0];item.statUpgrades={damage:.55,haste:.55};item.superUpgrades=['power'];close(spellTuning(item,g).damage,2.15);close(spellTuning(item,g).haste,1.35);item.superUpgrades=['quick','many'];close(spellTuning(item,g).damage,1.15);
 const h=new Game();for(let n=0;n<10;n++)passive(h,'power','common');assert.equal(h.heroStatUpgrades.power,.5);
});

test('fractional projectile bonuses improve extra-projectile chance additively, and regen/resistance remain useful',()=>{
 const g=new Game();passive(g,'multishot','legendary');passive(g,'multishot','common');g.enemies=[{id:200,x:100,y:0,hp:10000,radius:12}];g.random=()=>.54;g.attack();assert.equal(g.projectiles.length,2);g.projectiles=[];g.random=()=>.56;g.attack();assert.equal(g.projectiles.length,1);
 for(const rarity of ['legendary','common']){passive(g,'armor',rarity);passive(g,'regen',rarity);}g.hitClock=0;g.player.hp=g.player.maxHp;const hp=g.player.hp;g.hurtPlayer(100);close(hp-g.player.hp,92.25);g.player.hp=20;g.enemies=[];g.spawnClock=g.attackClock=99999;g.update(1);close(g.player.hp,21.1);
});

test('legacy pending cards are updated to the new percentages without rerolling rarity',()=>{
 const g=new Game();g.player.xp=g.player.nextXp;g.checkLevel();const saved=g.snapshot();for(const choice of saved.choices)if(choice.type!=='spell'){choice.rarity='legendary';choice.bonus=0;}
 const restored=Game.restore({},saved);assert.ok(restored.choices.filter(c=>c.type!=='spell').every(c=>c.rarity==='legendary'&&c.bonus===.5));assert.equal(restored.rng,saved.rng);
 const invalid=g.snapshot();invalid.heroStatUpgrades={power:NaN};assert.throws(()=>Game.restore({},invalid));
});
