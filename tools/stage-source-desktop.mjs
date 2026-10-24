// Public desktop releases never bundle original or extracted game resources.
import {cp,mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stageRuntime} from './desktop-target.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const name=process.argv[2];
if(!name||!/^[-\w.]+$/.test(name))throw Error('Supply a plain output folder name.');
const destination=path.join(root,'dist',name);
await mkdir(path.dirname(destination),{recursive:true});
await mkdir(destination,{recursive:false});
const target=await stageRuntime(path.join(root,'node_modules/electron/dist'),destination);
const app=path.join(destination,'resources/app');await mkdir(app,{recursive:true});
for(const name of await readdir(path.join(root,'game'))){
 if(!/\.(?:mjs|js|html|css)$/.test(name))continue;
 await cp(path.join(root,'game',name),path.join(app,'game',name),{recursive:true});
}
await mkdir(path.join(app,'game/data'),{recursive:true});
for(const name of ['catalog.json','areas.json','enemy-equipment.json'])
 await cp(path.join(root,'game/data',name),path.join(app,'game/data',name));
for(const name of ['desktop/main.cjs','tools/serve.mjs']){
 await mkdir(path.dirname(path.join(app,name)),{recursive:true});await cp(path.join(root,name),path.join(app,name));
}
const pkg=JSON.parse(await readFile(path.join(root,'package.json')));
await writeFile(path.join(app,'package.json'),JSON.stringify({name:pkg.name,version:pkg.version,type:'module',main:'desktop/main.cjs'}));
await cp(path.join(root,'docs/asset-setup.md'),path.join(destination,'ASSET-SETUP.md'));
await writeFile(path.join(destination,'PLAY.txt'),`Run ${target.executable}. First generate resources from your own Classic client in the source checkout; see ASSET-SETUP.md. Set BRITANNIA_ASSETS_DIR to that checkout's game/assets folder before launching. No game assets are bundled.\n`);
const files=[];
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
 const file=path.join(dir,entry.name);
 if(entry.isSymbolicLink())throw Error('Links are not permitted in release payloads.');
 if(entry.isDirectory()){await walk(file);continue;}
 const name=path.relative(destination,file).split(path.sep).join('/');
 if(name.startsWith('resources/app/game/assets/')||/\.(png|wav|ttf|uop|mul|idx)$/i.test(name))throw Error('Game resource in source-only desktop payload: '+name);
 const bytes=await readFile(file);files.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}}
await walk(destination);files.sort((a,b)=>a.path.localeCompare(b.path));
await writeFile(path.join(destination,'package-audit.json'),JSON.stringify({version:pkg.version,platform:process.platform,arch:process.arch,mode:'source-only',files},null,2));
console.log(JSON.stringify({destination,mode:'source-only',files:files.length}));
