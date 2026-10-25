import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game/core.mjs';
import {freshProgress,createProgressRun,finishProgress,syncAccountProgress,createAccountWardrobe,validateProgress,resumableRun} from '../game/progression.mjs';
import {ACCOUNT_UPGRADES,buyAccountUpgrade,ingotReward} from '../game/account.mjs';
const ring={id:'ring',name:'Ring',slot:'ring',itemId:1,stats:{},aosAttributes:{Luck:5}};
const catalog={items:[ring]};

test('ingots only roll from bosses and champions, rarely, in 10-50 percent first-upgrade payouts',()=>{
 let calls=0;assert.equal(ingotReward({},()=>{calls++;return 0}),0);assert.equal(calls,0);
 assert.equal(ingotReward({boss:true},()=>.31),0);assert.equal(ingotReward({packChampion:true},()=>.13),0);
 for(const leader of [{boss:true},{packChampion:true},{captain:true}])for(const value of [0,.5,.999]){
  let first=true;const payout=ingotReward(leader,()=>{if(first){first=false;return 0;}return value;});assert(payout>=2&&payout<=10);
 }
 const g=createProgressRun(catalog,freshProgress(),{seed:5});g.collect({kind:'ingot',value:4});assert.equal(g.ingotsEarned,4);assert.equal(g.player.gold,0);
 assert.equal(Game.restore(catalog,g.snapshot()).ingotsEarned,4);
});
test('account ingots settle once across autosave/reload/death and cannot resume a finished run',()=>{
 const profile=freshProgress(),g=createProgressRun(catalog,profile,{seed:4});g.ingotsEarned=5;
 syncAccountProgress(profile,g);syncAccountProgress(profile,g);assert.equal(profile.account.ingots,5);
 const restored=Game.restore(catalog,g.snapshot());syncAccountProgress(profile,restored);assert.equal(profile.account.ingots,5);
 const prior={state:restored.snapshot()};assert(resumableRun(prior,profile));restored.status='dead';restored.player.hp=0;
 const ended=finishProgress(profile,restored);assert.equal(ended.account.ingots,5);assert(!resumableRun(prior,ended));assert(!resumableRun({state:restored.snapshot()},profile));
 syncAccountProgress(ended,g);assert.equal(ended.account.ingots,5);
 assert.deepEqual(validateProgress(JSON.parse(JSON.stringify(ended)),catalog),ended);
});
test('permanent upgrades require ingots, survive death and apply five percent bonuses without stacking on restore or purchases',()=>{
 const profile=freshProgress();profile.gold=10000;assert.equal(buyAccountUpgrade(profile,'power'),false);
 profile.account.ingots=10000;for(const {id}of ACCOUNT_UPGRADES)assert(buyAccountUpgrade(profile,id));
 const g=createProgressRun(catalog,profile,{seed:5}),base=new Game(catalog);
 assert.equal(g.player.maxHp,base.player.maxHp*1.05);assert.equal(g.player.speed,base.player.speed*1.05);
 assert.equal(g.heroUpgradeBonus('power'),.05);assert.equal(g.aosBonuses.Luck,5);assert.equal(g.player.gold,profile.gold+5);
 g.applyPassiveUpgrade({id:'power',rarity:'common'});assert.equal(g.heroUpgradeBonus('power'),.1);
 const restored=Game.restore(catalog,g.snapshot());assert.equal(restored.heroUpgradeBonus('power'),.1);assert.equal(restored.player.maxHp,g.player.maxHp);
 g.status='dead';const ended=finishProgress(profile,g);assert.deepEqual(ended.account.upgrades,profile.account.upgrades);assert.equal(ended.gold,0);
 const camp=createProgressRun(catalog,profile,{restoreCamp:true});assert.equal(camp.player.gold,profile.gold);
});
test('insured gear survives death in a shared backpack, transfers between distinct class outfits, and avoids autosell',()=>{
 const profile=freshProgress(),warrior=createProgressRun(catalog,profile,{archetype:'warrior'});
 const item=warrior.makeItem(ring);item.insured=true;warrior.acquireItem(item);warrior.equip(warrior.inventory.indexOf(item));
 const ordinary=warrior.makeItem(ring);warrior.inventory.push(ordinary);warrior.status='dead';warrior.player.hp=0;
 const ended=finishProgress(profile,warrior);assert.equal(ended.account.inventory.length,1);const id=ended.account.inventory[0].accountItemId;
 assert.equal(ended.account.equipment.warrior.ring,id);assert.deepEqual(ended.account.equipment.mage,{});
 const mage=createAccountWardrobe(catalog,ended,'mage');assert.equal(mage.inventory.length,1);assert.equal(mage.equipped('ring'),undefined);
 assert(mage.equip(0));syncAccountProgress(ended,mage,{wardrobe:true});assert.equal(ended.account.equipment.mage.ring,id);assert.equal(ended.account.equipment.warrior.ring,undefined);
 const run=createProgressRun(catalog,ended,{archetype:'mage'});assert.equal(run.equipped('ring').accountItemId,id);
 run.autosell='common';run.equipment.ring=null;run.cleanupInventory();assert(run.inventory.some(i=>i.accountItemId===id));
 assert.deepEqual(validateProgress(JSON.parse(JSON.stringify(ended)),catalog),ended);
});
test('account imports migrate old profiles and reject malformed wallets, gear and duplicate assignments',()=>{
 const legacy=freshProgress();delete legacy.account;assert.equal(validateProgress(legacy,catalog).account.ingots,0);
 const profile=freshProgress(),g=createProgressRun(catalog,profile);const item=g.makeItem(ring);item.insured=true;g.inventory.push(item);g.equip(0);syncAccountProgress(profile,g);
 for(const mutate of [p=>p.account.ingots=-1,p=>p.account.upgrades.power=11,p=>p.account.inventory[0].insured=false,p=>p.account.inventory.push({...p.account.inventory[0]}),p=>p.account.equipment.warrior={ring:p.account.inventory[0].accountItemId},p=>p.account.receipts.bad={ingots:Infinity,finished:false}]){
  const invalid=structuredClone(profile);mutate(invalid);assert.throws(()=>validateProgress(invalid,catalog));
 }
});
