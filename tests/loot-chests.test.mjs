import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game/core.mjs';
import {lootChestAtPoint} from '../game/loot-chests.mjs';
import {lootRarity} from '../game/reward-rules.mjs';
import {rollUpgradeRarity,decorateUpgrade} from '../game/spell-upgrades.mjs';
function chestGame(){const g=new Game({}, {seed:2});g.enemies=[];g.pickups=[];g.spawnClock=g.attackClock=g.novaClock=g.chainClock=99999;g.autosell='off';g.autoequip=false;const item={uid:g.nextId++,id:'ring',name:'Ring',slot:'ring',price:100,power:0,defense:1,aosAttributes:{Luck:50}};const chest={id:g.nextId++,x:20,y:0,z:0,kind:'loot',radius:9,item};g.pickups.push(chest);return {g,chest,item};}
test('walking over overlapping chests opens all contents once without magnets moving them',()=>{
 const {g,chest,item}=chestGame();chest.x=60;g.pickups.push({...chest,id:g.nextId++,item:{...item,uid:g.nextId++}});g.upgrades.magnet=20;g.buffs.magnet={remaining:100};for(let i=0;i<180;i++)g.update(1/60);assert.equal(g.pickups.length,2);assert.equal(chest.x,60);assert.equal(g.inventory.length,0);
 g.player.x=60;g.update(1/60);assert.equal(g.pickups.length,0);assert.equal(g.inventory.length,2);assert.equal(g.inventory.filter(i=>i.uid===item.uid).length,1);assert.equal(g.openLootChest(chest.id),false);g.update(1/60);assert.equal(g.inventory.length,2);
});
test('automatic chest pickup respects floors and walls and applies autosell',()=>{
 const {g,chest,item}=chestGame();g.player.x=chest.x;g.elevationAt=()=>20;g.update(1/60);assert.equal(g.pickups.length,1);g.elevationAt=()=>0;g.clearSight=()=>false;g.update(1/60);assert.equal(g.pickups.length,1);g.clearSight=()=>true;g.autosell='common';const before=g.player.gold;g.update(1/60);assert.equal(g.pickups.length,0);assert.equal(g.inventory.some(i=>i.uid===item.uid),false);assert.ok(g.player.gold>before);
});
test('chest interaction respects distance, floors, walls and paused/dead states',()=>{
 const {g,chest}=chestGame();chest.x=200;assert.equal(g.openLootChest(chest.id),false);chest.x=20;g.elevationAt=()=>20;assert.equal(g.openLootChest(chest.id),false);g.elevationAt=()=>0;g.clearSight=()=>false;assert.equal(g.openLootChest(chest.id),false);g.clearSight=()=>true;g.pause();assert.equal(g.openLootChest(chest.id),false);g.pause();g.player.hp=0;assert.equal(g.openLootChest(chest.id),false);assert.equal(g.pickups.length,1);
});
test('legacy item drops restore as unopened chests, retaining contents and rarity',()=>{
 const {g,chest,item}=chestGame();item.rarity='rare';const restored=Game.restore({},g.snapshot());assert.equal(restored.openLootChest(chest.id),true);assert.equal(restored.inventory.find(i=>i.uid===item.uid).rarity,'rare');
});
test('chest hit testing uses its visible art footprint, projection, and topmost overlapping chest',()=>{
 const {g,chest}=chestGame();assert.equal(lootChestAtPoint(g,{x:20,y:-45}).id,chest.id);assert.equal(lootChestAtPoint(g,{x:70,y:-45}),null);g.pickups.push({...chest,id:99});assert.equal(lootChestAtPoint(g,{x:20,y:-45}).id,99);assert.equal(lootChestAtPoint(g,{x:20,y:-145},p=>({...p,y:p.y-100})).id,99);
});
test('Luck monotonically improves mob loot and upgrade rarity for matched rolls, including leaders',()=>{
 const rank={normal:0,magic:1,rare:2,artifact:3};
 for(let i=0;i<1000;i++)for(const leader of [false,true]){const roll=i/1000;let prior=-1;for(const luck of [0,100,1000,3000,10000]){const quality=rank[lootRarity(roll,{leader,luck})];assert.ok(quality>=prior);prior=quality;}}
 const counts=luck=>{const loot=[0,0,0,0],upgrades=Array(5).fill(0);for(let i=0;i<1000;i++){loot[rank[lootRarity(i/1000,{luck})]]++;upgrades[['common','uncommon','rare','epic','legendary'].indexOf(rollUpgradeRarity(()=>i/1000,luck).id)]++;}return {loot,upgrades}};
 const low=counts(0),high=counts(3000);assert.ok(high.loot[0]<low.loot[0]);assert.ok(high.loot[3]>low.loot[3]);assert.ok(high.upgrades[4]>low.upgrades[4]);
});
test('equipped Luck feeds real upgrade cards and combines with area/difficulty loot bonuses',()=>{
 const {g,item}=chestGame();g.inventory.push(item);g.equipment.ring=item.uid;g.random=()=>.5;const choice={id:'power',name:'Power',type:'passive'};const low=decorateUpgrade(g,choice);item.aosAttributes.Luck=3000;const high=decorateUpgrade(g,choice);assert.ok(high.steps>low.steps);assert.equal(lootRarity(.3,{luck:1000,magicFind:1}),lootRarity(.3,{magicFind:2}));
});
