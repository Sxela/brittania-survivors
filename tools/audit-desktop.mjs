import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const folder=path.resolve(process.argv[2]||'dist/BritanniaSurvivors');
const audit=JSON.parse(await readFile(path.join(folder,'package-audit.json'),'utf8'));
const expected=new Map(audit.files.map(f=>[f.path,f]));
const seen=new Set();
async function inspect(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory()){await inspect(file);continue}const relative=path.relative(folder,file).split(path.sep).join('/');if(relative==='package-audit.json')continue;const record=expected.get(relative);if(!record)throw Error(`Unexpected file: ${relative}`);const bytes=await readFile(file);if(bytes.length!==record.bytes||createHash('sha256').update(bytes).digest('hex')!==record.sha256)throw Error(`Byte mismatch: ${relative}`);seen.add(relative)}}
await inspect(folder);
if(seen.size!==expected.size)throw Error('Missing packaged files');
const pkg=JSON.parse(await readFile(path.join(folder,'resources/app/package.json'),'utf8'));
if(pkg.version!==audit.version||pkg.main!=='desktop/main.cjs')throw Error('Application metadata mismatch');
for(const file of expected.keys())if(/runuo|research|node_modules|private-plans|\.cache|AGENTS\.md/i.test(file))throw Error('Private payload in package');
console.log(JSON.stringify({ok:true,version:audit.version,files:seen.size,folder}));
