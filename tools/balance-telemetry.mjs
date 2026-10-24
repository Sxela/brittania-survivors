// Simulation-only observation. Count nested on-hit/area damage exactly once,
// including recursive hits on the same enemy, without changing combat RNG.
export function observeCombat(game){
 const totals={damageTaken:0,damageDealt:0,healing:0,hits:0,eligibleAttacks:0,contactSeconds:0,stalledSamples:0,enemySamples:0,maxAlive:0};
 const hurt=game.hurtPlayer.bind(game),deal=game.hurtEnemy.bind(game),stack=[];
 game.hurtPlayer=(damage,...rest)=>{
  const hp=game.player.hp;if(game.hitClock<=0&&hp>0)totals.eligibleAttacks++;
  hurt(damage,...rest);const taken=Math.max(0,hp-game.player.hp);totals.damageTaken+=taken;if(taken>0)totals.hits++;
 };
 game.hurtEnemy=(enemy,...rest)=>{
  const hp=enemy.hp,frame={enemy,children:0};stack.push(frame);
  try{return deal(enemy,...rest);}
  finally{
   stack.pop();const damage=Math.max(0,hp-enemy.hp);totals.damageDealt+=Math.max(0,damage-frame.children);
   const parent=stack.findLast(p=>p.enemy===enemy);if(parent)parent.children+=damage;
  }
 };
 return totals;
}
