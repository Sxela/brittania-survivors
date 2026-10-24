import {combatAttributes,itemResistances,damageDistribution} from './combat-types.mjs';
import {itemSpellLevels,itemSchoolPoints,SCHOOL_POINTS_PER_RANK} from './spell-levels.mjs';
export const EQUIPMENT_SLOTS = [
  'weapon','offhand','head','neck','earrings','ring','bracelet','talisman','armor','arms','hands','legs','feet','shirt','pants','waist','cloak','robe','skirt','middleTorso',
];
export const SLOT_LABELS={weapon:'Weapon',offhand:'Off hand',head:'Head',neck:'Neck',earrings:'Earrings',ring:'Ring',bracelet:'Bracelet',talisman:'Talisman',armor:'Chest',arms:'Arms',hands:'Gloves',legs:'Legs',feet:'Footwear',shirt:'Shirt',pants:'Pants',waist:'Waist',cloak:'Cloak',robe:'Outer torso',skirt:'Outer legs',middleTorso:'Middle torso',innerLegs:'Inner legs'};
// Different item categories can occupy the same native layer (pants/leg armour).
// Prefer the logical slot, so two-handed weapons compare with the worn weapon
// before considering a shield occupying their shared native hand layer.
export function comparisonItem(game,item){
  return game.equipped(item.slot)||game.wornItems.find(worn=>
    (item.serverLayer&&worn.serverLayer===item.serverLayer)||
    (item.serverLayerNumber>0&&worn.serverLayerNumber===item.serverLayerNumber));
}
export const AOS_LABELS={PhysicalDamage:'Physical damage increase',ElementalDamage:'Elemental damage increase',ResistElementalBonus:'Elemental resistance',ResistPhysicalBonus:'Physical resistance',HitElementalArea:'Hit elemental area',WeaponDamage:'Damage increase',WeaponSpeed:'Swing speed increase',SpellDamage:'Spell damage increase',BonusHits:'Hit points',BonusStr:'Strength',BonusDex:'Dexterity',BonusInt:'Intelligence',RegenHits:'Hit point regeneration',RegenMana:'Mana regeneration',RegenStam:'Stamina regeneration',Luck:'Luck (loot and upgrade rolls)',GoldFind:'Gold find (% more gold from creatures and ore)',AttackChance:'Hit chance increase',DefendChance:'Defense chance increase',CastSpeed:'Faster casting',CastRecovery:'Faster cast recovery',LowerManaCost:'Lower mana cost',LowerRegCost:'Lower reagent cost',ReflectPhysical:'Reflect physical damage',EnhancePotions:'Enhance potions',NightSight:'Night sight',SpellChanneling:'Spell channeling',HitLeechHits:'Hit life leech',HitLeechMana:'Hit mana leech',HitLeechStam:'Hit stamina leech',HitFireball:'Hit fireball',HitLightning:'Hit lightning',HitMagicArrow:'Hit magic arrow',HitHarm:'Hit harm',HitLowerAttack:'Hit lower attack',HitLowerDefend:'Hit lower defense',SelfRepair:'Self repair',DurabilityBonus:'Durability bonus',LowerStatReq:'Lower requirements',MageWeapon:'Mage weapon',UseBestSkill:'Use best weapon skill',HitDispel:'Hit dispel',HitPhysicalArea:'Hit physical area',HitFireArea:'Hit fire area',HitColdArea:'Hit cold area',HitPoisonArea:'Hit poison area',HitEnergyArea:'Hit energy area'};
export const INACTIVE_PROPERTIES=Object.freeze(['BonusMana','RegenMana','LowerManaCost','HitLeechMana','BonusStam','RegenStam','HitLeechStam','SelfRepair','DurabilityBonus','InitMinHits','InitMaxHits','MinHitPoints','MaxHitPoints','HitPoints','MaxHits','Hits','StamReq','ManaReq','LowerRegCost','NightSight','SpellChanneling']);
// Preserve original RunUO fields in source records, but never roll or value
// attributes and equip requirements for resources absent from this arena.
const PRIMARY_STAT_PROPERTIES=new Set(['BonusStr','BonusDex','BonusInt','LowerStatReq','BaseStrBonus','BaseDexBonus','BaseIntBonus','AosStrBonus','AosDexBonus','AosIntBonus','StrengthReq','DexterityReq','IntelligenceReq','StrReq','DexReq','IntReq','AosStrengthReq','AosDexterityReq','AosIntelligenceReq','AosStrReq','AosDexReq','AosIntReq']);
export const activeProperty=key=>!INACTIVE_PROPERTIES.includes(key)&&!PRIMARY_STAT_PROPERTIES.has(key);
const numeric = obj => Object.fromEntries(Object.entries(obj||{}).filter(([,v])=>typeof v==='number'&&Number.isFinite(v)));
export function attributesOf(item){const raw={...numeric(item?.aosAttributes),...numeric(item?.weaponAttributes),...numeric(item?.armorAttributes)};for(const [key,n]of Object.entries(numeric(item?.weaponBonuses)))raw[key]=(raw[key]||0)+n;return combatAttributes(Object.fromEntries(Object.entries(raw).filter(([key])=>activeProperty(key))),item);}
// Only properties that affect the survivor simulation qualify an item as loot.
export function hasGameplayStats(item){return !!item?.grantedSpell||Object.keys(itemSpellLevels(item)).length>0||itemSchoolPoints(item)>0||(item?.power||0)>0||(item?.defense||0)>0||Object.values(item?.resistances||{}).some(v=>v>0)||Object.entries(attributesOf(item)).some(([k,v])=>v>0&&!['MageArmor','MageWeapon','UseBestSkill','HitDispel','LowerStatReq'].includes(k));}
export function aosFamily(source){return source.inheritance?.some(n=>/Spellbook/.test(n))?'spellbook':source.slot==='weapon'?'weapon':source.slot==='offhand'?'shield':['ring','bracelet','earrings','neck','talisman'].includes(source.slot)?'jewelry':source.slot==='head'?'hat':'armor';}
export function lootSourceEligible(source,slot=source.slot,rules={}){
  const preview=sourceProperties(source),stats=preview.stats;preview.stats={...stats};
  preview.power=slot==='weapon'?Number(stats.MaxDamage??stats.AosMaxDamage??(!source.slot?(stats.damageMax??stats.damage??source.damage??10):0)):0;
  for(const range of source.propertyRanges||[])if(preview[range.target]&&range.values?.length)preview[range.target][range.key]=Math.max(0,...range.values.filter(Number.isFinite));
  if(hasGameplayStats(preview))return true;
  if(artifactItem(source)||source.fixedProperties?.length)return false;
  return (rules[aosFamily({...source,slot})]||[]).some(r=>r.max>0&&hasGameplayStats({[r.target]:{[r.key]:r.max}}));
}
export function artifactItem(source){return source?.artifact===true||source?.isArtifact===true||source?.rarity==='artifact'||source?.rarity==='unique'||Number(source?.artifactRarity)>0;}
export function itemScore(item){
  const stats=attributesOf(item),resist=itemResistances(item),defense=item?.aosMode?resist.Physical+resist.Elemental:(item?.defense||0);
  return (item?.power||0)*3+(item?.grantedSpell?20:0)+Object.values(itemSpellLevels(item)).reduce((a,n)=>a+n*12,0)+itemSchoolPoints(item)*1.5+defense*2+Object.values(resist).reduce((a,v)=>a+(Number(v)||0),0)+Object.entries(stats).reduce((a,[k,v])=>a+v*(k==='Luck'?.05:k==='GoldFind'?.3:k==='BonusHits'?2:/^Resist.*Bonus$/.test(k)?.2:1),0);
}
export function sourceProperties(source){
  const attributes=numeric(source.aosAttributes||source.attributes);for(const [stat,key]of [['BaseStrBonus','BonusStr'],['BaseDexBonus','BonusDex'],['BaseIntBonus','BonusInt']])if(Number(source.stats?.[stat]))attributes[key]=(attributes[key]||0)+Number(source.stats[stat]);
  return {aosAttributes:attributes,weaponAttributes:numeric(source.weaponAttributes),armorAttributes:numeric(source.armorAttributes),resistances:numeric(source.resistances),skillBonuses:source.skillBonuses||[],stats:source.stats||{}};
}
export function propertyRows(item){
  const rows=[];
  if(item?.power)rows.push({key:'power',label:item.aosMode?'Weapon damage':'Power',value:item.power});
  if(item?.defense&&!item.aosMode)rows.push({key:'defense',label:'Defense',value:item.defense});
  for(const [k,v]of Object.entries(itemResistances(item)))if(v)rows.push({key:'resist:'+k,label:k+' resistance (flat points)',value:v});
  if(item?.grantedSpell)rows.push({key:'granted:'+item.grantedSpell,label:'Autocast '+item.grantedSpell.replace(/-/g,' ')+' (shared upgrades only)',value:1});
  if(item?.weaponTrait)rows.push({key:'trait:'+item.weaponTrait,label:item.weaponTrait+' weapon trait',value:1});
  if(item?.slot==='weapon'&&(item.power>0||Object.values(item.damageTypes||{}).some(v=>v>0)))for(const [type,value]of Object.entries(damageDistribution(item.damageTypes)))if(value>0)rows.push({key:'damage:'+type,label:type+' damage (%)',value});
  for(const [element,label]of [['Fire','Burn'],['Cold','Slow'],['Poison','Poison']]){
   const share=Number(item?.damageTypes?.[element])||0;if(share>0)rows.push({key:'effect:'+element,label:label+' contribution (%)',value:share});
   const chance=Number(item?.weaponAttributes?.['Hit'+element+'Area'])||0;if(chance>0)rows.push({key:'areaEffect:'+element,label:label+' on area hit (%)',value:chance});
  }
  for(const [k,v]of Object.entries(attributesOf(item)))if(v&&!/^Resist(?:Physical|Elemental)Flat$/.test(k))rows.push({key:'aos:'+k,label:/^Resist(?:Physical|Elemental)Bonus$/.test(k)?k.includes('Physical')?'Physical resistance bonus (% of class base)':'Elemental resistance bonus (% of class base)':/^(?:Physical|Elemental)DamageFlat$/.test(k)?k.replace('DamageFlat',' damage (flat points)'):/^(?:Physical|Elemental)Damage$/.test(k)?k.replace('Damage',' damage bonus (% of class base)'):AOS_LABELS[k]||k.replace(/([a-z])([A-Z])/g,'$1 $2'),value:v});
  for(const [id,levels]of Object.entries(itemSpellLevels(item)))rows.push({key:'spellLevels:'+id,label:id.replace(/(^|-)([a-z])/g,(m,d,c)=>(d?' ':'')+c.toUpperCase())+' levels',value:levels,note:'+'+levels+' effective rank'});
  for(const skill of item?.skillBonuses||[])if(skill.value)rows.push({key:'skill:'+skill.skill,label:skill.skill==='EvalInt'?'Evaluating Intelligence':skill.skill.replace(/([a-z])([A-Z])/g,'$1 $2'),value:skill.value,note:['Magery','EvalInt'].includes(skill.skill)?'+'+Number((skill.value/SCHOOL_POINTS_PER_RANK).toFixed(2))+' rank to all spells':'No effect in this game'});
  return rows;
}

export const WEAR_ORDER=['ring','earrings','feet','pants','legs','shirt','talisman','neck','armor','middleTorso','arms','hands','bracelet','skirt','robe','waist','cloak','head','weapon','offhand'];
export function orderedEquipment(game){return Object.entries(game.equipment).map(([slot,uid])=>game.inventory.find(i=>i.uid===uid)).filter(Boolean).sort((a,b)=>WEAR_ORDER.indexOf(a.slot)-WEAR_ORDER.indexOf(b.slot));}

export function rollAosProperty(rule,budget,random){
  let percent=100-Math.floor(Math.sqrt(Math.floor(random()*10001)));
  percent=Math.max(budget.minIntensity,Math.min(budget.maxIntensity,percent));
  const step=rule.step||1,low=Math.floor(rule.min/step),high=Math.floor(rule.max/step),scaledBy=Math.floor(10000/(Math.abs(high-low)+1));
  return (low+Math.floor((high-low)*percent*(10000+scaledBy)/1000001))*step;
}
