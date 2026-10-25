// Pacing/odds from allods2-rea/survivors/{core,encounters,loot}.mjs.
// Creature identities and item properties continue to come from RunUO.
export const EQUIPMENT_DROP_CHANCE=0;
export const dropsLootChest=enemy=>!!(enemy.boss||enemy.zoneBoss||enemy.captain||enemy.packChampion);
export const POWERUP_DROP_CHANCE=.004;
export const HEAL_DROP_CHANCE=.04;
export const GOLD_DROP_CHANCE=.12;
// Shared display order for equipment, shop stock and upgrade cards.
export function rarityRank(item){return item?.artifact?5:({artifact:5,unique:5,legendary:4,epic:3,rare:2,uncommon:1,magic:1,common:0,normal:0}[item?.rarity]??(item?.tier>=2?2:item?.tier>0?1:0));}
export const rarestFirst=(a,b)=>rarityRank(b)-rarityRank(a);
export const ORDINARY_GOLD_RETAINED=.1;
export function monsterGoldBase(game,enemy={},combatTime=null){
 const zone=game.zoneRun,fraction=Math.min(1,(zone?.pressureElapsed||0)/Math.max(1,game.zonePlan?.bossAt||1));
 const time=combatTime??(zone?((zone.index+fraction)/Math.max(1,game.areaRoute?.length||1)*game.duration):game.time);
 return Math.max(1,Math.round((enemy.boss?15:enemy.captain||enemy.packChampion?6:2+Math.floor(time/180))*(game.difficulty==='hard'?1.5:1)*(game.zoneScale?.gold||1))+(game.zoneRun?.index||0));
}
export function bossSchedule(duration=600){
 const final=duration>15?duration-15:duration;
 return [...[120,240,360,480].filter(t=>t<final),final];
}
export function championSchedule(duration=600){
 const majors=bossSchedule(duration),marks=[];
 for(let mark=35;mark<duration-30;mark+=45)if(majors.every(major=>Math.abs(major-mark)>=20))marks.push(mark);
 return marks;
}
export const luckQualityMultiplier=luck=>Math.min(6,1+Math.max(0,Number(luck)||0)/1000);
export function lootRarity(roll,{leader=false,magicFind=0,luck=0}={}){
 const find=Math.max(0,Math.min(10,magicFind+Math.min(10,Math.max(0,Number(luck)||0)/1000)));
 const unique=Math.min(.08,(leader?.025:.004)*(1+find*.4));
 if(roll>=1-unique)return 'artifact';
 if(leader)return roll<.75/(1+find*.5)?'magic':'rare';
 return roll<.6/(1+find)?'normal':roll<1-Math.min(.5,.1*(1+find*.8))?'magic':'rare';
}
export const lootLeader=enemy=>!!(enemy.boss||enemy.captain||enemy.elite||enemy.modifier==='paragon');
