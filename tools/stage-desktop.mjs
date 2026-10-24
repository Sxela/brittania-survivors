import {
  cp,
  copyFile,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rename,
  stat,
  link,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {stageRuntime} from './desktop-target.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const outputName = process.argv[2] || `BritanniaSurvivors-${pkg.version}`;
if (!/^[a-zA-Z0-9._-]+$/.test(outputName))
  throw Error("Output name must be a plain folder name");
const destination = path.join(root, "dist", outputName);
try {
  await stat(destination);
  throw Error(
    `Output already exists: ${destination}. Choose a new package version or move the previous build before staging again.`,
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await mkdir(destination, { recursive: true });
const runtime = path.join(root, "node_modules/electron/dist");
const target=await stageRuntime(runtime,destination);
const app = path.join(destination, "resources/app");
await mkdir(app, { recursive: true });
const manifest = JSON.parse(
  await readFile(path.join(root, "game/assets/manifest.json"), "utf8"),
);
const assets = new Set(
  [
    ...Object.values(manifest.images),
    ...Object.values(manifest.animations),
  ].map((a) => "game/" + a.src),
);
function collectActorFiles(value){if(!value||typeof value!=="object")return;if(typeof value.src==='string')assets.add('game/'+value.src);for(const child of Object.values(value))collectActorFiles(child);}
collectActorFiles(manifest.animations);
const uiManifest = JSON.parse(await readFile(path.join(root, "game/assets/ui/manifest.json"), "utf8"));
const uiFiles = new Set(["game/assets/ui/manifest.json", ...Object.values(uiManifest.images).map(a => "game/" + a.src), ...Object.values(uiManifest.fonts).map(a => "game/" + a.src)]);
const effectsManifest=JSON.parse(await readFile(path.join(root,"game/assets/effects/manifest.json"),"utf8"));
const audioManifest=JSON.parse(await readFile(path.join(root,"game/assets/audio/manifest.json"),"utf8"));
const mediaFiles=new Set(["game/assets/effects/manifest.json","game/assets/audio/manifest.json",...Object.values(effectsManifest.images).map(a=>"game/"+a.src),...Object.values(audioManifest.sounds).map(a=>"game/"+a.src)]);
const worldManifest=JSON.parse(await readFile(path.join(root,"game/assets/world-equipment/manifest.json"),"utf8"));
const worldFiles=new Set(["game/assets/world-equipment/manifest.json"]);
function collectWorldFiles(value){if(!value||typeof value!=="object")return;if(typeof value.src==="string")worldFiles.add("game/"+value.src);for(const child of Object.values(value))collectWorldFiles(child);}
collectWorldFiles(worldManifest);
const extraFiles=new Set();
for(const group of ['abilities','maps','classic-minimap','classic-summons','zone-maps','locations','mobile-locations']){
  const filename=`game/assets/${group}/manifest.json`;
  const data=JSON.parse(await readFile(path.join(root,filename),'utf8'));
  extraFiles.add(filename);
  for(const entry of Object.values(data.areas||{}))extraFiles.add('game/'+entry.src);
  for(const entry of Object.values(data.images||data.icons||{}))extraFiles.add('game/'+entry.src);
  function collectExtra(value){if(!value||typeof value!=='object')return;if(typeof value.src==='string')extraFiles.add('game/'+value.src);for(const child of Object.values(value))collectExtra(child);}
  collectExtra(data.animations);
}
const sourceFiles = [
  'game/asset-cache.mjs',
  'game/asset-cache-policy.mjs',
  'game/asset-cache-worker.js',
  'game/asset-loading.mjs',
  'game/loading-screen.mjs',
  "game/index.html",
  "game/style.css",
  "game/assets/menu-background.png",
  "game/app.mjs",
  "game/mobile.mjs",
  "game/actor-placement.mjs",
  "game/world-layers.mjs",
  "game/core.mjs",
  "game/hues.mjs",
  "game/presentation.mjs",
  "game/inventory.mjs",
  "game/item-overlay.mjs",
  "game/navigation.mjs",
  "game/movable-hud.mjs",
  "game/audio.mjs",
  "game/effects.mjs",
  "game/classic-effects.mjs",
  "game/equipment.mjs",
  "game/world-appearance.mjs",
  "game/general-mechanics.mjs",
  "game/reward-rules.mjs",
  "game/monster-stats.mjs",
  "game/enemy-equipment.mjs",
  "game/minimap.mjs",
  "game/spell-system.mjs",
  "game/loot-chests.mjs",
  "game/mining.mjs",
  "game/combat-types.mjs",
  "game/spell-upgrades.mjs",
  "game/spell-preview.mjs",
  "game/spell-levels.mjs",
  "game/build-stats.mjs",
  "game/weapon-traits.mjs",
  "game/monster-behavior.mjs",
  "game/monster-source-data.mjs",
  "game/progression.mjs",
  "game/camp-ui.mjs",
  "game/guidance.mjs",
  "game/pathfinding.mjs",
  "game/map-regions.mjs",
  "game/route-maps.mjs",
  "game/location-map.mjs",
  "game/location-height.mjs",
  "game/zone-run.mjs",
  "game/zone-pacing.mjs",
  "game/choice-draw.mjs",
  "game/zone-progression.mjs",
  "game/area-route.mjs",
  "game/biome-terrain.mjs",
  "game/map-navigation.mjs",
  "game/static-placement.mjs",
  "game/data/catalog.json",
  "game/data/enemy-equipment.json",
  "game/data/areas.json",
  "desktop/main.cjs",
  "tools/serve.mjs",
  "tools/start-mobile.mjs",
  "Start-Survivors-Mobile.cmd",
  ...assets,
  ...uiFiles,
  ...mediaFiles,
  ...worldFiles,
  ...extraFiles,
  ...(manifest.hues?.src ? ["game/" + manifest.hues.src] : []),
];
for (const file of new Set(sourceFiles)) {
  const target = path.resolve(app, file);
  if (!target.startsWith(app + path.sep))
    throw Error("Asset escapes application directory");
  await mkdir(path.dirname(target), { recursive: true });
  // CI assets are immutable for the whole job. Hardlinks avoid keeping another
  // 3 GB copy on hosted runners; local review packages remain independent.
  if(process.env.GITHUB_ACTIONS==='true'&&file.startsWith('game/assets/')){
    try{await link(path.join(root,file),target);continue;}catch(error){if(!['EXDEV','EPERM','EACCES','ENOTSUP'].includes(error.code))throw error;}
  }
  await copyFile(path.join(root, file), target);
}
// Runtime art needs rendering metadata; keep investigation provenance in the workspace.
const clean = {
  formatVersion: manifest.formatVersion,
  images: {},
  animations: {},
  limitations: manifest.limitations,
  hues: manifest.hues
    ? {
        src: manifest.hues.src,
        count: manifest.hues.count,
        samplesPerHue: manifest.hues.samplesPerHue,
      }
    : undefined,
  animationCoverage: manifest.animationCoverage,
};
for (const [key, a] of Object.entries(manifest.images))
  clean.images[key] = { src: a.src, width: a.width, height: a.height };
for (const [key, a] of Object.entries(manifest.animations)) {
  const {
    sourceArchive,
    sourceMember,
    sourceSha256,
    bodyMapping,
    defaultHueEvidence,
    ...render
  } = a;
  clean.animations[key] = render;
}
await writeFile(
  path.join(app, "game/assets/manifest.json"),
  JSON.stringify(clean),
);
await writeFile(
  path.join(app, "package.json"),
  JSON.stringify({
    name: pkg.name,
    version: pkg.version,
    private: true,
    type: "module",
    main: "desktop/main.cjs",
  }),
);
await writeFile(
  path.join(destination, "PLAY.txt"),
  `Launch ${target.executable}${target.platform==='linux'?' (./britannia-survivors from a terminal)':''}. WASD/arrows move; Space dash; I inventory; B trader; Escape pause.\nUnofficial fan project. Ultima Online and its original assets belong to Electronic Arts Inc. and their respective rights holders. Not affiliated with or endorsed by EA or Broadsword Online Games.\n`,
);
const files = [];
async function inventory(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await inventory(file);
    else {
      const bytes = await readFile(file);
      files.push({
        path: path.relative(destination, file).split(path.sep).join("/"),
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
}
await inventory(destination);
files.sort((a, b) => a.path.localeCompare(b.path));
const report = {
  version: pkg.version,
  platform: process.platform,
  arch: process.arch,
  files,
};
await writeFile(
  path.join(destination, "package-audit.json"),
  JSON.stringify(report, null, 2),
);
// Compare every staged application source against its original bytes.
for (const file of sourceFiles) {
  const original = await readFile(path.join(root, file)),
    staged = await readFile(path.join(app, file));
  if (!original.equals(staged)) throw Error(`Staged byte mismatch: ${file}`);
}
const forbidden = files.filter((f) =>
  /runuo|research|node_modules|private-plans|\.cache|extract_client|AGENTS\.md/i.test(
    f.path,
  ),
);
if (forbidden.length) throw Error("Unexpected private files in package");
console.log(
  JSON.stringify({
    destination,
    files: files.length,
    bytes: files.reduce((sum, f) => sum + f.bytes, 0),
    verifiedSources: sourceFiles.length,
  }),
);
