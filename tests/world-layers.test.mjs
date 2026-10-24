import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,GAME_DEFAULTS} from '../game/core.mjs';
// These mechanics tests interact with creatures on the tick they spawn.
GAME_DEFAULTS.enemyArrival=0;
import {entityElevation,actorDepth,staticDepth,obstructsCharacter} from '../game/world-layers.mjs';

test('Haven static water stays beneath its dock, piers and shoreline walls',()=>{
 const point=mapPoint(114,146);
 const water={flags:524481,height:0,z:-5,bounds:[43,43,0,0]};
 const plank={flags:25089,height:1,z:-3},pier={flags:16448,height:5,z:-1},wall={flags:24656,height:20,z:-5};
 assert.ok(staticDepth(point,water)<staticDepth(point,plank,true));
 assert.ok(staticDepth(point,water)<staticDepth(point,pier));
 assert.ok(staticDepth(point,water)<staticDepth(point,wall));
 assert.equal(staticDepth(point,{...water,height:30}),point.y+22-.05,'tall waterfalls retain vertical scenery depth');
});
import {mapPoint} from '../game/map-regions.mjs';

test('raised floor diamonds sort behind their own occupants across the cell, including loot and corpses',()=>{
 for(const z of [-27,0,20,60]){
  const point=mapPoint(5,5),floor=staticDepth(point,{z},true),map={elevationAt:()=>z};
  for(const fraction of [.01,.25,.5,.75,.99]){
   const occupant=mapPoint(5+fraction,5+fraction);
   assert.ok(floor<actorDepth(occupant,map));
   assert.ok(floor<actorDepth({...occupant,z},map));
  }
 }
});
test('dead enemies give every drop and corpse the death floor, even if a drop offset crosses a stair',()=>{
 const game=new Game({monsters:[{id:'test-rat',name:'Rat',body:238,adaptation:{hp:50,xp:3,damage:2}}],weapons:[{id:'sword',name:'Sword',damage:10}]},{seed:4});
 game.enemies=[];game.pickups=[];game.elevationAt=(x,y)=>y>=100?40:0;
 const enemy=game.spawnEnemy('test-rat');Object.assign(enemy,{x:100,y:100,boss:true});
 game.hurtEnemy(enemy,1e6);
 assert.ok(game.pickups.some(p=>p.kind==='loot'&&p.y<100));
 for(const drop of game.pickups)assert.equal(drop.z,40);
 assert.equal(game.corpses[0].z,40);
 const loot=game.pickups.find(p=>p.kind==='loot');assert.equal(entityElevation(loot,{elevationAt:()=>0}),40);
 assert.equal(Game.restore(game.catalog,game.snapshot()).pickups.find(p=>p.kind==='loot').z,40);
});
test('pickup magnets do not pull or collect items through another floor',()=>{
 const game=new Game();game.enemies=[];game.spawnClock=999;game.attackClock=999;game.elevationAt=()=>0;
 const drop={id:game.nextId++,kind:'gold',value:20,x:game.player.x+4,y:game.player.y,radius:5,z:40};game.pickups=[drop];
 game.update(.02);assert.equal(game.pickups.includes(drop),true);assert.equal(drop.attracted,undefined);
 game.elevationAt=()=>40;game.update(.02);assert.equal(game.pickups.length,0);
});
test('circle transparency selects obstructing upper walls, preserves current floor and foliage, and stays local',()=>{
 const hero={x:100,y:200},bounds={left:50,top:0,width:100,height:250,depth:220};
 assert.equal(obstructsCharacter({z:0,height:80,name:'wall'},bounds,hero,20),true);
 assert.equal(obstructsCharacter({z:20,height:0,name:'floor'},bounds,hero,20),false);
 assert.equal(obstructsCharacter({z:0,height:80,name:'tree'},bounds,hero,20),false);
 assert.equal(obstructsCharacter({z:0,height:80,name:'wall'},{...bounds,left:500},hero,20),false);
});


test('only scenery drawn after and overlapping the character can activate the transparency circle',()=>{
 const hero={x:100,y:200},item={z:0,height:80,name:'wall'},bounds={left:50,top:0,width:100,height:250};
 assert.equal(obstructsCharacter(item,bounds,hero,20,220),true);
 assert.equal(obstructsCharacter(item,bounds,hero,20,180),false,'wall behind the character stays opaque');
 assert.equal(obstructsCharacter(item,bounds,hero,20,200.2),false,'equal-depth static is drawn before player');
 assert.equal(obstructsCharacter(item,{...bounds,left:140},hero,20,220),false,'nearby scenery inside the circle but beside the character stays opaque');
 assert.equal(obstructsCharacter(item,{...bounds,top:130,height:40},hero,20,220),false,'scenery below the raised character does not hide');
});
