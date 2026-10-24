import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MapAssetStore} from '../game/map-asset-store.mjs';

function fixture(){
  return {images:{a:{src:'atlas.webp',width:4,height:8,atlas:{x:0,y:0}},b:{src:'atlas.webp',width:8,height:8,atlas:{x:8,y:0}},
    g0:{src:'g0.webp',width:64,height:64},g1:{src:'g1.webp',width:64,height:64},g2:{src:'g2.webp',width:64,height:64}},
    regions:[{grounds:[0,1,2].map(i=>({image:'g'+i,left:i*128,top:0,width:64,height:64}))}]};
}
const bitmap=src=>({width:src==='atlas.webp'?16:64,height:src==='atlas.webp'?8:64,closed:false,close(){this.closed=true;}});
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('atlas pages load once and initial terrain excludes distant chunks',async()=>{
  const calls=[],progress=[];
  const store=new MapAssetStore(fixture(),{margin:0,load:async src=>{calls.push(src);return bitmap(src);}});
  await store.preload({x:0,y:0},60,60,(done,total)=>progress.push([done,total]));
  assert.deepEqual(calls.sort(),['atlas.webp','g0.webp']);assert.equal(store.images.a.bitmap,store.images.b.bitmap);
  assert.equal(store.images.b.sx,8);assert.equal(store.images.b.width,8);assert.equal(store.images.g2,undefined);
  assert.equal(store.loadingGround,false);assert.deepEqual(progress.at(-1),[2,2]);store.dispose();
});

test('budgeted prefetch avoids eviction/reload loops and releases terrain behind the camera',async()=>{
  const calls=[],created=new Map();
  const store=new MapAssetStore(fixture(),{margin:400,maxBytes:512+2*64*64*4,load:async src=>{calls.push(src);const image=bitmap(src);created.set(src,image);return image;}});
  await store.preload({x:0,y:0},60,60);
  store.update({x:0,y:0},60,60);await settle();
  for(let i=0;i<10;i++){store.update({x:0,y:0},60,60);await settle();}
  assert.equal(calls.length,3);assert(store.bytes<=store.maxBytes);
  store.update({x:256,y:0},60,60);assert.equal(store.loadingGround,true);await settle();
  assert.equal(store.loadingGround,false);assert.equal(created.get('g0.webp').closed,true);assert.equal(store.images.g0,undefined);
  assert(store.bytes<=store.maxBytes);store.dispose();assert.equal(store.bytes,0);
});

test('decode concurrency is limited and in-flight bitmaps close after disposal',async()=>{
  let active=0,peak=0;const images=[];
  const store=new MapAssetStore(fixture(),{concurrency:1,load:async src=>{active++;peak=Math.max(peak,active);await settle();active--;const image=bitmap(src);images.push(image);return image;}});
  const preloading=store.preload({x:0,y:0},400,64);await settle();store.dispose();await preloading;await settle();
  assert.equal(peak,1);assert(images.every(image=>image.closed));assert.equal(store.records.size,0);
});

test('failed ground downloads remain retryable and do not mark missing terrain ready',async()=>{
  let failed=true;const store=new MapAssetStore(fixture(),{margin:0,load:async src=>{if(src==='g0.webp'&&failed)throw Error('offline');return bitmap(src);}});
  await assert.rejects(store.preload({x:0,y:0},60,60),/offline/);assert.equal(store.loadingGround,true);
  failed=false;store.failed.get('g0.webp').retryAt=0;store.update({x:0,y:0},60,60);await settle();
  assert.equal(store.loadingGround,false);store.dispose();
});

test('invalid atlas rectangles fail without retaining a decoded page',async()=>{
  const manifest=fixture();manifest.images.b.atlas.x=99;const images=[];
  const store=new MapAssetStore(manifest,{load:async src=>{const image=bitmap(src);images.push(image);return image;}});
  await assert.rejects(store.preload({x:0,y:0},60,60),/Invalid map atlas/);store.dispose();
  assert(images.every(image=>image.closed));
});
