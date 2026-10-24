import {readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {releaseNames,RELEASE_PART_BYTES} from './collect-release.mjs';
export async function verifyRelease(folder,version){
 const expected=new Set(),records=new Map(),artifacts=new Map();
 for(const platform of ['win','linux']){
  const manifestName=`release-manifest-${platform}.json`,manifest=JSON.parse(await readFile(path.join(folder,manifestName),'utf8'));
  if(manifest.version!==version||manifest.platform!==platform||JSON.stringify(manifest.files.map(f=>f.name))!==JSON.stringify(releaseNames(platform)))throw Error('Incomplete or mismatched release: '+platform);
  expected.add(manifestName);expected.add(`PLAY-${platform}.txt`);
  let split=false;
  for(const file of manifest.files){
   if(!file.parts.length||!Number.isSafeInteger(file.bytes)||file.parts.reduce((n,p)=>n+p.bytes,0)!==file.bytes||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('Invalid artifact size or checksum');
   artifacts.set(file.name,{hash:createHash('sha256'),sha256:file.sha256});
   split ||= file.parts.length>1;
   for(let i=0;i<file.parts.length;i++){
    const part=file.parts[i],name=file.parts.length===1?file.name:file.name+'.part'+String(i+1).padStart(3,'0');
    if(part.name!==name||!Number.isSafeInteger(part.bytes)||part.bytes<1||part.bytes>RELEASE_PART_BYTES||records.has(name))throw Error('Invalid release part');
    expected.add(name);records.set(name,{...part,artifact:file.name});
   }
  }
  if(split)expected.add(platform==='win'?'REASSEMBLE-Windows.cmd':'REASSEMBLE-Linux.sh');
 }
 const names=(await readdir(folder)).filter(n=>n!=='SHA256SUMS.txt').sort();
 if(names.length!==expected.size||names.some(n=>!expected.has(n)))throw Error('Missing or unexpected release files');
 const sums=[];
 for(const name of names){const hash=createHash('sha256'),part=records.get(name);let size=0;for await(const chunk of createReadStream(path.join(folder,name))){hash.update(chunk);if(part)artifacts.get(part.artifact).hash.update(chunk);size+=chunk.length;}const digest=hash.digest('hex');if(part&&(part.bytes!==size||part.sha256!==digest))throw Error('Corrupt release file: '+name);sums.push(`${digest}  ${name}`);}
 for(const [name,artifact]of artifacts)if(artifact.hash.digest('hex')!==artifact.sha256)throw Error('Corrupt reconstructed artifact: '+name);
 await writeFile(path.join(folder,'SHA256SUMS.txt'),sums.join('\n')+'\n');
 return {version,files:names.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))verifyRelease(path.resolve(process.argv[2]||'release-assets'),process.argv[3]).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
