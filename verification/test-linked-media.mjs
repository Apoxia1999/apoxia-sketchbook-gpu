import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),archive=require('../desktop/archive.cjs');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'apoxia-linked-media-'));
const data=path.join(root,'data'),original=path.join(root,'source.mp4');
let backend;
async function start(){
 backend=spawn(process.execPath,['server.js'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,PORT:'0',REFERENCIAS_DATA_DIR:data,APOXIA_DESKTOP_TOKEN:'test-desktop',APOXIA_LOCAL_MEDIA_KEY:'test-local'},stdio:['ignore','pipe','inherit']});
 return await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Backend startup timeout')),10000);backend.once('exit',code=>{clearTimeout(timer);reject(Error('Backend exited '+code));});backend.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127.0.0.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});});
}
async function stop(){if(!backend||backend.exitCode!==null)return;const done=new Promise(resolve=>backend.once('exit',resolve));backend.kill();await done;}
try{
 execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=32x32:d=2','-c:v','libx264','-pix_fmt','yuv420p',original]);
 let base=await start();
 const request=(url,options={})=>fetch(base+url,{...options,headers:{'X-Apoxia-Desktop-Token':'test-desktop',...options.headers}});
 const query='name=source.mp4&type=video&linked=1&nativeVideo=1';
 let response=await request('/api/items?'+query,{method:'POST',body:JSON.stringify({path:original})});assert.equal(response.status,403);
 response=await request('/api/items?'+query,{method:'POST',headers:{'X-Apoxia-Local-Media-Key':'test-local'},body:JSON.stringify({path:original})});assert.equal(response.status,202);
 const item=await response.json(),managed=path.join(data,'originals',item.id+'.mp4');assert((await fs.lstat(managed)).isSymbolicLink());assert.equal(await fs.realpath(managed),original);
 let ready;for(let i=0;i<100;i++){ready=(await(await request('/api/items')).json()).find(x=>x.id===item.id);if(ready.status!=='processing')break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(ready.status,'ready',ready.error);assert.equal(ready.nativeVideo,true);assert(!(await fs.readdir(path.join(data,'media'))).includes(item.id+'.mp4'));
 const source=await fs.readFile(original);assert.deepEqual(Buffer.from(await(await request('/original/'+item.id)).arrayBuffer()),source);
 response=await request('/original/'+item.id,{headers:{Range:'bytes=0-15'}});assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,16);
 await stop();base=await start();assert.equal((await(await request('/api/items')).json())[0].nativeVideo,true);assert.equal((await request('/original/'+item.id)).status,200);
 await stop();
 await fs.rename(original,original+'.moved');base=await start();
 const missing=(await(await request('/api/items')).json())[0];assert.equal(missing.originalMissing,true);assert.equal(missing.originalAvailable,false);assert.equal(missing.status,'ready');assert.equal((await request('/media/'+item.id+'.jpg')).status,200);
 await stop();await fs.rename(original+'.moved',original);base=await start();assert.equal((await(await request('/api/items')).json())[0].originalMissing,false);await stop();
 const zip=path.join(root,'backup.zip');await archive.exportZip(data,zip,{format:'apoxia-sketchbook',version:1,includeLinks:false,links:{}},{},()=>{});
 await fs.mkdir(path.join(root,'unpacked'));
 const extracted=await archive.extractZip(zip,path.join(root,'unpacked'),()=>{});assert.deepEqual(await fs.readFile(path.join(extracted.data,'originals',item.id+'.mp4')),source);assert(!(await fs.lstat(path.join(extracted.data,'originals',item.id+'.mp4'))).isSymbolicLink());
 assert.equal(await archive.copyMediaFiles(data,()=>{}),1);assert(!(await fs.lstat(managed)).isSymbolicLink());assert.equal(await archive.copyMediaFiles(data,()=>{}),0);
 await fs.unlink(original);assert.deepEqual(await fs.readFile(managed),source);base=await start();assert.equal((await request('/original/'+item.id)).status,200);
 console.log('PASS: protected linked import, direct playback/ranges, reload, self-contained ZIP, copy to DATA and source removal.');
}finally{await stop();await fs.rm(root,{recursive:true,force:true});}
