import {waveCreature} from './monster-stats.mjs';
import {DIFFICULTIES} from './general-mechanics.mjs';
// Existing source-based HP/damage progression is separate. Pacing adds gentle
// duration/density growth rather than multiplying those stats a second time.
export function buildZonePacing(route,catalog,difficulty='normal'){
 const logs=(catalog.areas||[]).map(a=>Math.log1p(Math.max(0,a.typicalThreat||0))),low=Math.min(...logs),high=Math.max(...logs),population=DIFFICULTIES[difficulty]?.population||1;
 let prior=0;
 return route.map((area,index)=>{
  const source=catalog.areas.find(a=>a.id===area.id),classes=new Set(source?.combatClasses||[]),ordinary=(catalog.monsters||[]).filter(m=>(classes.has(m.className)||classes.has(m.sourceName))&&waveCreature(m));
  const threat=(Math.log1p(Math.max(0,area.typicalThreat||source?.typicalThreat||0))-low)/Math.max(1e-9,high-low),position=index/Math.max(1,route.length-1);
  const progress=index?Math.min(1,Math.max(prior,position,.7*(area.bracket||0)/7+.3*threat)):0;prior=progress;
  const bossAt=ordinary.length?120+30*Math.round(progress*(difficulty==='hard'?4:difficulty==='easy'?2:3)):0;
  const sizeScale=1+progress*(population-1),waveMin=Math.round((25+25*progress)*sizeScale),waveMax=Math.round((50+50*progress)*sizeScale),waveSize=Math.round((waveMin+waveMax)/2),growth=5;
  return {version:1,progress,bossAt,waveEvery:30,waveSize,waveMin,waveMax,growth,spread:.28+.17*progress,championTimes:bossAt?Array.from({length:bossAt/30+1},(_,n)=>n*30):[0],waveTimes:Array.from({length:bossAt/30},(_,n)=>n*30)};
 });
}
export const waveRangeAt=(plan,index)=>[plan.waveMin,plan.waveMax].map(n=>n+Math.floor(index/2)*plan.growth);
export const waveSizeAt=(plan,index)=>{const [min,max]=waveRangeAt(plan,index);return (min+max)/2;};
export const rollWaveSize=(plan,index,random)=>{const [min,max]=waveRangeAt(plan,index);return min+Math.floor(Math.max(0,Math.min(.999999999,random()))*(max-min+1));};
export function timelineEvents(plan){return [...plan.waveTimes.filter(t=>t>0).map(time=>({time,kind:'wave'})),{time:plan.bossAt,kind:'boss'}];}
