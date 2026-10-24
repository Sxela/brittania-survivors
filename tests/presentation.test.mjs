import test from "node:test";
import assert from "node:assert/strict";
import { actorFacing, compareEquipment } from "../game/presentation.mjs";
import { Game } from "../game/core.mjs";
import { readFileSync } from "node:fs";

test("all eight screen-space headings select the native EC facing row and mirror", () => {
  for(const [dx,dy,row,mirror] of [
    [0,1,0,false],[-1,1,1,false],[-1,0,2,false],[-1,-1,3,false],
    [0,-1,4,false],[1,-1,3,true],[1,0,2,true],[1,1,1,true],
  ]) assert.deepEqual(actorFacing(dx,dy),{row,mirror},`heading ${dx},${dy}`);
  assert.deepEqual(actorFacing(0,0),{row:0,mirror:false});
});

test("equipment comparisons report actual slot stats, including empty and equal slots", () => {
  assert.deepEqual(compareEquipment({slot:"weapon",power:9},{power:4})[0],{key:"power",label:"Power",value:9,equipped:4,delta:5});
  assert.equal(compareEquipment({slot:"armor",defense:3},{defense:8})[0].delta,-5);
  assert.equal(compareEquipment({slot:"armor",defense:3},null)[0].delta,3);
  assert.equal(compareEquipment({slot:"weapon",power:4},{power:4})[0].delta,0);
});

test("returning worn gear to the backpack removes its bonus and preserves items and saves", () => {
  const catalog=JSON.parse(readFileSync(new URL('../game/data/catalog.json',import.meta.url)));
  const g=new Game(catalog,{seed:37});
  const item=g.inventory[0],damage=g.damage;
  assert.equal(g.unequip(0),true);assert.equal(g.equipment.weapon,null);
  assert.equal(g.damage,damage-item.power);assert.equal(g.inventory[0].uid,item.uid);
  assert.equal(g.unequip(0),false);assert.equal(g.unequip(999),false);
  assert.equal(g.equip(0),true);assert.equal(g.damage,damage);
  g.unequip(0);const restored=Game.restore(catalog,g.snapshot());
  assert.equal(restored.equipment.weapon,null);assert.equal(restored.inventory[0].uid,item.uid);
});
