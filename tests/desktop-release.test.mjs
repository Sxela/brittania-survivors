import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {stageRuntime,desktopTarget} from '../tools/desktop-target.mjs';
import {buildArguments} from '../tools/build-desktop.mjs';
import {splitReleaseFile,releaseNames,hashFile,restoreScript} from '../tools/collect-release.mjs';
import {spawn} from 'node:child_process';
import {verifyRelease} from '../tools/verify-release.mjs';
import release from '../tools/prepare-release.cjs';
async function temporary(fn){const root=await mkdtemp(path.join(os.tmpdir(),'britannia-release-'));try{return await fn(root);}finally{await rm(root,{recursive:true,force:true});}}

test('native Windows and Linux staging preserve runtime resources and choose the correct executable',async()=>{
 await temporary(async root=>{for(const platform of ['win32','linux']){
  const source=path.join(root,platform),destination=path.join(root,platform+'-staged'),target=desktopTarget(platform);await mkdir(path.join(source,'resources'),{recursive:true});await writeFile(path.join(source,target.original),'runtime');await writeFile(path.join(source,'resources/default_app.asar'),'exclude');await writeFile(path.join(source,'resources/license.txt'),'keep');
  await stageRuntime(source,destination,platform);assert.equal(await readFile(path.join(destination,target.executable),'utf8'),'runtime');assert.deepEqual(await readdir(path.join(destination,'resources')),['license.txt']);
 }});
 assert.equal(buildArguments(['--linux'],'linux').target.executable,'britannia-survivors');assert.ok(buildArguments(['--win','--dir'],'win32').flags.includes('--dir'));
 for(const args of [['--win','--linux'],['--linux'],['--publish'],['--win;echo bad']])assert.throws(()=>buildArguments(args,'win32'));
});

test('release preparation rejects malformed inputs and updates package, lock and on-screen build together',async()=>{
 for(const value of ['1.2.3\n','01.2.3','1.2.3-beta.01','1.2.3; echo bad','1.2', '65536.0.0'])assert.throws(()=>release.releaseVersion(value));
 assert.deepEqual(release.releaseVersion('v1.2.3-beta.1'),{version:'1.2.3-beta.1',tag:'v1.2.3-beta.1',prerelease:true});
 await temporary(async root=>{await mkdir(path.join(root,'game'));await writeFile(path.join(root,'package.json'),JSON.stringify({version:'0.0.1'}));await writeFile(path.join(root,'package-lock.json'),JSON.stringify({version:'0.0.1',packages:{'':{version:'0.0.1'}}}));await writeFile(path.join(root,'game/index.html'),'LOCAL BUILD <b>0.0.1 · Classic</b>');await release.prepareRelease('v1.2.3',root);assert.equal(JSON.parse(await readFile(path.join(root,'package.json'))).version,'1.2.3');assert.equal(JSON.parse(await readFile(path.join(root,'package-lock.json'))).packages[''].version,'1.2.3');assert.match(await readFile(path.join(root,'game/index.html'),'utf8'),/1\.2\.3 · Classic/);});
});

test('oversized binaries split without losing bytes, including exact part boundaries',async()=>{
 await temporary(async root=>{const output=path.join(root,'output');await mkdir(output);const source=path.join(root,'binary.exe'),bytes=Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz!');await writeFile(source,bytes);const file=await splitReleaseFile(source,output,10);assert.deepEqual(file.parts.map(p=>p.bytes),[10,10,10,7]);assert.equal(file.sha256,createHash('sha256').update(bytes).digest('hex'));const restored=Buffer.concat(await Promise.all(file.parts.map(p=>readFile(path.join(output,p.name)))));assert.deepEqual(restored,bytes);for(const part of file.parts)assert.equal(await hashFile(path.join(output,part.name)),part.sha256);
  await writeFile(path.join(root,'exact.exe'),Buffer.alloc(20,7));const exact=await splitReleaseFile(path.join(root,'exact.exe'),output,10);assert.deepEqual(exact.parts.map(p=>p.bytes),[10,10]);
 });
});

test('release verification requires both complete native builds and rejects corrupted downloads',async()=>{
 await temporary(async root=>{const output=path.join(root,'downloads');await mkdir(output);
  for(const platform of ['win','linux']){const files=[];for(const name of releaseNames(platform)){const source=path.join(root,name);await writeFile(source,'native '+name);files.push(await splitReleaseFile(source,output));}await writeFile(path.join(output,`release-manifest-${platform}.json`),JSON.stringify({version:'1.2.3',platform,files}));await writeFile(path.join(output,`PLAY-${platform}.txt`),'Instructions');}
  assert.equal((await verifyRelease(output,'1.2.3')).files,7);assert.match(await readFile(path.join(output,'SHA256SUMS.txt'),'utf8'),/Britannia-Survivors-win-x64\.zip/);await assert.rejects(verifyRelease(output,'1.2.4'),/mismatched/);await writeFile(path.join(output,'Britannia-Survivors-win-x64.zip'),'corrupt');await assert.rejects(verifyRelease(output,'1.2.3'),/Corrupt/);
 });
});

test('the downloaded platform reassembly script reconstructs and verifies a split binary',async()=>{
 await temporary(async root=>{const output=path.join(root,'downloads');await mkdir(output);const bytes=Buffer.from('A complete native binary with several numbered parts.'),source=path.join(root,'fixture.exe');await writeFile(source,bytes);const file=await splitReleaseFile(source,output,10),win=process.platform==='win32',script=win?'REASSEMBLE-Windows.cmd':'REASSEMBLE-Linux.sh';await writeFile(path.join(output,script),restoreScript(win?'win':'linux',[file]));
  const result=await new Promise((resolve,reject)=>{const child=spawn(win?(process.env.ComSpec||'cmd.exe'):'sh',win?['/d','/c','.\\'+script]:[script],{cwd:output,stdio:['ignore','pipe','pipe'],windowsHide:true});let log='';child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);child.on('error',reject);child.on('exit',code=>resolve({code,log}));});
  assert.equal(result.code,0,result.log);assert.deepEqual(await readFile(path.join(output,file.name)),bytes);
 });
});
