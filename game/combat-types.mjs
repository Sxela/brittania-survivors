// Damage identities remain available for visuals/status effects; combat has two channels.
export const DAMAGE_CHANNELS=Object.freeze(['Physical','Elemental']);
export const CLASS_CHANNEL_BASES=Object.freeze({magic:Object.freeze({Physical:5,Elemental:20}),melee:Object.freeze({Physical:20,Elemental:5}),arrow:Object.freeze({Physical:12,Elemental:12})});
export const classChannelBases=game=>CLASS_CHANNEL_BASES[game.attackKind]||CLASS_CHANNEL_BASES.magic;
// Percent bonuses add against the class base, never against the running total.
export function classPercent(base,bonus=0,flat=0,cap=Infinity){return Math.max(0,Math.min(cap,base*(1+bonus/100)+flat));}
export function damageChannel(type){return String(type||'Physical').toLowerCase()==='physical'?'Physical':'Elemental';}
const value=n=>Array.isArray(n)?n.filter(Number.isFinite).reduce((a,b)=>a+b,0)/(n.filter(Number.isFinite).length||1):Number(n)||0;
export function combatResistances(resistances={}){
 const sums={Physical:0,Elemental:0};
 for(const [key,n]of Object.entries(resistances)){const k=key.toLowerCase();if(k==='physical')sums.Physical+=value(n);else if(k==='elemental')sums.Elemental+=value(n);else if(['fire','cold','poison','energy'].includes(k))sums.Elemental+=value(n)/4;}
 return sums;
}
export function damageDistribution(types={}){
 const out={Physical:0,Elemental:0};for(const [type,n]of Object.entries(types))out[damageChannel(type)]+=Math.max(0,value(n));
 return out.Physical+out.Elemental>0?out:{Physical:100,Elemental:0};
}
export function combatAttributes(raw,item={}){
 item??={};
 const out={},types=damageDistribution(item.damageTypes);
 const add=(k,v)=>{out[k]=(out[k]||0)+v;};
 for(const [key,n]of Object.entries(raw)){
  if(key==='WeaponDamage'){
   if(item.slot==='weapon'){if(types.Physical>0)add('PhysicalDamage',n);if(types.Elemental>0)add('ElementalDamage',n);}
   else add('PhysicalDamage',n);
  }else if(key==='SpellDamage')add('ElementalDamage',n);
  else if(/^Resist(?:Fire|Cold|Poison|Energy)Bonus$/.test(key))add('ResistElementalBonus',n/4);
  else if(/^Hit(?:Fire|Cold|Poison|Energy)Area$/.test(key))add('HitElementalArea',n);
  else add(key,n);
 }
 return out;
}
export function itemResistances(item={}){
 return itemResistanceParts(item||{}).flat;
}
export function itemResistanceParts(item={}){
 const flat=combatResistances(item.resistances),bonus={Physical:0,Elemental:0};
 for(const field of ['aosAttributes','weaponAttributes','armorAttributes'])for(const [key,n]of Object.entries(item[field]||{})){
  if(key==='ResistPhysicalBonus')bonus.Physical+=value(n);
  else if(key==='ResistElementalBonus')bonus.Elemental+=value(n);
  else if(/^Resist(?:Fire|Cold|Poison|Energy)Bonus$/.test(key))bonus.Elemental+=value(n)/4;
  else if(key==='ResistPhysicalFlat')flat.Physical+=value(n);
  else if(key==='ResistElementalFlat')flat.Elemental+=value(n);
 }
 return {flat,bonus};
}
export function damageBonusParts(game,channel){
 const b=game.aosBonuses||{},base=classChannelBases(game)[channel],items=b[channel+'Damage']??b[channel==='Physical'?'WeaponDamage':'SpellDamage']??0;
 const passive=(game.heroUpgradeBonus?.('power')||0)*100,shared=(game.globalSpellUpgrades?.[channel.toLowerCase()]||0)*100,buffs=(game.channelDamageBuff?.(channel)||0)*100,flat=b[channel+'DamageFlat']||0;
 return {base,items,passive,shared,buffs,flat,total:classPercent(base,items+passive+shared+buffs,flat)};
}
export function damageIncrease(game,channel){
 if(game.attackKind)return 1+damageBonusParts(game,channel).total/100;
 const b=game.aosBonuses||{};return 1+Math.max(0,Math.min(100,b[channel==='Physical'?'PhysicalDamage':'ElementalDamage']??b[channel==='Physical'?'WeaponDamage':'SpellDamage']??0))/100;
}
export function spellDamageChannel(id,element){return damageChannel(element||(['fire-elemental','water-elemental'].includes(id)?'Elemental':'Physical'));}
export function combatAffixRules(rules,item={}){
 const out=[],seen=new Set(),types=damageDistribution(item.damageTypes);
 for(const source of rules){
  let keys=[source.key];
  if(source.target==='resistances'&&['Fire','Cold','Poison','Energy'].includes(source.key))keys=['Elemental'];
  else if(/^Resist(?:Fire|Cold|Poison|Energy)Bonus$/.test(source.key))keys=['ResistElementalBonus'];
  else if(/^Hit(?:Fire|Cold|Poison|Energy)Area$/.test(source.key))keys=['HitElementalArea'];
  else if(source.key==='SpellDamage')keys=['ElementalDamage'];
  else if(source.key==='WeaponDamage')keys=item.slot==='weapon'?['Physical','Elemental'].filter(k=>types[k]>0).map(k=>k+'Damage'):['PhysicalDamage'];
  for(const key of keys){const id=source.target+':'+key;if(!seen.has(id)){out.push({...source,key});seen.add(id);}}
 }
 // Adaptation: Gold find rolls on worn non-weapon families beside RunUO Luck.
 if(rules.length&&item.slot!=='weapon'&&!out.some(r=>r.key==='GoldFind'))out.push({target:'aosAttributes',key:'GoldFind',min:5,max:40,step:1,adaptation:true});
 for(const channel of ['Physical','Elemental']){
  const damage=out.find(r=>r.key===channel+'Damage');
  if(damage&&!out.some(r=>r.key===channel+'DamageFlat'))out.push({...damage,key:channel+'DamageFlat',min:1,max:5,step:1});
  if(rules.length&&!out.some(r=>r.key==='Resist'+channel+'Bonus'))out.push({target:item.slot==='weapon'?'weaponAttributes':'armorAttributes',key:'Resist'+channel+'Bonus',min:5,max:50,step:5});
 }
 return out;
}
export function elementalAreaTypes(items,weapon){
 const out={};for(const item of items)for(const field of ['aosAttributes','weaponAttributes','armorAttributes'])for(const element of ['Fire','Cold','Poison','Energy']){const n=Number(item[field]?.['Hit'+element+'Area'])||0;if(n>0)out[element]=(out[element]||0)+n;}
 if(!Object.values(out).some(n=>n>0))for(const [key,n]of Object.entries(weapon?.damageTypes||{}))if(damageChannel(key)==='Elemental'&&n>0)out[key]=n;
 const total=Object.values(out).reduce((a,b)=>a+b,0);return total?Object.fromEntries(Object.entries(out).map(([k,n])=>[k,n/total*100])):{Elemental:100};
}
