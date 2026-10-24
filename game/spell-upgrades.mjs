import {luckQualityMultiplier} from './reward-rules.mjs';
import {effectiveSpellRank} from './spell-levels.mjs';
export const HERO_UPGRADE_IDS=Object.freeze(['power','haste','vitality','speed','magnet','regen','armor','multishot']);
// Independent per-spell stat improvements and five-upgrade behavior milestones.
export const UPGRADE_RARITIES=Object.freeze([
 {id:'common',name:'Common',color:'#c9c7bb',factor:1,steps:1,statBonus:.05,globalBonus:.05},
 {id:'uncommon',name:'Uncommon',color:'#85c775',factor:2,steps:2,statBonus:.10,globalBonus:.10},
 {id:'rare',name:'Rare',color:'#70baff',factor:3,steps:3,statBonus:.15,globalBonus:.15},
 {id:'epic',name:'Epic',color:'#cc8cff',factor:5,steps:5,statBonus:.25,globalBonus:.20},
 {id:'legendary',name:'Legendary',color:'#ffc653',factor:10,steps:10,statBonus:.50,globalBonus:.25},
]);
const add=(a,b)=>Math.round((a+b)*10000)/10000;
const lasting=new Set(['reactive-armor','magic-reflection','protection','arch-protection','agility','cunning','strength','bless','invisibility','clumsy','weaken','feeblemind','curse','mass-curse','paralyze','poison','fire-field','poison-field','paralyze-field','energy-field','wall-of-stone','blade-spirits','summon-creature','energy-vortex','air-elemental','earth-elemental','fire-elemental','water-elemental','summon-daemon']);
const utility=new Set(['clumsy','weaken','feeblemind','curse','mass-curse','paralyze','paralyze-field','energy-field','wall-of-stone','invisibility','teleport']);
const self=new Set(['heal','greater-heal','reactive-armor','magic-reflection','protection','arch-protection','agility','cunning','strength','bless','invisibility','teleport']);
const multi=new Set(['magic-arrow','fireball','energy-bolt','fire-field','poison-field','paralyze-field','energy-field','wall-of-stone','blade-spirits','summon-creature','energy-vortex','air-elemental','earth-elemental','fire-elemental','water-elemental','summon-daemon','chain-lightning']);
export const GLOBAL_SPELL_UPGRADES=Object.freeze([
 {key:'physical',name:'Physical damage bonus',kind:'damage',base:.05,icon:'spells/earthquake'},
 {key:'elemental',name:'Elemental damage bonus',kind:'damage',base:.05,icon:'spells/fireball'},
 {key:'potency',name:'Defensive spell potency',kind:'damage',base:.05,icon:'spells/protection'},
 {key:'area',name:'Spell area',kind:'area',base:.05,icon:'spells/meteor-swarm'},
 {key:'haste',name:'Spell cast speed',kind:'haste',base:.05,icon:'stats/faster-cast'},
 {key:'duration',name:'Spell duration',kind:'duration',base:.05,icon:'spells/fire-field'},
]);
const physical=new Set(['earthquake','blade-spirits','summon-creature','energy-vortex','air-elemental','earth-elemental','summon-daemon']);
export function globalDamageKey(id){return self.has(id)?'potency':physical.has(id)?'physical':'elemental';}
export function globalSpellChoices(game,spells){const owned=[...(game.spellLoadout||[]),...(game.weaponSpell?[game.weaponSpell]:[])];return GLOBAL_SPELL_UPGRADES.filter(def=>spells.some(spell=>{
 const item=owned.find(i=>i.id===spell.id);return item&&(def.kind!=='damage'||globalDamageKey(spell.id)===def.key)&&spellUpgradeKinds(spell,item,game).includes(def.kind);
})).map(def=>({id:'global:'+def.key,type:'global',category:'All spells',globalKey:def.key,upgradeKind:def.kind,upgradeLabel:def.name,name:def.name,description:['physical','elemental'].includes(def.key)?'Scales the matching class damage bonus for attacks and spells.':undefined,affected:spells.filter(spell=>owned.some(i=>i.id===spell.id)&&(def.kind!=='damage'||globalDamageKey(spell.id)===def.key)&&spellUpgradeKinds(spell,owned.find(i=>i.id===spell.id),game).includes(def.kind)).map(spell=>spell.name),icon:'assets/classic-ui/abilities/'+def.icon+'.png'}));}
export function applyGlobalUpgrade(game,offer){
 const def=GLOBAL_SPELL_UPGRADES.find(d=>'global:'+d.key===offer.id&&d.key===offer.globalKey),rarity=UPGRADE_RARITIES.find(r=>r.id===(offer.rarity||'common'));
 if(!def||!rarity||offer.upgradeKind!==undefined&&offer.upgradeKind!==def.kind)return false;
 const bonus=rarity.globalBonus;if(offer.bonus!==undefined&&offer.bonus!==bonus)return false;
 game.globalSpellUpgrades??={};game.globalSpellUpgrades[def.key]=add(game.globalSpellUpgrades[def.key]||0,bonus);return true;
}
export function spellUpgradeKinds(spell,item={},game=null){
 const t=spellTuning(item,game),u=item.statUpgrades||{},rank=effectiveSpellRank(game,{rank:1,...item,id:spell.id});
 const maintained=['reactive-armor','protection','arch-protection','agility','cunning','strength','bless'].includes(spell.id)&&(25+rank*5)*t.duration>=Math.max(.5,spell.cooldown*(1-(rank-1)*.065)/t.haste);
 return [...(!utility.has(spell.id)?['damage']:[]),...(!self.has(spell.id)?[spell.id==='chain-lightning'?'targets':'area']:[]),'haste',...(lasting.has(spell.id)&&spell.id!=='magic-reflection'?['duration']:[])].filter(k=>!(maintained&&['duration','haste'].includes(k))).filter(k=>k==='damage'?t.damage<10000:k==='area'?t.area<4:k==='duration'?t.duration<6:k==='targets'?t.targets<50:(u.haste||0)+(game?.globalSpellUpgrades?.haste||0)+(item.superUpgrades||[]).filter(v=>v==='quick').length*.5<19);
}
export const upgradeLabel=kind=>({damage:'Damage',area:'Area',haste:'Cast speed',duration:'Duration',targets:'Chain targets'}[kind]||'Learn');
export function spellTuning(item={},game=null){
 const globals=game?.globalSpellUpgrades||{},local=item.weaponGranted?{}:item.statUpgrades||{},classScaled=!!game?.attackKind&&globalDamageKey(item.id)!=='potency',u={...local,damage:(local.damage||0)+(utility.has(item.id)||classScaled?0:globals[globalDamageKey(item.id)]||0),area:(local.area||0)+(globals.area||0),haste:(local.haste||0)+(globals.haste||0)+(item.weaponGranted?(game?.heroUpgradeBonus?.('haste')||0):0),duration:(local.duration||0)+(globals.duration||0)},supers=item.weaponGranted?[]:item.superUpgrades||[];
 const quick=supers.filter(s=>s==='quick').length,power=supers.filter(s=>s==='power').length,many=supers.filter(s=>s==='many').length;
 return {damage:Math.min(10000,Math.max(.05,1+(u.damage||0)+(!game?.attackKind&&!self.has(item.id)&&!utility.has(item.id)?(game?.heroUpgradeBonus?.('power')||0)+(game?.spellDamageAddition||0):0)+.6*power-.2*(quick+many))),area:Math.min(4,1+(u.area||0)),haste:Math.max(.05,Math.min(20,1+(u.haste||0)+quick*.5-power*.2)),duration:Math.min(6,Math.max(.05,1+(u.duration||0)+(utility.has(item.id)&&lasting.has(item.id)?.6*power-.2*(quick+many):0))),targets:Math.min(50,(u.targets||0)+(item.id==='chain-lightning'?many*2:0)),count:Math.min(item.id?.includes('field')||item.id==='wall-of-stone'?5:8,1+many),upgrades:item.upgradeCount||0};
}
export function rollUpgradeRarity(random,luck=0){const roll=random()/luckQualityMultiplier(luck);return UPGRADE_RARITIES[roll<.02?4:roll<.07?3:roll<.2?2:roll<.45?1:0];}
export function decorateUpgrade(game,choice){
 if(choice.type==='spell'&&!choice.upgradeKind)return {...choice,rarity:'common',rarityName:'New spell',rarityColor:'#d8bd70'};
 return describeUpgrade(game,choice,rollUpgradeRarity(()=>game.random(),game.aosBonuses?.Luck||0));
}
export function normalizeUpgradeOffer(game,choice){const rarity=UPGRADE_RARITIES.find(r=>r.id===(choice.rarity||'common'));return rarity&&(choice.upgradeKind||HERO_UPGRADE_IDS.includes(choice.id))?describeUpgrade(game,choice,rarity):choice;}
function describeUpgrade(game,choice,r){
 const kind=choice.upgradeKind,global=choice.type==='global',bonus=global?r.globalBonus:kind==='targets'?r.steps:r.statBonus;
 return {...choice,rarity:r.id,rarityName:r.name,rarityColor:r.color,bonus,steps:r.steps,description:kind?`${choice.upgradeLabel||upgradeLabel(kind)} +${kind==='targets'?bonus:Number((bonus*100).toFixed(2))+'% of '+(global&&['physical','elemental'].includes(choice.globalKey)?'class base bonus':'base')} for ${global?'all related current and future spells and weapon casts':choice.spellName}.`:passiveUpgradeDescription(game,choice,bonus)};
}
function passiveUpgradeDescription(game,choice,bonus){
 const pct=Math.round(bonus*100),baseHp=game.baseMaxHp||110;
 const descriptions={power:`Physical and elemental damage bonus +${pct}% of your class bases.`,haste:`Basic attack and weapon spell cast speed +${pct}% of base.`,vitality:`Maximum health +${pct}% of base (+${Number((baseHp*bonus).toFixed(2))} HP); heal the added health.`,speed:`Movement speed +${pct}% of base.`,magnet:`Pickup radius +${pct}% of base.`,regen:`Regeneration +${pct}% of base health per 10 seconds (+${Number((baseHp*bonus/10).toFixed(2))} HP/s at rest). For 2 s after damage: 25% regen, capped at 1% of base health per second.`,armor:`Resistance +${pct}% of your class bases.`,multishot:game.attackKind==='melee'?`Melee reach +${pct}% of base.`:`Additional basic projectiles +${pct}% of base (fractional amounts give an extra-projectile chance).`};
 return descriptions[choice.id]||choice.description;
}

export function previewUpgradeState(item,offer){return {...item,statUpgrades:{...item.statUpgrades,[offer.upgradeKind]:(item.statUpgrades?.[offer.upgradeKind]||0)+(offer.bonus||.05)}};}
export function applyStatUpgrade(game,item,offer){
 if(item.weaponGranted)return false;
 const kind=offer.upgradeKind||'damage';
 if(!['damage','area','haste','duration','targets'].includes(kind))return false;
 const rarity=UPGRADE_RARITIES.find(r=>r.id===(offer.rarity||'common'));if(!rarity)return false;
 const max=kind==='targets'?rarity.steps:rarity.statBonus;
 if(offer.bonus!==undefined&&offer.bonus!==max)return false;
 item.statUpgrades??={};item.statUpgrades[kind]=add(item.statUpgrades[kind]||0,max);
 item.upgradeCount=(item.upgradeCount||0)+1;
 if(item.upgradeCount%5===0){game.pendingSpellSupers??=[];game.pendingSpellSupers.push({spellId:item.id,milestone:item.upgradeCount});}
 return true;
}
export function superUpgradeOptions(spell,item={}){
 const unit=spell.id==='chain-lightning'?'chain targets':spell.id.includes('field')||spell.id==='wall-of-stone'?'fields':/elemental|daemon|creature|vortex|spirits/.test(spell.id)?'summons':'projectiles';
 const effect=utility.has(spell.id)&&lasting.has(spell.id)?'effect duration':spell.id==='teleport'?'blink distance':'potency';
 const t=spellTuning(item),canMultiply=multi.has(spell.id)&&(spell.id==='chain-lightning'?t.targets<50:t.count<(spell.id.includes('field')||spell.id==='wall-of-stone'?5:8));
 return [{id:'quick',name:'Quickening',description:`+50% cast speed; -20% ${effect}.`},canMultiply?{id:'many',name:spell.id==='chain-lightning'?'Forked lightning':'Echoing cast',description:`+${spell.id==='chain-lightning'?2:1} ${unit} per cast; -20% ${effect}.`}:{id:'power',name:'Empowered cast',description:`+60% ${effect}; Cast speed -20% of base.`}];
}
export function chooseSuperUpgrade(game,option,spells){
 const pending=game.pendingSpellSupers?.[0],spell=spells.find(s=>s.id===pending?.spellId),item=game.spellLoadout.find(s=>s.id===pending?.spellId);
 if(!spell||!item||!superUpgradeOptions(spell,item).some(s=>s.id===option))return false;
 item.superUpgrades??=[];item.superUpgrades.push(option);game.pendingSpellSupers.shift();return true;
}
export function validUpgradeState(game){
 if(game.heroStatUpgrades!==undefined&&(!game.heroStatUpgrades||typeof game.heroStatUpgrades!=='object'||Array.isArray(game.heroStatUpgrades)||Object.entries(game.heroStatUpgrades).some(([k,v])=>!HERO_UPGRADE_IDS.includes(k)||!Number.isFinite(v)||v<0||v>10000)))return false;
 if(game.globalSpellUpgrades!==undefined&&(!game.globalSpellUpgrades||typeof game.globalSpellUpgrades!=='object'||Array.isArray(game.globalSpellUpgrades)||Object.entries(game.globalSpellUpgrades).some(([k,v])=>!GLOBAL_SPELL_UPGRADES.some(d=>d.key===k)||!Number.isFinite(v)||v<0||v>10000)))return false;
 for(const item of game.spellLoadout||[]){
  if(item.statUpgrades!==undefined&&(!item.statUpgrades||typeof item.statUpgrades!=='object'||Array.isArray(item.statUpgrades)||Object.entries(item.statUpgrades).some(([k,v])=>!['damage','area','haste','duration','targets'].includes(k)||!Number.isFinite(v)||v<0||v>10000||k==='targets'&&!Number.isInteger(v))))return false;
  if(item.upgradeCount!==undefined&&(!Number.isInteger(item.upgradeCount)||item.upgradeCount<0||item.upgradeCount>100000))return false;
  if(item.superUpgrades!==undefined&&(!Array.isArray(item.superUpgrades)||item.superUpgrades.length>Math.floor((item.upgradeCount||0)/5)||item.superUpgrades.some(s=>!['quick','power','many'].includes(s)||s==='many'&&!multi.has(item.id))))return false;
 }
 if(game.pendingSpellSupers!==undefined){
  if(!Array.isArray(game.pendingSpellSupers)||game.pendingSpellSupers.length>100)return false;
  const seen=new Set();for(const p of game.pendingSpellSupers){const item=game.spellLoadout?.find(s=>s.id===p.spellId),key=p.spellId+':'+p.milestone;if(!item||!Number.isInteger(p.milestone)||p.milestone<5||p.milestone%5||p.milestone>item.upgradeCount||seen.has(key))return false;seen.add(key);}
 }
 for(const item of game.spellLoadout||[]){
  if(item.upgradeCount===undefined)continue;
  const chosen=item.superUpgrades?.length||0,pending=(game.pendingSpellSupers||[]).filter(p=>p.spellId===item.id);
  if(chosen+pending.length!==Math.floor(item.upgradeCount/5)||pending.some((p,n)=>p.milestone!==(chosen+n+1)*5))return false;
 }
 return true;
}
