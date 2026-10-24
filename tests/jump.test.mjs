import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game/core.mjs';
import {createLocationMap} from '../game/location-map.mjs';
import {mapPoint,mapCell} from '../game/map-regions.mjs';
function game(){const g=new Game();g.enemies=[];g.spawnClock=999;g.player.x=g.player.y=0;g.lastDirection={x:1,y:0};return g;}

test('teleport enters an enclosed native castle and its walking, spawns and gate use the interior',()=>{
 const width=14,height=12,main=[],physical=[];
 for(let a=0;a<width;a++)for(let b=0;b<height;b++){
  if(a<3)main.push(a*height+b);
  if(a<3||a>=4&&a<=11&&b>=2&&b<=9)physical.push(a*height+b);
 }
 const region={width,height,tiles:Array.from({length:width*height},()=>[1,0,[]]),walkZ:Array(width*height).fill(0),mainPassable:main,physicalPassable:physical,
  blocked:Array.from({length:width*height},(_,i)=>i).filter(i=>!main.includes(i)),statics:[],grounds:[],spawn:{...mapPoint(1.5,5.5),tileX:1,tileY:5}};
 const map=createLocationMap({regions:[region]},{}),g=game();g.player.radius=6;Object.assign(g.player,mapPoint(2.5,5.5));g.lastDirection={x:1,y:1};
 g.isPassable=map.isPlayable;g.canTraverse=map.canTraverse;g.elevationAt=map.elevationAt;
 const before={x:g.player.x,y:g.player.y};g.moveActor(g.player,22,22);assert.deepEqual({x:g.player.x,y:g.player.y},before,'walking cannot cross the castle wall');
 assert.equal(g.dash(),true);assert.ok(mapCell(g.player.x,g.player.y).a>=4);assert.equal(g.canStand(g.player.x,g.player.y,g.player.radius),true);
 g.moveActor(g.player,3,3);assert.equal(map.canTraverse({...g.player,x:g.player.x-3,y:g.player.y-3},g.player),true,'the landing is still a usable walking floor');
 let spawned=0;
 for(let n=0;n<20;n++){
  const point=map.randomSpawn(()=>n/20,g.player,6,false,{width:600,height:500});if(!point)continue;
  const cell=mapCell(point.x,point.y);assert.ok(cell.a>=4&&cell.a<=11&&cell.b>=2&&cell.b<=9);assert.equal(map.canTraverse(g.player,point),true);spawned++;
 }
 assert.ok(spawned>0,'waves must be able to spawn inside the castle after teleporting');
 assert.equal(map.canTraverse(g.player,map.gatePoint(g.player)),true,'the gate must be reachable from the interior');
 assert.equal(map.isPlayable(...Object.values(mapPoint(3.5,5.5))),false,'wall tiles remain unwalkable');
 assert.equal(map.isPlayable(...Object.values(mapPoint(12.5,5.5))),false,'void outside the castle remains unwalkable');
});
test('jump crosses a solid castle wall while ordinary walking remains blocked',()=>{
 const g=game();g.isPassable=x=>x<30||x>90;
 g.update(.2,{x:1,y:0});assert.ok(g.player.x<30);
 g.player.x=0;assert.equal(g.dash(),true);assert.ok(g.player.x>90);assert.ok(g.canStand(g.player.x,g.player.y,g.player.radius));
 const landed=g.player.x;g.update(.2);assert.equal(g.player.x,landed);assert.equal(g.dash(),false);
});
test('jump finds a shorter safe landing when its full endpoint is obstructed',()=>{
 const g=game();g.isPassable=x=>x<30||x>70&&x<130;
 assert.equal(g.dash(),true);assert.ok(g.player.x>70&&g.player.x<130);assert.ok(g.canStand(g.player.x,g.player.y,g.player.radius));
});
test('jump cannot land in water, void or walls and failed jumps spend no cooldown',()=>{
 const g=game();g.isPassable=x=>x<=14;assert.equal(g.dash(),false);assert.equal(g.player.x,0);assert.equal(g.player.dashCooldown,0);
});
test('diagonal jumps stay within range and land with full body clearance',()=>{
 const g=game();g.lastDirection={x:1,y:1};g.isPassable=(x,y)=>x<30||x>65;
 assert.equal(g.dash(),true);assert.ok(g.player.x>65);assert.ok(Math.hypot(g.player.x,g.player.y)<=147.60001);assert.equal(g.player.x,g.player.y);
});
test('saving a jump does not repeat its displacement after loading',()=>{
 const g=game();g.dash();const saved=g.snapshot(),restored=Game.restore({},saved);const x=restored.player.x;
 restored.update(.2);assert.equal(restored.player.x,x);assert.ok(restored.player.dashCooldown>0);
});
