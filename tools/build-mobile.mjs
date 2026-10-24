import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {locationManifestForArea} from '../game/route-maps.mjs';
const source=JSON.parse(await readFile(new URL('../game/assets/locations/manifest.json',import.meta.url),'utf8'));
const catalog=JSON.parse(await readFile(new URL('../game/data/areas.json',import.meta.url),'utf8'));
const output=new URL('../game/assets/mobile-locations/',import.meta.url);await mkdir(output,{recursive:true});
const index={formatVersion:1,areas:{}};let bytes=0;
for(const area of catalog.areas){
 const selected=locationManifestForArea(source,{...area,facet:area.facets[0]});
 const text=JSON.stringify(selected),filename=area.id+'.json';
 await writeFile(new URL(filename,output),text);bytes+=Buffer.byteLength(text);index.areas[area.id]={src:'assets/mobile-locations/'+filename,name:area.name};
}
await writeFile(new URL('manifest.json',output),JSON.stringify(index));
console.log(JSON.stringify({areas:Object.keys(index.areas).length,indexBytes:Buffer.byteLength(JSON.stringify(index)),totalAreaBytes:bytes}));
const optimized=spawnSync(process.env.BRITANNIA_ASSET_PYTHON||'python',[fileURLToPath(new URL('./optimize-map-assets.py',import.meta.url))],{stdio:'inherit',windowsHide:true});
if(optimized.error)throw optimized.error;
if(optimized.status!==0)throw Error('Map asset optimization failed');
