import {trackAsset} from './asset-loading.mjs';

async function loadBitmap(src,signal) {
  return trackAsset('Area artwork',async()=>{
    const response=await fetch(src,{signal});
    if(!response.ok)throw Error('Area artwork unavailable (HTTP '+response.status+')');
    return createImageBitmap(await response.blob());
  });
}
const intersects=(chunk,camera,w,h,margin)=>chunk.left+chunk.width>=camera.x-margin
  &&chunk.left<=camera.x+w+margin&&chunk.top+chunk.height>=camera.y-margin&&chunk.top<=camera.y+h+margin;

export class MapAssetStore {
  constructor(manifest,{load=loadBitmap,maxBytes=160*1024*1024,margin=384,concurrency=6,onError=()=>{}}={}) {
    this.manifest=manifest;this.load=load;this.maxBytes=maxBytes;this.margin=margin;this.concurrency=concurrency;this.onError=onError;
    this.images={};this.groups=new Map();this.records=new Map();this.pending=new Map();this.failed=new Map();this.queue=[];
    this.bytes=0;this.peakBytes=0;this.requests=0;this.active=0;this.clock=0;this.disposed=false;this.controller=new AbortController();
    this.chunks=manifest.regions.flatMap(r=>[...(r.grounds||[]),...(r.backdropGrounds||[])]).map(chunk=>{
      const entry=manifest.images[chunk.image];if(!entry)throw Error('Missing ground image definition');
      return {...chunk,src:entry.src,width:chunk.width||entry.width,height:chunk.height||entry.height};
    });
    const groundKeys=new Set(this.chunks.map(c=>c.image));this.groundSources=new Set(this.chunks.map(c=>c.src));
    this.always=new Set();
    for(const [key,entry] of Object.entries(manifest.images)) {
      if(!this.groups.has(entry.src))this.groups.set(entry.src,[]);
      this.groups.get(entry.src).push([key,entry]);
      if(!groundKeys.has(key))this.always.add(entry.src);
    }
    this.visible=new Set();this.desired=new Set(this.always);this.pinned=new Set(this.always);
  }
  select(camera,w,h) {
    this.visible=new Set(this.chunks.filter(c=>intersects(c,camera,w,h,0)).map(c=>c.src));
    this.pinned=new Set([...this.always,...this.visible]);
    this.desired=new Set(this.pinned);
    const cost=src=>this.records.get(src)?.bytes||(()=>{const entry=this.groups.get(src)[0][1];return (entry.width||1024)*(entry.height||1024)*4;})();
    let spare=Math.max(0,this.maxBytes-[...this.pinned].reduce((sum,src)=>sum+cost(src),0));
    const nearby=this.chunks.filter(c=>!this.pinned.has(c.src)&&intersects(c,camera,w,h,this.margin))
      .sort((a,b)=>Math.hypot(a.left+a.width/2-camera.x-w/2,a.top+a.height/2-camera.y-h/2)-Math.hypot(b.left+b.width/2-camera.x-w/2,b.top+b.height/2-camera.y-h/2));
    for(const chunk of nearby){if(this.desired.has(chunk.src))continue;const bytes=cost(chunk.src);if(bytes<=spare){this.desired.add(chunk.src);spare-=bytes;}}
    for(const src of this.desired){const record=this.records.get(src);if(record)record.used=++this.clock;}
  }
  async preload(camera,w,h,onProgress=()=>{}) {
    this.select(camera,w,h);
    const required=[...this.pinned];let complete=0;onProgress(0,required.length);
    await Promise.all(required.map(src=>this.request(src,0).then(()=>onProgress(++complete,required.length))));
    this.evict();
  }
  update(camera,w,h) {
    if(this.disposed)return;
    this.select(camera,w,h);
    for(const job of [...this.queue])if(!this.desired.has(job.src)){
      this.queue.splice(this.queue.indexOf(job),1);this.pending.delete(job.src);job.resolve();
    }
    for(const src of this.desired){
      const priority=this.pinned.has(src)?0:1;
      const waiting=this.pending.get(src);if(waiting)waiting.priority=priority;
      if(!this.records.has(src)&&!waiting&&(!this.failed.has(src)||this.failed.get(src).retryAt<=Date.now()))this.request(src,priority).catch(()=>{});
    }
    this.evict();this.pump();
  }
  request(src,priority=0) {
    if(this.disposed)return Promise.resolve();
    if(this.records.has(src))return Promise.resolve(this.records.get(src).bitmap);
    if(this.pending.has(src))return this.pending.get(src).promise;
    let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const job={src,priority,promise,resolve,reject};this.pending.set(src,job);this.queue.push(job);this.pump();return promise;
  }
  pump() {
    this.queue.sort((a,b)=>a.priority-b.priority);
    while(!this.disposed&&this.active<this.concurrency&&this.queue.length){const job=this.queue.shift();this.active++;this.run(job);}
  }
  async run(job) {
    let bitmap;
    try{
      this.requests++;bitmap=await this.load(job.src,this.controller.signal);
      if(this.disposed||!this.desired.has(job.src)){bitmap.close?.();job.resolve();return;}
      // Validate all source rectangles before making any sprite visible.
      for(const [,entry] of this.groups.get(job.src))if(entry.atlas){
        const {x,y}=entry.atlas;
        if(![x,y,entry.width,entry.height].every(Number.isInteger)||x<0||y<0||entry.width<=0||entry.height<=0||x+entry.width>bitmap.width||y+entry.height>bitmap.height)throw Error('Invalid map atlas rectangle');
      }
      for(const [key,entry] of this.groups.get(job.src))this.images[key]=entry.atlas
        ?{bitmap,sx:entry.atlas.x,sy:entry.atlas.y,width:entry.width,height:entry.height}:bitmap;
      const bytes=bitmap.width*bitmap.height*4;
      this.records.set(job.src,{bitmap,bytes,used:++this.clock});this.bytes+=bytes;this.peakBytes=Math.max(this.peakBytes,this.bytes);
      this.failed.delete(job.src);this.evict();job.resolve(bitmap);
    }catch(error){
      bitmap?.close?.();this.failed.set(job.src,{error,retryAt:Date.now()+3000});
      if(!this.disposed)this.onError(error);
      job.reject(error);
    }finally{this.pending.delete(job.src);this.active--;this.pump();}
  }
  evict() {
    if(this.bytes<=this.maxBytes)return;
    const candidates=[...this.records].filter(([src])=>!this.pinned.has(src)).sort(([a,ra],[b,rb])=>Number(this.desired.has(a))-Number(this.desired.has(b))||ra.used-rb.used);
    for(const [src,record] of candidates){
      if(this.bytes<=this.maxBytes)break;
      record.bitmap.close?.();this.bytes-=record.bytes;this.records.delete(src);
      for(const [key] of this.groups.get(src))delete this.images[key];
    }
  }
  get loadingGround(){return [...this.visible].some(src=>!this.records.has(src));}
  get stats(){
    const ground=[...this.records].filter(([src])=>this.groundSources.has(src));
    return {assetBytes:this.bytes,assetPeakBytes:this.peakBytes,assetEntries:this.records.size,imageRequests:this.requests,pendingImages:this.pending.size,
      groundBytes:ground.reduce((n,[,record])=>n+record.bytes,0),groundEntries:ground.length,groundHits:0,groundMisses:0,groundReadbacks:0};
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;this.controller.abort();
    for(const job of this.queue){this.pending.delete(job.src);job.resolve();}this.queue=[];
    for(const record of this.records.values())record.bitmap.close?.();this.records.clear();
    for(const key of Object.keys(this.images))delete this.images[key];this.bytes=0;
  }
}
