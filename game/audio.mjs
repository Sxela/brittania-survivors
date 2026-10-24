export class OriginalAudio {
  constructor(manifest) {
    this.manifest=manifest;this.volume=.2;this.enabled=true;this.context=null;this.buffers=new Map();this.loading=new Map();this.lastPlayed=new Map();this.active=new Set();this.played=0;
  }
  async unlock() {
    if(!this.enabled)return;
    this.context ??= new AudioContext();
    if(!this.master){this.master=this.context.createGain();this.master.gain.value=.22*this.volume;this.master.connect(this.context.destination); }
    if(this.context.state==='suspended')await this.context.resume();
    this.updateAmbience();
  }
  setVolume(value) {
    if(!Number.isFinite(value))return this.volume;
    this.volume=Math.max(0,Math.min(1,value));
    if(this.master)this.master.gain.setTargetAtTime(.22*this.volume,this.context.currentTime,.025);
    return this.volume;
  }
  setEnabled(value) {
    this.enabled=value;
    if(!value) for(const voice of this.active) {try{voice.stop();}catch{}}
    this.updateAmbience();
  }
  setScene(scene,role=this.ambientRole||'ambience-forest') {
    this.scene=scene;this.ambientRole=role;this.updateAmbience();
  }
  async updateAmbience() {
    if(!this.context||!this.master)return;
    const role=this.ambientRole||'ambience-forest';
    const volume=!this.enabled||this.scene==='hidden'?0:this.scene==='playing'?.24:.065;
    if(this.ambientSource&&this.loadedAmbient===role){this.ambientGain.gain.setTargetAtTime(volume,this.context.currentTime,.6);return;}
    if(this.pendingAmbient===role)return;
    this.pendingAmbient=role;
    const buffer=await this.load(role);
    if(this.pendingAmbient!==role||!buffer)return;
    this.pendingAmbient=null;
    this.ambientSource?.stop();
    this.ambientSource?.disconnect();this.ambientGain?.disconnect();
    const voice=this.context.createBufferSource(),gain=this.context.createGain();
    voice.buffer=buffer;voice.loop=true;gain.gain.value=0;voice.connect(gain);gain.connect(this.master);
    this.ambientSource=voice;this.ambientGain=gain;this.loadedAmbient=role;
    voice.start();this.updateAmbience();
  }
  async load(role) {
    const entry=this.manifest.sounds[role];if(!entry)return null;
    const src=entry.src;
    if(this.buffers.has(src))return this.buffers.get(src);
    if(!this.loading.has(src))this.loading.set(src,(async()=>{
      const response=await fetch(src);if(!response.ok)throw Error('Original sound unavailable: '+role);
      const buffer=await this.context.decodeAudioData(await response.arrayBuffer());this.buffers.set(src,buffer);return buffer;
    })().catch(()=>null));
    return this.loading.get(src);
  }
  async play(role,source,listener) {
    if(!this.enabled||!this.context||this.context.state!=='running')return;
    const now=performance.now(),cooldown=role==='footstep'?500:role==='ui-click'?65:90;
    if(now-(this.lastPlayed.get(role)??-Infinity)<cooldown)return;
    this.lastPlayed.set(role,now);
    const buffer=await this.load(role);
    if(!buffer||!this.enabled||performance.now()-now>500||this.active.size>=18)return;
    const voice=this.context.createBufferSource();voice.buffer=buffer;
    const gain=this.context.createGain();
    const distance=source&&listener?Math.hypot(source.x-listener.x,source.y-listener.y):0;
    gain.gain.value=Math.max(.08,1-distance/950);voice.connect(gain);
    let pan;
    if(source&&listener&&this.context.createStereoPanner){pan=this.context.createStereoPanner();pan.pan.value=Math.max(-.8,Math.min(.8,(source.x-listener.x)/650));gain.connect(pan);pan.connect(this.master);}else gain.connect(this.master);
    this.active.add(voice);voice.onended=()=>{this.active.delete(voice);voice.disconnect();gain.disconnect();pan?.disconnect();};
    voice.start();this.played++;
  }
  get stats(){return {enabled:this.enabled,volume:this.volume,decoded:this.buffers.size,played:this.played,voices:this.active.size,state:this.context?.state??'locked'};}
}
