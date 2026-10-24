import {createReadStream} from 'node:fs';
import {open,stat,copyFile,rename,unlink,mkdir,readdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const RELEASE_PART_BYTES=1900*1024*1024;
export async function hashFile(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
export function releaseNames(platform){
 if(platform==='win')return ['Britannia-Survivors-win-x64.zip'];
 if(platform==='linux')return ['Britannia-Survivors-linux-x64.AppImage','Britannia-Survivors-linux-x64.tar.gz'];
 throw Error('Release platform must be win or linux.');
}
export async function splitReleaseFile(source,output,maxBytes=RELEASE_PART_BYTES,move=false){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error('Invalid release part size.');
 const name=path.basename(source);if(!/^[A-Za-z0-9._-]+$/.test(name))throw Error('Unsafe artifact name.');
 const size=(await stat(source)).size;if(!size)throw Error('Empty release artifact: '+name);
 if(size<=maxBytes){const sha256=await hashFile(source);if(move)await rename(source,path.join(output,name));else await copyFile(source,path.join(output,name));return {name,bytes:size,sha256,parts:[{name,bytes:size,sha256}]};}
 const parts=[],whole=createHash('sha256');let file,hash,count=0,partName;
 async function close(){if(!file)return;await file.close();parts.push({name:partName,bytes:count,sha256:hash.digest('hex')});file=null;}
 try{
  for await(const chunk of createReadStream(source,{highWaterMark:4*1024*1024})){
   whole.update(chunk);let offset=0;
   while(offset<chunk.length){
    if(!file){partName=name+'.part'+String(parts.length+1).padStart(3,'0');file=await open(path.join(output,partName),'wx');hash=createHash('sha256');count=0;}
    const length=Math.min(maxBytes-count,chunk.length-offset),piece=chunk.subarray(offset,offset+length);
    await file.writeFile(piece);hash.update(piece);count+=length;offset+=length;if(count===maxBytes)await close();
   }
  }
  await close();
 }finally{await file?.close();}
 if(move)await unlink(source);
 return {name,bytes:size,sha256:whole.digest('hex'),parts};
}
export function restoreScript(platform,files){
 const split=files.filter(file=>file.parts.length>1);
 if(platform==='win')return '@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\n'+split.map(file=>`if exist "${file.name}" (\r\n echo ${file.name} already exists. Move it aside before reassembling.\r\n exit /b 1\r\n)\r\ncopy /b ${file.parts.map(p=>'"'+p.name+'"').join('+')} "${file.name}" >nul\r\nif errorlevel 1 exit /b 1\r\npowershell -NoProfile -Command "if ((Get-FileHash -LiteralPath '${file.name}' -Algorithm SHA256).Hash -ne '${file.sha256}') { throw 'Checksum mismatch' }"\r\nif errorlevel 1 exit /b 1\r\n`).join('')+'echo Reassembly verified.\r\npause\r\n';
 return '#!/bin/sh\nset -eu\ncd -- "$(dirname -- "$0")"\nrestored=0\n'+split.map(file=>`if [ -f '${file.parts[0].name}' ]; then
test ! -e '${file.name}' || { echo '${file.name} already exists; move it aside first.'; exit 1; }
cat ${file.parts.map(p=>"'"+p.name+"'").join(' ')} > '${file.name}'
printf '%s\\n' '${file.sha256}  ${file.name}' | sha256sum -c -
${file.name.endsWith('.AppImage')?"chmod +x '"+file.name+"'\n":''}restored=$((restored+1))
fi
`).join('')+"test \"$restored\" -gt 0 || { echo 'No numbered parts found.'; exit 1; }\necho 'Reassembly verified.'\n";
}
export async function collectRelease(platform,root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')){
 const names=releaseNames(platform),output=path.join(root,'release-assets');await mkdir(output,{recursive:true});
 if((await readdir(output)).length)throw Error('release-assets must be empty.');
 const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')),files=[];
 for(const name of names)files.push(await splitReleaseFile(path.join(root,'dist/releases',name),output,RELEASE_PART_BYTES,true));
 await writeFile(path.join(output,`release-manifest-${platform}.json`),JSON.stringify({version:pkg.version,platform,files},null,2)+'\n');
 const split=files.some(f=>f.parts.length>1);
 if(split)await writeFile(path.join(output,platform==='win'?'REASSEMBLE-Windows.cmd':'REASSEMBLE-Linux.sh'),restoreScript(platform,files),{mode:0o755});
 await writeFile(path.join(output,`PLAY-${platform}.txt`),`Britannia Survivors ${pkg.version}\n\n${split?'Download all numbered parts for your chosen format into one folder, plus the matching REASSEMBLE script. Run REASSEMBLE-Windows.cmd on Windows, or sh REASSEMBLE-Linux.sh on Linux. It reconstructs the original binaries and verifies their SHA-256 checksums.\n\n':''}${platform==='win'?'Extract Britannia-Survivors-win-x64.zip, then run BritanniaSurvivors.exe inside the extracted folder.':'Run chmod +x Britannia-Survivors-linux-x64.AppImage, then ./Britannia-Survivors-linux-x64.AppImage. Alternatively extract the tar.gz and run ./britannia-survivors inside it.'}\n\nNo original game resources are bundled. Generate resources locally using the source checkout and ASSET-SETUP.md. Set BRITANNIA_ASSETS_DIR to that checkout's game/assets directory before launch.\n\nUnofficial fan project. Ultima Online and its original assets belong to Electronic Arts Inc. and their respective rights holders. Not affiliated with or endorsed by EA or Broadsword Online Games.\n`);
 console.log(JSON.stringify({platform,files:files.map(f=>({name:f.name,bytes:f.bytes,parts:f.parts.length}))}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))collectRelease(process.argv[2]).catch(error=>{console.error(error.message);process.exitCode=1;});
