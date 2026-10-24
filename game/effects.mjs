export class OriginalEffects {
  constructor(ctx,manifest){this.ctx=ctx;this.manifest=manifest;this.images=new Map();this.drawCounts={};this.framesSeen=new Set();this.birth=new WeakMap();}
  async load(){await Promise.all(Object.values(this.manifest.effects).map(async a=>{if(this.images.has(a.src))return;const im=new Image();im.src=a.src;await im.decode();this.images.set(a.src,im);}));}
  sprite(role,x,y,{age=0,angle=0,width,height,scale=1,alpha=1}={}){
    const a=this.manifest.effects[role];if(!a)return false;
    const im=this.images.get(a.src);if(!im)return false;
    const frame=Math.floor(Math.max(0,age)*(a.fps||0))%a.frames;
    const w=(width??a.displayWidth)*scale,h=(height??a.displayHeight)*scale;
    const g=this.ctx;g.save();g.globalCompositeOperation=a.blend||'source-over';g.globalAlpha=Math.max(0,Math.min(1,alpha));g.translate(x,y);g.rotate(angle+(a.rotationOffset||0));
    g.drawImage(im,(frame%a.columns)*a.cellWidth,Math.floor(frame/a.columns)*a.cellHeight,a.cellWidth,a.cellHeight,-a.anchorX/a.cellWidth*w,-a.anchorY/a.cellHeight*h,w,h);g.restore();
    this.drawCounts[role]=(this.drawCounts[role]||0)+1;this.framesSeen.add(role+':'+frame);return true;
  }
  projectile(shot,camera,time){
    if(!this.birth.has(shot))this.birth.set(shot,time);
    const age=time-this.birth.get(shot),angle=Math.atan2(shot.vy,shot.vx),x=shot.x-camera.x,y=shot.y-camera.y-24;
    if(shot.kind==='arrow')this.sprite('arrow',x,y,{age,angle});
    else if(shot.kind==='fireball'){
      for(let i=3;i>=1;i--)this.sprite('fireball',x-Math.cos(angle)*i*9,y-Math.sin(angle)*i*9,{angle:age*2,scale:1-i*.17,alpha:.5-i*.08});
      this.sprite('fireball',x,y,{angle:age*2});this.sprite('fireball-core',x,y,{scale:1+Math.sin(age*20)*.15});
    } else {
      this.sprite('magic-arrow',x,y,{age,angle});this.sprite('spark',x+Math.cos(angle)*10,y+Math.sin(angle)*10,{scale:.45,alpha:.8});
    }
  }
  effect(e,camera,time){
    const life=Math.max(0,e.life/(e.maxLife||.45)),age=(e.maxLife||.45)-e.life,x=e.x-camera.x,y=e.y-camera.y-25;
    if(e.kind==='chain'&&Number.isFinite(e.x2)){
      const dx=e.x2-e.x,dy=e.y2-e.y,length=Math.hypot(dx,dy);
      this.sprite('chain',x+dx/2,y+dy/2,{age,angle:Math.atan2(dy,dx),height:length,width:10+Math.sin(time*60)*3,alpha:Math.min(1,life*3)});
      this.sprite('lightning',e.x2-camera.x,e.y2-camera.y-80,{angle:Math.PI/2,height:120,alpha:life});
      this.sprite('hit',e.x2-camera.x,e.y2-camera.y-25,{alpha:life});
    } else if(e.kind==='fire-field'){
      this.sprite('fireball-core',x,y+12,{width:30,height:16,alpha:Math.min(1,life*3)});
      for(let i=0;i<3;i++)this.sprite('fireball',x+(i-1)*7,y+8-(Math.sin(age*12+i)*.5+.5)*8,{width:17,height:28+i*3,angle:Math.sin(age*9+i)*.08,alpha:Math.min(1,life*3)});
    } else if(e.kind==='nova'){
      for(let i=0;i<8;i++){
        const a=i*Math.PI/4,progress=Math.min(1,(1-life)*1.8),r=(e.radius||110)*(.35+(i%3)*.22),px=x+Math.cos(a)*r,py=y+Math.sin(a)*r*.65;
        this.sprite('nova',px-(1-progress)*55,py-(1-progress)*160,{scale:.8+progress*.4,alpha:Math.min(1,life*2)});
        this.sprite('fireball-core',px,py,{scale:progress*1.5,alpha:life});
      }
    } else if(e.kind==='dash'){
      for(let i=0;i<5;i++)this.sprite('dash',x+(i-2)*9,y-i*5,{scale:1+age,alpha:life});
    } else if(e.kind==='heal'){
      for(let i=0;i<6;i++){const a=i*Math.PI/3+age*4;this.sprite('heal',x+Math.cos(a)*20,y+Math.sin(a)*12-age*35,{scale:.65,alpha:life});}
    } else if(e.kind==='slash'){
      for(let i=0;i<5;i++){const a=-Math.PI*.8+i*.4+age*4;this.sprite('spark',x+Math.cos(a)*(e.radius||60),y+Math.sin(a)*(e.radius||60)*.5,{scale:.65,alpha:life});}
    } else this.sprite(e.kind==='hurt'?'hurt':'hit',x,y,{scale:.7+(1-life),alpha:life});
  }
  get stats(){return {images:this.images.size,drawCounts:{...this.drawCounts},framesSeen:[...this.framesSeen]};}
}
