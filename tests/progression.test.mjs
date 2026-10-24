import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../game/core.mjs';
import { freshProgress, validateProgress, createProgressRun, finishProgress, bankCamp, buyLegacy } from '../game/progression.mjs';

const chest={id:'chest',name:'Chest',slot:'armor',itemId:1,stats:{},aosAttributes:{BonusHits:25}};
const catalog={items:[chest],armor:[chest]};

test('finite-zone victory gold does not grow while the player waits to collect loot',()=>{
  const game=winner();game.zoneRun={index:5};game.areaRoute=Array.from({length:6},(_,i)=>({id:String(i)}));
  const first=finishProgress(freshProgress(),game).gold;
  game.time=100000;
  assert.equal(finishProgress(freshProgress(),game).gold,first);
});
function winner(difficulty='normal'){
  const game=new Game(catalog,{difficulty,seed:3});
  const item=game.makeItem(chest);game.inventory.push(item);game.equip(game.inventory.length-1);
  game.player.gold=100;game.time=600;game.kills=120;game.status='victory';return game;
}

test('victory retains gear and gold, applies difficulty rewards and preserves independent profile data',()=>{
  for(const [difficulty,reward] of [['easy',68],['normal',80],['hard',104]]){
    const profile=freshProgress(difficulty);profile.upgrades.power=2;profile.best=650;
    const game=winner(difficulty),next=finishProgress(profile,game);
    assert.equal(next.gold,100+reward);assert.equal(next.victories,1);assert.equal(next.best,650);
    assert.equal(next.upgrades.power,2);assert.equal(profile.gold,0);assert.equal(next.stash.status,'victory');
    assert.deepEqual(validateProgress(JSON.parse(JSON.stringify(next)),catalog),next);
  }
});

test('camp restores equipment and merchant stock, applies newly bought bonuses once and uses unique identifiers',()=>{
  const prior=winner();prior.shopRestocks=2;
  const profile=finishProgress(freshProgress(),prior);
  profile.upgrades.vitality=3;profile.upgrades.power=2;
  const next=createProgressRun(catalog,profile,{seed:7,restoreCamp:true});
  assert.deepEqual(next.inventory,prior.snapshot().inventory);assert.deepEqual(next.equipment,prior.equipment);assert.deepEqual(next.shop,prior.snapshot().shop);
  assert.equal(next.player.maxHp,110+30+25);assert.equal(next.player.hp,next.player.maxHp);
  assert.equal(next.gearHpBonus,25);assert.equal(next.player.gold,profile.gold);assert.equal(next.time,0);assert.equal(next.status,'playing');
  assert.equal(next.shopRestocks,2);assert.equal(next.restockPrice,prior.restockPrice);
  const itemIds=new Set([...next.inventory,...next.shop].map(i=>i.uid));
  assert.ok(next.enemies.every(e=>!itemIds.has(e.id)));assert.ok(next.nextId>Math.max(...itemIds,...next.enemies.map(e=>e.id)));
  const restored=Game.restore(catalog,next.snapshot());assert.equal(restored.player.maxHp,next.player.maxHp);
});

test('new runs clear carried loot, equipped gear and old merchant stock',()=>{
  const prior=winner();prior.shopRestocks=2;
  const profile=finishProgress(freshProgress(),prior);profile.upgrades.vitality=3;
  const fresh=createProgressRun(catalog,profile,{seed:7});
  const expected=new Game(catalog,{seed:7,legacyBonuses:profile.upgrades});
  assert.deepEqual(fresh.inventory,expected.inventory);
  assert.deepEqual(fresh.equipment,expected.equipment);
  assert.deepEqual(fresh.shop,expected.shop);
  assert.equal(fresh.player.maxHp,140);assert.equal(fresh.gearHpBonus,0);
  assert.equal(fresh.player.gold,profile.gold);assert.equal(fresh.shopRestocks,0);
  assert.notDeepEqual(fresh.inventory,prior.inventory);
  assert.deepEqual(Game.restore(catalog,prior.snapshot()).snapshot().inventory,prior.snapshot().inventory);
});

test('backpack cleanup profits survive restoring camp and camp banking',()=>{
  const game=winner();game.autoequip=false;game.autosell='inferior';
  const low=game.makeItem(chest),high=game.makeItem(chest);high.aosAttributes.BonusHits=30;
  game.inventory.push(low,high);
  const profile=finishProgress(freshProgress(),game),next=createProgressRun(catalog,profile,{restoreCamp:true});
  assert.ok(next.player.gold>profile.gold);assert.ok(next.inventory.some(i=>i.uid===high.uid));assert.equal(next.inventory.some(i=>i.uid===low.uid),false);
  next.pause();const banked=bankCamp(profile,next);
  assert.equal(banked.gold,next.player.gold);assert.equal(banked.stash.status,'paused');
  assert.equal(validateProgress(banked,catalog).gold,next.player.gold);
});

test('death clears progression and carried equipment while retaining the selected difficulty',()=>{
  const profile=finishProgress(freshProgress('hard'),winner('hard'));profile.upgrades.vitality=5;
  const game=createProgressRun(catalog,profile);game.status='dead';
  assert.deepEqual(finishProgress(profile,game),freshProgress('hard'));
});

test('camp purchases spend banked gold, cap ranks and affect subsequent starts',()=>{
  const profile=freshProgress();profile.gold=1000;
  for(let rank=0;rank<5;rank++){const before=profile.gold;assert.equal(buyLegacy(profile,'vitality'),true);assert.equal(profile.gold,before-(25+rank*25));}
  assert.equal(buyLegacy(profile,'vitality'),false);assert.equal(buyLegacy(profile,'invalid'),false);
  assert.equal(createProgressRun(catalog,profile).player.maxHp,160);
  const poor=freshProgress();assert.equal(buyLegacy(poor,'power'),false);assert.equal(poor.upgrades.power,0);
});

test('imports reject malformed balances, ranks and stash identity/state without mutating valid profiles',()=>{
  const valid=finishProgress(freshProgress(),winner());
  for(const mutate of [p=>p.gold=-1,p=>p.best=NaN,p=>p.victories=.5,p=>p.upgrades.power=6,p=>p.upgrades=[],p=>p.stash=0,p=>p.stash='',p=>p.stash.status='dead',p=>p.stash.nextId=1,p=>p.stash.inventory.push(structuredClone(p.stash.inventory[0])),p=>p.stash.player.hp=Infinity]){
    const invalid=structuredClone(valid);mutate(invalid);assert.throws(()=>validateProgress(invalid,catalog));
  }
  const accepted=validateProgress(valid,catalog);accepted.stash.inventory[0].name='Changed';assert.notEqual(valid.stash.inventory[0].name,'Changed');
});
