import {itemResistances} from './combat-types.mjs';
import { attributesOf, activeProperty } from './equipment.mjs';

export const DIFFICULTIES = Object.freeze({
  easy: { name: 'Easy', health: .75, damage: .75, population: .8, reward: .85 },
  normal: { name: 'Normal', health: 1, damage: 1, population: 1, reward: 1 },
  hard: { name: 'Hard', health: 1.3, damage: 1.25, population: 1.25, reward: 1.3 },
});
export const POWERUPS = Object.freeze({
  haste: { duration: 12, value: 1, name: 'Haste' },
  shield: { duration: 15, value: 65, name: 'Protection' },
  magnet: { duration: 8, value: 1, name: 'Experience magnet' },
  'heal-percent': { duration: 0, value: .35, name: 'Restoration' },
});

// Keep stat trade-offs, body restrictions, hand use, and damage types intact.
// This intentionally treats unknown non-numeric capabilities conservatively.
export function comparableItems(a,b) {
  if (!a || !b || a.slot !== b.slot || !!a.twoHanded !== !!b.twoHanded || a.serverLayer !== b.serverLayer) return false;
  if ((a.allowMale!==false)!==(b.allowMale!==false)||(a.allowFemale!==false)!==(b.allowFemale!==false)) return false;
  if (JSON.stringify(a.damageTypes||{})!==JSON.stringify(b.damageTypes||{})) return false;
  if((a.grantedSpell||null)!==(b.grantedSpell||null))return false;
  for (const key of new Set([...Object.keys(a.stats||{}),...Object.keys(b.stats||{})])) {
    if(!activeProperty(key))continue;
    const x=a.stats?.[key],y=b.stats?.[key];
    if ((typeof x!=='number'||typeof y!=='number') && x!==y) return false;
  }
  return true;
}
function dimensions(item) {
  const out={power:item.power||0,defense:item.aosMode?0:item.defense||0};
  for(const [key,value] of Object.entries(attributesOf(item)))out['a:'+key]=key==='MageWeapon'?-value:value;
  for(const [key,value] of Object.entries(itemResistances(item)))out['r:'+key]=value;
  for(const skill of item.skillBonuses||[])out['skill:'+skill.skill]=(out['skill:'+skill.skill]||0)+(Number(skill.value)||0);
  for(const [id,levels] of Object.entries(item.spellLevels||{}))out['spell:'+id]=(out['spell:'+id]||0)+(Number(levels)||0);
  for(const [key,value] of Object.entries(item.stats||{}))if(activeProperty(key)&&typeof value==='number'&&Number.isFinite(value))out['s:'+key]=/Req|Weight$/.test(key)?-value:value;
  return out;
}
export function strictlyDominates(better,worse) {
  if(!comparableItems(better,worse))return false;
  const a=dimensions(better),b=dimensions(worse);let gain=false;
  for(const key of new Set([...Object.keys(a),...Object.keys(b)])){
    const x=a[key]||0,y=b[key]||0;if(x<y)return false;if(x>y)gain=true;
  }
  return gain;
}
