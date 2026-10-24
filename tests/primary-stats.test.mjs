import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Game} from '../game/core.mjs';
import {activeProperty,attributesOf,propertyRows,itemScore,hasGameplayStats} from '../game/equipment.mjs';
import {strictlyDominates} from '../game/general-mechanics.mjs';

test('primary stats and requirements have no tooltip, loot or autosell value',()=>{
  const plain={slot:'ring',power:0,defense:0,stats:{},aosAttributes:{}};
  const retired={...plain,aosAttributes:{BonusStr:30,BonusDex:30,BonusInt:30},armorAttributes:{LowerStatReq:100},stats:{StrengthReq:150,AosStrReq:140,DexterityReq:130,IntelligenceReq:120,BaseStrBonus:5,AosDexBonus:5}};
  assert.deepEqual(attributesOf(retired),{});assert.deepEqual(propertyRows(retired),[]);
  assert.equal(itemScore(retired),itemScore(plain));assert.equal(hasGameplayStats(retired),false);
  assert.equal(strictlyDominates(retired,plain),false);assert.equal(strictlyDominates(plain,retired),false);
  assert.equal(strictlyDominates({...plain,aosAttributes:{BonusHits:5}},retired),true);
  assert.equal(retired.stats.StrengthReq,150);
});

test('stat bonuses do not change damage, weapon cadence or health and requirements never block equipment',()=>{
  for(const attackKind of ['magic','arrow','melee']){
    const game=new Game();game.attackKind=attackKind;
    const weapon={uid:game.nextId++,slot:'weapon',aosMode:true,power:15,stats:{AosSpeed:35,StrengthReq:200,DexterityReq:200,IntelligenceReq:200},aosAttributes:{},resistances:{}};
    game.inventory.push(weapon);assert.equal(game.canAutoequip(weapon),true);assert.equal(game.equip(0),true);
    const expected={damage:game.damage,interval:game.attackInterval,hp:game.player.maxHp};
    weapon.aosAttributes={BonusStr:100,BonusDex:100,BonusInt:100};weapon.weaponAttributes={LowerStatReq:50};game.refreshEquipmentStats();
    assert.equal(game.damage,expected.damage);assert.equal(game.attackInterval,expected.interval);assert.equal(game.player.maxHp,expected.hp);
    assert.equal(game.unequip(0),true);assert.equal(game.equip(0),true);
  }
});

test('legacy STR health is removed once while retaining vitality and actual HP bonuses',()=>{
  const game=new Game(),item={uid:game.nextId++,slot:'ring',name:'Legacy ring',power:0,defense:0,price:1,tier:0,stats:{},aosAttributes:{BonusStr:20,BonusHits:12}};
  game.inventory.push(item);game.equip(0);game.player.maxHp+=75;game.player.hp=game.player.maxHp;
  const save=game.snapshot();save.gearHpBonus=22;save.player.maxHp+=10;save.player.hp+=10;
  const restored=Game.restore({},save);
  assert.equal(restored.player.maxHp,game.player.maxHp);assert.equal(restored.player.hp,game.player.maxHp);assert.equal(restored.gearHpBonus,12);
  assert.deepEqual(Game.restore({},restored.snapshot()).snapshot(),restored.snapshot());
  restored.unequip(0);assert.equal(restored.player.maxHp,game.player.maxHp-12);
  save.player.hp=40;assert.equal(Game.restore({},save).player.hp,40);
});

test('AOS affix rolls never add primary stats or lower requirements',()=>{
  const catalog=JSON.parse(fs.readFileSync(new URL('../game/data/catalog.json',import.meta.url))),game=new Game(catalog,{seed:613});
  for(const slot of ['weapon','armor','ring','neck','shirt']){
    const source=catalog.items.find(item=>item.slot===slot&&!item.artifact&&!item.fixedProperties?.length);
    for(let i=0;i<40;i++){
      const item=game.makeItem(source,slot,3);
      assert.ok(item.rolledProperties.every(rule=>activeProperty(rule.key)));
      assert.ok(propertyRows(item).every(row=>!['aos:BonusStr','aos:BonusDex','aos:BonusInt','aos:LowerStatReq'].includes(row.key)));
    }
  }
});
