import test from 'node:test';
import assert from 'node:assert/strict';
import {routeMapManifest,locationManifestForArea} from '../game/route-maps.mjs';
import {createMapRegions} from '../game/map-regions.mjs';
import {isFloorSurface} from '../game/static-placement.mjs';

const region=id=>({id,areaId:id,name:id,ground:id+'-ground',radar:id+'-radar',statics:[{image:'shared-prop',x:1,y:1,z:0,flags:0}],tiles:Array.from({length:4096},()=>[3,0,[]]),blocked:[]});
const source={regions:['a','b','c'].map(region),images:Object.fromEntries(['a-ground','a-radar','b-ground','b-radar','c-ground','c-radar','shared-prop'].map(key=>[key,{src:key+'.png'}]))};

test('route maps keep selected native areas in difficulty order and load only their artwork',()=>{
  const manifest=routeMapManifest(source,[{id:'b',name:'Second',facet:'Felucca'},{id:'c',name:'Third',facet:'Malas'}],600);
  assert.deepEqual(manifest.regions.map(r=>r.areaId),['b','c']);
  assert.deepEqual(manifest.regions.map(r=>r.id),[0,1]);
  assert.equal(manifest.stageSeconds,300);
  assert.deepEqual(Object.keys(manifest.images).sort(),['b-ground','b-radar','c-ground','c-radar','shared-prop']);
  assert.equal(source.regions[1].id,'b');
  const map=createMapRegions(manifest,{});
  assert.equal(map.stageAt(299.99),0);assert.equal(map.stageAt(300),1);
  assert.equal(map.areaAt(100000,100000,400),'c');
  assert.throws(()=>routeMapManifest(source,[{id:'missing',name:'Missing'}]),/unavailable/);
});

test('native upper storeys can be cut away without removing floors or tall props from source data',()=>{
  assert.equal(isFloorSurface({flags:0x6201,name:'grey slate tile',bounds:[43,43,0,0]}),true);
  assert.equal(isFloorSurface({flags:0x200,name:'wooden floor',bounds:[43,43,0,0]}),true);
  assert.equal(isFloorSurface({flags:0x240,name:'grey slate tile',bounds:[43,43,0,0]}),false);
  assert.equal(isFloorSurface({flags:0x200,name:'bookcase',bounds:[43,70,0,0]}),false);
});

test('finite location loading includes surrounding native scenery without changing arena bounds',()=>{
 const arena={areaId:'a',width:8,height:6,radar:'radar',grounds:[{image:'ground'}],statics:[{image:'tree'}],
  backdropGrounds:[{image:'outside-ground'}],backdropStatics:[{image:'outside-tree',x:-3,y:0}]};
 const images=Object.fromEntries(['radar','ground','tree','outside-ground','outside-tree','gate','other-area'].map(k=>[k,{src:k+'.png'}]));
 const selected=locationManifestForArea({regions:[arena],images,moongate:{frames:['gate']}},{id:'a',facet:'Trammel'});
 assert.equal(selected.regions[0].width,8);assert.equal(selected.regions[0].height,6);
 assert.deepEqual(Object.keys(selected.images).sort(),['gate','ground','outside-ground','outside-tree','radar','tree']);
 assert.equal(selected.regions[0].backdropStatics[0].x,-3);
});
