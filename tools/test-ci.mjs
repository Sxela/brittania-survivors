import {readdir,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const exists=async file=>{try{await access(path.join(root,file));return true;}catch{return false;}};
const assets=!process.argv.includes('--source-only')&&await exists('game/assets/manifest.json');
const assetTests=new Set(['classic-spell-effects.test.mjs','enemy-equipment.test.mjs','ground-cache.test.mjs','hues.test.mjs','location-height.test.mjs','location-map.test.mjs','maps.test.mjs','minimap.test.mjs','mobile.test.mjs','spell-system.test.mjs','timed-zones.test.mjs']);
const files=(await readdir(path.join(root,'tests'))).filter(file=>file.endsWith('.test.mjs')).sort();
const selected=[];
for(const file of files){
 if(!assets&&assetTests.has(file)||file==='spell-system.test.mjs'&&!await exists('runuo/Scripts/Spells/First/MagicArrow.cs')){console.log('Skipping client/server evidence test unavailable in this checkout: '+file);continue;}
 selected.push('tests/'+file);
}
if(!selected.length)throw Error('No gameplay tests found.');
const child=spawn(process.execPath,['--test',...selected],{cwd:root,stdio:'inherit',windowsHide:true});
child.on('error',error=>{console.error(error);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
