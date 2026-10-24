import test from 'node:test';
import assert from 'node:assert/strict';
import {SPELLS,chooseSpell,tickSpellSystem} from '../game/spell-system.mjs';
import {spellPreview,spellPreviewLines} from '../game/spell-preview.mjs';
import {Game} from '../game/core.mjs';

function arena(){
  return {time:100,nextId:1,damage:80,player:{x:0,y:0,hp:40,maxHp:100},enemies:[{id:2,x:60,y:0,hp:60,maxHp:1000,radius:12}],projectiles:[],spellLoadout:[],spellFields:[],hits:[],
    nearest(){return this.enemies[0];},hurtEnemy(e,damage,weapon,element){this.hits.push({damage,element});},effect(){}};
}
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} versus ${expected}`);

test('spell previews match actual projectile, direct, delayed, field, poison and summon damage at every rank',()=>{
  for(const rank of [1,3,5])for(const spell of SPELLS){
    const g=arena(),preview=spellPreview(g,spell.id,rank);
    if(preview.damage===undefined&&preview.tickDamage===undefined)continue;
    chooseSpell(g,spell.id);g.spellLoadout[0].rank=rank;
    tickSpellSystem(g,.1);close(g.spellLoadout[0].cooldown,preview.cooldown);
    if(g.projectiles.length){close(g.projectiles[0].damage,preview.damage);continue;}
    if(['mind-blast','explosion','meteor-swarm'].includes(spell.id))tickSpellSystem(g,preview.delay);
    if(spell.id==='poison-field')tickSpellSystem(g,.01);
    assert.ok(g.hits.length,spell.id);
    const expected=spell.id==='earthquake'?30*(1+(rank-1)*.25):spell.id==='harm'?preview.damage[1]:preview.tickDamage??preview.damage;
    close(g.hits[0].damage,expected);assert.equal(g.hits[0].element,preview.element,spell.id);
  }
});

test('rank choices compare current and next damage and cooldown without inventing damage on utility spells',()=>{
  const g=arena(),lines=spellPreviewLines(g,'fireball',2,1);
  assert.ok(lines.includes('Damage: 112 → 140 Elemental per hit'));
  assert.ok(lines.includes('Nearby splash: 67.2 → 84 Elemental'));
  assert.ok(lines.includes('Cooldown: 3.5 → 3.3 s'));
  const poison=spellPreviewLines(g,'poison',1).join(' ');assert.ok(poison.includes('Elemental every 2 s'));assert.ok(poison.includes('Duration: 8 s'));
  const quake=spellPreviewLines(g,'earthquake',1).join(' ');assert.ok(quake.includes('15–100 Physical'));assert.ok(quake.includes('50 %'));
  const heal=spellPreviewLines(g,'greater-heal',1);assert.ok(heal.includes('No direct damage.'));assert.ok(heal.includes('Healing: 42 HP'));
  for(const spell of SPELLS){const rows=spellPreviewLines(g,spell.id,3,2);assert.ok(rows.length>=2,spell.id);assert.ok(!rows.some(row=>/NaN|undefined/.test(row)),spell.id);}
});

test('previews follow current character damage and active buffs without changing saves or RNG',()=>{
  const g=new Game();const before=g.snapshot(),base=spellPreview(g,'fireball',1).damage;
  for(const spell of SPELLS)spellPreviewLines(g,spell.id,2,1);
  assert.deepEqual(g.snapshot(),before);
  g.upgrades.power=2;assert.ok(spellPreview(g,'fireball',1).damage>base);
  const unbuffed=spellPreview(g,'fireball',1).damage;
  g.spellLoadout.push({id:'cunning',rank:1,cooldown:1,active:true,activeRemaining:30});
  close(spellPreview(g,'fireball',1).damage,unbuffed+base/1.2*.02);
});
