import {CACHE_LIMIT,validAssetVersion,cacheableAsset,cacheableResponse} from './asset-cache-policy.mjs';
const prefix='britannia-assets-v1-'+encodeURIComponent(new URL(self.registration.scope).pathname)+'-';
const metaName=prefix+'metadata',metaUrl=new URL('asset-cache-version.json',self.registration.scope).href;
let versionPromise=null,maintenance=null,generation=0,storesSinceTrim=0;
const writes=new Set();
async function version() {
  if(!versionPromise)versionPromise=(async()=>{
    // Page setup normally supplies this; metadata survives worker restarts.
    const response=await (await caches.open(metaName)).match(metaUrl);
    const value=response&&(await response.json()).version;
    return validAssetVersion(value)?value:null;
  })().catch(()=>null);
  return versionPromise;
}
async function trim(cache,count=CACHE_LIMIT) {
  if(maintenance)await maintenance;
  maintenance=(async()=>{const keys=await cache.keys();for(const key of keys.slice(0,Math.max(0,keys.length-count)))await cache.delete(key);})();
  try{await maintenance;}finally{maintenance=null;}
}
async function store(cache,request,response,started) {
  if(started!==generation)return;
  try{await cache.put(request,response.clone());}
  catch(error){
    if(error.name!=='QuotaExceededError')return;
    // Reclaim only this game's assets; storage denial must never block play.
    try{await trim(cache,Math.floor((await cache.keys()).length/2));if(started===generation)await cache.put(request,response.clone());}catch{}
  }
  if(++storesSinceTrim>=32){storesSinceTrim=0;try{await trim(cache);}catch{}}
}
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
  const message=event.data;
  event.waitUntil((async()=>{
    try{
      if(message?.type==='configure'&&validAssetVersion(message.version)){
        versionPromise=Promise.resolve(message.version);
        await (await caches.open(metaName)).put(metaUrl,new Response(JSON.stringify({version:message.version})));
        const current=prefix+message.version;
        for(const name of await caches.keys())if(name.startsWith(prefix)&&name!==current&&name!==metaName)await caches.delete(name);
      }else if(message?.type==='clear'){
        generation++;await Promise.allSettled([...writes]);
        for(const name of await caches.keys())if(name.startsWith(prefix)&&name!==metaName)await caches.delete(name);
      }else throw Error('Invalid asset cache message');
      event.ports[0]?.postMessage({ok:true});
    }catch{event.ports[0]?.postMessage({ok:false});}
  })());
});
self.addEventListener('fetch',event=>{
  if(!cacheableAsset(event.request,self.registration.scope))return;
  // Register waitUntil synchronously, while streaming the response to the game.
  let finish;const persisted=new Promise(resolve=>finish=resolve);event.waitUntil(persisted);
  event.respondWith((async()=>{
    let handedOff=false;
    try{
      const revision=await version();
      if(!revision)return await fetch(event.request);
      let cache;
      try{cache=await caches.open(prefix+revision);const hit=await cache.match(event.request);if(hit)return hit;}catch{}
      const response=await fetch(event.request);
      if(cache&&cacheableResponse(response)){
        // Start consuming the cache clone before the response can be consumed.
        const write=store(cache,event.request,response,generation).catch(()=>{});
        writes.add(write);handedOff=true;
        write.finally(()=>{writes.delete(write);finish();});
      }
      return response;
    }finally{if(!handedOff)finish();}
  })());
});
