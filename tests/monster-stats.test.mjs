import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Game,GAME_DEFAULTS} from '../game/core.mjs';
// These mechanics tests interact with creatures on the tick they spawn.
GAME_DEFAULTS.enemyArrival=0;
const catalog=JSON.parse(fs.readFileSync(new URL('../game/data/catalog.json',import.meta.url)));
catalog.enemyEquipment=JSON.parse(fs.readFileSync(new URL('../game/data/enemy-equipment.json',import.meta.url)));
const inside=(value,range,label)=>assert.ok(value>=Math.min(...range)&&value<=Math.max(...range),`${label}: ${value} outside ${range}`);

test('Normal monsters retain source AoS hit/damage/resistance ranges, without HP or damage caps',()=>{
 const game=new Game(catalog,{seed:51});game.enemies=[];
 for(const source of catalog.monsters){
  const enemy=game.spawnEnemy(source,false,false,{modifier:null});
  const hits=source.stats.hits||source.stats.str;
  if(hits)inside(enemy.hp,hits,source.id+' HP');
  if(source.stats.damage)inside(enemy.damage,source.stats.damage,source.id+' damage');
  for(const [name,range] of Object.entries(source.resistances))inside(enemy.resistances[name],range,source.id+' '+name);
  game.enemies=[];
 }
 const harrower=game.spawnEnemy('harrower',true,true);assert.ok(harrower.hp>=30000);
});

test('Balron stays592–711HP and22–29damage in all scheduled boss roles on Normal',()=>{
 const game=new Game(catalog,{seed:45});game.enemies=[];
 for(const [time,final] of [[480,false],[585,true],[600,true]]){
  game.time=time;const enemy=game.spawnEnemy('balron',true,final,{modifier:null});
  inside(enemy.hp,[592,711],'Balron HP');inside(enemy.damage,[22,29],'Balron damage');
  assert.equal(enemy.maxMana,enemy.serverStats.int);
 }
});

test('first-minute random waves never include boss-only creatures; Balrons unlock at8:00 bosses',()=>{
 const game=new Game(catalog,{seed:7});
 for(let i=0;i<1000;i++){
  game.time=i%60;const enemy=game.spawnEnemy();
  assert.notEqual(enemy.type,'balron');assert.equal(catalog.monsters.find(m=>m.id===enemy.type)?.adaptation.bossOnly,false);
  game.enemies=[];
 }
 for(const time of [120,240,360])for(let i=0;i<50;i++){
  game.time=time;assert.notEqual(game.spawnEnemy(null,true).type,'balron');game.enemies=[];
 }
 game.time=480;const seen=new Set();for(let i=0;i<1000;i++){seen.add(game.spawnEnemy(null,true).type);game.enemies=[];}
 assert.ok(seen.has('balron'));
});

test('human equipment is seeded, saved, and retained on true corpse garment layers',()=>{
 const a=new Game(catalog,{seed:9}),b=new Game(catalog,{seed:9});
 const enemy=a.spawnEnemy('brigand'),same=b.spawnEnemy('brigand');
 assert.deepEqual(enemy.equipment,same.equipment);assert.ok(enemy.equipment.some(i=>i.slot==='weapon'));assert.ok(enemy.equipment.length>=4);
 a.hurtEnemy(enemy,1e9);const corpse=a.corpses.at(-1);assert.deepEqual(corpse.equipment,enemy.equipment);
 enemy.equipment[0].hue=123;assert.notDeepEqual(corpse.equipment,enemy.equipment);
 const restored=Game.restore(catalog,a.snapshot());assert.deepEqual(restored.corpses.at(-1).equipment,corpse.equipment);
 const invalid=a.snapshot();invalid.enemies[0].equipment=[{slot:'weapon',itemId:-1,hue:0}];assert.throws(()=>Game.restore(catalog,invalid));
});

test('old saves gain native stats at the same health fraction and retire premature boss species',()=>{
 const game=new Game(catalog,{seed:4});game.enemies=[];game.time=40;
 const orc=game.spawnEnemy('orc');orc.hp=5;orc.maxHp=10;game.spawnEnemy('balron');
 const save=game.snapshot();delete save.monsterStatsVersion;for(const enemy of save.enemies){delete enemy.serverStats;delete enemy.equipment;}
 const restored=Game.restore(catalog,save);
 assert.equal(restored.enemies.length,1);const enemy=restored.enemies[0];assert.equal(enemy.type,'orc');
 inside(enemy.maxHp,catalog.monsters.find(m=>m.id==='orc').stats.hits,'restored Orc HP');assert.equal(enemy.hp,enemy.maxHp*.5);
 assert.equal(restored.monsterStatsVersion,1);
});
