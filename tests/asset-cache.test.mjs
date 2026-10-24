import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cacheableAsset,cacheableResponse,validAssetVersion} from '../game/asset-cache-policy.mjs';
test('persistent cache includes only complete same-origin assets in the game scope',()=>{
  const scope='https://game.example/play/';
  assert(cacheableAsset(new Request(scope+'assets/maps/a.json'),scope));
  for(const url of ['https://elsewhere.example/play/assets/a.png',scope+'data/catalog.json',scope+'app.mjs',scope+'asset-cache-version.json','https://game.example/assets/other.png'])assert(!cacheableAsset(new Request(url),scope));
  assert(!cacheableAsset(new Request(scope+'assets/a.wav',{headers:{range:'bytes=0-10'}}),scope));
  assert(!cacheableAsset(new Request(scope+'assets/a.json',{method:'POST'}),scope));
});
test('HTTP errors, partial responses and HTML fallbacks never become cached assets',()=>{
  assert(cacheableResponse(new Response('{}',{headers:{'content-type':'application/json'}})));
  for(const status of [206,404,500])assert(!cacheableResponse(new Response('error',{status})));
  assert(!cacheableResponse(new Response('<html>fallback</html>',{headers:{'content-type':'text/html'}})));
});
test('asset bank revisions must be complete sha256 identities',()=>{
  assert(validAssetVersion('a'.repeat(64)));
  for(const value of [null,1,'main','../private','a'.repeat(63)])assert(!validAssetVersion(value));
});
