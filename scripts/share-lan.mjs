// Shares the existing Linux Electron backend; never starts another DATA writer.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,timingSafeEqual} from 'node:crypto';
const profile=process.env.APOXIA_PROFILE || path.join(os.homedir(),'.config','Apoxia SketchBook');
const address=process.env.APOXIA_LAN_HOST;
const port=Number(process.env.APOXIA_LAN_PORT || 8765);
if(!address || !/^192\.168\.\d{1,3}\.\d{1,3}$|^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$|^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(address))throw new Error('Set APOXIA_LAN_HOST to this computer’s private LAN IPv4 address.');
if(!Number.isInteger(port) || port<1024 || port>65535)throw new Error('Invalid LAN port.');
const allowedHost=`${address}:${port}`,lanOrigin=`http://${allowedHost}`;
async function loadAccessKey() {
  await fs.mkdir(profile,{recursive:true,mode:0o700});
  const file=path.join(profile,'lan-access.json');
  try {
    const handle=await fs.open(file,'wx',0o600);
    try {await handle.writeFile(JSON.stringify({version:1,token:randomBytes(24).toString('hex')}));}
    finally {await handle.close();}
  } catch(error) {if(error.code!=='EEXIST')throw error;}
  const stat=await fs.lstat(file);
  if(!stat.isFile() || stat.uid!==process.getuid() || stat.mode&0o077)throw new Error('The LAN access key must be private to this user.');
  const value=JSON.parse(await fs.readFile(file,'utf8'));
  if(value.version!==1 || !/^[a-f0-9]{48}$/.test(value.token))throw new Error('Invalid LAN access key.');
  return value.token;
}
const access=await loadAccessKey();
let credentials,credentialTime=0;
async function backendCredentials() {
  if(credentials && Date.now()-credentialTime<4000)return credentials;
  const config=JSON.parse(await fs.readFile(path.join(profile,'desktop.json'),'utf8'));
  const pid=(await fs.readFile(path.join(config.canvasDir || path.join(profile,'canvas'),'.server.lock'),'utf8')).trim();
  if(!/^\d+$/.test(pid))throw new Error('Electron is not running.');
  const runtimeFile=path.join(profile,'desktop-runtime.json');
  const stat=await fs.lstat(runtimeFile);
  if(!stat.isFile() || stat.uid!==process.getuid() || stat.mode&0o077)throw new Error('The desktop runtime credentials must be private to this user.');
  const runtime=JSON.parse(await fs.readFile(runtimeFile,'utf8'));
  if(String(runtime.pid)!==pid || !/^[a-f0-9]{64}$/.test(runtime.token) || !Number.isInteger(runtime.port))throw new Error('Wait for Electron to finish opening its canvas.');
  credentials={port:runtime.port,token:runtime.token};credentialTime=Date.now();return credentials;
}
async function renewSharing() {
  const backend=await backendCredentials();
  const response=await fetch(`http://127.0.0.1:${backend.port}/api/lan-sharing`,{method:'POST',signal:AbortSignal.timeout(5000),headers:{'X-Apoxia-Desktop-Token':backend.token,'X-Apoxia-Lan-Control':backend.token}});
  if(!response.ok)throw new Error('Restart Electron with the LAN-sharing changes before starting this relay.');
}
function matchesAccess(value) {const left=Buffer.from(value || ''),right=Buffer.from(access);return left.length===right.length && timingSafeEqual(left,right);}
function answer(res,status,message) {res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});res.end(message);}
// randomUUID needs HTTPS in browsers, but getRandomValues also works on a LAN HTTP origin.
const uuidPrelude=`if(!crypto.randomUUID) crypto.randomUUID=()=>{const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;return [...b].map((v,i)=>([4,6,8,10].includes(i)?'-':'')+v.toString(16).padStart(2,'0')).join('');};\n`;
const server=http.createServer(async(req,res)=> {
  try {
    if(req.headers.host!==allowedHost)return answer(res,403,'Invalid host.');
    const url=new URL(req.url,lanOrigin);
    if(req.method==='GET' && url.pathname==='/' && matchesAccess(url.searchParams.get('access'))) {
      res.writeHead(303,{'Location':'/','Set-Cookie':`apoxiaLan=${access}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});return res.end();
    }
    const cookie=/(?:^|;\s*)apoxiaLan=([a-f0-9]+)(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    if(!matchesAccess(cookie))return answer(res,403,'Open the private access link to enter this canvas.');
    const entryNavigation=req.method==='GET' && url.pathname==='/' && req.headers['sec-fetch-dest']==='document';
    if((req.headers.origin && req.headers.origin!==lanOrigin) || req.headers['sec-fetch-site']==='cross-site' && !entryNavigation)return answer(res,403,'Invalid origin.');
    if(!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(req.method))return answer(res,405,'Method not allowed.');
    if(url.pathname==='/api/lan-sharing' || url.pathname.endsWith('/original-path') || url.pathname==='/api/object-links')return answer(res,403,'This action requires the desktop app.');
    const backend=await backendCredentials();
    const headers={...req.headers,host:`127.0.0.1:${backend.port}`,'x-apoxia-desktop-token':backend.token};
    delete headers['x-apoxia-lan-control'];delete headers.authorization;
    if(headers.origin)headers.origin=`http://127.0.0.1:${backend.port}`;
    headers.cookie=(headers.cookie || '').split(';').filter(part=>!part.trim().startsWith('apoxiaLan=')).join(';');
    const upstream=http.request({host:'127.0.0.1',port:backend.port,path:req.url,method:req.method,headers},async reply=> {
      if (reply.statusCode >= 400) credentialTime = 0;
      const responseHeaders={...reply.headers,'referrer-policy':'no-referrer'};
      if(url.pathname==='/desktop-bootstrap.js' && reply.statusCode===200) {
        try {
          const chunks=[];for await(const chunk of reply)chunks.push(chunk);
          const body=Buffer.concat([Buffer.from(uuidPrelude),...chunks]);delete responseHeaders['content-length'];responseHeaders['cache-control']='no-store';
          res.writeHead(200,responseHeaders);res.end(body);
        }catch {res.destroy();}
      } else {res.writeHead(reply.statusCode,responseHeaders);reply.pipe(res);reply.on('error',()=>res.destroy());}
    });
    upstream.on('error',()=>{credentialTime=0;if(!res.headersSent)answer(res,503,'Electron is unavailable. Reopen the desktop app.');else res.destroy();});
    req.on('aborted',()=>upstream.destroy());
    res.on('close',()=>{if(!res.writableFinished)upstream.destroy();});
    req.pipe(upstream);
  } catch {if(!res.headersSent)answer(res,503,'Electron is unavailable. Reopen the desktop app.');else res.destroy();}
});
// Electron may still be starting when systemd launches this service.
for(;;) {
  try {await renewSharing();break;}
  catch {credentialTime=0;await new Promise(resolve=>setTimeout(resolve,1000));}
}
const renew=setInterval(()=>renewSharing().catch(()=>{credentialTime=0;}),5000);
server.requestTimeout=0;
server.listen(port,address,()=>console.log(`Apoxia SketchBook · edición LAN\n${lanOrigin}/?access=${access}\nMantén Electron y este proceso abiertos. Ctrl+C termina la sesión compartida.\nAviso: LAN usa HTTP sin cifrado. Comparte solo en redes de confianza o mediante un proxy HTTPS.`));
server.on('error',error=>{clearInterval(renew);console.error(error.message);process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(renew);server.close();server.closeAllConnections();});
