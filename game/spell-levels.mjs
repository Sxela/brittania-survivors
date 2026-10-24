// Survivor adaptation: equipment raises the effective rank of learned and
// weapon-granted spells. Learned rank stays the stored value; combat, previews
// and inspection read the effective rank so unequipping recomputes cleanly.
export const SPELL_LEVEL_ITEM_CAP=3,SCHOOL_RANK_CAP=3,EFFECTIVE_RANK_CAP=8;
// RunUO jewelry and spellbooks roll SkillBonuses of 1-15. Magery and Evaluating
// Intelligence are the casting schools with a real consumer here.
export const SCHOOL_SKILLS=Object.freeze(['Magery','EvalInt']);
export const SCHOOL_POINTS_PER_RANK=10;
export const GOLD_FIND_CAP=100;
const SPELL_LEVEL_FAMILIES=new Set(['jewelry','spellbook']),SCHOOL_FAMILIES=new Set(['jewelry','spellbook']);

export function itemSpellLevels(item){return Object.fromEntries(Object.entries(item?.spellLevels||{}).filter(([,n])=>Number.isInteger(n)&&n>0));}
export function itemSchoolPoints(item){return (item?.skillBonuses||[]).filter(s=>SCHOOL_SKILLS.includes(s.skill)).reduce((sum,s)=>sum+(Number(s.value)||0),0);}
export function schoolPoints(game){return (game?.wornItems||[]).reduce((sum,item)=>sum+itemSchoolPoints(item),0);}
export function spellRankParts(game,item){
 const learned=item?.rank||1;
 if(!game||!item)return {learned,gear:0,school:0,effective:learned,capped:false};
 const gearRaw=(game.wornItems||[]).reduce((sum,worn)=>sum+(itemSpellLevels(worn)[item.id]||0),0);
 const gear=Math.min(SPELL_LEVEL_ITEM_CAP,gearRaw),school=Math.min(SCHOOL_RANK_CAP,schoolPoints(game)/SCHOOL_POINTS_PER_RANK);
 const total=learned+gear+school,effective=Math.min(EFFECTIVE_RANK_CAP,total);
 return {learned,gear,gearRaw,school,effective,capped:total>EFFECTIVE_RANK_CAP};
}
export function effectiveSpellRank(game,item){return spellRankParts(game,item).effective;}
export function goldFindBonus(game){return Math.max(0,Math.min(GOLD_FIND_CAP,game?.aosBonuses?.GoldFind||0))/100;}
export function withGoldFind(game,gold){return Math.max(1,Math.round(gold*(1+goldFindBonus(game))));}

// Spell levels favour the hero's current spells so a drop is usually usable,
// but any playable spell can appear to support switching builds.
export function rollSpellPower(item,family,tier,{random,spells,learned=[],granted=null}){
 if(tier<=0||item.artifact||item.predefined)return item;
 const levelFamily=SPELL_LEVEL_FAMILIES.has(family)||(family==='weapon'&&!!granted);
 if(levelFamily&&spells.length&&random()<.18+.06*Math.min(4,tier)){
  const own=[granted,...learned].filter(id=>id&&spells.includes(id));
  const id=own.length&&random()<.65?own[Math.floor(random()*own.length)]:spells[Math.floor(random()*spells.length)];
  const max=Math.min(SPELL_LEVEL_ITEM_CAP,tier>=3?3:tier>=2?2:1),levels=1+Math.floor(random()*max);
  item.spellLevels={...(item.spellLevels||{}),[id]:levels};
 }
 if(SCHOOL_FAMILIES.has(family)&&!itemSchoolPoints(item)&&random()<.2+.05*Math.min(4,tier)){
  const skill=SCHOOL_SKILLS[Math.floor(random()*SCHOOL_SKILLS.length)],value=Math.min(15,1+Math.floor(random()*(4+tier*3)));
  item.skillBonuses=[...(item.skillBonuses||[]),{skill,value,adaptation:true}];
 }
 return item;
}
export function validSpellLevels(item){
 if(item?.spellLevels===undefined)return true;
 if(!item.spellLevels||typeof item.spellLevels!=='object'||Array.isArray(item.spellLevels))return false;
 return Object.entries(item.spellLevels).every(([id,n])=>typeof id==='string'&&id.length<80&&Number.isInteger(n)&&n>=1&&n<=SPELL_LEVEL_ITEM_CAP);
}
