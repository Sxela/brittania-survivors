import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAssetTracker} from '../game/asset-loading.mjs';

test('overlapping asset requests share progress and reset only after the batch settles',async()=>{
  const tracker=createAssetTracker();let finishFirst,finishSecond;
  const first=tracker.track('Artwork',()=>new Promise(resolve=>finishFirst=resolve));
  const second=tracker.track('Audio',()=>new Promise(resolve=>finishSecond=resolve));
  assert.deepEqual(tracker.snapshot(),{pending:2,completed:0,failed:0,total:2,label:'Artwork'});
  finishFirst('image');assert.equal(await first,'image');
  assert.deepEqual(tracker.snapshot(),{pending:1,completed:1,failed:0,total:2,label:'Audio'});
  finishSecond();await second;assert.equal(tracker.snapshot().pending,0);
  const next=tracker.track('New area',()=>42);
  assert.equal(tracker.snapshot().completed,0);
  assert.equal(await next,42);
});

test('failed and synchronously throwing loads settle progress and preserve the error',async()=>{
  const tracker=createAssetTracker(),states=[];
  const unsubscribe=tracker.subscribe(state=>states.push(state));
  await assert.rejects(tracker.track('Missing image',()=>{throw Error('not found');}),/not found/);
  assert.deepEqual(states.at(-1),{pending:0,completed:1,failed:1,total:1,label:''});
  unsubscribe();const count=states.length;
  await tracker.track('Cached image',Promise.resolve('ready'));
  assert.equal(states.length,count);
  assert.equal(tracker.snapshot().failed,0);
});
