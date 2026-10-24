import {WEAR_ORDER} from './equipment.mjs';

export const isEquipmentBody = body => [183,184,185,186,400,401,402,403,605,606].includes(Number(body));
export const enemySex = body => [184,186,401,403,606].includes(Number(body))?'female':'male';
export function orderedEnemyEquipment(items=[]){
  const rank = item => item.slot==='hair'?WEAR_ORDER.indexOf('head')-.5:WEAR_ORDER.indexOf(item.slot);
  return [...items].sort((a,b)=>rank(a)-rank(b));
}

// Only source-backed finite constructor alternatives are present in this data.
// A choice group equips one option; source switches never equip every branch.
export function generateEnemyEquipment(sourceId,body,random,data){
  const recipe=data?.recipes?.[sourceId];
  if(!recipe||!isEquipmentBody(body))return [];
  const roll=()=>Math.max(0,Math.min(.999999999999,Number(random())||0));
  const pick=values=>values[Math.floor(roll()*values.length)];
  const shared=Object.fromEntries(Object.entries(recipe.sharedHues||{}).map(([key,values])=>[key,pick(values)]));
  const slots=new Map();
  for(const group of [...(recipe.common||[]),...(recipe[enemySex(body)]||[])]){
    if(group.chance!==undefined&&roll()>=group.chance)continue;
    const options=group.options||[];
    if(!options.length)continue;
    let option;
    if(group.weights){
      let target=roll()*group.weights.reduce((sum,value)=>sum+value,0);
      option=options.at(-1);
      for(let index=0;index<options.length;index++){target-=group.weights[index];if(target<0){option=options[index];break;}}
    }else option=pick(options);
    const hue=group.sharedHue?shared[group.sharedHue]:pick(option.hueIds?.length?option.hueIds:[0]);
    slots.set(option.slot,{id:`enemy:${sourceId}:${option.slot}`,slot:option.slot,itemId:option.itemId,hue,twoHanded:!!option.twoHanded,serverLayerNumber:option.serverLayerNumber||0,className:option.className});
  }
  // This server variant deliberately has no outfit. Native clothes keep its
  // human form readable without adding combat stats or changing death loot.
  if(sourceId==='plague-spawn')for(const [slot,itemId,className,serverLayerNumber] of [['shirt',0x1517,'Shirt',5],['pants',0x152E,'ShortPants',4]]){
    slots.set(slot,{id:`enemy:${sourceId}:${slot}`,slot,itemId,className,serverLayerNumber,hue:0,twoHanded:false,cosmetic:true});
  }
  return orderedEnemyEquipment([...slots.values()]);
}
