import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game} from '../game/core.mjs';
import {comparisonItem} from '../game/equipment.mjs';
import {compareEquipment} from '../game/presentation.mjs';

const catalog=JSON.parse(readFileSync(new URL('../game/data/catalog.json',import.meta.url)));
const source=id=>{const value=catalog.items.find(item=>item.id===id);assert.ok(value,id);return value;};
const add=(game,id)=>{const item=game.makeItem(source(id));game.inventory.push(item);return item;};
const wear=(game,item)=>assert.equal(game.equip(game.inventory.indexOf(item)),true);

test('differently named items compare with the worn item in their shared equipment slot',()=>{
  for(const [wornId,nextId] of [['gold-necklace','plate-gorget'],['boots','sandals'],['robe','fancy-dress'],['body-sash','tunic'],['katana','bow']]){
    const game=new Game(catalog),worn=add(game,wornId),next=add(game,nextId);wear(game,worn);
    assert.equal(comparisonItem(game,next),worn,`${wornId} / ${nextId}`);
    wear(game,next);assert.equal(game.wornItems.includes(worn),false);
  }
});

test('pants and leg armour compare against the actual native-layer replacement in either direction',()=>{
  for(const [wornId,nextId] of [['short-pants','plate-legs'],['plate-legs','short-pants']]){
    const game=new Game(catalog),worn=add(game,wornId),next=add(game,nextId);wear(game,worn);
    assert.notEqual(worn.slot,next.slot);assert.equal(comparisonItem(game,next),worn);
    worn.aosAttributes={Luck:10};next.aosAttributes={Luck:25};
    assert.equal(compareEquipment(next,comparisonItem(game,next)).find(row=>row.key==='aos:Luck').delta,15);
    wear(game,next);assert.equal(game.wornItems.includes(worn),false);
  }
});

test('two-handed weapons prefer the current weapon for comparison and empty slots remain empty',()=>{
  const game=new Game(catalog),weapon=add(game,'katana'),shield=add(game,'buckler'),bow=add(game,'bow');
  wear(game,weapon);wear(game,shield);
  assert.equal(comparisonItem(game,bow),weapon);
  game.unequip(game.inventory.indexOf(weapon));assert.equal(comparisonItem(game,bow),shield);
  game.unequip(game.inventory.indexOf(shield));assert.equal(comparisonItem(game,bow),undefined);
});
