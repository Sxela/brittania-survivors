import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchLoadingJson} from '../game/loading-screen.mjs';

test('area download progress counts streamed bytes and preserves split UTF-8 characters',async()=>{
  const bytes=new TextEncoder().encode('{"name":"Briétain"}');
  const chunks=[bytes.slice(0,13),bytes.slice(13)];
  const progress=[];
  const response=new Response(new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(chunk);controller.close();}}),{headers:{'content-length':String(bytes.length)}});
  const data=await fetchLoadingJson('/area.json',(...counts)=>progress.push(counts),async()=>response);
  assert.equal(data.name,'Briétain');
  assert.deepEqual(progress,[[chunks[0].length,bytes.length],[bytes.length,bytes.length]]);
});

test('compressed response lengths are not presented as decoded download totals',async()=>{
  const response=new Response('{"ready":true}',{headers:{'content-encoding':'gzip','content-length':'6'}});
  const progress=[];
  assert.deepEqual(await fetchLoadingJson('/area.json',(...counts)=>progress.push(counts),async()=>response),{ready:true});
  assert.deepEqual(progress,[[14,0]]);
});

test('failed area downloads report HTTP errors instead of parsing the error body',async()=>{
  await assert.rejects(fetchLoadingJson('/missing.json',()=>{},async()=>new Response('missing',{status:404})),/HTTP 404/);
});
