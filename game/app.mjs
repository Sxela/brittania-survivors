import {timelineEvents} from './zone-pacing.mjs';
import {lootChestAtPoint} from './loot-chests.mjs';
import {placeGoldOre,syncGoldOre,MINING_STRIKE_SECONDS} from './mining.mjs';
import {mapPoint} from './map-regions.mjs';
import {globalSpellChoices,UPGRADE_RARITIES,superUpgradeOptions,chooseSuperUpgrade} from './spell-upgrades.mjs';
import {enterZoneSpellShop} from './zone-run.mjs';
import {mobilePresentation,isTouchHold} from './mobile.mjs';
import {entityElevation,actorDepth} from './world-layers.mjs';
import {spellPreviewLines,spellOfferPreviewLines} from './spell-preview.mjs';
import {currentStats,spellBreakdown,statNumber} from './build-stats.mjs';
import {actorAnchorY} from './actor-placement.mjs';
import { Game, ENEMY_ARRIVAL_SECONDS } from "./core.mjs";
import { DIFFICULTIES, POWERUPS } from "./general-mechanics.mjs";
import { freshProgress, validateProgress, createProgressRun, finishProgress, bankCamp, buyLegacy } from "./progression.mjs";
import { renderCampControls, renderLegacy } from "./camp-ui.mjs";
import { spellHud, SPELLS, SPELL_CAPACITY, passiveIcon,spellInvisible,spellChoices } from "./spell-system.mjs";
import { applyHue, applySpectral, hueIdentity } from "./hues.mjs";
import { actorFacing } from "./presentation.mjs";
import { PointerNavigation, cursorWorldPoint,playerCamera } from "./navigation.mjs";
import { OriginalAudio } from "./audio.mjs";
import { WorldAppearance } from "./world-appearance.mjs";
import {isEquipmentBody} from './enemy-equipment.mjs';
import {createNativeMinimap} from './minimap.mjs';
import { settleBiome } from "./map-navigation.mjs";
import { Z_SCALE } from "./static-placement.mjs";
import { createMapRegions } from "./map-regions.mjs";
import {routeMapManifest} from './route-maps.mjs';
import {createLocationMap,relocateLocationSave} from './location-map.mjs';
import { pickupGuides, championGuides, lastEnemyGuides } from "./guidance.mjs";
import { OriginalEffects } from "./classic-effects.mjs";
import { attachMovableHud } from './movable-hud.mjs';
import {createLoadingScreen,fetchLoadingJson,paintLoadingScreen} from './loading-screen.mjs';
import {trackAsset,loadAssetJson,showBackgroundLoading} from './asset-loading.mjs';
showBackgroundLoading(document);
const assetLoading=createLoadingScreen(document);
assetLoading.begin('Loading sound and interface');
const forceMobile=new URLSearchParams(location.search).get('mobile')==='1';
const touchDevice=()=>navigator.maxTouchPoints>0||matchMedia('(pointer:coarse)').matches;
const mobileClient=mobilePresentation({width:innerWidth,height:innerHeight,touch:touchDevice(),forced:forceMobile}).mobile;
let worldZoom=1,mobileZoom=1.5;
try{const saved=Number(localStorage.getItem('britannia-mobile-zoom'));if([1,1.5,2].includes(saved))mobileZoom=saved;}catch{}
const navigation = new PointerNavigation();
navigation.onUnreachable=()=>announce('That location is blocked. Choose an open path.');
import { renderEquipmentWindow, renderShopWindow, clearEquipmentWindow } from "./inventory.mjs";
const audioManifest = await loadAssetJson("./assets/audio/manifest.json");
const soundtrack = new OriginalAudio(audioManifest);
const uiManifest = await loadAssetJson("./assets/ui/manifest.json");
const $ = (id) => document.getElementById(id),
  canvas = $("world"),
  ctx = canvas.getContext("2d");
const movableHud=attachMovableHud($('hud'));
await trackAsset('Fonts',()=>Promise.all(['UOText','UOTitle','UOSubtitle'].map(font=>document.fonts.load('16px '+font))));
await trackAsset('Fonts',document.fonts.ready);
assetLoading.begin('Loading spell effects');
const effectsManifest=await loadAssetJson("./assets/effects/manifest.json");
const spellEffects=new OriginalEffects(ctx,effectsManifest);
assetLoading.begin('Loading spell effects',Object.keys(effectsManifest.effects).length);
await spellEffects.load(()=>assetLoading.advance());
assetLoading.begin('Loading game data');
const catalog = await loadAssetJson('./data/catalog.json');
catalog.enemyEquipment=await loadAssetJson('./data/enemy-equipment.json');
const areaCatalog=await loadAssetJson('./data/areas.json');
catalog.areas=areaCatalog.areas;delete catalog.areaCount;
catalog.zoneMode=true;
const radarManifest=await loadAssetJson('./assets/classic-minimap/manifest.json'),radarImages={};
assetLoading.begin('Loading minimap artwork',Object.keys(radarManifest.images).length);
await Promise.all(Object.entries(radarManifest.images).map(async([key,entry])=>{const image=new Image();image.src=entry.src;await trackAsset('Minimap artwork',()=>image.decode());radarImages[key]=image;assetLoading.advance();}));
let nativeMinimap=createNativeMinimap(radarManifest,radarImages);
let manifest = { images: {}, animations: {} },
  images = {};
try {
  manifest = await loadAssetJson("./assets/manifest.json");
  assetLoading.begin('Loading interface artwork',Object.keys(manifest.images||{}).length);
  await Promise.all(
    Object.entries(manifest.images || {}).map(async ([key, entry]) => {
      const img = new Image();
      img.src = "./" + (typeof entry === "string" ? entry : entry.src);
      try {
        await trackAsset('Interface artwork',()=>img.decode());
        images[key] = img;
      } catch {} finally {assetLoading.advance();}
    }),
  );
} catch {
  $("loading").textContent =
    "Client art unavailable. Run python tools/extract_client.py to recover it.";
}
assetLoading.begin('Loading world manifests');
const summonManifest=await loadAssetJson('./assets/classic-summons/manifest.json');
manifest.animations={...manifest.animations,...summonManifest.animations};
let huePalettes = {};
try {
  const hueData = await loadAssetJson(
    "./" + (manifest.hues?.src || "assets/hues.json"),
  );
  huePalettes = hueData.palettes || {};
} catch {}
const legacyMapManifest=await loadAssetJson('./assets/maps/manifest.json');
let areaMapManifest=null;
const originalLocations=await loadAssetJson('./assets/mobile-locations/manifest.json');
let mobileAreaCache=null;
async function nativeArea(area){
 if(mobileAreaCache?.regions[0]?.areaId===area.id){mobileAreaCache.regions[0].runFacet=area.facet;return mobileAreaCache;}
 const entry=originalLocations.areas[area.id];if(!entry)throw Error('Native location unavailable: '+area.name);
 mobileAreaCache=await trackAsset('Area data',()=>fetchLoadingJson(entry.src,(loaded,total)=>assetLoading.bytes(loaded,total)));mobileAreaCache.regions[0].runFacet=area.facet;return mobileAreaCache;
}
let mapManifest=legacyMapManifest,mapImages={},mapRegions=createMapRegions(mapManifest,mapImages,{palettes:huePalettes}),mapLoading=false;
let activeBiomeStage=0;
async function attachMap(newRun=false,mapState=null){
  assetLoading.begin('Loading '+(game.currentArea()?.name||'area')+' data');
  await paintLoadingScreen();
  if(!game.zoneRun&&game.areaRoute?.length&&!areaMapManifest)areaMapManifest=await loadAssetJson('./assets/zone-maps/manifest.json');
  const selected=game.zoneRun?await nativeArea(game.currentArea()):game.areaRoute?.length?routeMapManifest(areaMapManifest,game.areaRoute,game.duration):legacyMapManifest;
  if(game.zoneRun)selected.images['tree-stump']=uiManifest.images['scenery/tree-stump'];
  const loaded={};
  assetLoading.begin('Loading area artwork',Object.keys(selected.images).length);
  // Explicit bitmap decoding also works while the native window is offscreen.
  // Detached HTML image decode promises can stall after a viewport resize.
  await Promise.all(Object.entries(selected.images).map(([key,entry])=>trackAsset('Area artwork',async()=>{const response=await fetch(entry.src);if(!response.ok)throw Error('Area artwork could not be loaded');loaded[key]=await createImageBitmap(await response.blob());assetLoading.advance();})));
  assetLoading.begin('Preparing terrain and paths');
  await paintLoadingScreen();
  for(const image of Object.values(mapImages))image.close?.();
  mapManifest=selected;mapImages=loaded;mapRegions=game.zoneRun?createLocationMap(selected,loaded,{palettes:huePalettes,areaId:game.currentArea().id}):createMapRegions(selected,loaded,{palettes:huePalettes});
  nativeMinimap=game.areaRoute?.length?createNativeMinimap({...radarManifest,regions:selected.regions.map(r=>({id:r.id,image:r.radar}))},{...radarImages,...loaded}):createNativeMinimap(radarManifest,radarImages);
  activeBiomeStage=mapRegions.stageAt(game.time);
  if(newRun){mapRegions.reset();const start=mapRegions.nearestPlayable(mapManifest.regions[0].spawn.x,mapManifest.regions[0].spawn.y,0),dx=start.x-game.player.x,dy=start.y-game.player.y;game.player.x=start.x;game.player.y=start.y;for(const enemy of game.enemies){enemy.x+=dx;enemy.y+=dy;}}
  else {if(game.zoneRun)relocateLocationSave(game,mapState,selected.regions[0]);mapRegions.restore(mapState||[]);}
  mapRegions.update(playerCamera(game.player,view,mapRegions.elevationAt(game.player.x,game.player.y,game.time)),view.w,view.h,game.time,[game.player,...game.enemies,...game.pickups,...game.corpses,...game.spellFields.filter(f=>f.summon)]);
  game.elevationAt=(x,y,time)=>mapRegions.elevationAt(x,y,time);
  game.isPassable=(x,y,time)=>mapRegions.isPlayable(x,y,time);game.nearestPassable=(x,y,time)=>mapRegions.nearestPlayable(x,y,time);
  game.areaAt=(x,y,time)=>mapRegions.areaAt(x,y,time);
  if(game.zoneRun)game.spawnLocation=(area,radius,boss,options={})=>mapRegions.randomSpawn(()=>game.random(),game.player,radius,boss,{width:view.w,height:view.h,angle:options.spawnAngle,spread:options.spawnSpread});
  settleBiome(game,mapRegions,{cancelCasts:false});
  syncGoldOre(game);
  if(game.zoneRun){
    const key=game.currentArea().id+':'+game.zoneRun.index;
    if(game.oreAreaKey!==key){const r=selected.regions[0],cells=r.mainPassable||[],points=[];
      for(let i=0;i<Math.min(180,cells.length);i++){const cell=cells[Math.floor(i*cells.length/Math.min(180,cells.length))],p=mapPoint(Math.floor(cell/r.height)+.5,cell%r.height+.5);
        if([[-22,0],[22,0],[0,-22],[0,22],[0,0]].every(([x,y])=>game.canStand(p.x+x,p.y+y,18)))points.push(p);
      }placeGoldOre(game,points,key);
    }
  }
  const safe=Object.assign((x,y)=>game.canStand(x,y,game.player.radius*.5),{canTraverse:game.canTraverse});
  navigation.configure(safe,(x,y)=>{let point=mapRegions.nearestPlayable(x,y,game.time);for(let radius=4;!safe(point.x,point.y)&&radius<120;radius+=4){for(let i=0;i<16;i++){const px=x+Math.cos(i*Math.PI/8)*radius,py=y+Math.sin(i*Math.PI/8)*radius;if(safe(px,py)){point={x:px,y:py};break;}}}return point;});
}
let zoneShopDismissed='';
function zoneShopKey(){return game?.zoneRun?game.seed+':'+game.zoneRun.index:'';}
function currentMoongate(){
  if(!game.zoneRun.gate)game.zoneRun.gate=mapRegions.gatePoint(game.player);
  return game.zoneRun.gate;
}
let pendingZonePurchase=null,spellShopReadyAt=0;
function cancelZoneReplacement(){
  pendingZonePurchase=null;
  // Returning clicks must not activate an offer under the old Back button.
  spellShopReadyAt=performance.now()+1000;zoneSpellShop();
}
function spellOfferHTML(offer){return `<small class="spell-preview">${spellOfferPreviewLines(game,offer).map(esc).join('<br>')}</small>`;}
function upgradeCard(offer){const rarity=UPGRADE_RARITIES.find(r=>r.id===offer.rarity)||UPGRADE_RARITIES[0];return `<strong style="color:${rarity.color}">${esc(offer.name)}</strong><small>${esc(offer.upgradeKind?rarity.name:offer.type==='spell'?'New spell':rarity.name)} / ${esc(offer.type==='global'?'Shared upgrade':offer.category||'Passive')}<br>${esc(offer.description||'')}</small>${offer.type==='global'?`<small>Affects: ${esc((offer.affected||[]).join(', '))}. Also applies to future spells.</small>`:offer.type==='spell'?spellOfferHTML(offer):`<small>+${Math.round((offer.bonus||.05)*100)}% of base / additive</small>`}`;}
function zoneSpellShop(){
 if(!game||game.zoneRun?.phase!=='spellshop'||game.status==='levelup')return;
 if(showSuperUpgrade('zone-spells'))return;
 if(game.status==='playing')game.pause();
 pendingZonePurchase=null;screen='zone-spells';soundtrack.setScene('paused');zoneShopDismissed=zoneShopKey();
 const available=new Map(game.shopUpgradeChoices.map(offer=>[offer.id,offer]));
 game.zoneSpellOffers=game.zoneSpellOffers.filter(offer=>available.has(offer.id));
 const reroll=game.zoneSpellRerollPrice;
 dialog(`<div class="eyebrow">BETWEEN AREAS</div><h2>Upgrade your build</h2><div class="shop-wallet"><img src="assets/classic-ui/hud/shop.png" alt=""><strong id="zone-shop-gold">${Math.floor(game.player.gold).toLocaleString("en-US")} gold</strong><small>${Math.round(game.aosBonuses.Luck||0)} Luck</small></div><div class="choices">${game.zoneSpellOffers.map((offer,i)=>`<article class="choice"><img class="choice-icon" src="${offer.icon}" alt="">${upgradeCard(offer)}<button class="choice-action" data-zone-spell="${i}" data-shop-action data-unaffordable="${game.player.gold<game.zoneUpgradePrice(offer)}">Buy / ${game.zoneUpgradePrice(offer)} gold</button></article>`).join('')||'<p>Learn spells at every fifth level to unlock upgrades here.</p>'}</div><div class="dialog-actions"><button id="zone-inventory" data-shop-action>Inventory</button><button id="zone-items" data-shop-action>Buy / sell items</button><button id="zone-reroll" data-shop-action data-unaffordable="${game.player.gold<reroll||!available.size}">Reroll / ${reroll} gold</button><button id="zone-finish" data-shop-action>Next area</button></div>`);
 document.querySelectorAll('[data-zone-spell]').forEach(button=>button.onclick=event=>{if(button.isConnected&&event.detail<2&&performance.now()>=spellShopReadyAt)buyZoneSpell(Number(button.dataset.zoneSpell));});
 $('zone-reroll').onclick=()=>{if(performance.now()<spellShopReadyAt)return;if(game.rerollZoneSpells()){zoneSpellShop();hud();save();soundtrack.play('gold');}};
 $('zone-finish').onclick=()=>{if(performance.now()>=spellShopReadyAt)completeZoneTravel();};
 $('zone-inventory').onclick=()=>{if(performance.now()>=spellShopReadyAt)inventory();};
 $('zone-items').onclick=()=>{if(performance.now()>=spellShopReadyAt)shop();};
 spellShopReadyAt=performance.now()+1000;const guarded=[...$('dialog').querySelectorAll('[data-shop-action]')];for(const button of guarded)button.disabled=true;
 setTimeout(()=>{for(const button of guarded)if(button.isConnected&&screen==='zone-spells')button.disabled=button.dataset.unaffordable==='true';},1000);
}
let superReturn='game';
function showSuperUpgrade(returnTo='game'){
 const pending=game?.pendingSpellSupers?.[0];if(!pending)return false;
 if(screen!=='super-upgrade')superReturn=returnTo;
 if(game.status==='playing')game.pause();
 const spell=SPELLS.find(s=>s.id===pending.spellId),options=superUpgradeOptions(spell,game.spellLoadout.find(s=>s.id===spell.id));
 screen='super-upgrade';soundtrack.setScene('paused');
 dialog(`<div class="eyebrow">SUPER UPGRADE / ${pending.milestone} IMPROVEMENTS</div><h2>${esc(spell.name)}</h2><p>Choose a behavior change. This is a bonus choice, separate from your character level.</p><div class="choices">${options.map(option=>`<article class="choice"><img class="choice-icon" src="${spell.icon}" alt=""><strong>${esc(option.name)}</strong><small>${esc(option.description)}</small><button class="choice-action" data-super="${option.id}">Choose</button></article>`).join('')}</div>`);
 document.querySelectorAll('[data-super]').forEach(button=>button.onclick=()=>{
  if(!chooseSuperUpgrade(game,button.dataset.super,SPELLS))return;save();
  if(game.pendingSpellSupers.length){showSuperUpgrade();return;}
  screen='game';
  if(superReturn==='zone-spells'){zoneSpellShop();return;}
  if(game.status==='paused')game.status='playing';game.checkLevel();
  if(game.status==='levelup')levelup();else resume();hud();save();
 });return true;
}
function buyZoneSpell(index){
  if(performance.now()<spellShopReadyAt)return;
  const selected=game.zoneSpellOffers[index];if(!selected||!game.shopUpgradeChoices.some(offer=>offer.id===selected.id))return;
  if(game.buyZoneSpell(index)===true){zoneSpellShop();hud();save();soundtrack.play('gold');}
}

async function enterMoongate(){
 if(mapLoading||!game||game.status!=='playing'||game.zoneRun?.phase!=='cleared')return;
 const gate=currentMoongate();
 if(Math.hypot(game.player.x-gate.x,game.player.y-gate.y)>100){navigation.setDestination(gate);announce('Walk into the moongate when you have collected your loot.');return;}
 if(!enterZoneSpellShop(game))return;
 navigation.cancel();soundtrack.play('gate-travel');zoneSpellShop();hud();save();
}
async function completeZoneTravel(){
 if(mapLoading||game?.zoneRun?.phase!=='spellshop'||game.pendingSpellSupers?.length)return;
 mapLoading=true;const state=game.snapshot(),map=mapRegions.snapshot();
 try{
  game.finishZoneSpellShop();game.status='playing';
  if(!game.advanceZone())throw Error('The journey could not advance');
  if(game.status==='victory'){ending();return;}
  game.status='paused';navigation.cancel();zoneShopDismissed='';announce('Travelling through the moongate...');
  await attachMap(true);game.status='playing';soundtrack.play('gate-travel');hud();resume();announce(game.currentArea().name);
 }catch(error){game=Game.restore(runtimeCatalog,state);await attachMap(false,map);zoneSpellShop();announce('The next area could not be loaded: '+error.message);console.error(error);}
 finally{assetLoading.hide();mapLoading=false;save();}
}
$('zone-action').onclick=()=>{if(game?.zoneRun?.phase==='spellshop')zoneSpellShop();else enterMoongate();};
const worldManifest=await loadAssetJson('./assets/world-equipment/manifest.json');
const worldAppearance=new WorldAppearance(ctx,worldManifest,huePalettes);
worldAppearance.maxBytes=(mobileClient?64:128)*1024*1024;
const lootFeed=[];
function itemArt(item){const art=uiManifest.equipment?.items?.[item?.id];return art?.variants?.find(v=>v.itemId===item.itemId)||art;}
function dropImage(kind,item){const art=kind==='gold'?uiManifest.equipment.items['gold-large']:kind==='heal'?uiManifest.equipment.items.potion:itemArt(item);return uiManifest.images[art?.icon];}
const abilityImages=new Map();
function abilityImage(src){if(!abilityImages.has(src)){const image=new Image();image.src=src;abilityImages.set(src,image);trackAsset('Spell icons',()=>image.decode()).catch(()=>{});}const image=abilityImages.get(src);return image.complete&&image.naturalWidth?image:null;}
function powerupIcon(id){return 'assets/classic-ui/abilities/spells/'+({haste:'agility',shield:'protection',magnet:'telekinesis','heal-percent':'greater-heal'}[id]||'heal')+'.png';}
function drawDrop(drop,camera){
  const x=drop.x-camera.x,y=drop.y-camera.y-entityElevation(drop,mapRegions,game?.time||0)*Z_SCALE;
  if(x< -80||x>view.w+80||y< -120||y>view.h+80)return;
  if(drop.kind==='loot'){
    spellEffects.sprite('heal',x,y-28,{height:70,width:14,alpha:.38+.12*Math.sin(fxTime*3)});
    spellEffects.sprite('spark',x,y-4,{scale:.4,alpha:.55});
  }
  if(POWERUPS[drop.kind]){
    if(drop.life<6&&Math.floor(fxTime*5)%2)return;
    spellEffects.sprite('heal',x,y,{scale:.75,alpha:.65});
    const icon=abilityImage(powerupIcon(drop.kind));if(icon)ctx.drawImage(icon,x-14,y-28,28,28);
    ctx.font='12px UOText';ctx.textAlign='center';ctx.fillStyle='#fff0a0';ctx.fillText(POWERUPS[drop.kind].name,x,y-35);return;
  }
  const art=drop.kind==='loot'?uiManifest.images['loot/chest']:drop.kind==='ore'?uiManifest.images['resources/gold-ore']:dropImage(drop.kind,drop.item);if(!art)return;
  const scale=Math.min(1.25,(['ore','loot'].includes(drop.kind)?52:36)/art.width,(['ore','loot'].includes(drop.kind)?60:40)/art.height),def={src:art.src,cellWidth:art.width,cellHeight:art.height,framesPerDirection:1,anchorX:art.width/2,anchorY:art.height};
  worldAppearance.sprite(def,x,y,{row:0,mirror:false},0,drop.kind==='ore'?0x8A5:drop.kind==='loot'?0:drop.item?.hue||0,scale);
  if(drop.kind==='loot'&&Math.hypot(drop.x-game.player.x,drop.y-game.player.y)<150){
    ctx.save();ctx.font='12px UOText';ctx.textAlign='center';ctx.strokeStyle='#151108';ctx.lineWidth=3;ctx.fillStyle='#edcc7a';const label='Loot chest / walk over to open';ctx.strokeText(label,x,y-70);ctx.fillText(label,x,y-70);ctx.restore();
  }
  if(drop.kind==='ore'&&Math.hypot(drop.x-game.player.x,drop.y-game.player.y)<90){
    ctx.save();ctx.textAlign='center';ctx.font='12px UOText';ctx.strokeStyle='#151108';ctx.lineWidth=3;ctx.fillStyle='#eed078';const label=drop.mining?'Mining gold / '+drop.strikes+' strikes left':'Gold ore / stand close to mine';ctx.strokeText(label,x,y-58);ctx.fillText(label,x,y-58);
    if(drop.mining){ctx.fillStyle='#211c14';ctx.fillRect(x-25,y-52,50,5);ctx.fillStyle='#e3bc65';ctx.fillRect(x-24,y-51,48*drop.progress/MINING_STRIKE_SECONDS,3);}ctx.restore();
  }
}
function drawPickupGuidance(){
  const arrow=uiManifest.images['textures/buttons/arrowbuttonright'];const image=arrow&&abilityImage(arrow.src);
  const radar=$('minimap').clientWidth/worldZoom,last=lastEnemyGuides(game,view.w,view.h,worldZoom,radar);
  for(const guide of [...pickupGuides(game,view.w,view.h,worldZoom),...championGuides(game,view.w,view.h,worldZoom,radar).filter(g=>!last.some(e=>e.enemyId===g.enemyId)),...last]){
    ctx.save();ctx.translate(guide.x,guide.y);ctx.rotate(guide.angle);if(image)ctx.drawImage(image,0,0,Math.min(20,image.width),Math.min(20,image.height));ctx.restore();
    if(guide.kind==='champion'||guide.kind==='enemy')continue;
    ctx.save();ctx.font='12px UOText';ctx.textAlign=guide.x<view.w/2?'left':'right';ctx.fillStyle='#fff0a0';ctx.strokeStyle='#000';ctx.lineWidth=3;
    const text=(guide.kind==='powerup'?POWERUPS[guide.drop.kind]?.name:guide.kind.toUpperCase())+' '+guide.distance;const x=Math.max(6,Math.min(view.w-6,guide.x)),y=guide.y-9;ctx.strokeText(text,x,y);ctx.fillText(text,x,y);ctx.restore();
  }
}
function renderLootFeed(){
  while(lootFeed.length&&fxTime-lootFeed[0].time>5)lootFeed.shift();
  const feed=$('pickup-feed');
  feed.innerHTML=[...lootFeed].reverse().map(e=>{const art=dropImage(e.kind==='autosell'?'loot':e.kind,e.item);return `<div class="pickup-notice ${e.item?.rarity||e.kind}" data-pickup="${esc(e.kind)}">${art?`<img src="${art.src}" alt="">`:''}<span>${esc(e.text)}${e.value&&e.kind==='autosell'?` <b>+${e.value} gold</b>`:''}</span></div>`;}).join('');
}
const spriteLoads = new Map();
const spriteSizes = new Map(),
  spriteUsage = new Map();
let spriteBytes = 0;
function trimSprites(current) {
  while (spriteBytes > (mobileClient?64:192) * 1024 * 1024 && spriteSizes.size > 1) {
    const oldest = [...spriteUsage]
      .filter(([src]) => src !== current && spriteSizes.has(src))
      .sort((a, b) => a[1] - b[1])[0]?.[0];
    if (!oldest) break;
    spriteBytes -= spriteSizes.get(oldest);
    spriteSizes.delete(oldest);
    spriteUsage.delete(oldest);
    spriteLoads.delete(oldest);
    for (const key of Object.keys(images))
      if (
        key.startsWith("body-") &&
        manifest.animations?.[key.slice(5)]?.src === oldest
      )
        delete images[key];
  }
}
async function loadSprite(body) {
  const def = manifest.animations?.[String(body)];
  if (!def) return null;
  spriteUsage.set(def.src, performance.now());
  if (images["body-" + body]) return images["body-" + body];
  if (!spriteLoads.has(def.src)) {
    const img = new Image();
    img.src = "./" + def.src;
    spriteLoads.set(
      def.src,
      trackAsset('Creature artwork',()=>img.decode())
        .then(() => img)
        .catch(() => null),
    );
  }
  const img = await spriteLoads.get(def.src);
  if (img) {
    images["body-" + body] = img;
    if (!spriteSizes.has(def.src)) {
      const bytes = img.width * img.height * 4;
      spriteSizes.set(def.src, bytes);
      spriteBytes += bytes;
    }
    spriteUsage.set(def.src, performance.now());
    trimSprites(def.src);
  }
  return img;
}
const warmBodies = [
  400,
  401,
  ...catalog.monsters
    .filter((m) => (m.adaptation?.tier ?? 1) <= 1)
    .flatMap((m) => m.bodyIds || [m.body]),
];
const initialBodies=[...new Set(warmBodies)].slice(0,48);
assetLoading.begin('Loading character artwork',initialBodies.length);
await Promise.all(initialBodies.map(async body=>{await loadSprite(body);assetLoading.advance();}));
// Every discovered creature remains reachable, including explicitly reported art gaps.
const runtimeCatalog = catalog;
const hueFrames = new Map();
let hueFrameBytes = 0;
function tintedFrame(def, im, frame, direction, hue, partialHue) {
  hue = hue || def.defaultHue || 0;
  const { id, partial, spectral } = hueIdentity(hue, partialHue),
    palette = huePalettes[String(id)];
  if ((!id || !palette) && !spectral) return null;
  const key = [
    def.src,
    frame,
    direction,
    id,
    Number(partial),
    Number(spectral),
  ].join(":");
  if (hueFrames.has(key)) {
    const value = hueFrames.get(key);
    hueFrames.delete(key);
    hueFrames.set(key, value);
    return value;
  }
  const c = document.createElement("canvas");
  c.width = def.cellWidth;
  c.height = def.cellHeight;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(
    im,
    frame * c.width,
    direction * c.height,
    c.width,
    c.height,
    0,
    0,
    c.width,
    c.height,
  );
  const pixels = g.getImageData(0, 0, c.width, c.height);
  if (spectral) applySpectral(pixels.data);
  else applyHue(pixels.data, palette, partial);
  g.putImageData(pixels, 0, 0);
  const bytes = c.width * c.height * 4;
  while (hueFrames.size && hueFrameBytes + bytes > (mobileClient?24:64) * 1024 * 1024) {
    const oldest = hueFrames.keys().next().value;
    const previous = hueFrames.get(oldest);
    hueFrameBytes -= previous.width * previous.height * 4;
    hueFrames.delete(oldest);
  }
  hueFrames.set(key, c);
  hueFrameBytes += bytes;
  return c;
}
let game = null,
  selected = "mage",
  screen = "menu",
  last = performance.now(),
  fxTime = 0,
  view = { w: 1200, h: 700 },
  keys = new Set(),
  touch = { x: 0, y: 0 },
  sound = true,
  lastKills = 0,
  lastLevel = 1,
  messageUntil = 0,
  saveAt = 0;
let campMode=false, profile=freshProgress();
try{const raw=localStorage.getItem('britannia-progress-v1');if(raw)profile=validateProgress(JSON.parse(raw),runtimeCatalog);}catch{}
const campRoot=document.createElement('section');campRoot.id='camp-controls';$('new-game-setup').after(campRoot);
function persistProgress(){try{localStorage.setItem('britannia-progress-v1',JSON.stringify(profile));}catch{announce('Progress could not be saved. Export a backup.');}}
function refreshCamp(){renderCampControls(campRoot,profile,{
  difficulty:id=>{profile.difficulty=id;persistProgress();refreshCamp();},
  inventory:()=>{campMode=true;game=createProgressRun(runtimeCatalog,profile,{archetype:selected,restoreCamp:true});game.pause();inventory();},
  legacy:openLegacy,
  export:exportProgress,
  import:importProgress,
  reset:()=>{
    dialog('<h2>New session?</h2><p>Erase equipment, gold, legacy upgrades, records and the saved run?</p><div class="dialog-actions"><button id="keep-session">Keep progress</button><button id="erase-session">Erase and start fresh</button></div>');
    $('keep-session').onclick=returnCamp;
    $('erase-session').onclick=()=>{profile=freshProgress(profile.difficulty);persistProgress();localStorage.removeItem('britannia-run-v1');returnCamp();};
  },
});}
function returnCamp(){showMenuView('home');if(campMode&&game){profile=bankCamp(profile,game);persistProgress();}campMode=false;game=null;screen='menu';overlay(true);$('menu').classList.remove('hidden');for(const id of ['hud','top-hud','bottom-hud','minimap'])$(id).classList.add('hidden');$('continue').classList.toggle('hidden',!localStorage.getItem('britannia-run-v1'));refreshCamp();soundtrack.setScene('menu');}
function openLegacy(){screen='legacy';dialog('');renderLegacy($('dialog'),profile,{onBuy:id=>{if(buyLegacy(profile,id)){persistProgress();openLegacy();}},onClose:returnCamp});}
function exportProgress(){save();const run=localStorage.getItem('britannia-run-v1');const blob=new Blob([JSON.stringify({format:'britannia-survivors',version:1,profile,run:run?JSON.parse(run):null},null,2)],{type:'application/json'});const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download='Britannia-Survivors-save.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function importProgress(){const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.onchange=async()=>{try{const file=input.files[0];if(!file||file.size>16*1024*1024)throw Error('Save file is too large');const data=JSON.parse(await trackAsset('Save data',()=>file.text()));if(data.format!=='britannia-survivors'||data.version!==1)throw Error('Unsupported save file');const next=validateProgress(data.profile,runtimeCatalog);if(data.run){if(!paths.some(p=>p.id===data.run.archetype))throw Error('Invalid character');Game.restore(runtimeCatalog,data.run.state);}profile=next;persistProgress();if(data.run)localStorage.setItem('britannia-run-v1',JSON.stringify(data.run));else localStorage.removeItem('britannia-run-v1');campMode=false;returnCamp();announce('Progress imported.');}catch(error){announce('Import failed: '+error.message);}};input.click();}
const paths = [
  {
    id: "warrior",
    name: "Warrior",
    icon: "class-warrior",
    description: "Steel & resolve",
    detail: "20% physical / 5% magic",
  },
  {
    id: "mage",
    name: "Magician",
    icon: "class-mage",
    description: "Words of power",
    detail: "Fireball wand / 20% magic / 5% physical",
  },
  {
    id: "archer",
    name: "Ranger",
    icon: "class-ranger",
    description: "A steady hand",
    detail: "Swift bow / 12% physical and magic",
  },
];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function asset(...names) {
  for (const n of names) if (images[n]) return images[n];
  return null;
}
function renderClasses() {
  $("classes").innerHTML = paths
    .map(
      (p) =>
        `<button class="class-card ${selected === p.id ? "selected" : ""}" data-class="${p.id}"><span class="class-icon">${asset(p.icon) ? `<img src="${asset(p.icon).src}" alt="">` : ""}</span><strong>${p.name}</strong><small>${p.description}<br>${p.detail}</small></button>`,
    )
    .join("");
  document.querySelectorAll("[data-class]").forEach(
    (b) =>
      (b.onclick = () => {
        selected = b.dataset.class;
        renderClasses();
      }),
  );
}
renderClasses();
refreshCamp();
function showMenuView(view='home') {
  $('menu').dataset.view=view;
  $('home-actions').classList.toggle('hidden',view!=='home');
  $('new-game-setup').classList.toggle('hidden',view!=='setup');
  campRoot.classList.toggle('hidden',view!=='camp');
  $('menu-back-home').classList.toggle('hidden',view!=='camp');
  $('menu').scrollTop=0;
  try{const saved=JSON.parse(localStorage.getItem('britannia-run-v1'));$('saved-summary').textContent=saved?`${paths.find(p=>p.id===saved.archetype)?.name||'Adventurer'} / ${saved.state.zoneRun?'Area '+(saved.state.zoneRun.index+1)+' / '+saved.state.areaRoute.length:'Level '+saved.state.player.level}`:'';}catch{$('saved-summary').textContent='';}
}
const menuBack=document.createElement('button');menuBack.id='menu-back-home';menuBack.textContent='Back';campRoot.after(menuBack);
$('new-game').onclick=()=>showMenuView('setup');
$('menu-back').onclick=()=>showMenuView('home');
menuBack.onclick=()=>showMenuView('home');
$('camp-button').onclick=()=>showMenuView('camp');
$('options-button').onclick=()=>openOptions(false);
$('exit-button').onclick=()=>{save();window.close();};
showMenuView();
function openOptions(inRun=!!game&&!campMode){
  if(game?.status==='playing')game.pause();
  screen='options';
  dialog(`<h2>Options</h2><label class="volume-control" for="option-volume"><span>Volume <output id="option-volume-value" for="option-volume">${Math.round(soundtrack.volume*100)}%</output></span><input id="option-volume" type="range" min="0" max="100" step="1" value="${Math.round(soundtrack.volume*100)}" aria-label="Sound volume"></label><div class="options-actions"><button id="option-sound">Sound: ${sound?'On':'Off'}</button><button id="option-hud-lock">HUD: ${movableHud.locked?'Locked':'Draggable'}</button><button id="option-hud-reset">Reset HUD</button><button id="option-export">Export save</button><button id="option-import">Import save</button><button id="option-reset">Reset progress</button></div><div class="dialog-actions"><button id="options-back">Back</button></div>`);
  $('option-volume').oninput=e=>{soundtrack.setVolume(Number(e.target.value)/100);$('option-volume-value').textContent=Math.round(soundtrack.volume*100)+'%';try{localStorage.setItem('britannia-volume',String(soundtrack.volume));}catch{}};
  $('option-sound').onclick=()=>{$('sound').click();$('option-sound').textContent='Sound: '+(sound?'On':'Off');};
  $('option-hud-lock').onclick=()=>{movableHud.setLocked(!movableHud.locked);$('option-hud-lock').textContent='HUD: '+(movableHud.locked?'Locked':'Draggable');};
  $('option-hud-reset').onclick=()=>movableHud.reset();
  $('option-export').onclick=exportProgress;$('option-import').onclick=importProgress;
  $('option-reset').onclick=()=>{save();mainMenu();campRoot.querySelector('[data-camp="reset"]').click();};
  if(touchDevice()||forceMobile){const button=document.createElement('button');button.id='option-zoom';button.textContent='World zoom: '+Math.round(mobileZoom*100)+'%';button.onclick=()=>{mobileZoom=mobileZoom===1?1.5:mobileZoom===1.5?2:1;localStorage.setItem('britannia-mobile-zoom',String(mobileZoom));resize();button.textContent='World zoom: '+Math.round(mobileZoom*100)+'%';};$('dialog').querySelector('.options-actions').append(button);}
  $('options-back').onclick=()=>{if(inRun){resume();pause();}else returnCamp();};
}
function resize() {
  const policy=mobilePresentation({width:innerWidth,height:innerHeight,touch:touchDevice(),forced:forceMobile,dpr:devicePixelRatio,zoom:mobileZoom});
  document.body.classList.toggle('mobile-layout',policy.portrait);
  document.body.classList.toggle('touch-device',policy.mobile);
  document.body.dataset.worldZoom=String(policy.zoom);worldZoom=policy.zoom;
  const r = canvas.getBoundingClientRect();
  view = { w: r.width/worldZoom, h: r.height/worldZoom };
  const dpr = policy.dpr;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr*worldZoom, 0, 0, dpr*worldZoom, 0, 0);
  ctx.imageSmoothingEnabled=!policy.mobile;
  movableHud.refresh();
  game?.setViewport?.(view.w, view.h);
  if (screen === "bestiary") {
    document.querySelectorAll("[data-portrait]").forEach((c) => {
      const monster = catalog.monsters.find((m) => m.id === c.dataset.portrait);
      if (monster)
        paintPortrait(c, monster, bestiaryVariants.get(monster.id) || 0);
    });
  }
}
new ResizeObserver(resize).observe(canvas);
function announce(text) {
  const inRun=!$("hud").classList.contains("hidden");
  $("message").textContent = inRun?text:"";
  $("menu-message").textContent = inRun?"":text;
  messageUntil = fxTime + 4;
}
function overlay(visible) {
  clearEquipmentWindow();
  document.body.classList.toggle('menu-scene',!game||campMode);
  if(visible)soundtrack.setScene('paused');
  if(visible) { navigation.cancel(); release(); }
  $("dialog").classList.remove("equipment-window");
  $("overlay").classList.toggle("hidden", !visible);
  $("menu").classList.add("hidden");
  $("dialog").classList.add("hidden");
}
async function start({saved=null,seed}={}) {
  if(mapLoading)return;
  mapLoading=true;$('start').disabled=true;$('continue').disabled=true;
  pendingChestId=null;lastChestTap=null;
  const previousGame=game;
  try {
  assetLoading.begin(saved?'Loading saved journey':'Preparing new journey');
  await paintLoadingScreen();
  campMode=false;
  zoneShopDismissed='';
  game=saved?Game.restore(runtimeCatalog,saved.state):createProgressRun(runtimeCatalog,profile,{archetype:selected,seed});
  const status=game.status;game.status='paused';
  announce('Preparing the journey…');
  await attachMap(!saved,saved?.map);
  game.status=status==='paused'?'playing':status;
  if(!saved){profile.stash=null;persistProgress();}
  soundtrack.setScene('playing');
  assetLoading.begin('Loading equipment artwork');
  await worldAppearance.warm(game);
  lootFeed.length=0;
  screen = "game";
  navigation.cancel();
  overlay(false);
  for (const id of ["hud", "top-hud", "bottom-hud", "minimap"])
    $(id).classList.remove("hidden");
  $("hero-title").textContent =
    paths.find((p) => p.id === selected)?.name.toUpperCase() || "ADVENTURER";
  const heroIcon = asset("class-" + selected);
  $("hero-icon").innerHTML = heroIcon ? `<img src="${heroIcon.src}" alt="">` : "";
  lastKills = 0;
  lastLevel = 1;
  saveAt = 0;
  announce(document.body.classList.contains('touch-device')?'Tap to move / Hold to steer / Release to stop':"The wilds stir. Survive until the final guardian falls.");
  hud();
  if(!showSuperUpgrade()&&saved&&game.status==='levelup')levelup();
  }catch(error){game=previousGame;announce('The journey could not be loaded: '+error.message);console.error(error);}
  finally{assetLoading.hide();mapLoading=false;$('start').disabled=false;$('continue').disabled=false;}
}
$("start").onclick = start;
const AUTOSAVE_SECONDS=2;let lastAutosave=-Infinity;
function save() {
  if(campMode&&game){profile=bankCamp(profile,game);persistProgress();return;}
  if (mapLoading || !game || ["dead", "victory"].includes(game.status)) return;
  try {
    localStorage.setItem(
      "britannia-run-v1",
      JSON.stringify({ archetype: selected, state: game.snapshot(), map:mapRegions.snapshot() }),
    );
    $("footer-status").textContent = "CHRONICLE SAVED LOCALLY";
  } catch {
    $("footer-status").textContent = "LOCAL SAVE UNAVAILABLE";
  }
}
try {
  if (localStorage.getItem("britannia-run-v1"))
    $("continue").classList.remove("hidden");
} catch {}
$("continue").onclick = async () => {
  try {
    const data = JSON.parse(localStorage.getItem("britannia-run-v1"));
    selected = data.archetype;
    await start({saved:data});
    announce("Your chronicle continues.");
  } catch (e) {
    announce("Saved chronicle could not be loaded.");
    console.error(e);
  }
};
window.addEventListener("pagehide", save);
function dialog(html) {
  hideSpellDetails();
  overlay(true);
  $("dialog").classList.remove("hidden");
  $("dialog").innerHTML = html;
}
function resume() {
  if(campMode){returnCamp();return;}
  if(showSuperUpgrade())return;
  if(game?.zoneRun?.phase==='spellshop'){zoneSpellShop();return;}
  soundtrack.setScene('playing');
  if (game?.status === "paused") game.pause();
  screen = "game";
  overlay(false);
  keys.clear();
}
function pause() {
  if (!game || ["dead", "victory", "levelup"].includes(game.status)) return;
  if (screen !== "game") {
    resume();
    return;
  }
  game.pause();
  screen = "pause";
  soundtrack.setScene('paused');
  save();
  dialog(
    '<div class="eyebrow">A MOMENT OF RESPITE</div><h2>Chronicle paused</h2><p>Your run has been saved on this device. Return to the wilds when you are ready.</p><div class="dialog-actions"><button id="resume" class="primary">Return to the wilds</button><button id="new-run">New chronicle</button></div>',
  );
  $("resume").onclick = resume;
  $('dialog').querySelector('h2').textContent='Paused';
  $('resume').textContent='Resume';$('new-run').textContent='Main Menu';
  const extras=document.createElement('div');extras.className='dialog-actions';extras.innerHTML='<button id="pause-stats">Stats</button><button id="pause-bestiary">Bestiary</button><button id="pause-options">Options</button>';$('dialog').append(extras);
  $('pause-stats').onclick=openStats;
  $('pause-bestiary').onclick=bestiary;$('pause-options').onclick=()=>openOptions(true);
  $("new-run").onclick = mainMenu;
}
$("pause").onclick = pause;
const statTable=rows=>`<table class="build-stat-table"><tbody>${rows.map(([label,value])=>`<tr><th scope="row">${esc(label)}</th><td>${esc(value)}</td></tr>`).join('')}</tbody></table>`;
function spellDetailsHTML(id){
 const detail=spellBreakdown(game,id);if(!detail)return '';
 return `<h3>${esc(detail.name)}</h3><table class="build-stat-table"><thead><tr><th>Stat</th><th>Base</th><th>Current</th></tr></thead><tbody>${detail.rows.map(row=>`<tr><th scope="row">${esc(row.label)}</th><td>${esc(row.base)}</td><td>${esc(row.current)}</td></tr>`).join('')}</tbody></table><ul class="stat-sources">${detail.sources.map(line=>`<li>${esc(line)}</li>`).join('')}</ul><p class="fine">${detail.lines.map(esc).join('<br>')}</p><small>Damage is before enemy resistance. Base includes your class damage bonus; excludes equipment, passives, shared upgrades and active buffs.</small>`;
}
function openStats(){
 if(!game||!['playing','paused'].includes(game.status)||!['game','pause','zone-spells'].includes(screen))return;
 const previous=screen;if(game.status==='playing')game.pause();
 keys.clear();navigation.cancel();screen='stats';soundtrack.setScene('paused');
 const stats=currentStats(game);
 dialog(`<div class="stats-heading"><h2>Current stats</h2><button id="stats-back">Back</button></div><div class="build-stats"><section><h3>Character</h3>${statTable(stats.rows)}<h3>Resistance</h3>${stats.resistance.map(r=>`<p><strong>${r.channel==='Elemental'?'Elemental / magical':r.channel}: ${statNumber(r.effective)}%</strong><br>Class base ${statNumber(r.base)}% × (1 + item bonus ${statNumber(r.items)}% + passive ${statNumber(r.passive)}% + wards ${statNumber(r.wards)}%) + ${statNumber(r.flat)} flat item points.</p>`).join('')}<p class="fine">Incoming damage = (hit − flat armor) × (1 − resistance). Total resistance caps at 70%; minimum hit is 1 HP before shields. Elemental covers fire, cold, poison and energy. Original four elemental item resistances contribute their average.</p></section><section><h3>Passives</h3>${statTable(stats.passives)}<h3>Shared spell upgrades</h3>${statTable(stats.globals)}<details><summary>All equipment bonuses</summary>${statTable(stats.equipment)}</details></section></div><h3>Spells</h3><p class="fine">Open a spell to inspect its base values and every bonus source.</p><div class="build-spells">${[...game.spellLoadout,...(game.weaponSpell?[{...game.weaponSpell,id:"weapon:"+game.weaponSpell.id}]:[])].map(s=>`<details class="aos-properties"><summary>${esc((s.weaponGranted?'Weapon / ':'')+(SPELLS.find(d=>d.id===s.id.replace(/^weapon:/,''))?.name||s.id))}</summary>${spellDetailsHTML(s.id)}</details>`).join('')||'<p>No learned spells yet.</p>'}</div>`);
 $('stats-back').onclick=()=>{resume();if(previous==='pause')pause();};
}
$('stats-button').onclick=openStats;
let spellDetailAnchor=null,spellDetailTimer;
const spellDetails=document.createElement('div');spellDetails.id='spell-details';spellDetails.className='aos-properties hidden';spellDetails.setAttribute('role','tooltip');document.body.append(spellDetails);
function hideSpellDetails(){clearTimeout(spellDetailTimer);spellDetails.classList.add('hidden');spellDetailAnchor?.removeAttribute('aria-describedby');spellDetailAnchor=null;}
function showSpellDetails(anchor){
 if(screen!=='game'||!spellBreakdown(game,anchor.dataset.skill)){hideSpellDetails();return;}
 clearTimeout(spellDetailTimer);spellDetailAnchor?.removeAttribute('aria-describedby');spellDetailAnchor=anchor;anchor.setAttribute('aria-describedby','spell-details');
 spellDetails.innerHTML=`<button class="spell-details-close" aria-label="Close spell details">Close</button>${spellDetailsHTML(anchor.dataset.skill)}`;
 spellDetails.querySelector('button').onclick=hideSpellDetails;spellDetails.classList.remove('hidden');
 const r=anchor.getBoundingClientRect(),w=spellDetails.offsetWidth,h=spellDetails.offsetHeight;
 spellDetails.style.left=Math.max(8,Math.min(innerWidth-w-8,r.left))+'px';
 spellDetails.style.top=Math.max(8,r.top-h-8>=8?r.top-h-8:Math.min(innerHeight-h-8,r.bottom+8))+'px';
}
const deferSpellHide=()=>{clearTimeout(spellDetailTimer);spellDetailTimer=setTimeout(hideSpellDetails,180);};
$('skills').addEventListener('pointerover',e=>{const anchor=e.target.closest('[data-skill]');if(anchor&&anchor!==spellDetailAnchor&&e.pointerType!=='touch')showSpellDetails(anchor);});
$('skills').addEventListener('pointerout',e=>{if(!e.relatedTarget?.closest?.('[data-skill]'))deferSpellHide();});
$('skills').addEventListener('focusin',e=>{const anchor=e.target.closest('[data-skill]');if(anchor)showSpellDetails(anchor);});
$('skills').addEventListener('focusout',deferSpellHide);
$('skills').addEventListener('click',e=>{const anchor=e.target.closest('[data-skill]');if(anchor)showSpellDetails(anchor);});
spellDetails.addEventListener('pointerenter',()=>clearTimeout(spellDetailTimer));spellDetails.addEventListener('pointerleave',deferSpellHide);
window.addEventListener('resize',hideSpellDetails);
function mainMenu() {
  save();
  soundtrack.setScene('menu');refreshCamp();
  game = null;
  screen = "menu";
  overlay(true);
  $("menu").classList.remove("hidden");
  showMenuView();
  for (const id of ["hud", "top-hud", "bottom-hud", "minimap"])
    $(id).classList.add("hidden");
  try {
    $("continue").classList.toggle(
      "hidden",
      !localStorage.getItem("britannia-run-v1"),
    );
  } catch {}
}
function spellPreviewHTML(id,rank=1,previousRank=0){
  return `<small class="spell-preview">${spellPreviewLines(game,id,rank,previousRank).map(esc).join('<br>')}</small>`;
}
function chooseUpgrade(index,replaceId=null){
  const choice=game.choices[index];
  if(choice?.requiresReplacement&&!replaceId){
    screen='replacement';
    const options=game.spellLoadout.map(item=>({...SPELLS.find(s=>s.id===item.id),rank:item.rank})).filter(item=>item.category===choice.category);
    dialog(`<h2>Learn ${esc(choice.name)}</h2><p>Replace one ${choice.category==='offense'?'offensive':'defensive'} spell. The replaced spell loses all its improvements and Super Upgrades. The new spell starts fresh; shared upgrades remain.</p>${spellPreviewHTML(choice.spellId,1)}<div class="choices">${options.map(item=>`<article class="choice"><img class="choice-icon" src="${item.icon}" alt=""><strong>${esc(item.name)}</strong><small>Learned spell</small>${spellPreviewHTML(item.id,item.rank)}<button class="choice-action" data-replace="${item.id}">Replace</button></article>`).join('')}</div><div class="dialog-actions"><button id="cancel-replacement">Keep current spells</button></div>`);
    document.querySelectorAll('[data-replace]').forEach(button=>button.onclick=()=>chooseUpgrade(index,button.dataset.replace));
    $('cancel-replacement').onclick=levelup;return;
  }
  if(!game.chooseUpgrade(index,replaceId))return;
  screen='game';overlay(false);soundtrack.setScene('playing');
  if(!showSuperUpgrade('levelup')&&game.status==='levelup')levelup();hud();save();soundtrack.play('ui-click');
}
function levelup() {
  if(showSuperUpgrade('levelup'))return;
  screen='levelup';soundtrack.setScene('paused');
  const choices=game.choices||[],learning=game.learningSpells;
  dialog(`<div class="eyebrow">KNOWLEDGE IS POWER</div><h2>${learning?'Learn a spell':'Your power grows'}</h2><p>Level ${game.player.level} / ${SPELL_CAPACITY.offense} offense and ${SPELL_CAPACITY.defense} defense slots</p>${learning?'<p>Pick one of three new spells. New spell choices arrive every 5 levels. Replacing a spell resets its progress.</p>':'<p>Improve one spell, all related spells, or your hero.</p>'}<div class="choices${learning?' spell-learning':''}">${choices.map((c,i)=>`<article class="choice"><img class="choice-icon" src="${c.icon||passiveIcon(c.id)}" alt="">${upgradeCard(c)}${c.requiresReplacement?'<small>Choose a spell to replace.</small>':''}<button class="choice-action" data-choice="${i}">${learning?'Learn':'Choose'} <kbd>${i+1}</kbd></button></article>`).join('')}</div><div class="dialog-actions"><button id="level-reroll" ${game.player.gold<game.levelRerollPrice?'disabled':''}>Reroll / ${game.levelRerollPrice} gold</button><span>${Math.floor(game.player.gold)} gold</span>${learning?'<button id="skip-spell">Keep current spells</button>':''}</div>`);
  document.querySelectorAll('[data-choice]').forEach(button=>button.onclick=()=>chooseUpgrade(Number(button.dataset.choice)));
  if(learning)$('skip-spell').onclick=()=>{if(game.skipNewSpell()){screen='game';overlay(false);soundtrack.setScene('playing');if(game.status==='levelup')levelup();hud();save();}};
  $('level-reroll').onclick=()=>{if(game.reroll()){levelup();hud();save();soundtrack.play('gold');}};
}
function inventory(refresh=false) {
  if (!game || ["dead", "victory", "levelup"].includes(game.status)) return;
  if (screen === "inventory") {
    resume();
    return;
  }
  if (game.status === "playing") game.pause();
  screen = "inventory";
  dialog("");
  if(!refresh)game.autoEquipInventory?.();game.cleanupInventory?.();
  soundtrack.setScene('paused');
  renderEquipmentWindow({
    root: $("dialog"), game, ui: uiManifest, palettes:huePalettes,
    onChange: () => { inventoryRefresh(); hud(); save(); },
    onClose: resume,
    onBuy:index=>{if(game.buy(index)){inventoryRefresh();hud();save();}},
    onRestock:()=>{if(game.restockShop()){inventoryRefresh();hud();save();}},
  });
  if(!refresh){$('dialog').dataset.inventoryTab='gear';$('dialog').setInventoryTab?.('gear');$('dialog').scrollTop=0;}
}
function inventoryRefresh() {
  const scroll=$('dialog').scrollTop;
  screen = "game";
  inventory(true);
  $('dialog').scrollTop=scroll;
}
let bestiaryQuery = "",
  bestiaryPage = 0;
const bestiaryVariants = new Map();
function appearanceOptions(monster) {
  const bodies = monster.bodyIds?.length ? monster.bodyIds : [monster.body];
  const hues = monster.hueIds?.length ? monster.hueIds : [0];
  const choices = monster.visualVariants?.length
    ? monster.visualVariants.map((v) => ({ ...v }))
    : bodies.flatMap((body) => hues.map((hue) => ({ body, hue })));
  if (monster.adaptation?.paragonEligible) {
    const paragon = catalog.enemyModifiers?.find((m) => m.id === "paragon");
    if (paragon)
      for (const body of bodies)
        choices.push({ body, hue: paragon.hue, label: "Paragon" });
  }
  return choices;
}
async function paintPortrait(canvas, monster, index) {
  const choices = appearanceOptions(monster),
    visual = choices[index % choices.length],
    def = manifest.animations?.[String(visual.body)];
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (!def) {
    g.fillStyle = "#b2b699";
    g.textAlign = "center";
    g.font = "13px UOText";
    g.fillText("Appearance unavailable", 80, 60);
    return;
  }
  const im = await loadSprite(visual.body);
  if (!im || !canvas.isConnected) return;
  const tinted = tintedFrame(def, im, 0, 2, visual.hue, visual.partialHue);
  const scale = Math.min(140 / def.cellWidth, 100 / def.cellHeight),
    w = def.cellWidth * scale,
    h = def.cellHeight * scale;
  if (tinted) g.drawImage(tinted, (160 - w) / 2, 110 - h, w, h);
  else
    g.drawImage(
      im,
      0,
      def.cellHeight * 2,
      def.cellWidth,
      def.cellHeight,
      (160 - w) / 2,
      110 - h,
      w,
      h,
    );
}
function closeBestiary() {
  if (game) resume();
  else mainMenu();
}
function bestiary() {
  if (game && ["levelup", "dead", "victory"].includes(game.status)) return;
  if (screen === "bestiary") {
    closeBestiary();
    return;
  }
  if (game?.status === "playing") game.pause();
  screen = "bestiary";
  renderBestiary();
}
function renderBestiary() {
  const rows = catalog.monsters.filter((m) =>
    (m.name + " " + m.className)
      .toLowerCase()
      .includes(bestiaryQuery.toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(rows.length / 12));
  bestiaryPage = Math.min(bestiaryPage, pages - 1);
  const shown = rows.slice(bestiaryPage * 12, bestiaryPage * 12 + 12);
  dialog(
    `<div class="eyebrow">THE CREATURES OF BRITANNIA</div><h2>Bestiary</h2><p>${catalog.monsters.length} creatures Â· Browse their appearances and Paragon forms.</p><input id="bestiary-search" type="search" placeholder="Find a creatureâ€¦" aria-label="Find a creature" value="${esc(bestiaryQuery)}"><div class="bestiary-grid">${shown
      .map((m) => {
        const options = appearanceOptions(m),
          i = bestiaryVariants.get(m.id) || 0,
          v = options[i % options.length];
        return `<article class="bestiary-card"><canvas width="160" height="120" data-portrait="${esc(m.id)}"></canvas><strong>${esc(m.name)}</strong><small>${m.adaptation?.hp || 0} health Â· ${m.adaptation?.ranged ? "Ranged" : "Melee"}${m.adaptation?.bossOnly ? " Â· Boss" : ""}</small><button data-variant="${esc(m.id)}" ${options.length < 2 ? "disabled" : ""}>${v.label || "Appearance"} ${(i % options.length) + 1} / ${options.length}</button></article>`;
      })
      .join(
        "",
      )}</div><div class="dialog-actions"><button id="bestiary-prev" ${bestiaryPage === 0 ? "disabled" : ""}>Previous</button><span class="bestiary-pagination">${bestiaryPage + 1} / ${pages}</span><button id="bestiary-next" ${bestiaryPage === pages - 1 ? "disabled" : ""}>Next</button><button id="bestiary-close">Return</button></div>`,
  );
  const input = $("bestiary-search");
  input.oninput = () => {
    const position = input.selectionStart;
    bestiaryQuery = input.value;
    bestiaryPage = 0;
    renderBestiary();
    $("bestiary-search").focus();
    try {
      $("bestiary-search").setSelectionRange(position, position);
    } catch {}
  };
  $("bestiary-prev").onclick = () => {
    bestiaryPage--;
    renderBestiary();
  };
  $("bestiary-next").onclick = () => {
    bestiaryPage++;
    renderBestiary();
  };
  $("bestiary-close").onclick = closeBestiary;
  document.querySelectorAll("[data-variant]").forEach(
    (button) =>
      (button.onclick = () => {
        const id = button.dataset.variant;
        bestiaryVariants.set(id, (bestiaryVariants.get(id) || 0) + 1);
        renderBestiary();
      }),
  );
  document.querySelectorAll("[data-portrait]").forEach((c) => {
    const m = shown.find((m) => m.id === c.dataset.portrait);
    paintPortrait(c, m, bestiaryVariants.get(m.id) || 0);
  });
}
$("bestiary-button").onclick = bestiary;
function shop() {
  if(!game||['dead','victory','levelup'].includes(game.status))return;
  if(screen!=='inventory')inventory();
  $('dialog').setInventoryTab?.('shop');
}
$("inventory-button").onclick = inventory;
$("shop-button").onclick = shop;
$("dash-button").onclick=()=>{if(screen==='game')game?.dash();};
document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) {
    if (e.key === "Escape") {
      e.target.blur();
      closeBestiary();
    }
    return;
  }
  if (e.key === "Escape" && screen === "bestiary") {
    closeBestiary();
    return;
  }
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key))
    e.preventDefault();
  keys.add(e.key.toLowerCase());
  if(["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"].includes(e.key.toLowerCase())) navigation.cancel();
  if (e.repeat) return;
  if(e.key==='F11'){e.preventDefault();if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen().catch(()=>{});return;}
  if(screen==='super-upgrade'){e.preventDefault();if(['1','2'].includes(e.key))document.querySelectorAll('[data-super]')[Number(e.key)-1]?.click();return;}
  if(e.key==='Escape'&&screen==='replacement'){levelup();return;}
  if(e.key==='Escape'&&screen==='zone-replacement'){cancelZoneReplacement();return;}
  if(e.key==='Escape'&&screen==='zone-spells'){resume();return;}
  if(e.key==='Escape'&&screen==='inventory'){resume();return;}
  if(e.key==='Escape'&&screen==='options'){$('options-back').click();return;}
  if((e.key==='Escape'||e.key.toLowerCase()==='c')&&screen==='stats'){$('stats-back').click();return;}
  if(e.key.toLowerCase()==='c'&&['game','pause','zone-spells'].includes(screen)){openStats();return;}
  if(e.key==='Escape'&&screen==='menu') {showMenuView();return;}
  if(e.key==='Escape'&&screen==='legacy'){returnCamp();return;}
  if (e.key === "Escape") pause();
  if (e.key.toLowerCase() === "i") inventory();
  if (e.key.toLowerCase() === "b") shop();
  if (e.key === " " && screen === "game") game?.dash?.();
  if(e.key.toLowerCase()==='e'&&screen==='game'&&game?.zoneRun?.phase==='cleared'){e.preventDefault();enterMoongate();}
  if (screen === "levelup" && ["1", "2", "3", "4", "5"].includes(e.key)) {
    chooseUpgrade(Number(e.key)-1);
  }
});
document.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => {
  release();navigation.cancel();keys.clear();
  if (screen === "game" && game?.status === "playing") pause();
});
document.addEventListener('visibilitychange',()=>{if(document.hidden){release();navigation.cancel();if(screen==='game'&&game?.status==='playing')pause();else save();}});
let pointer = null,pendingChestId=null,lastChestTap=null,lastDoubleChestTapAt=-Infinity;
function chestUnderPointer(e){
 if(!game)return null;const r=canvas.getBoundingClientRect(),camera=playerCamera(game.player,view,mapRegions.elevationAt(game.player.x,game.player.y,game.time));
 const point={x:camera.x+(e.clientX-r.left)*view.w/r.width,y:camera.y+(e.clientY-r.top)*view.h/r.height};
 return lootChestAtPoint(game,point,chest=>({x:chest.x,y:chest.y-entityElevation(chest,mapRegions,game.time)*Z_SCALE}));
}
function requestChest(chest){
 if(!chest||game.status!=='playing')return;
 pendingChestId=chest.id;
 if(game.openLootChest(chest.id)){pendingChestId=null;navigation.cancel();}
 else navigation.setDestination({x:chest.x,y:chest.y});
}
function pointDestination(e) {
  if(!game||mapLoading) return;
  const point=cursorWorldPoint(e.clientX,e.clientY,canvas.getBoundingClientRect(),game.player,view,(x,y)=>mapRegions.elevationAt(x,y,game.time));
  if(game.zoneRun?.phase==='cleared'){
    const gate=currentMoongate();
    if(Math.hypot(point.x-gate.x,point.y-gate.y)<48){enterMoongate();return;}
  }
  navigation.setDestination(point);
}
canvas.addEventListener("contextmenu",e=>e.preventDefault());
canvas.addEventListener("pointerdown", e => {
  if(screen!=="game" || ![0,2].includes(e.button))return;
  e.preventDefault();
  if(pointer)return;
  pointer={id:e.pointerId,clientX:e.clientX,clientY:e.clientY,originX:e.clientX,originY:e.clientY,startedAt:performance.now(),touch:e.pointerType==='touch',held:false,steer:e.button===2};
  const chest=e.button===0?chestUnderPointer(e):null;
  if(chest){const now=performance.now();if(lastChestTap?.id===chest.id&&now-lastChestTap.time<450){lastChestTap=null;lastDoubleChestTapAt=now;requestChest(chest);}else{lastChestTap={id:chest.id,time:now};pendingChestId=null;navigation.setDestination({x:chest.x,y:chest.y});}}
  else{lastChestTap=null;pendingChestId=null;pointDestination(e);}
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('dblclick',e=>{if(screen!=='game'||performance.now()-lastDoubleChestTapAt<500)return;const chest=chestUnderPointer(e);if(chest){e.preventDefault();requestChest(chest);}});
canvas.addEventListener("pointermove",e=>{
  if(pointer?.id!==e.pointerId)return;
  pointer.clientX=e.clientX;pointer.clientY=e.clientY;pointDestination(e);
});
function release(e) {if(e&&pointer&&e.pointerId!==pointer.id)return;if(isTouchHold(pointer,performance.now()))navigation.cancel();pointer=null;touch={x:0,y:0};}
canvas.addEventListener("pointerup",release);
canvas.addEventListener("pointercancel",()=>{release();navigation.cancel();});
const stick = $("joystick");
stick.addEventListener("pointerdown", (e) => {
  navigation.cancel();
  pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
  stick.setPointerCapture(e.pointerId);
});
stick.addEventListener("pointermove", (e) => {
  if (pointer?.id !== e.pointerId) return;
  touch = {
    x: Math.max(-1, Math.min(1, (e.clientX - pointer.x) / 35)),
    y: Math.max(-1, Math.min(1, (e.clientY - pointer.y) / 35)),
  };
  stick.firstElementChild.style.transform = `translate(${touch.x * 25}px,${touch.y * 25}px)`;
});
stick.addEventListener("pointerup", () => {
  release();
  stick.firstElementChild.style.transform = "";
});
stick.addEventListener("pointercancel",()=>{release();stick.firstElementChild.style.transform="";});
let skillSignature = "";
try { sound=localStorage.getItem('britannia-sound')!=='off';const volume=localStorage.getItem('britannia-volume');if(volume!==null&&volume.trim()!=='')soundtrack.setVolume(Number(volume)); } catch {}
soundtrack.setEnabled(sound);
$("sound").textContent=sound?'Sound on':'Sound off';
document.addEventListener('pointerdown',e=>{if(sound){soundtrack.unlock().then(()=>{if(e.target.closest('button'))soundtrack.play('ui-click');}).catch(()=>{});}}, {capture:true});
document.addEventListener('keydown',()=>{if(sound)soundtrack.unlock().catch(()=>{});},{capture:true});
$("sound").onclick=()=>{
  sound=!sound;soundtrack.setEnabled(sound);
  $("sound").textContent=sound?'Sound on':'Sound off';
  try{localStorage.setItem('britannia-sound',sound?'on':'off');}catch{}
  if(sound)soundtrack.unlock().then(()=>soundtrack.play('ui-click')).catch(()=>{});
};
const compactCount=new Intl.NumberFormat("en",{notation:"compact",maximumFractionDigits:0});
function hud() {
  if (!game) return;
  const p = game.player;
  $("hero-level").textContent = `Level ${p.level}`;
  $("hp-fill").style.width = `${(100 * Math.max(0, p.hp)) / p.maxHp}%`;
  $("hp-text").textContent = `${Math.ceil(p.hp)} / ${Math.ceil(p.maxHp)}`;
  $("clock").textContent =
    `${String(Math.floor(game.time / 60)).padStart(2, "0")}:${String(Math.floor(game.time % 60)).padStart(2, "0")}`;
  for(const [id,value] of [["kills",game.kills],["gold",Math.floor(p.gold)],["hud-gold",Math.floor(p.gold)]]){const node=$(id);node.textContent=value<10000?value:compactCount.format(value);node.title=value.toLocaleString("en-US");}
  $("xp-label").textContent = `LEVEL ${p.level}`;
  $("xp-text").textContent = `${Math.floor(p.xp)} / ${p.nextXp} EXPERIENCE`;
  $("xp-fill").style.width = `${(100 * p.xp) / p.nextXp}%`;
  $("chapter").textContent =
    game.time < 120
      ? "The awakening"
      : game.time < 300
        ? "The dead gather"
        : game.time < 480
          ? "Words of darkness"
          : "The final reckoning";
  $('zone').querySelector('strong').textContent=mapRegions.regionName(p.x,p.y,game.time);
  $('zone').querySelector('span').textContent=(game.currentArea(mapRegions.areaAt(p.x,p.y,game.time))?.facet||'Felucca').toUpperCase();
  const zoneProgress=game.zoneProgress();
  const zoneAction=$('zone-action');zoneAction.classList.toggle('hidden',!zoneProgress||zoneProgress.phase==='combat');
  if(zoneProgress){
    document.querySelector('.run-clock small').textContent=`AREA ${zoneProgress.index+1} OF ${zoneProgress.total}`;
    $('clock').textContent=zoneProgress.phase==='combat'?(zoneProgress.bossSpawned?'Defeat the guardian':`Guardian in ${Math.floor(Math.ceil(zoneProgress.remaining)/60)}:${String(Math.ceil(zoneProgress.remaining)%60).padStart(2,'0')}`):zoneProgress.phase==='cleared'?`Gate closes in ${Math.ceil(zoneProgress.gateRemaining)}s`:'Area clear';
    $('chapter').textContent=zoneProgress.phase==='spellshop'?'Upgrade, then continue your journey':zoneProgress.phase==='cleared'?'Evacuate! Swarms keep growing stronger':`The horde grows stronger / ${Math.floor((zoneProgress.pressureElapsed||0)/60)}:${String(Math.floor((zoneProgress.pressureElapsed||0)%60)).padStart(2,'0')}`;
    zoneAction.textContent=zoneProgress.phase==='spellshop'?'Spells':`Gate / ${Math.ceil(zoneProgress.gateRemaining)}s / E`;
    const plan=zoneProgress.plan,timeline=$('zone-timeline');timeline.classList.toggle('hidden',zoneProgress.phase!=='combat');
    if(plan){const progress=Math.min(1,(zoneProgress.pressureElapsed||0)/Math.max(1,plan.bossAt));$('zone-time-fill').style.width=(progress*100)+'%';timeline.setAttribute('aria-label',`Area time ${Math.floor(zoneProgress.pressureElapsed||0)} of ${plan.bossAt} seconds`);
      const signature=plan.bossAt+':'+plan.waveEvery;if(timeline.dataset.plan!==signature){timeline.dataset.plan=signature;$('zone-time-events').innerHTML=timelineEvents(plan).map(e=>`<img class="time-event ${e.kind}" style="left:${plan.bossAt?100*e.time/plan.bossAt:100}%" src="assets/classic-ui/abilities/${e.kind==='boss'?'spells/summon-daemon':'spells/summon-creature'}.png" title="${e.kind==='boss'?'Guardian':'Horde'} / ${Math.floor(e.time/60)}:${String(e.time%60).padStart(2,'0')}" alt="${e.kind==='boss'?'Guardian':'Horde'}">`).join('');}
    }

  }else document.querySelector('.run-clock small').textContent='HOLD THE REALM';
  $('dash-button').disabled=p.dashCooldown>0;
  $('shop-button').setAttribute('aria-label',`Trader / ${Math.floor(p.gold).toLocaleString('en-US')} gold`);
  const baseIcon=game.attackKind==='magic'?'spells/magic-arrow':game.attackKind==='arrow'?'skills/archery':'skills/swordsmanship';
  const entries=[{id:'basic',name:game.weapons[0]?.name||'Attack',rank:1+(game.upgrades.multishot||0),icon:'assets/classic-ui/abilities/'+baseIcon+'.png',cooldown:game.attackClock,duration:game.attackInterval,category:'basic'},...spellHud(game),...['nova','chain'].filter(id=>game.upgrades[id]).map(id=>({id,name:id==='nova'?'Meteor Swarm':'Chain Lightning',rank:game.upgrades[id],icon:passiveIcon(id),cooldown:id==='nova'?game.novaClock:game.chainClock,duration:id==='nova'?5:3,category:'legacy'}))];
  entries.sort((a,b)=>Number(a.category==='defense')-Number(b.category==='defense'));
  document.querySelector('.controls').classList.toggle('hidden',game.time>12);
  const nextSignature=entries.map(entry=>entry.id+':'+entry.rank+':'+(entry.upgradeCount||0)+':'+entry.icon).join('|');
  if(nextSignature!==skillSignature){skillSignature=nextSignature;$('skills').innerHTML=entries.map(entry=>`<div class="skill" data-category="${entry.category}" data-skill="${entry.id}" tabindex="0"><img src="${entry.icon}" alt="${esc(entry.name)}" draggable="false"><span class="skill-cooldown"></span><b>${entry.weaponGranted?'W':entry.type==='spell'?(entry.upgradeCount||0)%5+'/5':entry.rank}</b></div>`).join('');movableHud.refresh();}
  for(const entry of entries){const slot=$('skills').querySelector(`[data-skill="${entry.id}"]`);if(!slot)continue;slot.style.setProperty('--cooldown-angle',`${Math.min(1,Math.max(0,entry.cooldown)/(entry.duration||1))*360}deg`);slot.classList.toggle('buff-active',!!entry.active);if(entry.type==='spell'||entry.weaponGranted)slot.removeAttribute('title');else slot.title=`${entry.name}${entry.type==='spell'?' / '+(entry.upgradeCount||0)+' improvements':''}${entry.type==='spell'?' / '+spellPreviewLines(game,entry.id,entry.rank).join(' / '):''}${entry.active?' / Active'+(entry.activeRemaining?' '+entry.activeRemaining.toFixed(1)+'s':''):''}${entry.reflectionCharges?' / '+entry.reflectionCharges+' circles':''}${entry.cooldown>0?' / Cooldown '+entry.cooldown.toFixed(1)+'s':''}`;}
  $('dash-status').textContent=p.dashCooldown>0?'Dash '+p.dashCooldown.toFixed(1)+'s':'Dash ready / Space';
  $('active-buffs').innerHTML=(game.activeBuffs||[]).map(buff=>`<span><img src="${powerupIcon(buff.id)}" alt="">${esc(POWERUPS[buff.id]?.name||buff.id)} ${buff.id==='shield'?Math.ceil(buff.value)+' HP':buff.remaining.toFixed(1)+'s'}</span>`).join('')+spellHud(game).filter(spell=>spell.active&&spell.activeRemaining>0).map(spell=>`<span><img src="${spell.icon}" alt="">${esc(spell.name)} ${spell.activeRemaining.toFixed(1)}s${spell.reflectionCharges?' / '+spell.reflectionCharges+' circles':''}</span>`).join('');

  if (game.kills > lastKills) {
    lastKills = game.kills;
  }
}
function hash(x, y) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
const terrainCache = {};
function terrainTexture(key, patch = false) {
  if (terrainCache[key]) return terrainCache[key];
  const im = asset(key);
  if (!im) return null;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.filter = "saturate(.55) brightness(.7)";
  g.drawImage(im, 0, 0, 256, 256);
  g.filter = "none";
  if (patch) {
    g.globalCompositeOperation = "destination-in";
    const fade = g.createRadialGradient(128, 128, 15, 128, 128, 125);
    fade.addColorStop(0, "#000d");
    fade.addColorStop(0.5, "#0009");
    fade.addColorStop(1, "#0000");
    g.fillStyle = fade;
    g.fillRect(0, 0, 256, 256);
  }
  return (terrainCache[key] = c);
}
function ground(camera) {
  const { w, h } = view;
  if(mapRegions.drawGround(ctx,camera,w,h,game?.time||0))return;
  ctx.fillStyle = "#34432b";
  ctx.fillRect(0, 0, w, h);
  const tile = 192,
    ox = ((camera.x % tile) + tile) % tile,
    oy = ((camera.y % tile) + tile) % tile;
  const grass = terrainTexture("ground-grass"),
    dirt = terrainTexture("ground-dirt", true);
  for (let x = -tile; x < w + tile; x += tile)
    for (let y = -tile; y < h + tile; y += tile) {
      const wx = Math.floor((x + camera.x) / tile),
        wy = Math.floor((y + camera.y) / tile),
        n = hash(wx, wy);
      if (grass) ctx.drawImage(grass, x - ox, y - oy, tile + 1, tile + 1);
      if (dirt && n > 0.55) {
        ctx.globalAlpha = 0.6;
        ctx.drawImage(dirt, x - ox - 30, y - oy - 30, tile * 1.5, tile * 1.5);
        ctx.globalAlpha = 1;
      }
    }
}

function shadow(x, y, r) {
  ctx.fillStyle = "#07110d65";
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
}
function prop(x, y, n) {
  const tree = asset("tree-sprite"),
    rock = asset("rock-sprite");
  shadow(x, y, n > 0.32 ? 28 : 18);
  if (n > 0.32 && tree) {
    const h = 150 + (n - 0.3) * 65;
    ctx.drawImage(tree, x - h * 0.4, y - h, h * 0.8, h);
    return;
  }
  if (n <= 0.32 && rock) {
    ctx.drawImage(rock, x - 22, y - 32, 44, 36);
    return;
  }
  if (n <= 0.32) {
    ctx.fillStyle = "#555f49";
    ctx.beginPath();
    ctx.moveTo(x - 17, y);
    ctx.lineTo(x - 20, y - 12);
    ctx.lineTo(x - 6, y - 24);
    ctx.lineTo(x + 12, y - 20);
    ctx.lineTo(x + 18, y - 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#728063";
    ctx.beginPath();
    ctx.moveTo(x - 20, y - 12);
    ctx.lineTo(x - 6, y - 24);
    ctx.lineTo(x + 7, y - 15);
    ctx.closePath();
    ctx.fill();
    return;
  }
  ctx.strokeStyle = "#494a2d";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - 3, y - 90);
  ctx.stroke();
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = ["#1e3827", "#294631", "#335337", "#3a5939"][i];
    ctx.beginPath();
    ctx.ellipse(
      x + Math.sin(n * 60 + i) * 15,
      y - 55 - i * 19,
      32 - i * 3,
      29,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}
function sprite(
  body,
  x,
  y,
  moving = true,
  scale = 1,
  dx = 0,
  dy = 1,
  hue = 0,
  partialHue = false,
) {
  const def = manifest.animations?.[String(body)];
  if (!def) return false;
  const im = images["body-" + body];
  if (!im) {
    loadSprite(body);
    return true;
  }
  spriteUsage.set(def.src, performance.now());
  const fw = def.cellWidth,
    fh = def.cellHeight,
    frames = def.framesPerDirection;
  const fi = moving ? Math.floor(fxTime * 8) % frames : 0;
  const { row: direction, mirror } = actorFacing(dx, dy);
  ctx.save();
  ctx.translate(x, y);
  if (mirror) ctx.scale(-1, 1);
  const tinted = tintedFrame(def, im, fi, direction, hue, partialHue);
  if (tinted)
    ctx.drawImage(
      tinted,
      -def.anchorX * scale,
      -actorAnchorY(def) * scale,
      fw * scale,
      fh * scale,
    );
  else
    ctx.drawImage(
      im,
      fi * fw,
      direction * fh,
      fw,
      fh,
      -def.anchorX * scale,
      -actorAnchorY(def) * scale,
      fw * scale,
      fh * scale,
    );
  ctx.restore();
  return true;
}
function actor(e, camera, player = false) {
  const x = e.x - camera.x,
    y = e.y - camera.y-mapRegions.elevationAt(e.x,e.y,game?.time||0)*Z_SCALE;
  if (x < -120 || y < -150 || x > view.w + 120 || y > view.h + 150) return;
  const r = e.radius || 15;
  shadow(x, y, r);
  if(player){
    ctx.save();if(spellInvisible(game))ctx.globalAlpha=.45;
    worldAppearance.player(game,x,y,!!(keys.size||touch.x||touch.y||navigation.destination),fxTime);
    ctx.restore();
    const barY=y-100,track=abilityImage(uiManifest.images['bar-track'].src),fill=abilityImage(uiManifest.images['bar-health'].src);
    if(track)ctx.drawImage(track,x-23,barY,46,5);if(fill)ctx.drawImage(fill,x-23,barY,46*Math.max(0,e.hp/e.maxHp),5);
    const shield=game.buffs?.shield;if(shield){ctx.fillStyle='#a6d6ff';ctx.fillRect(x-23,barY+6,46*Math.min(1,shield.value/65),2);}
    return;
  }
  const wisp =
    !player &&
    (manifest.animations?.[String(e.body)]?.animationBodyId === 949 ||
      e.body === 58);
  let actorScale = player ? 1 : e.boss ? 1.5 : 1;
  if (wisp) {
    actorScale *= 0.45;
    // The recovered Wisp base refers to a separate 3D particle model.
    // This pulse makes it readable until that original effect is reconstructed.
    const cy = y - 65 * actorScale;
    const radius = (22 + Math.sin(fxTime * 4) * 3) * (e.boss ? 1.5 : 1);
    const glow = ctx.createRadialGradient(x, cy, 0, x, cy, radius);
    glow.addColorStop(0, "#eeffffef");
    glow.addColorStop(0.15, "#b2f1ffc0");
    glow.addColorStop(0.45, "#79dce74a");
    glow.addColorStop(1, "#79dce700");
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = glow;
    ctx.fillRect(x - radius, cy - radius, radius * 2, radius * 2);
    ctx.restore();
  }
  const dressed=isEquipmentBody(e.body);
  if(dressed)worldAppearance.enemy({...e,dx:e.dx??game.player.x-e.x,dy:e.dy??game.player.y-e.y},x,y,e.moving!==false,fxTime);
  if (
    !dressed&&!sprite(
      player ? 400 : e.body,
      x,
      y,
      player ? !!(keys.size || touch.x || touch.y || navigation.destination) : true,
      actorScale,
      player ? game?.lastDirection.x || 0 : game?.player.x - e.x || 0,
      player ? (game?.lastDirection.y ?? 1) : ((game?.player.y ?? e.y + 1) - e.y),
      player ? 0 : e.hue || 0,
      player ? false : Boolean(e.partialHue),
    )
  ) {
    if (player) {
      ctx.fillStyle = "#22312a";
      ctx.beginPath();
      ctx.moveTo(x, y - 35);
      ctx.lineTo(x - 13, y - 3);
      ctx.lineTo(x + 13, y - 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle =
        selected === "mage"
          ? "#99aaa1"
          : selected === "warrior"
            ? "#b0a688"
            : "#759174";
      ctx.beginPath();
      ctx.moveTo(x, y - 31);
      ctx.lineTo(x - 12, y - 8);
      ctx.lineTo(x + 12, y - 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#c6b298";
      ctx.beginPath();
      ctx.arc(x, y - 34, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#9b8150";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 15, y);
      ctx.lineTo(x + 17, y - 43);
      ctx.stroke();
      ctx.fillStyle = "#acdacc";
      ctx.beginPath();
      ctx.arc(x + 17, y - 43, 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = e.color || "#a19c76";
      ctx.beginPath();
      ctx.ellipse(x, y - r * 0.8, r * 0.8, r * 1.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#eee4bc";
      ctx.fillRect(x - 5, y - r * 1.15, 3, 2);
      ctx.fillRect(x + 3, y - r * 1.15, 3, 2);
      ctx.font = "13px UOText";
      ctx.textAlign = "center";
      ctx.fillStyle = "#ded7b5";
      ctx.fillText(e.name, x, y - r * 2.2 - 6);
    }
  }
  if (player) {
    const body=manifest.animations[String(game.player.sex==='female'?401:400)],height=body?(body.cellHeight||90):90;
    const barY=y-Math.min(130,height)-9;
    const track=abilityImage(uiManifest.images['bar-track'].src),fill=abilityImage(uiManifest.images['bar-health'].src);
    if(track)ctx.drawImage(track,x-23,barY,46,5);if(fill)ctx.drawImage(fill,x-23,barY,46*Math.max(0,e.hp/e.maxHp),5);
    const shield=game.buffs?.shield;if(shield){ctx.fillStyle='#a6d6ff';ctx.fillRect(x-23,barY+6,46*Math.min(1,shield.value/65),2);}
    ctx.strokeStyle = "#b0dfb345";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, y + 2, 21, 9, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (e.hp < e.maxHp || e.boss) {
    ctx.fillStyle = "#131c14";
    ctx.fillRect(x - 20, y - r * 2.5 - 8, 40, 4);
    ctx.fillStyle = e.boss ? "#daa360" : "#b4765a";
    ctx.fillRect(x - 20, y - r * 2.5 - 8, 40 * Math.max(0, e.hp / e.maxHp), 4);
    if (e.boss) {
      ctx.fillStyle = "#ebd49f";
      ctx.font = "13px UOText";
      ctx.textAlign = "center";
      ctx.fillText(e.name, x, y - r * 2.5 - 14);
    }
  }
}
function draw() {
  const p = game?.player || { x: 400 + Math.sin(fxTime * 0.03) * 20, y: 400 };
  const camera = playerCamera(p,view,mapRegions.elevationAt(p.x,p.y,game?.time||0));
  ground(camera);
  const objects=mapRegions.decorations(camera,view.w,view.h,game?.time||0,game?.player).map(item=>({y:item.y,draw:()=>item.draw(ctx,camera)}));
  if (game) {
    for(const corpse of game.corpses||[])objects.push({y:actorDepth(corpse,mapRegions,game.time),draw:()=>worldAppearance.corpse(corpse,{x:camera.x,y:camera.y+entityElevation(corpse,mapRegions,game.time)*Z_SCALE})});
    for (const a of game.pickups) {
      if(a.kind!=="xp"){objects.push({y:actorDepth(a,mapRegions,game.time),draw:()=>drawDrop(a,camera)});continue;}
      objects.push({y:actorDepth(a,mapRegions,game.time),draw:()=>{
      const x = a.x - camera.x,
        y = a.y - camera.y-entityElevation(a,mapRegions,game.time)*Z_SCALE;
      ctx.fillStyle =
        a.kind === "xp"
          ? "#91d8c0"
          : a.kind === "gold"
            ? "#ddbd68"
            : a.kind === "heal"
              ? "#d37a71"
              : "#cda2e2";
      ctx.shadowBlur = 10;
      ctx.shadowColor = ctx.fillStyle;
      ctx.beginPath();
      if (a.kind === "xp") {
        ctx.moveTo(x, y - 4);
        ctx.lineTo(x + 3, y);
        ctx.lineTo(x, y + 4);
        ctx.lineTo(x - 3, y);
      } else ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      }});
    }
    const groundEffect=e=>['earthquake','enemy-cast','cast-warning','fire-field','poison-field','paralyze-field','energy-field','wall-of-stone'].includes(e.kind);
    const drawEffect=e=>spellEffects.effect(e,{x:camera.x,y:camera.y+entityElevation(e,mapRegions,game.time)*Z_SCALE},fxTime);
    game.effects.filter(groundEffect).forEach(drawEffect);
    for (const e of game.enemies)
      if(e.hp>0)objects.push({ y: actorDepth(e,mapRegions,game.time), draw: () => {if(!(e.arrival>0)){actor(e, camera);return;}ctx.save();ctx.globalAlpha=Math.max(.15,1-e.arrival/ENEMY_ARRIVAL_SECONDS);actor(e, camera);ctx.restore();} });
    for(const summon of game.spellFields||[])if(summon.summon&&summon.life>0)objects.push({y:actorDepth(summon,mapRegions,game.time),draw:()=>{shadow(summon.x-camera.x,summon.y-camera.y-mapRegions.elevationAt(summon.x,summon.y,game.time)*Z_SCALE,13);sprite(summon.body,summon.x-camera.x,summon.y-camera.y-mapRegions.elevationAt(summon.x,summon.y,game.time)*Z_SCALE,true,1,summon.dx||0,summon.dy||1,summon.hue||0);}});
    if(p.hp>0)objects.push({ y: actorDepth(p,mapRegions,game.time), draw: () => actor(p, camera, true) });
    if(game.zoneRun?.phase==='cleared'&&(game.zoneRun.gateRemaining??30)>0){
      const gate=currentMoongate(),portal=mapManifest.moongate,sequence=portal?.sequence||portal?.frames?.map((_,i)=>i)||[];
      const frame=portal?.frames?.[sequence[Math.floor(fxTime*(portal.fps||8))%sequence.length]],image=mapImages[frame];
      if(image)objects.push({y:gate.y,draw:()=>{
        const x=gate.x-camera.x,y=gate.y-camera.y-mapRegions.elevationAt(gate.x,gate.y,game.time)*Z_SCALE;
        ctx.drawImage(image,x-22,y-image.height+22);
        ctx.font='13px UOText';ctx.textAlign='center';ctx.fillStyle='#b8e7ff';ctx.strokeStyle='#000';ctx.lineWidth=3;
        const next=game.areaRoute[game.zoneRun.index+1],label=(next?'Next: '+next.name:'Return to Britannia')+' / '+Math.ceil(game.zoneRun.gateRemaining??30)+'s / E';ctx.strokeText(label,x,y-image.height+14);ctx.fillText(label,x,y-image.height+14);
      }});
    }
    objects.sort((a, b) => a.y - b.y);
    for (const o of objects) o.draw();
    game.effects.filter(e=>!groundEffect(e)).forEach(drawEffect);
    for (const b of game.projectiles) spellEffects.projectile(b,{x:camera.x,y:camera.y+mapRegions.elevationAt(b.x,b.y,game.time)*Z_SCALE},fxTime);
    const m = $("minimap").getContext("2d");
    nativeMinimap.draw(m,mapRegions,game);
    drawPickupGuidance();
  } else {
    objects.sort((a, b) => a.y - b.y);
    objects.forEach((o) => o.draw());
    // The menu has no active player equipment.
  }
  ctx.fillStyle = "#1a342025";
  ctx.fillRect(0, 0, view.w, view.h);
}
function ending() {
  screen=game.status;const won=game.status==='victory';
  profile=finishProgress(profile,game);persistProgress();refreshCamp();
  try{localStorage.removeItem('britannia-run-v1');}catch{}
  soundtrack.setScene('menu');
  dialog(`<div class="eyebrow">${DIFFICULTIES[game.difficulty]?.name||'Normal'} difficulty</div><h2>${won?'Guardian of Britannia':game.zoneRun?.gateExpired?'Moongate closed':'Return to the moongate'}</h2><p>${won?'Victory! Equipment, gold and legacy are kept for your next journey.':game.zoneRun?.gateExpired?'The moongate closed before you escaped. Your run has ended; your next character starts fresh.':'Death erased equipment, gold and legacy. Your next character starts fresh.'}</p><div class="equipment"><span>${Math.floor(game.time/60)}m ${Math.floor(game.time%60)}s survived</span><span>${game.kills} slain</span><span>Level ${game.player.level}</span><span>${profile.gold} gold banked</span></div><div class="dialog-actions"><button id="again">Begin a new chronicle</button><button id="return-camp">Return to camp</button></div>`);
  $('again').onclick=start;$('return-camp').onclick=returnCamp;
}
const slowFrames=[];
let lastFrameTiming=null,frameTiming=null,phaseTime=0;
function framePhase(name){const now=performance.now();frameTiming[name]=now-phaseTime;phaseTime=now;}
function loop(now) {
  const started=performance.now(),interval=now-last;
  frameTiming={};phaseTime=started;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fxTime += dt;
  if (game && screen === "game" && !mapLoading) {
    mapRegions.update(playerCamera(game.player,view,mapRegions.elevationAt(game.player.x,game.player.y,game.time)),view.w,view.h,game.time,[game.player,...game.enemies.filter(e=>e.hp>0),...game.pickups,...game.corpses,...game.spellFields.filter(f=>f.summon)]);
    framePhase('terrain');
    const manualMovement=touch.x || touch.y || ["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"].some(key=>keys.has(key));
    if(manualMovement){pendingChestId=null;navigation.cancel();}
    if(isTouchHold(pointer,now)){pointer.held=true;pointer.steer=true;}
    if(pointer?.steer && !manualMovement) pointDestination(pointer);
    const pathInput=navigation.steer(game.player,dt);
    const x =
        Number(keys.has("d") || keys.has("arrowright")) -
        Number(keys.has("a") || keys.has("arrowleft")) +
        touch.x + pathInput.x,
      y =
        Number(keys.has("s") || keys.has("arrowdown")) -
        Number(keys.has("w") || keys.has("arrowup")) +
        touch.y + pathInput.y;
    game.setViewport?.(view.w, view.h);
    framePhase('navigation');
    game.update(dt, { x, y });
    // Autosave on active time so pauses and menus do not repeat writes.
    if(game.status==="playing"&&Math.abs(game.time-lastAutosave)>=AUTOSAVE_SECONDS){lastAutosave=game.time;save();}
    if(pendingChestId!==null){
      const chest=game.pickups.find(drop=>drop.id===pendingChestId&&drop.kind==='loot');
      if(!chest)pendingChestId=null;
      else if(game.openLootChest(pendingChestId)){pendingChestId=null;navigation.cancel();}
      else if(!navigation.destination&&game.status==='playing'){pendingChestId=null;announce('Move closer to reach the chest.');}
    }
    framePhase('simulation');
    const stage=mapRegions.stageAt(game.time);
    if(!game.zoneRun&&stage!==activeBiomeStage){
      activeBiomeStage=stage;
      game.notifyLoot({kind:'notice',text:mapManifest.regions[stage].name+' lies ahead'});
    }
    if(game.zoneRun?.phase==='cleared'){const gate=currentMoongate(),distance=Math.hypot(game.player.x-gate.x,game.player.y-gate.y);if(distance>64)game.zoneRun.gateArmed=true;if(game.zoneRun.gateArmed&&distance<32)enterMoongate();}
    if(game.pendingSpellSupers?.length)showSuperUpgrade();
    else if (game.status === "levelup") levelup();
    else if (["dead", "victory"].includes(game.status)) ending();
    else if(game.zoneRun?.phase==='spellshop'&&zoneShopDismissed!==zoneShopKey())zoneSpellShop();
    framePhase('events');
    if (fxTime > saveAt) {
      saveAt = fxTime + 10;
      save();
    }
    framePhase('save');
    hud();
    framePhase('hud');
  }
  if(game){for(const cue of game.drainAudioEvents()) soundtrack.play(cue.role,cue,game.player);for(const e of game.drainLootEvents()){if(e.kind==='xp')continue;const recent=e.kind==='autosell'&&lootFeed.findLast(n=>n.kind==='autosell'&&fxTime-n.time<2);if(recent){recent.count=(recent.count||1)+1;recent.value=(recent.value||0)+(e.value||0);recent.text=`Sold ${recent.count} items`;recent.time=fxTime;}else lootFeed.push({...e,time:fxTime});}while(lootFeed.length>5)lootFeed.shift();}
  if(lootFeed.length||$("pickup-feed").childElementCount)renderLootFeed();
  const ambientRole=mapRegions.regionName(game?.player.x||0,game?.player.y||0,game?.time||0).includes('desert')||mapRegions.regionName(game?.player.x||0,game?.player.y||0,game?.time||0).includes('snow')?'ambience-wind':'ambience-forest';
  soundtrack.setScene(document.hidden?'hidden':screen==='game'&&game?.status==='playing'?'playing':'menu',ambientRole);
  if (fxTime > messageUntil) {$("message").textContent = "";$("menu-message").textContent = "";}
  framePhase('audio');
  draw();
  framePhase('render');
  const cpuMs=performance.now()-started;
  lastFrameTiming={intervalMs:interval,cpuMs,phases:frameTiming};
  if(game&&screen==='game'&&(cpuMs>80||interval>150)){
    slowFrames.push({...lastFrameTiming,gameTime:game.time,enemies:game.enemies.length,projectiles:game.projectiles.length,pickups:game.pickups.length,corpses:game.corpses.length,ground:mapRegions.performanceStats,spriteBytes});
    if(slowFrames.length>60)slowFrames.shift();
  }
  requestAnimationFrame(loop);
}
// A deliberately small local inspection surface for runtime smoke checks.
window.britannia = {
  get viewport(){return {...view,zoom:worldZoom,mobile:document.body.classList.contains('mobile-layout')};},
  get performance(){return {lastFrame:lastFrameTiming,slowFrames:[...slowFrames]};},
  audio: soundtrack,
  spellEffects,
  worldAppearance,
  get mapRegions(){return mapRegions;},
  get mapManifest(){return mapManifest;},
  get nativeMinimap(){return nativeMinimap;},
  uiManifest,
  navigation,
  loadSprite,
  get huePalettes() {
    return huePalettes;
  },
  get hueFrameCount() {
    return hueFrames.size;
  },
  get spriteCacheBytes() {
    return spriteBytes;
  },
  get runtimeCatalog() {
    return runtimeCatalog;
  },
  get game() {
    return game;
  },
  get manifest() {
    return manifest;
  },
  start,
  inventory,
  shop,
  zoneSpellShop,
  enterMoongate,
  pause,
  bestiary,
  returnCamp,
  exportProgress,
  importProgress,
  get profile(){return profile;},
};
resize();
requestAnimationFrame(loop);
assetLoading.hide();
