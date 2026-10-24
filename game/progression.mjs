import { Game } from './core.mjs';

export const LEGACY = [
  {id:'power',name:'Battle insight',description:'+4% damage per rank'},
  {id:'vitality',name:'Enduring spirit',description:'+10 starting health per rank'},
  {id:'magnet',name:'Treasure sense',description:'+8 pickup range per rank'},
];
const clone=value=>JSON.parse(JSON.stringify(value));
const validObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function identifiers(state) {
  return [...state.inventory,...state.shop].map(item=>item.uid).concat(
    ...['enemies','projectiles','pickups','corpses'].map(key=>(state[key]||[]).map(entity=>entity.id)),
    state.pickups.filter(drop=>drop.kind==='loot').map(drop=>drop.item.uid),
  );
}
function validateStash(catalog,stash) {
  Game.restore(catalog,stash);
  const ids=identifiers(stash);
  if(!Number.isSafeInteger(stash.nextId)||ids.some(id=>!Number.isSafeInteger(id)||id<1||id>=stash.nextId)||new Set(ids).size!==ids.length)throw Error('Invalid stash identifiers');
  if(stash.status==='dead')throw Error('A dead character cannot be kept in camp');
}
export function freshProgress(difficulty='normal') {
  return {version:1,difficulty,gold:0,best:0,victories:0,upgrades:{power:0,vitality:0,magnet:0},stash:null};
}
export function validateProgress(raw,catalog) {
  if(!validObject(raw)||raw.version!==1||!['easy','normal','hard'].includes(raw.difficulty))throw Error('Invalid progress file');
  for(const key of ['gold','best','victories'])if(!Number.isFinite(raw[key])||raw[key]<0||raw[key]>1e9)throw Error('Invalid progress value');
  if(!Number.isInteger(raw.victories)||!validObject(raw.upgrades))throw Error('Invalid progress value');
  const profile=freshProgress(raw.difficulty);
  for(const entry of LEGACY){const rank=raw.upgrades?.[entry.id]??0;if(!Number.isInteger(rank)||rank<0||rank>5)throw Error('Invalid legacy rank');profile.upgrades[entry.id]=rank;}
  Object.assign(profile,{gold:raw.gold,best:raw.best,victories:raw.victories});
  if(raw.stash!==null&&raw.stash!==undefined){validateStash(catalog,raw.stash);profile.stash=clone(raw.stash);}
  return profile;
}
export function createProgressRun(catalog,profile,{archetype='mage',seed=Date.now()>>>0,restoreCamp=false}={}) {
  const game=new Game(catalog,{seed,archetype,difficulty:profile.difficulty,legacyBonuses:profile.upgrades});
  if(restoreCamp&&profile.stash){
    const previous=Game.restore(catalog,profile.stash);
    // New opening creatures must not reuse identifiers belonging to carried gear.
    game.nextId=Math.max(game.nextId,previous.nextId);
    for(const key of ['enemies','projectiles','pickups','corpses'])for(const entity of game[key])entity.id=game.nextId++;
    game.player.maxHp-=game.gearHpBonus||0;game.gearHpBonus=0;
    game.inventory=clone(previous.inventory);game.equipment=clone(previous.equipment);
    game.shop=clone(previous.shop);game.shopRestocks=previous.shopRestocks||0;game.nextId=Math.max(game.nextId,previous.nextId);
    game.player.sex=previous.player.sex||'male';game.autosell=previous.autosell;game.autoequip=previous.autoequip;
    game.refreshEquipmentStats();game.player.hp=game.player.maxHp;
    game.player.gold=profile.gold;
    game.cleanupInventory?.();game.refreshWeapons();
  }
  else game.player.gold=profile.gold;
  return game;
}
export function bankCamp(profile,game) {
  return {...profile,gold:game.player.gold,stash:game.snapshot()};
}
export function finishProgress(profile,game) {
  if(game.status!=='victory')return freshProgress(profile.difficulty);
  const reward=Math.round((50+Math.floor(game.kills/12)+(game.zoneRun?game.areaRoute.length*5:Math.floor(game.time/30)))*(game.difficultySettings?.reward||1));
  return {...profile,gold:game.player.gold+reward,best:Math.max(profile.best,game.time),victories:profile.victories+1,stash:game.snapshot()};
}
export function buyLegacy(profile,id) {
  if(!LEGACY.some(entry=>entry.id===id))return false;
  const rank=profile.upgrades[id]||0,cost=25+rank*25;
  if(rank>=5||profile.gold<cost)return false;
  profile.gold-=cost;profile.upgrades[id]=rank+1;return true;
}
