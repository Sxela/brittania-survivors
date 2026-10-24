import { MONSTER_SOURCE_DATA } from './monster-source-data.mjs';
import { tryReflectSpell } from './spell-system.mjs';
// Capabilities and circle selection follow RunUO MageAI. Survivor pacing and
// fixed ground warnings give the player time to move without lowering source HP.
const poisonLevels={Lesser:1,Regular:2,Greater:3,Deadly:4,Lethal:5};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
// Broad screen-scale targeting; the fixed ground warning remains dodgeable.
// Leaving this outer range still cancels a cast immediately.
export const ENEMY_TARGET_RANGES=Object.freeze({harm:900,lightning:900,'mind-blast':900,explosion:900,'flame-strike':900});
export function monsterProfile(source){
 const raw=MONSTER_SOURCE_DATA[source?.id]||{ai:source?.originalAI||(source?.ranged||source?.adaptation?.ranged?['AI_Mage']:[]),breath:false,poison:null,poisonChance:.5,mana:source?.ranged||source?.adaptation?.ranged?100:0,magery:source?.ranged||source?.adaptation?.ranged?60:0};
 return {caster:raw.ai.some(a=>['AI_Mage','AI_NecroMage','AI_Mystic','AI_Spellweaving'].includes(a)),archer:raw.ai.includes('AI_Archer'),breath:raw.breath,poison:raw.poison,poisonOptions:raw.poisonOptions||[],poisonChance:raw.poisonChance,magery:raw.magery,mana:raw.mana};
}
export function enemyCasterSpawnAllowed(source,time){
 const b=monsterProfile(source);return !b.caster||time>=(b.magery>=80?180:75);
}
export function initMonsterBehavior(game,enemy,source){
 enemy.behavior=monsterProfile(source);enemy.ranged=enemy.behavior.caster||enemy.behavior.archer;
 enemy.mana=Math.max(0,enemy.serverStats?.mana??Math.min(200,enemy.behavior.mana||0));enemy.maxMana=enemy.mana;
 enemy.castClock=enemy.behavior.caster?1.5+game.random()*1.5:1.3+game.random()*1.5;
 enemy.breathClock=5+game.random()*5;enemy.contactPoisonClock=0;
}
const damageSpells=Object.freeze([
 {id:'magic-arrow',mana:4,kind:'magic',element:'Fire',scale:.8},
 {id:'harm',mana:6,kind:'harm',element:'Cold',scale:.9,targeted:true},
 {id:'fireball',mana:9,kind:'fireball',element:'Fire',scale:1},
 {id:'lightning',mana:11,kind:'lightning',element:'Energy',scale:1.15,targeted:true},
 {id:'mind-blast',mana:14,kind:'mind-blast',element:'Cold',scale:1.2,targeted:true},
 {id:'energy-bolt',mana:20,kind:'energy-bolt',element:'Energy',scale:1.35},
 {id:'explosion',mana:20,kind:'explosion',element:'Fire',scale:1.4,targeted:true},
 {id:'flame-strike',mana:40,kind:'flame-strike',element:'Fire',scale:1.5,targeted:true},
]);
export function chooseEnemyDamageSpell(game,enemy){
 const b=enemy.behavior,maxCircle=Math.max(1,Math.min(8,Math.floor(((b.magery||0)+20)/(100/7))));
 const index=Math.min(maxCircle*2-1,Math.floor(game.random()*maxCircle*2));
 // MageAI weights the first five spells twice, then Energy Bolt and Explosion
 // once each, and assigns the remaining high-circle choices to Flame Strike.
 let spell=damageSpells[index<10?Math.floor(index/2):index===10?5:index===11?6:7];
 if(spell.targeted&&((game.time||0)<(spell.id==='flame-strike'?240:180)||(spell.id==='harm'&&distance(enemy,game.player)>ENEMY_TARGET_RANGES.harm)))
  spell=damageSpells[(game.time||0)>=90&&maxCircle>=3?2:0];
 return spell;
}
function projectile(game,enemy,kind,element,damage,spellId=null){
 const p=game.player,a=Math.atan2(p.y-enemy.y,p.x-enemy.x),speed=kind==='arrow'?300:195;
 game.projectiles.push({id:game.nextId++,ownerId:enemy.id,spellId,x:enemy.x,y:enemy.y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,radius:kind==='arrow'?4:7,damage,life:4,maxLife:4,hostile:true,kind,element});
 game.audioCue?.(kind==='arrow'?'bow':spellId||'fireball',enemy);
}
function targetCast(game,enemy,spell){
 const pending=game.pendingEnemyCasts??=[];
 if(distance(enemy,game.player)>(ENEMY_TARGET_RANGES[spell.id]||0)||(game.enemyGlobalCastClock||0)>0||pending.length>=2)return false;
 const delay=(game.time||0)<300?1.15:.95,radius=spell.id==='harm'?38:42;
 const cast={id:game.nextId++,ownerId:enemy.id,x:game.player.x,y:game.player.y,remaining:delay,delay,radius,spellId:spell.id,kind:spell.kind,element:spell.element,damage:enemy.damage*spell.scale};
 pending.push(cast);game.enemyGlobalCastClock=1.8;
 game.effects.push({x:cast.x,y:cast.y,radius,kind:'enemy-cast',castId:cast.id,spellId:spell.id,life:delay,maxLife:delay});
 return true;
}
export function tickEnemyCasts(game,dt){
 game.enemyGlobalCastClock=Math.max(0,(game.enemyGlobalCastClock||0)-dt);
 const pending=game.pendingEnemyCasts||[];
 for(const cast of pending){
  const enemy=game.enemies.find(e=>e.id===cast.ownerId&&e.hp>0);
  const range=ENEMY_TARGET_RANGES[cast.spellId]||0;
  // Breaking cast range interrupts immediately, even if the player returns
  // before impact. The locked ground point must also remain in caster range.
  if(!enemy||enemy.spellParalyzedUntil>game.time||enemy.spellSilencedUntil>game.time||distance(enemy,game.player)>range||distance(enemy,cast)>range||(game.clearSight&&!game.clearSight(enemy,cast))){
   cast.remaining=0;
   game.effects=game.effects.filter(effect=>!(effect.kind==='enemy-cast'&&(effect.castId===cast.id||(effect.castId===undefined&&effect.spellId===cast.spellId&&effect.x===cast.x&&effect.y===cast.y))));
   continue;
  }
  cast.remaining-=dt;if(cast.remaining>0)continue;
  game.effects.push({x:cast.x,y:cast.y,radius:cast.radius,kind:cast.kind,spellId:cast.spellId,life:.7,maxLife:.7});
  game.audioCue?.(cast.spellId,cast);
  if(distance(game.player,cast)>cast.radius+(game.player.radius||0))continue;
  if(game.clearSight&&!game.clearSight(enemy,game.player))continue;
  if(!tryReflectSpell(game,enemy,cast.damage,cast.element,{spellId:cast.spellId,kind:'targeted'}))game.hurtPlayer(cast.damage,cast.element,enemy);
 }
 game.pendingEnemyCasts=pending.filter(cast=>cast.remaining>0);
}
export function tickMonsterBehavior(game,enemy,dt,knownVisible=null){
 const b=enemy.behavior||monsterProfile({id:enemy.type});enemy.behavior=b;
 const p=game.player,d=distance(enemy,p);enemy.mana=Math.min(enemy.maxMana||0,(enemy.mana||0)+dt);
 enemy.castClock=(enemy.castClock??1.5)-dt;enemy.breathClock=(enemy.breathClock??7)-dt;enemy.contactPoisonClock=Math.max(0,(enemy.contactPoisonClock||0)-dt);
 if(enemy.spellParalyzedUntil>game.time)return {stop:Infinity};
 const visible=knownVisible??(!game.clearSight||game.clearSight(enemy,p));
 if(b.breath&&enemy.breathClock<=0&&d<480&&visible){
  enemy.breathClock=30+game.random()*15;
  projectile(game,enemy,'fireball','Fire',Math.min(enemy.hp*.16,p.maxHp*.35));
 }
 if((b.archer||(b.caster&&!(enemy.spellSilencedUntil>game.time)))&&enemy.castClock<=0&&d<=(b.archer?600:900)&&visible){
  enemy.castClock=b.archer?2.8:2.5+game.random()*1.2;
  if(b.archer)projectile(game,enemy,'arrow','Physical',enemy.damage);
  else if(enemy.hp<enemy.maxHp*.5&&enemy.mana>=11){
   enemy.mana-=11;enemy.hp=Math.min(enemy.maxHp,enemy.hp+enemy.maxHp*.12);game.effect?.(enemy.x,enemy.y,30,'#8aff9c','heal',.6);game.audioCue?.('heal',enemy);
  }else{
   const spell=chooseEnemyDamageSpell(game,enemy);
   if(enemy.mana>=spell.mana){
    if(spell.targeted){if(targetCast(game,enemy,spell))enemy.mana-=spell.mana;else enemy.castClock=1.8+game.random();}
    else{enemy.mana-=spell.mana;projectile(game,enemy,spell.kind,spell.element,enemy.damage*spell.scale,spell.id);}
   }
  }
 }
 return {stop:b.archer||(b.caster&&!(enemy.spellSilencedUntil>game.time)&&enemy.mana>=4)?230:enemy.radius+p.radius-2};
}
export function applyMonsterContact(game,enemy){
 const b=enemy?.behavior;if(!b?.poison||enemy.contactPoisonClock>0)return;
 enemy.contactPoisonClock=1;
 if(game.random()<(b.poisonChance??.5)){
  let name=b.poison;
  if(b.poisonOptions?.length>1){let roll=game.random();for(const option of b.poisonOptions){roll-=option.weight;if(roll<0){name=option.name;break;}}}
  const level=poisonLevels[name]||1;
  if((game.player.poison?.level||0)<=level)game.player.poison={level,tick:1.5,damage:level*1.6};
  game.player.poisonUntil=game.time+8+level*2;
 }
}
export function tickMonsterStatus(game,dt){
 const p=game.player;if(!p.poison)return;
 if(!(p.poisonUntil>game.time)){p.poison=null;return;}
 p.poison.tick-=dt;
 if(p.poison.tick<=0){p.poison.tick=2;game.hurtPlayer(p.poison.damage,'Poison');game.effect?.(p.x,p.y,16,'#7db751','hurt',.3);}
}
