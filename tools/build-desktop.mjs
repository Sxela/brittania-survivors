import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {desktopTarget} from './desktop-target.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
export function buildArguments(args=[],host=process.platform){
 if(args.some(arg=>!['--win','--linux','--dir'].includes(arg))||args.includes('--win')&&args.includes('--linux'))throw Error('Usage: desktop:dist [--win|--linux] [--dir]');
 const target=desktopTarget(host);
 if(args.includes('--win')&&host!=='win32'||args.includes('--linux')&&host!=='linux')throw Error('Build on the matching native Windows or Linux runner.');
 return {target,flags:[target.platform==='win'?'--win':'--linux','--x64',...(args.includes('--dir')?['--dir']:[])]};
}
function run(args){return new Promise((resolve,reject)=>{const env={...process.env,ELECTRON_BUILDER_COMPRESSION_LEVEL:process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL||'3'};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(process.execPath,args,{cwd:root,env,stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('Build command failed: '+code)));});}
export async function build(args=process.argv.slice(2)){
 const {target,flags}=buildArguments(args);
 const name=`BritanniaSurvivors-build-${target.platform}-${process.pid}`,folder=path.join(root,'dist',name);
 await run([path.join(root,'tools/stage-source-desktop.mjs'),name]);
 await run([path.join(root,'tools/audit-desktop.mjs'),folder]);
 await run([require.resolve('electron-builder/cli.js'),'--config',path.join(root,'electron-builder.json'),'--prepackaged',folder,...flags,'--publish','never']);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))build().catch(error=>{console.error(error.message);process.exitCode=1;});
