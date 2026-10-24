import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,GAME_DEFAULTS} from '../game/core.mjs';
// These mechanics tests interact with creatures on the tick they spawn.
GAME_DEFAULTS.enemyArrival=0;
import {bossSchedule,championSchedule,lootRarity} from '../game/reward-rules.mjs';

const catalog={items:[
 {id:'sword',name:'Sword',slot:'weapon',itemId:1,stats:{MinDamage:5,MaxDamage:8}},
 {id:'relic',name:'Relic',slot:'head',itemId:2,artifact:true,aosAttributes:{Luck:100},stats:{}}
]};
function quiet(game){game.enemies=[];game.spawnClock=999;game.attackClock=999;return game;}

test('Allods timing: four two-minute bosses, final at9:45, and staggered champions',()=>{
 assert.deepEqual(bossSchedule(),[120,240,360,480,585]);
 assert.deepEqual(championSchedule(),[35,80,170,215,260,305,395,440,530]);
 assert.deepEqual(bossSchedule(10),[10]);
 const g=quiet(new Game(catalog));
 for(const mark of bossSchedule()){
  g.time=mark-.01;g.update(.02);
  assert.equal(g.enemies.filter(e=>e.boss).length,1);
  assert.equal(!!g.enemies[0].final,mark===585);
  g.enemies=[];
 }
 assert.deepEqual(g.bossesSpawned,[120,240,360,480]);assert.equal(g.finalBossSpawned,true);
 assert.doesNotThrow(()=>Game.restore(catalog,g.snapshot()));
});

test('champions alternate captain and elite packs with two escorts, skip stale marks and cap leaders',()=>{
 const g=quiet(new Game(catalog));
 g.time=34.99;g.update(.02);let leader=g.enemies.find(e=>e.captain);
 assert.ok(leader);assert.equal(leader.packChampion,false);
 assert.equal(g.enemies.filter(e=>e.escortOf===leader.id).length,2);
 assert.ok(g.enemies.filter(e=>e.escortOf===leader.id).every(e=>!e.elite));
 g.time=79.99;g.update(.02);leader=g.enemies.find(e=>e.packChampion);
 assert.ok(leader);assert.ok(g.enemies.filter(e=>e.escortOf===leader.id).every(e=>e.elite));
 g.time=169.99;g.update(.02);assert.equal(g.enemies.filter(e=>e.captain).length,2);
 const restored=Game.restore(catalog,g.snapshot());restored.update(.01);
 assert.equal(restored.enemies.filter(e=>e.captain).length,2);
 const jumped=quiet(new Game(catalog));jumped.time=300;jumped.update(.01);
 assert.equal(jumped.enemies.filter(e=>e.captain).length,0);
});

test('regular mobs never drop equipment; only bosses and champions guarantee it',()=>{
 const g=quiet(new Game(catalog,{seed:8372}));let drops=0;g.dropLoot=()=>drops++;
 const kill=(flags={})=>{const enemy=g.spawnEnemy(null,!!flags.boss);Object.assign(enemy,flags);g.hurtEnemy(enemy,1e9);g.enemies=[];g.pickups=[];};
 kill();assert.equal(drops,0);
 drops=0;for(let i=0;i<10000;i++)kill();
 assert.equal(drops,0,'No random or first-kill equipment drops');
 for(const flags of [{elite:true},{modifier:'paragon'}]){kill(flags);assert.equal(drops,0);}
 for(const flags of [{boss:true},{captain:true},{packChampion:true}]){const before=drops;kill(flags);assert.equal(drops,before+1);}
});

test('ordinary and leader rarity rolls follow Allods odds while preserving UO fixed artifacts',()=>{
 for(const leader of [false,true]){
  const g=quiet(new Game(catalog,{seed:921})),counts={normal:0,magic:0,rare:0,artifact:0};
  g.time=400;
  for(let i=0;i<10000;i++){
   g.dropLoot({boss:leader,x:100,y:100});const item=g.pickups.pop().item;counts[item.rarity]++;
   if(item.artifact){assert.equal(item.id,'relic');assert.deepEqual(item.aosAttributes,{Luck:100});assert.equal(item.tier,0);}
  }
  if(leader){assert.equal(counts.normal,0);assert.ok(counts.artifact>=190&&counts.artifact<=310);assert.ok(counts.magic>7300&&counts.magic<7700);}
  else{assert.ok(counts.normal>5800&&counts.normal<6200);assert.ok(counts.artifact>=20&&counts.artifact<=65);}
 }
 assert.equal(lootRarity(.96,{leader:true}), 'rare');
 assert.equal(lootRarity(.96,{leader:true,magicFind:2}), 'artifact');
});

test('bosses and captains award Allods gold and powerups, bosses guarantee large healing drops',()=>{
 for(const [flags,amount] of [[{boss:true},15],[{captain:true},6]]){
  const g=quiet(new Game(catalog));g.autosell='off';const enemy=g.spawnEnemy(null,!!flags.boss);Object.assign(enemy,flags);
  const before=g.player.gold;g.hurtEnemy(enemy,1e9);
  assert.equal(g.player.gold,before+amount);
  assert.equal(g.pickups.filter(p=>p.kind==='loot').length,1);
  assert.equal(g.pickups.filter(p=>['haste','shield','magnet','heal-percent'].includes(p.kind)&&p.life===45).length,1);
  if(flags.boss)assert.ok(g.pickups.some(p=>p.kind==='heal'&&p.value===35));
 }
 const hard=quiet(new Game(catalog,{difficulty:'hard'})),boss=hard.spawnEnemy(null,true),before=hard.player.gold;
 hard.hurtEnemy(boss,1e9);assert.equal(hard.player.gold,before+23);
});

test('autosell defaults on, sells worse pickups once, protects equipped gear, artifacts and tradeoffs',()=>{
 const g=quiet(new Game(catalog));assert.equal(g.autosell,'inferior');
 const source={id:'helm',name:'Helm',slot:'head',itemId:3,stats:{}};
 const strong=g.makeItem({...source,aosAttributes:{Luck:20}},'head',0);g.acquireItem(strong);
 const weak=g.makeItem({...source,aosAttributes:{Luck:10}},'head',0),gold=g.player.gold;
 g.collect({kind:'loot',item:weak});assert.ok(!g.inventory.some(i=>i.uid===weak.uid));assert.ok(g.player.gold>gold);
 const after=g.player.gold;g.cleanupInventory();assert.equal(g.player.gold,after);assert.equal(g.equipment.head,strong.uid);
 const tradeoff=g.makeItem({...source,aosAttributes:{BonusHits:1}},'head',0);g.acquireItem(tradeoff);
 const unique=g.makeItem({...source,artifact:true,aosAttributes:{Luck:1}},'head',0);g.acquireItem(unique);
 assert.ok(g.inventory.some(i=>i.uid===tradeoff.uid));assert.ok(g.inventory.some(i=>i.uid===unique.uid));
 assert.equal(Game.restore(catalog,g.snapshot()).autosell,'inferior');
});

test('older saves skip past encounter marks and new schedules persist without replay',()=>{
 const g=quiet(new Game(catalog));g.time=350;const save=g.snapshot();
 delete save.encounterVersion;delete save.championMarks;save.bossesSpawned=[.25,.5];save.captainClock=12;
 const restored=Game.restore(catalog,save);restored.update(.01);
 assert.equal(restored.enemies.filter(e=>e.boss||e.captain).length,0);
 restored.time=359.99;restored.update(.02);assert.equal(restored.enemies.filter(e=>e.boss).length,1);
 const after=Game.restore(catalog,restored.snapshot());after.update(.01);assert.equal(after.enemies.filter(e=>e.boss).length,1);
 const invalid=after.snapshot();invalid.championMarks=[35,35];assert.throws(()=>Game.restore(catalog,invalid));
});

test('a final boss drops a chest that opens before timed victory',()=>{
 const g=quiet(new Game(catalog));g.time=584.99;g.update(.02);g.player.nextXp=1000000;
 const boss=g.enemies.find(e=>e.final);assert.ok(boss);g.autosell='off';
 const gold=g.player.gold,count=g.inventory.length;g.hurtEnemy(boss,1e9);
 assert.equal(g.player.gold,gold+15);assert.equal(g.inventory.length,count);const chest=g.pickups.find(p=>p.kind==='loot');assert.ok(chest);Object.assign(g.player,{x:chest.x,y:chest.y});assert.equal(g.openLootChest(chest.id),true);assert.equal(g.inventory.length,count+1);
 g.update(.02);assert.equal(g.status,'playing');
 g.time=599.99;g.update(.02);assert.equal(g.status,'victory');
});
