import {spellPreview,spellPreviewLines} from './spell-preview.mjs';
import {spellTuning,globalDamageKey,HERO_UPGRADE_IDS,GLOBAL_SPELL_UPGRADES} from './spell-upgrades.mjs';
import {spellDamageChannel,damageBonusParts} from './combat-types.mjs';
import {SPELLS,spellMovementMultiplier} from './spell-system.mjs';
import {spellRankParts,schoolPoints,goldFindBonus,SCHOOL_POINTS_PER_RANK,SCHOOL_RANK_CAP,SPELL_LEVEL_ITEM_CAP,EFFECTIVE_RANK_CAP,GOLD_FIND_CAP} from './spell-levels.mjs';

export const statNumber=n=>Number(Number(n).toFixed(2)).toString();
const pct=n=>`${n>=0?'+':''}${statNumber(n*100)}%`;
const value=n=>Array.isArray(n)?n.map(statNumber).join('–'):statNumber(n);
const labels={damage:'Damage / potency',area:'Area radius',haste:'Cast speed',duration:'Effect duration',targets:'Additional chain targets'};

// Keep the baseline on the same preview path as casting, with sources removed.
// Weapon power is a flat addition BEFORE the additive spell tuning pool;
// class channel damage is applied once on impact, with additive class bonuses.
export function spellBreakdown(game,id){
 const granted=id.startsWith('weapon:');id=id.replace(/^weapon:/,'');
 const item=granted&&game.weaponSpell?.id===id?game.weaponSpell:!granted?game.spellLoadout.find(s=>s.id===id):null,spell=SPELLS.find(s=>s.id===id);
 if(!item||!spell)return null;
 const rank=item.rank||1,baseGame=Object.create(game);
 Object.defineProperties(baseGame,{
  baseDamage:{value:game.baseDamage-(game.equipped('weapon')?.power||0)},
  aosBonuses:{value:{}},spellDamageAddition:{value:0},heroUpgradeBonus:{value:()=>0},channelDamageBuff:{value:()=>0},
  globalSpellUpgrades:{value:{}},wornItems:{value:[]},spellLoadout:{value:game.spellLoadout.map(s=>({id:s.id,rank:s.rank||1}))},
 });
 const base=spellPreview(baseGame,id,rank,{id,rank,weaponGranted:granted}),current=spellPreview(game,id,rank,item),t=spellTuning(item,game);
 const rows=[];
 for(const [key,label,unit]of [['damage','Damage',''],['tickDamage','Damage per tick',''],['healing','Healing',' HP'],['radius','Area radius',' px'],['duration','Duration',' s'],['cooldown','Cooldown',' s'],['targets','Chain targets',''],['count','Instances',''],['projectiles','Projectiles',''],['resistance','Physical resistance bonus','% of class base'],['bonus','Buff strength',current.bonusBase==='class'?'% of class base':'%'],['movementBonus','Movement bonus','% of base speed'],['charges','Reflect budget',' circles']]){
  if(current[key]!==undefined)rows.push({label,base:value(base[key])+unit,current:value(current[key])+unit});
 }
 const sources=[];
 if(granted)sources.push('Granted by '+game.equipped('weapon').name+'. Does not occupy a spell slot. Receives shared upgrades and passives only; no individual upgrades or Super Upgrades.');
 const r=spellRankParts(game,{...item,id});
 if(r.gear||r.school)sources.push(`Effective rank: learned ${statNumber(r.learned)} + gear ${statNumber(r.gear)}${r.gearRaw>r.gear?' (capped from '+r.gearRaw+')':''} + school ${statNumber(r.school)} = ${statNumber(r.effective)}${r.capped?' (capped at '+EFFECTIVE_RANK_CAP+')':''}. Each rank adds 25% of rank-1 potency and 6.5% shorter cooldown, plus rank-based duration and radius.`);
 for(const [key,n]of Object.entries(item.statUpgrades||{}))if(n)sources.push(`Spell upgrades · ${labels[key]}: ${key==='targets'?'+'+n:pct(n)}`);
 for(const [key,n]of Object.entries(game.globalSpellUpgrades||{})){
  const def=GLOBAL_SPELL_UPGRADES.find(d=>d.key===key);
  const applies=def?.kind==='damage'?globalDamageKey(id)===key&&spellTuning({id},{globalSpellUpgrades:{[key]:.01}}).damage!==1:({area:current.radius!==undefined,haste:true,duration:current.duration!==undefined}[def?.kind]);
  if(n&&def&&applies)sources.push(`Shared upgrades · ${def.name}: ${pct(n)}`);
 }
 if(item.superUpgrades?.length)sources.push(`Super upgrades: ${item.superUpgrades.map(s=>({quick:'Quickening (+50% cast speed, −20% potency)',power:'Empowered (+60% potency, −20% cast speed)',many:'Echo / fork (+instances or targets, −20% potency)'}[s])).join('; ')}`);
 const damaging=current.damage!==undefined||current.tickDamage!==undefined;
 if(damaging){
  if(id!=='earthquake'&&game.equipped('weapon')?.power)sources.push(`Equipment · Weapon power: +${statNumber(game.equipped('weapon').power)} to base attack (${pct(game.equipped('weapon').power/baseGame.baseDamage)}; ${statNumber(baseGame.baseDamage)} → ${statNumber(game.baseDamage)})`);
  const channel=spellDamageChannel(id,current.element),d=damageBonusParts(game,channel);
  sources.push(`Class · ${channel} damage bonus: ${statNumber(d.base)}% base`);
  sources.push(`Equipment · ${channel} damage bonus: ${pct(d.items/100)} of class base; flat +${statNumber(d.flat)} points`);
  sources.push(`Passives · Damage bonus: ${pct(d.passive/100)} of class base`);
  if(d.buffs)sources.push(`Active spell buffs / legacy · Damage bonus: ${pct(d.buffs/100)} of class base`);
  sources.push(`Class damage calculation: ${statNumber(d.base)}% × (1 + ${statNumber(d.items+d.passive+d.shared+d.buffs)}%) + ${statNumber(d.flat)} points = ${statNumber(d.total)}% → hit ×${statNumber(1+d.total/100)}`);
 }
 sources.push(`Final tuning: potency ×${statNumber(t.damage)}, radius ×${statNumber(t.area)}, cast speed ×${statNumber(t.haste)}, duration ×${statNumber(t.duration)}`);
 sources.push('Bonuses to the same tuning stat add against base. Cooldown = base cooldown ÷ cast speed. Caps are included in current values.');
 return {id:granted?'weapon:'+id:id,name:spell.name+(granted?' · Weapon':''),icon:spell.icon,rows,sources,lines:spellPreviewLines(game,id,rank,0,null,item)};
}

export function currentStats(game){
 const b=game.aosBonuses,hero=id=>game.heroUpgradeBonus(id),baseSpeed=game.attackKind==='arrow'?165:150;
 const resistance=['Physical','Elemental'].map(channel=>({channel,...game.resistanceBonus(channel),effective:game.resistances[channel]}));
 return {rows:[
  ['Health',`${statNumber(game.player.hp)} / ${statNumber(game.player.maxHp)}`],
  ['Health regeneration now',`${statNumber(game.regeneration)} HP/s`],
  ['Regeneration at rest',`${statNumber(game.baseRegeneration)} HP/s`],
  ['Regeneration after damage',`25%, capped at ${statNumber(game.baseMaxHp*.01)} HP/s for 2 s`],
  ['Life leech cap (if equipped)',`${statNumber(game.baseMaxHp*.025)} HP per 0.5 s`],
  ['Basic attack (before channel bonus)',statNumber(game.damage)],
  ['Basic attack interval',`${statNumber(game.attackInterval)} s`],
  ...(game.attackKind==='arrow'?[['Ranger bow tempo','+50% of weapon speed'],['Arrow penetration','Up to 3 enemies']]:[]),
  ['Movement speed',`${statNumber(game.player.speed+baseSpeed*((game.buffs.haste?.remaining>0?.3:0)+spellMovementMultiplier(game)-1))} px/s`],
  ['Pickup radius',`${statNumber(90*(1+hero('magnet'))+game.legacyBonuses.magnet*8)} px`],
  ['Flat armor',statNumber(game.armor)],
  ...['Physical','Elemental'].map(channel=>{const d=damageBonusParts(game,channel);return [channel+' damage bonus',`${statNumber(d.total)}% (class ${d.base}% × (1 + ${statNumber(d.items+d.passive+d.shared+d.buffs)}%) + ${statNumber(d.flat)} flat)`];}),
  ['Dodge chance',`${statNumber(Math.min(45,b.DefendChance||0))}%`],
  ['Luck',statNumber(b.Luck||0)],
  ['Gold find',`+${statNumber(goldFindBonus(game)*100)}% (cap ${GOLD_FIND_CAP}%) on creature gold and ore`],
  ['Spell school rank',`+${statNumber(Math.min(SCHOOL_RANK_CAP,schoolPoints(game)/SCHOOL_POINTS_PER_RANK))} to all spells (${statNumber(schoolPoints(game))} Magery / Evaluating Intelligence points ÷ ${SCHOOL_POINTS_PER_RANK}, cap +${SCHOOL_RANK_CAP}; item spell levels cap +${SPELL_LEVEL_ITEM_CAP} per spell)`],
 ],resistance,passives:HERO_UPGRADE_IDS.filter(id=>hero(id)).map(id=>[id,pct(hero(id))]),globals:GLOBAL_SPELL_UPGRADES.filter(d=>game.globalSpellUpgrades?.[d.key]).map(d=>[d.name,pct(game.globalSpellUpgrades[d.key])]),equipment:Object.entries(b).filter(([,n])=>n).map(([key,n])=>[key.replace(/([a-z])([A-Z])/g,'$1 $2'),statNumber(n)])};
}
