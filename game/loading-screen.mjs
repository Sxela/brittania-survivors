// Progress reflects completed downloads/decodes, never a simulated timer.
export function createLoadingScreen(document) {
  const root=document.getElementById('asset-loading');
  const label=document.getElementById('asset-loading-label');
  const detail=document.getElementById('asset-loading-detail');
  const bar=document.getElementById('asset-loading-progress');
  let completed=0,total=0;
  return {
    begin(text,count=0) {
      completed=0;total=count;root.hidden=false;root.setAttribute('aria-busy','true');
      label.textContent=text;detail.textContent=count?`0 / ${count} files`:'Please wait…';
      if(count){bar.max=count;bar.value=0;}else bar.removeAttribute('value');
    },
    advance() {
      completed=Math.min(total,completed+1);bar.value=completed;
      detail.textContent=`${completed} / ${total} files`;
    },
    bytes(loaded,size) {
      const mb=bytes=>(bytes/1024/1024).toFixed(1)+' MB';
      detail.textContent=size?`${mb(loaded)} / ${mb(size)}`:`${mb(loaded)} downloaded`;
      if(size){bar.max=size;bar.value=loaded;}else bar.removeAttribute('value');
    },
    hide() {root.hidden=true;root.setAttribute('aria-busy','false');},
  };
}

export async function fetchLoadingJson(url,onBytes,fetcher=fetch) {
  const response=await fetcher(url);
  if(!response.ok)throw Error(`Area data could not be loaded (HTTP ${response.status})`);
  if(!response.body?.getReader)return response.json();
  // Content-Length describes compressed wire bytes when Content-Encoding is
  // present; ReadableStream supplies decoded bytes, so don't mix those totals.
  const size=response.headers.get('content-encoding')?0:Number(response.headers.get('content-length'))||0;
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let text='',loaded=0;
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;
      loaded+=value.byteLength;text+=decoder.decode(value,{stream:true});onBytes(loaded,size);
    }
    text+=decoder.decode();return JSON.parse(text);
  } finally {reader.releaseLock();}
}

// Let a newly shown loading screen paint before CPU-heavy terrain preparation.
export const paintLoadingScreen=()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
