// Shared by every runtime loader, including background downloads during play.
export function createAssetTracker() {
  const pending=new Map(),listeners=new Set();let completed=0,failed=0,next=0;
  const snapshot=()=>({pending:pending.size,completed,failed,total:completed+pending.size,label:pending.values().next().value||''});
  const emit=()=>{const state=snapshot();for(const listener of listeners)listener(state);};
  return {
    snapshot,
    subscribe(listener){listeners.add(listener);listener(snapshot());return ()=>listeners.delete(listener);},
    async track(label,work){
      if(!pending.size){completed=0;failed=0;}
      const id=++next;pending.set(id,label);emit();
      try{return await (typeof work==='function'?work():work);}
      catch(error){failed++;throw error;}
      finally{pending.delete(id);completed++;emit();}
    },
  };
}
export const assetTracker=createAssetTracker();
export const trackAsset=(label,work)=>assetTracker.track(label,work);
export const loadAssetJson=url=>trackAsset('Game data',async()=>{
  const response=await fetch(url);if(!response.ok)throw Error('Game data unavailable (HTTP '+response.status+')');
  return response.json();
});

export function showBackgroundLoading(document) {
  const root=document.getElementById('background-loading'),bar=document.getElementById('background-loading-progress');
  const text=document.getElementById('background-loading-label'),modal=document.getElementById('asset-loading');
  const render=state=>{
    root.hidden=!state.pending||!modal.hidden;
    bar.max=Math.max(1,state.total);bar.value=state.completed;
    text.textContent=`Loading ${state.label.toLowerCase()} · ${state.completed} / ${state.total}${state.failed?' · '+state.failed+' unavailable':''}`;
  };
  assetTracker.subscribe(render);
  // Also cover <img> elements inserted by inventories, shops and upgrade cards.
  const seen=new WeakMap();
  const watch=image=>{
    const previous=seen.get(image);if(previous?.src===image.src)return;
    previous?.cancel();
    if(image.complete||!image.src)return;
    trackAsset('Interface artwork',()=>new Promise((resolve,reject)=>{
      const cleanup=()=>{image.removeEventListener('load',loaded);image.removeEventListener('error',failed);seen.delete(image);};
      const loaded=()=>{cleanup();resolve();};
      const failed=()=>{cleanup();reject(Error('Interface artwork unavailable'));};
      seen.set(image,{src:image.src,cancel:loaded});
      image.addEventListener('load',loaded);image.addEventListener('error',failed);
      if(image.complete){if(image.naturalWidth)loaded();else failed();}
    })).catch(()=>{});
  };
  const scan=node=>{if(node.nodeType!==1)return;if(node.tagName==='IMG')watch(node);node.querySelectorAll('img').forEach(watch);};
  const cancel=node=>{if(node.nodeType!==1)return;if(node.tagName==='IMG')seen.get(node)?.cancel();node.querySelectorAll('img').forEach(image=>seen.get(image)?.cancel());};
  scan(document.documentElement);
  new MutationObserver(records=>{
    for(const record of records){
      if(record.target===modal)render(assetTracker.snapshot());
      if(record.type==='childList'){for(const node of record.removedNodes)if(!node.isConnected)cancel(node);for(const node of record.addedNodes)scan(node);}
      else if(record.attributeName==='src'&&record.target.tagName==='IMG')watch(record.target);
    }
  }).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','hidden']});
}
