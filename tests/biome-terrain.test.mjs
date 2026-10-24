import test from 'node:test';
import assert from 'node:assert/strict';
import {BiomeTerrain,patchCell,MAX_BIOME_PATCHES} from '../game/biome-terrain.mjs';
const bounds=(a,b)=>({left:(a-b)*88-88,right:(a-b)*88+88,top:(a+b)*88,bottom:(a+b)*88+176});
const view={left:-400,right:400,top:-300,bottom:300};
const visible=(patch,v=view)=>{const b=bounds(patch.a,patch.b);return b.left<v.right&&b.right>v.left&&b.top<v.bottom&&b.bottom>v.top;};
const weights=field=>new Map([...field.patches].map(([k,p])=>[k,[...p.weights]]));

test('Allods retention freezes partly visible patches across every timed stage',()=>{
 const field=new BiomeTerrain(6,bounds);field.update(view,0);const initial=weights(field);
 for(let stage=1;stage<6;stage++){
  field.update(view,stage);
  for(const [key,p] of field.patches)if(visible(p))assert.deepEqual(p.weights,initial.get(key));
  assert.ok([...field.patches.values()].some(p=>p.weights[stage]===1));
 }
});

test('near offscreen patches blend textures; approaching changed ground never reverses it',()=>{
 const field=new BiomeTerrain(6,bounds);field.update(view,0);field.update(view,1);
 assert.ok([...field.patches.values()].some(p=>!visible(p)&&p.weights[0]>0&&p.weights[1]>0));
 for(let x=16;x<=700;x+=16){
  const old=weights(field),next={...view,left:view.left+x,right:view.right+x};field.update(next,1);
  for(const [key,p] of field.patches)if(old.has(key)){
   assert.ok(p.weights[1]+1e-8>=old.get(key)[1]);
   if(visible(p,next))assert.deepEqual(p.weights,old.get(key));
  }
 }
});

test('offscreen actors and drops retain their occupied ground and roof overhangs count as visible',()=>{
 const field=new BiomeTerrain(6,bounds);field.update(view,0);
 const patch=[...field.patches.values()].find(p=>bounds(p.a,p.b).left>view.right+400&&bounds(p.a,p.b).top>view.top&&bounds(p.a,p.b).bottom<view.bottom);
 assert.ok(patch);const box=bounds(patch.a,patch.b),actor={x:(box.left+box.right)/2,y:(box.top+box.bottom)/2,radius:32};
 const cell=patchCell(actor.x,actor.y);field.update(view,1,[actor]);assert.equal(field.patches.get(`${cell.a},${cell.b}`).index,0);
 field.update(view,1,[]);assert.equal(field.patches.get(`${cell.a},${cell.b}`).index,1);
 const roofBounds=(a,b)=>a===8&&b===0?{left:350,right:800,top:0,bottom:200}:bounds(a,b);
 const roof=new BiomeTerrain(6,roofBounds);roof.update(view,0);roof.update(view,1);assert.equal(roof.patches.get('8,0').index,0);
});

test('mixed terrain saves restore exactly, reject malformed weights and stay bounded during travel',()=>{
 const field=new BiomeTerrain(6,bounds);field.update(view,0);field.update(view,1);const saved=field.snapshot(),restored=new BiomeTerrain(6,bounds);restored.restore(saved);assert.deepEqual(restored.snapshot(),saved);
 restored.restore([[1,2,NaN,0,0,0,0,1],[1,2,1,1,0,0,0,0],[1.5,2,1,0,0,0,0,0]]);assert.equal(restored.patches.size,0);
 for(let i=0;i<40;i++)field.update({...view,left:i*3000,right:i*3000+800},5);
 assert.ok(field.patches.size<=MAX_BIOME_PATCHES);field.reset();assert.equal(field.patches.size,0);field.update(view,0);assert.ok([...field.patches.values()].every(p=>p.index===0));
});
