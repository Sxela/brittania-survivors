import {validAssetVersion} from './asset-cache-policy.mjs';
export const assetCacheState={enabled:false,reason:'Browser cache unavailable'};
async function message(worker,data) {
  return new Promise((resolve,reject)=>{
    const channel=new MessageChannel();
    const timeout=setTimeout(()=>{channel.port1.close();reject(Error('Asset cache did not respond'));},5000);
    channel.port1.onmessage=event=>{clearTimeout(timeout);channel.port1.close();event.data.ok?resolve():reject(Error('Asset cache unavailable'));};
    worker.postMessage(data,[channel.port2]);
  });
}
export async function setupAssetCache() {
  try{
    if(!isSecureContext||!('serviceWorker' in navigator)||!('caches' in globalThis))return false;
    const response=await fetch(new URL('./asset-cache-version.json',import.meta.url),{cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(!response.ok)return false;
    const {version}=await response.json();if(!validAssetVersion(version))return false;
    const registration=await navigator.serviceWorker.register(new URL('./asset-cache-worker.js',import.meta.url),{type:'module',updateViaCache:'none'});
    // Registering a new worker and claiming a page are distinct async steps.
    await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Asset cache startup timed out')),5000))]);
    if(!navigator.serviceWorker.controller)await new Promise((resolve,reject)=>{
      const ready=()=>{clearTimeout(timeout);navigator.serviceWorker.removeEventListener('controllerchange',ready);resolve();};
      const timeout=setTimeout(()=>{navigator.serviceWorker.removeEventListener('controllerchange',ready);reject(Error('Asset cache control timed out'));},5000);
      navigator.serviceWorker.addEventListener('controllerchange',ready);
      if(navigator.serviceWorker.controller)ready();
    });
    await message(navigator.serviceWorker.controller,{type:'configure',version});
    assetCacheState.enabled=true;assetCacheState.reason='Downloaded assets stay on this device';
    return true;
  }catch(error){assetCacheState.reason='Browser storage unavailable; using downloads';console.info(assetCacheState.reason);return false;}
}
export async function clearAssetCache() {
  if(!navigator.serviceWorker?.controller)throw Error('Browser asset cache is unavailable');
  await message(navigator.serviceWorker.controller,{type:'clear'});
}
