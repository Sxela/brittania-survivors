import test from 'node:test';
import assert from 'node:assert/strict';
import {staticPlacement,Z_SCALE,isFloorSurface} from '../game/static-placement.mjs';
import {mapPoint,mapCell} from '../game/map-regions.mjs';

test('source log house roof rises above its wall instead of lying on the ground',()=>{
 const point={x:0,y:0};
 const wall=staticPlacement(point,{z:0,bounds:[55,171,-5,0]});
 const roof=staticPlacement(point,{z:20,bounds:[89,68,-11,-34]});
 assert.equal(Z_SCALE,4);
 assert.equal(wall.top,-128);assert.equal(roof.top,-139);
 assert.equal(wall.top-roof.top,11,'native roof edge meets the top of the log wall');
 assert.ok(roof.depth>wall.depth,'elevated art draws after its lower wall');
});

test('signed native roof offsets and source height remain independent',()=>{
 const roof={z:46,bounds:[71,54,-9,-42]},ground={x:66,y:1386};
 const raised=staticPlacement(ground,roof),lower=staticPlacement(ground,{...roof,z:26});
 assert.equal(raised.top,lower.top-80);
 assert.equal(raised.left,35);
 assert.equal(raised.top,1149);
 assert.ok(raised.top<ground.y-200);
});

test('native floor diamonds and cell centers use the same 44 pixel grid',()=>{
 const point=mapPoint(5,8),floor=staticPlacement(point,{z:0,bounds:[0,0,0,0]});
 assert.equal(point.y,286);assert.equal(floor.top,286);assert.equal(floor.height,44);
 const center=mapPoint(5.5,8.5);assert.equal(center.y,floor.depth);
 assert.deepEqual(mapCell(center.x,center.y),{a:5,b:8});
});

test('inclusive EC bounds preserve the final row and column of original art',()=>{
 const grass=staticPlacement({x:0,y:0},{z:0,bounds:[43,53,4,-34]});
 assert.equal(grass.width,44);assert.equal(grass.height,54);
});

test('Classic art keeps its native horizontal anchor and raises roofs by source z',()=>{
 const item={classicArt:true,z:20,bounds:[89,68,0,0]},point={x:100,y:200};
 const raised=staticPlacement(point,item),ground=staticPlacement(point,{...item,z:0});
 assert.equal(raised.width,90);assert.equal(raised.height,69);assert.equal(raised.left,55);
 assert.equal(raised.top,95);assert.equal(ground.top-raised.top,80);assert.equal(raised.flat,false);
});

test('Classic furniture and narrow items share their native cell center',()=>{
 const point={x:100,y:200};
 for(const width of [12,44,50,66,167]){
  const p=staticPlacement(point,{classicArt:true,z:0,bounds:[width-1,65,0,0]});
  assert.equal(p.left+Math.floor(p.width/2),point.x);
  assert.equal(p.top+p.height,point.y+44);
 }
});

test('native singular planks and paved floors support cutaway without treating furniture as a floor',()=>{
 for(const name of ['wooden plank','stone pavers Dark','flagstones','wooden logs','wooden bridge']){
  assert.equal(isFloorSurface({name,flags:0x200,bounds:[43,43,0,0]}),true);
 }
 assert.equal(isFloorSurface({name:'table',flags:0x200,bounds:[43,43,0,0]}),false);
 assert.equal(isFloorSurface({name:'wooden plank',flags:0x240,bounds:[43,43,0,0]}),false);
});
