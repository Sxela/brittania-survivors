import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Game} from '../game/core.mjs';
import {attributesOf,propertyRows,itemScore,activeProperty} from '../game/equipment.mjs';
import {strictlyDominates} from '../game/general-mechanics.mjs';

test('inactive mana properties stay in source items without misleading gear comparisons',()=>{
  const plain={slot:'ring',power:0,defense:0,stats:{},aosAttributes:{}},old={...plain,aosAttributes:{BonusMana:20,RegenMana:5,LowerManaCost:8},weaponAttributes:{HitLeechMana:50}};
  assert.deepEqual(attributesOf(old),{});assert.deepEqual(propertyRows(old),[]);
  assert.equal(itemScore(old),itemScore(plain));assert.equal(strictlyDominates(old,plain),false);
  assert.equal(old.aosAttributes.BonusMana,20);
});
test('new AOS loot rolls useful properties instead of removed player mana bonuses',()=>{
  const catalog=JSON.parse(fs.readFileSync(new URL('../game/data/catalog.json',import.meta.url))),game=new Game(catalog,{seed:84});
  for(const slot of ['weapon','armor','ring']){
    const source=catalog.items.find(item=>item.slot===slot&&!item.artifact&&!item.fixedProperties?.length);
    for(let i=0;i<25;i++){
      const item=game.makeItem(source,slot,3);
      assert.ok(item.rolledProperties.length);
      assert.ok(item.rolledProperties.every(rule=>activeProperty(rule.key)));
    }
  }
});

test('stamina and durability have no tooltip, score or autosell comparison value',()=>{const plain={slot:'armor',power:0,defense:4,stats:{}};const old={...plain,stats:{InitMinHits:100,InitMaxHits:150},aosAttributes:{BonusStam:20,RegenStam:5},weaponAttributes:{HitLeechStam:50},armorAttributes:{SelfRepair:5,DurabilityBonus:100}};assert.deepEqual(attributesOf(old),{});assert.deepEqual(propertyRows(old),propertyRows(plain));assert.equal(itemScore(old),itemScore(plain));assert.equal(strictlyDominates(old,plain),false);assert.equal(strictlyDominates({...plain,defense:5},old),true);});
