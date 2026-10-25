import {damageChannel,damageIncrease,spellDamageChannel} from './combat-types.mjs';
import {spellTuning,previewUpgradeState} from './spell-upgrades.mjs';
import {spellRankParts} from './spell-levels.mjs';
import {SPELLS,DIRECT_SPELL_DAMAGE,SUMMON_SPELL_BODIES,spellDamageAtRank,spellCooldown} from './spell-system.mjs';

// Raw spell values use the same current character damage and rank scaling as
// casting. Actual damage also depends on each victim's resistances and debuffs.
// `rank` is the learned rank; equipment and school ranks are added as in combat.
export function spellPreview(game,id,rank=1,itemOverride=null){
  const spell=SPELLS.find(s=>s.id===id);if(!spell)return null;
  const item={id,...(itemOverride||game.spellLoadout?.find(s=>s.id===id)),rank},t=spellTuning(item,game),rankParts=spellRankParts(game,item);rank=rankParts.effective;
  const base=spellDamageAtRank(game,rank)*t.damage,scale=(1+(rank-1)*.25)*t.damage;
  const out={id,rank,rankParts,cooldown:spellCooldown(id,rank,item,game),element:spell.element};
  if(DIRECT_SPELL_DAMAGE[id]){
    out.damage=base*DIRECT_SPELL_DAMAGE[id];
    if(['chain-lightning','meteor-swarm'].includes(id))out.targets=id==='chain-lightning'?4+rank+t.targets:Math.min(48,Math.ceil((4+rank)*t.area*t.area));
    else out.splash=out.damage*.6;
    if(['mind-blast','explosion','meteor-swarm'].includes(id))out.delay=id==='mind-blast'?1:id==='explosion'?2.8:.65;
  }else if(id==='harm'){
    out.damage=[base*.6,base*1.2];out.splash=out.damage.map(n=>n*.6);
    out.note='Stronger within close range.';
  }else if(id==='earthquake'){
    out.damage=[15*scale,100*scale];out.hpPercent=50*scale;
    out.note="Damage scales with each enemy current health, within this range.";
  }else if(id==='fire-field'||id==='poison-field'||id==='poison'){
    out.tickDamage=base*(id==='fire-field'?.22:id==='poison-field'?.22*.7:.16);
    out.interval=id==='fire-field'?.5:2;
    out.duration=(id==='poison'?6+rank*2:5+rank)*t.duration;
    if(id==='poison-field')out.note='Applies 8 seconds of poison; crossing the wall refreshes it.';
  }else if(SUMMON_SPELL_BODIES[id]){
    out.damage=base*.45;out.interval=.5;out.duration=(18+rank*3)*t.duration;out.count=t.count;
    out.element=id==='fire-elemental'?'Fire':id==='water-elemental'?'Cold':'Physical';
    out.note='Summon attacks while in reach.';
  }else if(id==='heal'||id==='greater-heal')out.healing=(id==='heal'?18:42)*scale;
  else if(id==='magic-reflection'){out.duration=(35+(rank-1)*5)*t.duration;out.charges=Math.min(600,Math.round((8+rank*2)*t.damage));}
  else if(id==='invisibility')out.duration=(3+rank)*t.duration;
  else if(['reactive-armor','protection','arch-protection','agility','cunning','strength','bless'].includes(id)){
    out.duration=(25+rank*5)*t.duration;
    if(['reactive-armor','protection','arch-protection'].includes(id))out.resistance=((id==='reactive-armor'?15:8)+rank)*t.damage;
    if(id==='reactive-armor')out.note='Elemental resistance: -5.';
    if(['agility','cunning','strength','bless'].includes(id)){out.bonus=(8+rank*2)*t.damage;out.bonusLabel=id==='agility'?'Movement bonus':id==='cunning'?'Elemental damage bonus':id==='strength'?'Physical damage bonus':'Both damage bonuses';out.bonusBase=id==='agility'?'speed':'class';if(id==='bless')out.movementBonus=out.bonus;}
  }else if(id==='feeblemind'){out.duration=(3+rank)*t.duration;out.radius=190+rank*15;out.note='Interrupts active casts and prevents new spells for nearby casters.';
  }else if(['clumsy','weaken','curse','mass-curse'].includes(id)){
    out.duration=(12+rank*3)*t.duration;
    if(['clumsy','curse','mass-curse'].includes(id))out.slow=25;
    if(['weaken','curse','mass-curse'].includes(id))out.weaken=20;
    if(['feeblemind','curse','mass-curse'].includes(id))out.castDelay=(3+rank)*t.duration;
  }else if(id==='paralyze'){out.duration=Math.min(3,(1.5+rank*.25)*t.duration);out.radius=100;out.note='Area paralysis; boss duration: 0.75 s. Damage breaks paralysis. Recovery: 2.5 s.';}
  else if(['paralyze-field','energy-field','wall-of-stone'].includes(id)){
    out.duration=(5+rank)*t.duration;
    if(id==='paralyze-field'){out.duration=Math.min(4,(2+rank*.15)*t.duration);out.note='Passable. Freeze lasts until field expiry; bosses: up to 1 s. Damage does not break field freeze. Recovery: 3 s.';}
  }
  const channelBonus=damageIncrease(game,spellDamageChannel(id,out.element));
  if(out.damage!==undefined)out.damage=Array.isArray(out.damage)?out.damage.map(n=>n*channelBonus):out.damage*channelBonus;
  if(out.tickDamage!==undefined)out.tickDamage*=channelBonus;
  if(out.splash!==undefined)out.splash=Array.isArray(out.splash)?out.splash.map(n=>n*channelBonus):out.splash*channelBonus;
  if(out.hpPercent!==undefined)out.hpPercent*=channelBonus;
  if(spell.category==='offense'&&id!=='chain-lightning')out.radius=(id==='earthquake'?200+rank*15:id==='meteor-swarm'?130+rank*15:id.includes('field')||id==='wall-of-stone'?80+rank*10:id==='mass-curse'?160:out.radius||56)*t.area;
  if(['magic-arrow','fireball','energy-bolt'].includes(id))out.projectiles=t.count;
  if(id.includes('field')||id==='wall-of-stone')out.count=t.count;
  if(out.damage||out.tickDamage){
    const secondary=out.element==='Fire'?'Hits burn for 3 s.':out.element==='Cold'?'Hits slow movement by 25% for 3 s.':out.element==='Poison'?'Poison damage does not stack with existing poison.':'';
    if(secondary)out.note=[out.note,secondary].filter(Boolean).join(' ');
  }
  return out;
}

const number=n=>Number(n.toFixed(1)).toString();
const value=n=>Array.isArray(n)?n.map(number).join('\u2013'):number(n);
export function spellPreviewLines(game,id,rank=1,previousRank=0,previousStats=null,itemOverride=null){
  const stats=spellPreview(game,id,rank,itemOverride);if(!stats)return [];
  const before=previousStats||(previousRank?spellPreview(game,id,previousRank):null),lines=[];
  const r=stats.rankParts,oldRank=before?.rank,rankChanged=oldRank!==undefined&&number(oldRank)!==number(stats.rank);
  if(r&&(r.gear||r.school||rankChanged))lines.push(`Effective rank: ${rankChanged?number(oldRank)+' â†’ ':''}${number(stats.rank)} (learned ${number(r.learned)} + gear ${number(r.gear)} + school ${number(r.school)}${r.capped?', capped at 8':''})`);
  const row=(label,key,unit='')=>{
    if(stats[key]===undefined)return;
    const old=before?.[key],now=value(stats[key]);
    lines.push(`${label}: ${old!==undefined&&value(old)!==now?value(old)+' \u2192 ':''}${now}${unit?' '+unit:''}`);
  };
  if(stats.damage!==undefined)row(SUMMON_SPELL_BODIES[id]?'Summon hit':'Damage','damage',damageChannel(stats.element)+(stats.targets?' per enemy':' per hit'));
  else if(stats.tickDamage!==undefined)row('Damage','tickDamage',`${damageChannel(stats.element)} every ${number(stats.interval)} s`);
  else lines.push('No direct damage.');
  row('Nearby splash','splash',damageChannel(stats.element));
  row('Current health','hpPercent','%');
  row('Targets','targets','maximum');row('Projectiles','projectiles');row('Instances','count');
  if(SUMMON_SPELL_BODIES[id])row('Attack interval','interval','s');
  row('Healing','healing','HP');row(id==='feeblemind'?'Silence':'Duration','duration','s');row('Area radius','radius','px');
  row('Reflect budget','charges','spell circles');row('Physical resistance bonus','resistance','% of class base');
  row(stats.bonusLabel,'bonus',stats.bonusBase==='class'?'% of class base':'%');row('Movement bonus','movementBonus','% of base speed');row('Enemy slow','slow','%');row('Enemy damage reduction','weaken','%');
  row('Enemy cast delay','castDelay','s minimum');
  row('Impact delay','delay','s');row('Cooldown','cooldown','s');
  if(stats.note)lines.push(stats.note);
  return lines;
}

export function spellOfferPreviewLines(game,offer){
 const item=game.spellLoadout.find(s=>s.id===offer.spellId),rank=item?.rank||1;
 if(!item||!offer.upgradeKind)return spellPreviewLines(game,offer.spellId,rank);
 const ghost=Object.create(game);ghost.spellLoadout=game.spellLoadout.map(s=>s===item?previewUpgradeState(s,offer):s);
 return spellPreviewLines(ghost,offer.spellId,rank,0,spellPreview(game,offer.spellId,rank));
}
