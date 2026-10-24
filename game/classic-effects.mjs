// Native Classic animation cels replace Enhanced particle-component compositions.
import { OriginalEffects as SpriteEffects } from './effects.mjs';
export class OriginalEffects extends SpriteEffects {
  projectile(shot,camera,time) {
    if(!this.birth.has(shot))this.birth.set(shot,time);
    const age=time-this.birth.get(shot),x=shot.x-camera.x,y=shot.y-camera.y-24;
    const role=shot.spellId&&this.manifest.effects[shot.spellId]?shot.spellId:shot.kind==='magic'?'magic-arrow':this.manifest.effects[shot.kind]?shot.kind:'magic-arrow';
    this.sprite(role,x,y,{age,angle:Math.atan2(shot.vy||0,shot.vx||0)});
  }
  effect(e,camera,time) {
    const life=Math.max(0,e.life/(e.maxLife||.45)),age=(e.maxLife||.45)-e.life,x=e.x-camera.x,y=e.y-camera.y-25;
    if(e.kind==='reward-text'){
      const g=this.ctx,py=y-38-age*32-(e.lane||0)*16;g.save();g.globalAlpha=Math.min(1,life*3);g.font='14px UOText';g.textAlign='center';g.lineWidth=3;g.strokeStyle='#17130e';g.fillStyle=e.color||'#ffe17c';g.strokeText(e.text||'',x,py);g.fillText(e.text||'',x,py);g.restore();
    } else if(e.kind==='enemy-cast' ||e.kind==='cast-warning') {
      // Ground warning is survivor gameplay feedback, not a substituted spell.
      const g=this.ctx,r=e.radius||42;g.save();g.translate(x,e.y-camera.y);g.scale(1,.65);
      g.fillStyle='rgba(170,35,15,.16)';g.strokeStyle='#e8b151';g.lineWidth=2;g.beginPath();g.arc(0,0,r,0,Math.PI*2);g.fill();g.stroke();
      g.lineWidth=4;g.beginPath();g.arc(0,0,r,-Math.PI/2,-Math.PI/2+(1-life)*Math.PI*2);g.stroke();g.restore();
    } else if(e.kind==='earthquake') {
      this.drawCounts.earthquake=(this.drawCounts.earthquake||0)+1;
      // RunUO is sound-only. Arena feedback adds ground rings and fragments
      // composed from recovered Classic stone art, never a lightning substitute.
      const g=this.ctx,progress=1-life,radius=e.radius||215;
      g.save();g.translate(x,e.y-camera.y);g.scale(1,.65);g.strokeStyle='#c8ae79';g.lineWidth=3;g.globalAlpha=life*.85;
      for(let i=0;i<3;i++){const r=radius*((progress+i/3)%1);g.beginPath();g.arc(0,0,Math.max(1,r),0,Math.PI*2);g.stroke();}
      g.restore();
      for(let i=0;i<12;i++){const a=i*Math.PI/6,r=radius*(.25+progress*.65);this.sprite('wall-of-stone',x+Math.cos(a)*r,e.y-camera.y+Math.sin(a)*r*.65-Math.sin(progress*Math.PI)*12,{age,scale:.25,alpha:life*.85});}
    } else if(e.kind==='meteor-swarm') {
      for(let i=0;i<3;i++){
        const progress=Math.max(0,Math.min(1,(age-i*.06)/.65)),offset=(i-1)*16;
        this.sprite('meteor-swarm',x+offset-70*(1-progress),y+offset*.3-180*(1-progress),{age,angle:Math.atan2(180,70),scale:1.15,alpha:Math.min(1,life*4)});
      }
    } else if((e.kind==='chain'||e.kind==='chain-lightning')&&Number.isFinite(e.x2)) {
      // RunUO ChainLightning uses BoltEffect on each victim, not a sideways beam.
      this.sprite(e.kind==='chain'?'chain':'chain-lightning',e.x2-camera.x,e.y2-camera.y-25,{age});
    } else if(['fire-field','poison-field','paralyze-field','energy-field','wall-of-stone'].includes(e.kind)) {
      const alternate=Number.isFinite(e.angle)&&Math.cos(e.angle)*Math.sin(e.angle)<0;
      this.sprite(e.kind+(alternate&&e.kind!=='wall-of-stone'?'-alternate':''),x,e.y-camera.y,{age,alpha:Math.min(1,life*4)});
    } else if(e.kind==='nova') {
      for(let i=0;i<8;i++) {
        const angle=i*Math.PI/4,r=(e.radius||110)*(.3+(1-life)*.55);
        this.sprite('nova',x+Math.cos(angle)*r,y+Math.sin(angle)*r*.65,{age});
      }
    } else if(this.manifest.spells?.[e.kind]) {
      // visual:none deliberately has no unrelated hit/heal/lightning fallback.
      if(this.manifest.spells[e.kind].visual==='none'&&['blade-spirits','summon-creature','energy-vortex','air-elemental','earth-elemental','fire-elemental','water-elemental'].includes(e.kind))this.sprite('summon-daemon',x,y,{age,alpha:Math.min(1,life*4)});
      else if(this.manifest.spells[e.kind].visual!=='none')this.sprite(e.kind,x,e.kind==='flame-strike'?e.y-camera.y:y,{age,alpha:Math.min(1,life*4)});
    } else {
      const role=e.kind==='heal'?'heal':e.kind==='dash'?'dash':e.kind==='hurt'?'hurt':e.kind==='slash'?'spark':'hit';
      this.sprite(role,x,y,{age,alpha:Math.min(1,life*4)});
    }
  }
}
