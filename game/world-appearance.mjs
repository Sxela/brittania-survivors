import {actorAnchorY} from './actor-placement.mjs';
import {trackAsset} from './asset-loading.mjs';
import {actorFacing} from './presentation.mjs';
import {isPickaxe,MINING_STRIKE_SECONDS} from './mining.mjs';
import {orderedEquipment} from './equipment.mjs';
import {applyHue,applySpectral,hueIdentity} from './hues.mjs';
import {isEquipmentBody,enemySex,orderedEnemyEquipment} from './enemy-equipment.mjs';
export class WorldAppearance {
  constructor(ctx,manifest,palettes){this.ctx=ctx;this.manifest=manifest;this.palettes=palettes;this.maxBytes=128*1024*1024;this.images=new Map();this.pending=new Map();this.bytes=0;this.tints=new Map();this.tintBytes=0;this.layersDrawn=new Set();this.corpsesDrawn=0;}
  async load(src){
    if(this.images.has(src)){const e=this.images.get(src);this.images.delete(src);this.images.set(src,e);return e.image;}
    if(!this.pending.has(src)){const im=new Image();im.src=src;this.pending.set(src,trackAsset('Equipment artwork',()=>im.decode()).then(()=>{const bytes=im.width*im.height*4;this.images.set(src,{image:im,bytes});this.bytes+=bytes;while(this.bytes>this.maxBytes&&this.images.size>1){const key=this.images.keys().next().value;this.bytes-=this.images.get(key).bytes;this.images.delete(key);this.pending.delete(key);}return im;}).catch(()=>null));}
    return this.pending.get(src);
  }
  image(src){const e=this.images.get(src);if(!e){this.load(src);return null;}this.images.delete(src);this.images.set(src,e);return e.image;}
  tinted(def,im,frame,row,hue){
    const identity=hueIdentity(hue),palette=this.palettes[String(identity.id)];if(!palette&&!identity.spectral)return null;
    const key=[def.src,frame,row,hue].join(':');if(this.tints.has(key)){const c=this.tints.get(key);this.tints.delete(key);this.tints.set(key,c);return c;}
    const c=document.createElement('canvas');c.width=def.cellWidth;c.height=def.cellHeight;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(im,frame*c.width,row*c.height,c.width,c.height,0,0,c.width,c.height);const p=g.getImageData(0,0,c.width,c.height);if(identity.spectral)applySpectral(p.data);else applyHue(p.data,palette,identity.partial);g.putImageData(p,0,0);
    const bytes=c.width*c.height*4;while(this.tintBytes+bytes>32*1024*1024&&this.tints.size){const k=this.tints.keys().next().value,v=this.tints.get(k);this.tintBytes-=v.width*v.height*4;this.tints.delete(k);}this.tints.set(key,c);this.tintBytes+=bytes;return c;
  }
  sprite(def,x,y,facing,phase=0,hue=0,scale=1,alpha=1){
    if(!def)return false;const im=this.image(def.src);if(!im)return false;
    hue=hue||def.defaultHue||0;
    const frame=Math.min(def.framesPerDirection-1,Math.floor(phase/(def.frameStride||1))%def.framesPerDirection),g=this.ctx;
    const tint=hue?this.tinted(def,im,frame,facing.row,hue):null;
    g.save();g.globalAlpha=alpha;g.translate(x,y);if(facing.mirror)g.scale(-1,1);
    if(tint)g.drawImage(tint,-def.anchorX*scale,-actorAnchorY(def)*scale,def.cellWidth*scale,def.cellHeight*scale);
    else g.drawImage(im,frame*def.cellWidth,facing.row*def.cellHeight,def.cellWidth,def.cellHeight,-def.anchorX*scale,-actorAnchorY(def)*scale,def.cellWidth*scale,def.cellHeight*scale);
    g.restore();return true;
  }
  player(game,x,y,moving,time){
    const target=(game.pickups||[]).find(p=>p.kind==='ore'&&p.mining&&!p.collected);
    const sex=game.player.sex||'male',armed=!!(game.equipped('weapon')||game.equipped('offhand')),mining=!!target;
    const mode=mining&&this.manifest.playerBases[sex]?.mine?'mine':armed||mining?'walkArmed':'walk',base=this.manifest.playerBases[sex]?.[mode];
    const phase=mining?Math.min((base?.framesPerDirection||1)-1,Math.floor(target.progress/MINING_STRIKE_SECONDS*(base?.framesPerDirection||1))):moving?Math.floor(time*8)%(base?.sourceFramesPerDirection||10):0;
    const facing=mining?actorFacing(target.x-game.player.x,target.y-game.player.y):actorFacing(game.lastDirection.x,game.lastDirection.y);
    let items=orderedEquipment(game);
    if(mining){const tool=items.find(i=>i.slot==='weapon'&&isPickaxe(i))||{id:'mining-pickaxe',itemId:0xe86,slot:'weapon',twoHanded:true};items=items.filter(i=>!['weapon','offhand'].includes(i.slot));items.push(tool);}
    const drawItem=item=>{const art=this.manifest.equipment[String(item.itemId)]?.layers?.[sex],def=art?.[mode]||(mode==='mine'?null:art?.walk);if(this.sprite(def,x,y,facing,phase,item.hue||0))this.layersDrawn.add(item.id);};
    const rule=this.manifest.drawOrder?.twoHandedWeapons;
    const behind=items.filter(i=>i.twoHanded&&i.slot==='weapon'&&!rule?.exceptionItemIds.includes(i.itemId)&&((!facing.mirror&&facing.row>=1)||(facing.mirror&&facing.row===3)));
    behind.forEach(drawItem);
    this.sprite(base,x,y,facing,phase,game.player.hue||this.manifest.defaultSkinHue||0);
    items.filter(i=>!behind.includes(i)).forEach(drawItem);
  }
  enemy(enemy,x,y,moving,time){
    if(!isEquipmentBody(enemy.body))return false;
    const sex=enemySex(enemy.body),items=orderedEnemyEquipment(enemy.equipment||enemy.enemyEquipment||[]);
    const mode=items.some(i=>i.slot==='weapon'||i.slot==='offhand')?'walkArmed':'walk';
    const humanBase=this.manifest.playerBases[sex]?.[mode];
    const base=this.manifest.enemyBases?.[String(enemy.body)]?.[mode]||humanBase;
    if(!base)return false;
    const phase=moving?Math.floor(time*8)%(base.sourceFramesPerDirection||10):0;
    const facing=actorFacing(enemy.dx??1,enemy.dy??0),scale=enemy.boss?1.5:1;
    const drawItem=item=>{
      const art=this.manifest.equipment[String(item.itemId)]?.layers?.[sex],source=art?.[mode]||art?.walk;
      if(!source)return;
      const def=source;
      const hue=item.hue||source.equipmentConversionHue||0;
      if(this.sprite(def,x,y,facing,phase,hue,scale))this.layersDrawn.add(item.id);
    };
    const rule=this.manifest.drawOrder?.twoHandedWeapons;
    const behind=items.filter(i=>i.twoHanded&&i.slot==='weapon'&&!rule?.exceptionItemIds?.includes(i.itemId)&&((!facing.mirror&&facing.row>=1)||(facing.mirror&&facing.row===3)));
    behind.forEach(drawItem);
    const drawn=this.sprite(base,x,y,facing,phase,(enemy.hue||0)|(enemy.partialHue?0x8000:0),scale);
    items.filter(i=>!behind.includes(i)).forEach(drawItem);
    return drawn;
  }
  corpse(c,camera){const def=this.manifest.corpses[String(c.body)];if(!def)return;
    const facing=actorFacing(c.dx,c.dy),scale=c.boss?1.5:1,alpha=Math.min(1,c.life/4);
    if(this.sprite(def,c.x-camera.x,c.y-camera.y,facing,0,(c.hue||def.defaultHue||0)|(c.partialHue?0x8000:0),scale,alpha))this.corpsesDrawn++;
    if(isEquipmentBody(c.body))for(const item of orderedEnemyEquipment(c.equipment||[])){
      const layer=this.manifest.equipment[String(item.itemId)]?.corpseLayers?.[enemySex(c.body)];
      if(layer)this.sprite(layer,c.x-camera.x,c.y-camera.y,facing,0,item.hue||layer.equipmentConversionHue||0,scale,alpha);
    }
  }
  async warm(game){const sex=game.player.sex||'male',srcs=new Set();for(const d of Object.values(this.manifest.playerBases[sex]||{}))srcs.add(d.src);for(const item of game.wornItems)for(const d of Object.values(this.manifest.equipment[String(item.itemId)]?.layers?.[sex]||{}))srcs.add(d.src);for(const d of Object.values(this.manifest.equipment[String(0xe86)]?.layers?.[sex]||{}))srcs.add(d.src);await Promise.all([...srcs].map(s=>this.load(s)));}
  get stats(){return{bytes:this.bytes,tintBytes:this.tintBytes,layersDrawn:[...this.layersDrawn],corpsesDrawn:this.corpsesDrawn,images:this.images.size};}
}
