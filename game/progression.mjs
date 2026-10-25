import { Game } from './core.mjs';
import {freshAccount,ACCOUNT_CLASSES,validAccountRanks} from './account.mjs';

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
  return {version:1,difficulty,gold:0,best:0,victories:0,upgrades:{power:0,vitality:0,magnet:0},stash:null,account:freshAccount()};
}
export function validateProgress(raw,catalog) {
  if(!validObject(raw)||raw.version!==1||!['easy','normal','hard'].includes(raw.difficulty))throw Error('Invalid progress file');
  for(const key of ['gold','best','victories'])if(!Number.isFinite(raw[key])||raw[key]<0||raw[key]>1e9)throw Error('Invalid progress value');
  if(!Number.isInteger(raw.victories)||!validObject(raw.upgrades))throw Error('Invalid progress value');
  const profile=freshProgress(raw.difficulty);
  for(const entry of LEGACY){const rank=raw.upgrades?.[entry.id]??0;if(!Number.isInteger(rank)||rank<0||rank>5)throw Error('Invalid legacy rank');profile.upgrades[entry.id]=rank;}
  Object.assign(profile,{gold:raw.gold,best:raw.best,victories:raw.victories});
  if(raw.stash!==null&&raw.stash!==undefined){validateStash(catalog,raw.stash);profile.stash=clone(raw.stash);}
  if(raw.account!==undefined){
    const a=raw.account;
    if(!validObject(a)||!Number.isSafeInteger(a.ingots)||a.ingots<0||a.ingots>1e9||!validAccountRanks(a.upgrades)||!Number.isSafeInteger(a.nextId)||a.nextId<1||a.nextId>1e9||!Array.isArray(a.inventory)||a.inventory.length>1000||!validObject(a.equipment)||!validObject(a.receipts)||Object.keys(a.receipts).length>100000)throw Error('Invalid account data');
    for(const [key,receipt]of Object.entries(a.receipts))if(!/^[A-Za-z0-9-]{1,100}$/.test(key)||!validObject(receipt)||!Number.isSafeInteger(receipt.ingots)||receipt.ingots<0||receipt.ingots>1e9||typeof receipt.finished!=='boolean')throw Error('Invalid account receipt');
    const ids=new Set();
    for(const item of a.inventory){if(!item?.insured||!Number.isSafeInteger(item.accountItemId)||item.accountItemId<1||item.accountItemId>=a.nextId||ids.has(item.accountItemId))throw Error('Invalid insured item');ids.add(item.accountItemId);}
    const used=new Set(),probe=new Game(catalog);probe.inventory=a.inventory.map(item=>({...clone(item),uid:probe.nextId++}));probe.equipment=Object.fromEntries(Object.keys(probe.equipment).map(slot=>[slot,null]));const migrated=Game.restore(catalog,probe.snapshot());
    for(const id of Object.keys(a.equipment))if(!ACCOUNT_CLASSES.includes(id))throw Error('Invalid account character');
    for(const id of ACCOUNT_CLASSES){if(!validObject(a.equipment[id]))throw Error('Missing account character');for(const [slot,itemId]of Object.entries(a.equipment[id])){const item=a.inventory.find(i=>i.accountItemId===itemId);if(!item||item.slot!==slot||!Object.hasOwn(probe.equipment,slot)||used.has(itemId))throw Error('Invalid account equipment');used.add(itemId);}}
    profile.account={...freshAccount(),...clone(a),upgrades:{...freshAccount().upgrades,...a.upgrades}};
    profile.account.inventory=migrated.inventory.map(item=>({...item,uid:item.accountItemId}));
  }
  return profile;
}
export function createProgressRun(catalog,profile,{archetype='mage',seed=Date.now()>>>0,restoreCamp=false}={}) {
  const game=new Game(catalog,{seed,archetype,difficulty:profile.difficulty,legacyBonuses:profile.upgrades,accountBonuses:profile.account?.upgrades});
  game.accountRunId=seed+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
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
  if(profile.account?.inventory.length){
    for(const owned of profile.account.inventory){
      let item=game.inventory.find(i=>i.accountItemId===owned.accountItemId);
      if(!item){item={...clone(owned),uid:game.nextId++};game.inventory.push(item);}
      if(!restoreCamp&&profile.account.equipment[archetype]?.[item.slot]===item.accountItemId)game.equipment[item.slot]=item.uid;
    }
    game.refreshEquipmentStats();game.refreshWeapons();game.player.hp=game.player.maxHp;
  }
  game.accountItemVersion=1;
  if(!restoreCamp)game.player.gold+=(profile.account?.upgrades.startingGold||0)*5;
  return game;
}
export function bankCamp(profile,game) {
  return {...profile,gold:game.player.gold,stash:game.snapshot()};
}
export function finishProgress(profile,game) {
  const next=clone(profile);syncAccountProgress(next,game);
  if(game.accountRunId)next.account.receipts[game.accountRunId].finished=true;
  if(game.status!=='victory')return {...freshProgress(profile.difficulty),account:next.account};
  const reward=Math.round((50+Math.floor(game.kills/12)+(game.zoneRun?game.areaRoute.length*5:Math.floor(game.time/30)))*(game.difficultySettings?.reward||1));
  return {...next,gold:game.player.gold+reward,best:Math.max(profile.best,game.time),victories:profile.victories+1,stash:game.snapshot()};
}

export function syncAccountProgress(profile,game,{wardrobe=false}={}){
 const account=profile.account??=freshAccount();
 if(wardrobe&&game.player.gold>0){profile.gold+=game.player.gold;game.player.gold=0;}
 if(game.accountRunId&&!wardrobe){
  const receipt=account.receipts[game.accountRunId]??={ingots:0,finished:false};
  if(receipt.finished)return;
  const earned=game.ingotsEarned||0;account.ingots+=Math.max(0,earned-receipt.ingots);receipt.ingots=Math.max(receipt.ingots,earned);
 }
 const insured=game.inventory.filter(item=>item.insured);
 for(const item of insured)if(!item.accountItemId)item.accountItemId=account.nextId++;
 const carried=new Set(insured.map(i=>i.accountItemId));
 account.inventory=[...(game.accountItemVersion?[]:account.inventory.filter(i=>!carried.has(i.accountItemId))),...insured.map(item=>({...clone(item),uid:item.accountItemId}))];
 const known=new Set(account.inventory.map(i=>i.accountItemId));
 const archetype=game.player.archetype;
 if(!ACCOUNT_CLASSES.includes(archetype))return;
 account.equipment[archetype]=Object.fromEntries(game.wornItems.filter(i=>i.insured).map(i=>[i.slot,i.accountItemId]));
 const equipped=new Set(Object.values(account.equipment[archetype]));
 for(const id of ACCOUNT_CLASSES)for(const [slot,itemId]of Object.entries(account.equipment[id]))if(!known.has(itemId)||id!==archetype&&equipped.has(itemId))delete account.equipment[id][slot];
}

export function createAccountWardrobe(catalog,profile,archetype='mage'){
 const game=new Game(catalog,{archetype,accountBonuses:profile.account.upgrades,autoequip:false});
 game.inventory=profile.account.inventory.map(item=>({...clone(item),uid:game.nextId++}));
 game.equipment=Object.fromEntries(Object.keys(game.equipment).map(slot=>[slot,null]));
 for(const item of game.inventory)if(profile.account.equipment[archetype]?.[item.slot]===item.accountItemId)game.equipment[item.slot]=item.uid;
 game.player.maxHp-=game.gearHpBonus;game.gearHpBonus=0;game.refreshEquipmentStats();game.player.hp=game.player.maxHp;
 game.autosell='off';game.autoequip=false;game.accountItemVersion=1;game.pause();return game;
}

export function resumableRun(saved,profile){
 return !!saved?.state&&saved.state.player?.hp>0&&['playing','paused','levelup'].includes(saved.state.status)&&!profile?.account?.receipts[saved.state.accountRunId]?.finished;
}
export function buyLegacy(profile,id) {
  if(!LEGACY.some(entry=>entry.id===id))return false;
  const rank=profile.upgrades[id]||0,cost=25+rank*25;
  if(rank>=5||profile.gold<cost)return false;
  profile.gold-=cost;profile.upgrades[id]=rank+1;return true;
}
