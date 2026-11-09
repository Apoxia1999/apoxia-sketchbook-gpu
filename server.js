import './desktop/node2shell-guard.cjs';
import http from 'node:http';
import './image-crop.js';
const Crop=globalThis.ApoxiaCrop;
import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { VaultStorage } from './vault-storage.js';
import { resolvePinterestMedia } from './pinterest-media.js';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.REFERENCIAS_DATA_DIR || path.join(root, 'data'));
const mediaDir = path.join(dataDir, 'media');
const originalDir = path.join(dataDir, 'originals');
const tempDir = path.join(dataDir, 'tmp');
const previewCacheDir=path.join(tempDir,'gpu-preview-packs');
const dbFile = path.join(dataDir, 'board.json');
const strokesFile = path.join(dataDir, 'strokes.json');
const writingsFile = path.join(dataDir, 'writings.json');
const vaultsFile = path.join(dataDir, 'vaults.json');
const vaults = new Map();
let port = Number(process.env.PORT ?? 4180);
const desktopToken = process.env.APOXIA_DESKTOP_TOKEN;
const localMediaKey = process.env.APOXIA_LOCAL_MEDIA_KEY;
const ffmpeg = process.env.APOXIA_FFMPEG || 'ffmpeg';
const ffprobe = process.env.APOXIA_FFPROBE || 'ffprobe';
const portableMedia = Boolean(process.env.APOXIA_FFMPEG);
const maxUpload = 2 * 1024 * 1024 * 1024;
const items = new Map();
const deletedItems = new Map();
const originalChecks=new Map();
async function mediaAvailability(item){
 if(!item.originalAvailable)return item;
 const relative=`originals/${item.id}${item.originalExt}`,owner=storage.owner('items',item.id);
 if(owner?.crypto&&storage.contexts.get(owner.id)?.assets?.[relative])return item;
 let cached=originalChecks.get(item.id);
 if(!cached||Date.now()-cached.time>30000){const stat=await fsp.stat(path.join(dataDir,relative)).catch(()=>null);cached={time:Date.now(),missing:!stat?.isFile()};originalChecks.set(item.id,cached);}
 return {...item,originalAvailable:!cached.missing,originalMissing:cached.missing};
}

const strokes = new Map();
const writings = new Map();
const queue = [];
let active = 0;
let activeWrites = 0;
let clearing = false;
let saveChain = Promise.resolve();
let storage;
let boardRevision=0,lanSharingUntil=0;
const serverInstance=randomUUID();
const requestContext=new AsyncLocalStorage();
const sharedChanges=[];
let mutationTail = Promise.resolve();
const browserSessions = new Map();
async function acquireMutation() {
  let release;
  const next = new Promise(resolve => { release = resolve; });
  const previous = mutationTail; mutationTail = next;
  await previous; return release;
}
function getSession(req, res) {
  const cookie = /(?:^|;\s*)apoxiaSession=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
  let token = cookie?.[1];
  if (!token || !browserSessions.has(token)) {
    token = randomBytes(32).toString('hex');
    res.setHeader('Set-Cookie', `apoxiaSession=${token}; HttpOnly; SameSite=Strict; Path=/`);
  }
  browserSessions.set(token, Date.now()); return token;
}
async function persist(options) {
  const writer=requestContext.getStore()?.session || null;
  const operation = saveChain.catch(() => {}).then(async () => {
    await storage.persist(options);boardRevision++;
    sharedChanges.push({revision:boardRevision,writer});if(sharedChanges.length>2048)sharedChanges.shift();
  });
  saveChain = operation; return operation;
}

await Promise.all([fsp.mkdir(mediaDir, { recursive: true }), fsp.mkdir(originalDir, { recursive: true }), fsp.mkdir(tempDir, { recursive: true })]);
const lockFile = path.join(dataDir, '.server.lock');
try {
  await fsp.writeFile(lockFile, String(process.pid), { flag: 'wx' });
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const owner = Number(await fsp.readFile(lockFile, 'utf8').catch(() => '0'));
  let running = false;
  if (Number.isInteger(owner) && owner > 0) {
    try { process.kill(owner, 0); running = true; }
    catch (checkError) { if (checkError.code !== 'ESRCH') throw checkError; }
  }
  if (running) throw new Error(`Ya hay otra instancia usando ${dataDir} (PID ${owner}).`);
  await fsp.rm(lockFile, { force: true });
  await fsp.writeFile(lockFile, String(process.pid), { flag: 'wx' });
}
function releaseLock() {
  storage?.eraseKeys();
  try { if (fs.readFileSync(lockFile, 'utf8') === String(process.pid)) fs.rmSync(lockFile, { force: true }); }
  catch { /* The lock may already have been removed. */ }
}
process.on('exit', releaseLock);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { releaseLock(); process.exit(0); });
if (!fs.existsSync(path.join(dataDir, 'state.json'))) {
try {
  for (const item of JSON.parse(await fsp.readFile(dbFile, 'utf8'))) {
    item.type ||= 'video';
    if (item.status === 'processing') item.status = 'error', item.error = 'Conversión interrumpida. Elimina el elemento y vuelve a importarlo.';
    if (item.deleted) deletedItems.set(item.id, item);
    else items.set(item.id, item);
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
try {
  for (const stroke of JSON.parse(await fsp.readFile(strokesFile, 'utf8'))) strokes.set(stroke.id, stroke);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
try {
  for (const writing of JSON.parse(await fsp.readFile(writingsFile, 'utf8'))) writings.set(writing.id, writing);
} catch (error) { if (error.code !== 'ENOENT') throw error; }

try {
  for (const vault of JSON.parse(await fsp.readFile(vaultsFile, 'utf8'))) vaults.set(vault.id, vault);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
}
storage = new VaultStorage({ dataDir, vaults, items, deletedItems, writings, strokes });
await storage.load();
if([...vaults.values()].some(v=>v.crypto))await clearPreviewPacks();
async function clearPreviewPacks(){await fsp.rm(previewCacheDir,{recursive:true,force:true});}
async function trimPreviewPacks(keep){
 const files=await fsp.readdir(previewCacheDir);const entries=await Promise.all(files.filter(name=>/^[0-9a-f]{64}\.webp$/.test(name)).map(async name=>{const file=path.join(previewCacheDir,name),stat=await fsp.stat(file);return {file,size:stat.size,time:stat.mtimeMs};}));
 let size=entries.reduce((n,a)=>n+a.size,0);for(const a of entries.sort((a,b)=>a.time-b.time)){if(size<=64*1048576)break;if(a.file!==keep){await fsp.rm(a.file,{force:true});size-=a.size;}}
}
function saveVaults() { return persist(); }
function publicVault(vault, session) { return storage.publicVault(vault, session); }
function vaultOverlaps(box, ignoreId) {
  return [...vaults.values()].some(v => v.id !== ignoreId && box.x < v.x + v.width && box.x + box.width > v.x && box.y < v.y + v.height && box.y + box.height > v.y);
}
function save() { return persist(); }
function saveStrokes() { return persist(); }
function saveWritings() { return persist(); }
function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store' });
  res.end(data);
}
async function readJson(req, limit = 100000) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new Error('Petición demasiado grande');
  }
  return JSON.parse(body);
}
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command === 'ffmpeg' ? ffmpeg : command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${command} terminó con código ${code}: ${stderr}`)));
  });
}
function imagePixels(file, side) {
  return new Promise((resolve,reject)=> {
    const child=spawn(ffmpeg,['-hide_banner','-loglevel','error','-i',file,'-vf',`scale=${side}:${side}`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true});
    const chunks=[]; let length=0; const expected=side*side*3;
    child.stdout.on('data',chunk=> {length+=chunk.length;if(length<=expected) chunks.push(chunk);});
    child.on('error',reject);
    child.on('close',code=> {const bytes=Buffer.concat(chunks);if(code || bytes.length!==expected) return reject(new Error('No se pudo crear la vista lejana de la imagen'));resolve(Array.from({length:side*side},(_,i)=>'#'+bytes.subarray(i*3,i*3+3).toString('hex')));});
  });
}
function imageGradient(file) {
  if(portableMedia) return imagePixels(file,2);
  return new Promise((resolve, reject) => {
    const child = spawn('magick', [file, '-colorspace', 'sRGB', '-resize', '2x2!', '-alpha', 'off', '-depth', '8', 'rgb:-']);
    const chunks = []; let length = 0;
    child.stdout.on('data', chunk => { length += chunk.length; if (length <= 64) chunks.push(chunk); });
    child.on('error', reject);
    child.on('close', code => {
      const bytes = Buffer.concat(chunks);
      if (code || bytes.length !== 12) return reject(new Error('No se pudo extraer el gradiente'));
      resolve(Array.from({ length: 4 }, (_, i) => '#' + bytes.subarray(i * 3, i * 3 + 3).toString('hex')));
    });
  });
}
function imageMosaic(file) {
  if(portableMedia) return imagePixels(file,4);
  return new Promise((resolve, reject) => {
    const child = spawn('magick', [file, '-colorspace', 'sRGB', '-resize', '4x4!', '-alpha', 'off', '-depth', '8', 'rgb:-']);
    const chunks = []; let length = 0;
    child.stdout.on('data', chunk => { length += chunk.length; if (length <= 128) chunks.push(chunk); });
    child.on('error', reject);
    child.on('close', code => {
      const bytes = Buffer.concat(chunks);
      if (code || bytes.length !== 48) return reject(new Error('No se pudo extraer el mosaico'));
      resolve(Array.from({ length: 16 }, (_, i) => '#' + bytes.subarray(i * 3, i * 3 + 3).toString('hex')));
    });
  });
}
function probe(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,pix_fmt,width,height,duration:format=duration', '-of', 'json', file]);
    let out = '', err = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code) return reject(new Error(err || 'No se pudo leer el vídeo'));
      try {
        const parsed = JSON.parse(out);
        const stream = parsed.streams?.find(value => value.codec_type === 'video');
        if (!stream?.width || !stream?.height) throw new Error('El archivo no contiene vídeo');
        resolve({ width: stream.width, height: stream.height, duration: Number(stream.duration || parsed.format?.duration || 0), videoCodec: stream.codec_name, pixelFormat: stream.pix_fmt, audioCodec: parsed.streams?.find(value=>value.codec_type==='audio')?.codec_name, hasAudio: parsed.streams?.some(value => value.codec_type === 'audio') || false });
      } catch (error) { reject(error); }
    });
  });
}
function arrangeImportBatch(batchId) {
  if (!batchId) return;
  const batch = [...items.values()].filter(item => item.importBatch?.id === batchId).sort((a, b) => a.importBatch.index - b.importBatch.index);
  if (!batch.length) return;
  const origin = batch[0].importBatch;
  const gap=20*batch[0].chromeScale;const columns=origin.columns||4;
  let y = origin.y;
  for (let start = 0; start < batch.length; start += columns) {
    const row = batch.slice(start,start+columns);
    let x = origin.x;
    let height = 0;
    for (const item of row) {
      item.x = x; item.y = y;
      x += item.displayWidth + gap;
      height = Math.max(height, item.displayHeight);
    }
    y += height + gap;
  }
}
async function convert(job) {
  const { id, input } = job;
  const item = items.get(id) || deletedItems.get(id);
  if (!item) { await fsp.rm(input, { force: true }); return; }
  const video = path.join(mediaDir, `${id}.mp4`);
  const poster = path.join(mediaDir, `${id}.jpg`);
  const image = path.join(mediaDir, `${id}.webp`);
  const thumbnail = path.join(mediaDir, `${id}-thumb.webp`);
  try {
    if (item.type === 'audio') {
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vn', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', video]);
      if (!items.has(id) && !deletedItems.has(id)) { await fsp.rm(video, {force:true}); return; }
      Object.assign(item, {status:'ready', width:160, height:160, displayHeight:item.displayWidth, bytes:(await fsp.stat(video)).size});
      arrangeImportBatch(item.importBatch?.id);
      await save();
      return;
    }
    if (item.type === 'image') {
      const original = await probe(input).catch(() => null);
      if (original) { item.originalWidth = original.width; item.originalHeight = original.height; }
      if(portableMedia) {
        await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',input,'-frames:v','1','-vf',"scale=w='min(4096,iw)':h='min(4096,ih)':force_original_aspect_ratio=decrease",'-c:v','libwebp','-quality','82','-compression_level','5',image]);
        await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',image,'-frames:v','1','-vf',"scale=w='min(640,iw)':h='min(640,ih)':force_original_aspect_ratio=decrease",'-c:v','libwebp','-quality','75','-compression_level','4',thumbnail]);
      } else {
      await run('magick', [`${input}[0]`, '-auto-orient', '-resize', '4096x4096>', '-strip', '-quality', '82', '-define', 'webp:method=5', image]);
      await run('magick', [image, '-resize', '640x640>', '-quality', '75', '-define', 'webp:method=4', thumbnail]);
      }
      item.gradientColors = await imageGradient(image).catch(() => null);
      item.mosaicColors = await imageMosaic(image).catch(() => null);
    } else {
      const meta = await probe(input);
      const mp4=['.mp4','.m4v','.mov'].includes(item.originalExt)&&meta.videoCodec==='h264'&&['yuv420p','yuvj420p'].includes(meta.pixelFormat)&&(!meta.hasAudio||['aac','mp3'].includes(meta.audioCodec));
      const webm=item.originalExt==='.webm'&&['vp8','vp9','av1'].includes(meta.videoCodec)&&(!meta.hasAudio||['opus','vorbis'].includes(meta.audioCodec));
      item.nativeVideo=(item.linkedPlayback||item.originalBytes<40*1024*1024)&&(item.browserVideoCompatible||mp4||webm);
      if(item.linkedPlayback&&!item.nativeVideo)throw new Error('Este vídeo no se puede reproducir directamente. Activa Copiar media al importar para convertirlo.');
      delete item.linkedPlayback;
      delete item.browserVideoCompatible;
      if(!item.nativeVideo){
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-t', '30', '-vf', "scale=w='if(gte(iw,ih),min(640,iw),-2)':h='if(gte(iw,ih),-2,min(640,ih))':force_original_aspect_ratio=decrease:force_divisible_by=2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '29', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', video]);
      }
      const playback=item.nativeVideo?input:video;
      await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',playback,'-frames:v','1','-vf','scale=480:-2',poster]);
      const previewMeta=item.nativeVideo?meta:await probe(video);
      item.duration=previewMeta.duration;item.originalDuration=meta.duration;item.hasAudio=previewMeta.hasAudio;
    }
    if (!items.has(id) && !deletedItems.has(id)) {
      await Promise.allSettled([video, poster, image, thumbnail].map(file => fsp.rm(file, { force: true })));
      return;
    }
    const output = item.type === 'image' ? image : item.nativeVideo ? input : video;
    const result = await probe(output);
    Object.assign(item, { status: 'ready', width: result.width, height: result.height, displayWidth: item.displayWidth || 320, displayHeight: (item.displayWidth || 320) * result.height / result.width, bytes: (await fsp.stat(output)).size });
    arrangeImportBatch(item.importBatch?.id);
    await save();
  } catch (error) {
    item.status = 'error';
    item.error = error.message.slice(0, 300);
    arrangeImportBatch(item.importBatch?.id);
    await Promise.allSettled([video, poster, image, thumbnail].map(file => fsp.rm(file, { force: true })));
    await save();
  }
}
function pump() {
  while (active < 2 && queue.length) {
    const job = queue.shift();
    active++;
    convert(job).finally(() => { active--; pump(); });
  }
}
async function receive(req, file) {
  let size = 0;
  const out = fs.createWriteStream(file, { flags: 'wx' });
  try {
    await pipeline(req, async function* (source) {
      for await (const chunk of source) {
        size += chunk.length;
        if (size > maxUpload) throw new Error('El archivo supera 2 GB');
        yield chunk;
      }
    }, out);
    if (!size) throw new Error('El archivo está vacío');
  } catch (error) { await fsp.rm(file, { force: true }); throw error; }
}
function serveFile(req, res, file, type, cache = 'no-cache', extraHeaders = {}) {
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) return json(res, 404, { error: 'Archivo no encontrado' });
    const range = req.headers.range;
    const cacheHeaders=cache.includes('no-store')?{}:{ETag:`W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`,'Last-Modified':stat.mtime.toUTCString()};
    // Authorization and file existence are checked before validating a cache.
    if(!range&&cacheHeaders.ETag&&req.headers['if-none-match']?.split(',').some(tag=>tag.trim()===cacheHeaders.ETag||tag.trim()==='*')){
      res.writeHead(304,{'Cache-Control':cache,...cacheHeaders,...extraHeaders});return res.end();
    }
    let start = 0, end = stat.size - 1, status = 200;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return json(res, 416, { error: 'Rango inválido' });
      if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
      else start = Number(match[1]);
      if (match[2] && match[1]) end = Math.min(end, Number(match[2]));
      if (start > end || start >= stat.size) return json(res, 416, { error: 'Rango inválido' });
      status = 206;
    }
    res.writeHead(status, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': cache, ...cacheHeaders, ...extraHeaders, ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}) });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(file, { start, end });
    stream.on('error', () => res.destroy());
    res.once('close', () => stream.destroy());
    stream.pipe(res);
  });
}
const server = http.createServer((req,res)=>requestContext.run({session:null},async () => {
  const clearRequest = req.method === 'DELETE' && req.url?.split('?')[0] === '/api/board';
  const writeRequest = !['GET', 'HEAD'].includes(req.method) && !clearRequest;
  if (writeRequest) activeWrites++;
  let releaseMutation;
  try {
    if(desktopToken && req.headers['x-apoxia-desktop-token']!==desktopToken) return json(res,403,{error:'Esta instancia pertenece a la app de escritorio'});
    const host = req.headers.host;
    const allowed = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!allowed.includes(host) || (req.headers.origin && !allowed.map(value => `http://${value}`).includes(req.headers.origin)) || req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'Origen no permitido' });
    const session = getSession(req, res);requestContext.getStore().session=session;
    if (!['GET', 'HEAD'].includes(req.method)) releaseMutation = await acquireMutation();
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    if (clearing && writeRequest) return json(res, 409, { error: 'Se está borrando el canvas' });
    const objectRoute = /^\/(?:api\/)?(items|text|writings|strokes|media|original)\/([0-9a-f-]{36})(?:[-/.]|$)/.exec(pathname);
    if (objectRoute) {
      const kind = ['items','text','media','original'].includes(objectRoute[1]) ? 'items' : objectRoute[1];
      if (!storage.accessible(kind, objectRoute[2], session)) return json(res, 404, { error: 'Contenido no disponible' });
    }
    if (req.method === 'POST' && pathname === '/api/vaults/lock-all') {
      let closedPrivateContent = false;
      for (const vault of vaults.values()) if (storage.isOpen(vault, session)) {
        await storage.lock(vault, session, persist);
        closedPrivateContent = true;
      }
      if (closedPrivateContent) res.setHeader('Clear-Site-Data', '"cache"');
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && pathname === '/api/vaults/heartbeat') return json(res, 200, [...vaults.values()].map(v => publicVault(v, session)));
    if(req.method==='POST' && pathname==='/api/lan-sharing') {
      if(!desktopToken || req.headers['x-apoxia-lan-control']!==desktopToken) return json(res,403,{error:'No autorizado'});
      lanSharingUntil=Date.now()+15000;return json(res,200,{ok:true});
    }
    if(req.method==='GET' && pathname==='/api/shared-revision') return json(res,200,{enabled:lanSharingUntil>Date.now(),revision:boardRevision,instance:serverInstance});
    if(req.method==='GET' && pathname==='/api/shared-snapshot') {
      if(lanSharingUntil<Date.now())return json(res,409,{error:'La sesión compartida está cerrada'});
      releaseMutation=await acquireMutation();
      const since=Number(url.searchParams.get('since') ?? -1);
      const foreign=!Number.isSafeInteger(since) || since<0 || since>boardRevision || (sharedChanges.length && since<sharedChanges[0].revision-1) || sharedChanges.some(change=>change.revision>since && change.writer!==session);
      return json(res,200,{foreign,instance:serverInstance,revision:boardRevision,vaults:[...vaults.values()].map(v=>publicVault(v,session)),items:[...items.values()].filter(o=>storage.accessible('items',o.id,session)),strokes:[...strokes.values()].filter(o=>storage.accessible('strokes',o.id,session)),writings:[...writings.values()].filter(o=>storage.accessible('writings',o.id,session))});
    }
    if(req.method==='POST'&&pathname==='/api/gpu-preview-pack'){
      const input=await readJson(req,50000),ids=input.ids;
      if(!Array.isArray(ids)||!ids.length||ids.length>1024||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!(/^[0-9a-f-]{36}$/).test(id)))return json(res,400,{error:'Lista de miniaturas inválida'});
      if(ids.some(id=>{const item=items.get(id);return !item||item.type!=='image'||item.status!=='ready'||storage.owner('items',id);}))return json(res,404,{error:'Miniaturas no disponibles'});
      const files=ids.map(id=>path.join(mediaDir,`${id}-thumb.webp`));
      const stats=await Promise.all(files.map(file=>fsp.stat(file)));
      const key=createHash('sha256').update('gpu-preview-v1:'+ids.map((id,i)=>`${id}:${stats[i].mtimeMs}:${stats[i].size}`).join('|')).digest('hex');
      const output=path.join(previewCacheDir,`${key}.webp`);
      if(!fs.existsSync(output)){
        await fsp.mkdir(previewCacheDir,{recursive:true});const temp=path.join(previewCacheDir,`${key}.building.webp`);
        try{await run('magick',['montage','-limit','thread','2','-limit','memory','128MiB','-limit','map','256MiB','-thumbnail','64x64>','-background','transparent','-gravity','NorthWest','-geometry','64x64+0+0','-tile','32x32',...files,'-quality','85',temp]);await fsp.rename(temp,output);await trimPreviewPacks(output);}
        catch(error){await fsp.rm(temp,{force:true});return json(res,503,{error:'No se pudo preparar la caché de miniaturas'});}
      }
      return serveFile(req,res,output,'image/webp','private, no-store');
    }
    if (req.method === 'GET' && pathname === '/api/version') return json(res, 200, { version: 16 });
    if (req.method === 'PUT' && pathname === '/api/vault-memberships') {
      const input = await readJson(req, 2000000);
      if (!Array.isArray(input) || input.length !== vaults.size || new Set(input.map(v => v.id)).size !== vaults.size) return json(res, 400, { error: 'Lista de Vaults inválida' });
      const owned = new Set();
      for (const record of input) {
        if (!vaults.has(record.id) || !record.members) return json(res, 400, { error: 'Vault inválida' });
        for (const kind of ['items', 'writings', 'strokes']) {
          if (!Array.isArray(record.members[kind]) || record.members[kind].length > 50000) return json(res, 400, { error: 'Contenido inválido' });
          for (const id of record.members[kind]) {
            const key = `${kind}:${id}`;
            if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id) || owned.has(key)) return json(res, 400, { error: 'Pertenencia duplicada o inválida' });
            owned.add(key);
          }
        }
      }
      if (input.every(record => JSON.stringify(record.members) === JSON.stringify(vaults.get(record.id).members))) return json(res, 200, { ok: true });
      await clearPreviewPacks();
      await storage.changeMembership(input, session);
      await saveVaults(); return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && pathname === '/api/vaults') return json(res, 200, [...vaults.values()].map(v => publicVault(v, session)));
    if (req.method === 'POST' && pathname === '/api/vaults') {
      const input = await readJson(req, 2000);
      if (![input.x, input.y, input.width, input.height].every(Number.isFinite) || input.width <= 0 || input.height <= 0 || vaultOverlaps(input)) return json(res, 400, { error: 'La Vault no puede solaparse con otra' });
      const vault = { id: randomUUID(), x: input.x, y: input.y, width: input.width, height: input.height, members: { items: [], writings: [], strokes: [] } };
      vaults.set(vault.id, vault); await saveVaults();
      return json(res, 201, publicVault(vault, session));
    }
    const vaultMatch = /^\/api\/vaults\/([0-9a-f-]{36})(?:\/(unlock|lock|hint))?$/.exec(pathname);
    if (vaultMatch && vaults.has(vaultMatch[1])) {
      const vault = vaults.get(vaultMatch[1]);
      if (req.method === 'PATCH' && vaultMatch[2] === 'hint') {
        const input=await readJson(req,500000), hint=input.hint;
        if(!Array.isArray(hint)||hint.length>200||hint.some(stroke=>!Array.isArray(stroke)||stroke.length<1||stroke.length>2000||stroke.some(point=>!Array.isArray(point)||point.length!==2||point.some((n,i)=>!Number.isFinite(n)||n<0||n>(i===0?640:160)))))return json(res,400,{error:'Dibujo de pista inválido'});
        const previous=vault.hint;vault.hint=hint;
        try{await persist({geometryOnly:true});}catch(error){vault.hint=previous;throw error;}
        return json(res,200,publicVault(vault,session));
      }
      if (req.method === 'POST' && vaultMatch[2] === 'unlock') {
        if (req.headers['x-apoxia-protocol'] !== '16') return json(res, 409, { error: 'Recarga la interfaz para activar el cifrado real antes de abrir la Vault' });
        const input = await readJson(req, 4000);
        if (typeof input.password !== 'string' || input.password.length < 1 || input.password.length > 1024) return json(res, 400, { error: 'Introduce una contraseña' });
        await clearPreviewPacks();
        await storage.unlock(vault, input.password, input.confirm, session);
        await persist();
        return json(res, 200, { ...publicVault(vault, session), contents: { items: vault.members.items.map(id => items.get(id)).filter(Boolean), writings: vault.members.writings.map(id => writings.get(id)).filter(Boolean), strokes: vault.members.strokes.map(id => strokes.get(id)).filter(Boolean) } });
      }
      if (req.method === 'POST' && vaultMatch[2] === 'lock') {
        if (active || queue.length) return json(res, 409, { error: 'Espera a que terminen las importaciones antes de cerrar' });
        await storage.lock(vault, session, persist);
        res.setHeader('Clear-Site-Data', '"cache"');
        return json(res, 200, publicVault(vault, session));
      }
      if (req.method === 'PATCH' && !vaultMatch[2]) {
        if (req.headers['x-apoxia-protocol'] !== '16') return json(res, 409, { error: 'Recarga la interfaz para utilizar las coordenadas locales de la Vault' });
        const input = await readJson(req, 2000000);
        if ('locked' in input && typeof input.locked !== 'boolean') return json(res, 400, { error: 'Bloqueo inválido' });
        const box = { ...vault };
        for (const key of ['x', 'y', 'width', 'height']) if (key in input) box[key] = input[key];
        if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0 || vaultOverlaps(box, vault.id)) return json(res, 400, { error: 'La Vault no puede solaparse con otra' });
        if (input.members) return json(res, 400, { error: 'Usa la operación de pertenencia para modificar el contenido' });
        const factor = box.width / vault.width;
        const geometryChanged = box.x !== vault.x || box.y !== vault.y || box.width !== vault.width || box.height !== vault.height;
        if (vault.locked && input.locked !== false && geometryChanged) return json(res, 409, { error: 'Desbloquea la Vault para moverla o cambiar su tamaño' });
        if (Math.abs(box.height / vault.height - factor) > Math.max(1e-9, factor * 1e-6)) return json(res, 400, { error: 'La Vault se escala proporcionalmente' });
        if (vault.crypto && storage.contexts.has(vault.id) && !storage.isOpen(vault, session)) return json(res, 409, { error: 'Esta Vault está abierta en otra ventana' });
        const previousGeometry = { x: vault.x, y: vault.y, width: vault.width, height: vault.height, locked: vault.locked };
        Object.assign(vault, { x: box.x, y: box.y, width: box.width, height: box.height });
        if ('locked' in input) vault.locked = input.locked;
        // Local content does not change when its container moves or scales.
        // Commit public geometry without rewriting any encrypted payload.
        try { await persist({ geometryOnly: true }); }
        catch (error) { Object.assign(vault, previousGeometry); throw error; }
        return json(res, 200, publicVault(vault, session));
      }
      if (req.method === 'DELETE' && !vaultMatch[2]) {
        const input = await readJson(req, 1000);
        const action = input.action;
        if (!['release', 'discard'].includes(action)) return json(res, 400, { error: 'Indica si se conserva o se borra el contenido de la Vault' });
        const open = storage.isOpen(vault, session);
        if (action === 'release' && !open) return json(res, 409, { error: 'Abre la Vault para conservar su contenido' });
        if (action === 'discard' && open) return json(res, 409, { error: 'La Vault está abierta: confirma de nuevo para borrar solo la caja' });
        const occupied = storage.publicVault(vault, session).hasContents;
        if (occupied && input.confirm !== 'BORRAR VAULT') return json(res, 400, { error: 'Confirma el borrado de la Vault y todo su contenido' });
        if (vault.members.items.some(id => items.get(id)?.status === 'processing')) return json(res, 409, { error: 'Espera a que terminen las importaciones de esta Vault' });
        const result = action === 'release' ? await storage.releaseContainer(vault, session, persist) : await storage.discardVault(vault, session, persist);
        return json(res, 200, { ok: true, ...result });
      }
    }
    if(req.method==='PUT' && pathname==='/api/object-links') {
      if(!desktopToken) return json(res,400,{error:'Los accesos a archivos locales requieren la app de escritorio'});
      const input=await readJson(req,2000000), maps={items,writings,strokes};
      if(!Array.isArray(input.objects) || !input.objects.length || input.objects.length>20000) return json(res,400,{error:'Selección inválida'});
      const changes=[],seen=new Set();
      for(const entry of input.objects) {
        const object=maps[entry.kind]?.get(entry.id),key=`${entry.kind}:${entry.id}`;
        if(!object || seen.has(key) || !storage.accessible(entry.kind,entry.id,session)) return json(res,404,{error:'Elemento no disponible'});
        const link=entry.fileLink;
        if(link!==null && (!link || typeof link.id!=='string' || !/^[0-9a-f-]{36}$/.test(link.id) || typeof link.name!=='string' || link.name.length>1024)) return json(res,400,{error:'Enlace inválido'});
        seen.add(key);changes.push({object,before:object.fileLink,after:link?{id:link.id,name:link.name}:null});
      }
      for(const change of changes) {if(change.after) change.object.fileLink=change.after;else delete change.object.fileLink;}
      try {await persist();} catch(error) {for(const change of changes) {if(change.before) change.object.fileLink=change.before;else delete change.object.fileLink;}throw error;}
      return json(res,200,{ok:true});
    }
    if (req.method === 'POST' && pathname === '/api/connections') {
      const input=await readJson(req,4000), sides=['n','e','s','w'];
      const source=items.get(input.sourceId) || writings.get(input.sourceId), target=items.get(input.targetId) || writings.get(input.targetId);
      const kind=object=>writings.has(object.id)?'writings':'items';
      if(!source || !target || source.id===target.id || !storage.accessible(kind(source),source.id,session) || !storage.accessible(kind(target),target.id,session)) return json(res,404,{error:'Los elementos no están disponibles'});
      if(!sides.includes(input.sourceSide) || !sides.includes(input.targetSide) || (input.id && !/^[0-9a-f-]{36}$/.test(input.id))) return json(res,400,{error:'Conexión inválida'});
      if((input.color!==undefined && !/^#[0-9a-fA-F]{6}$/.test(input.color)) || (input.unit!==undefined && (!Number.isFinite(input.unit) || input.unit<=0 || input.unit>1e12))) return json(res,400,{error:'Estilo de conexión inválido'});
      const previous=source.connections || [];
      const existing=previous.find(link=>link.targetId===target.id && link.sourceSide===input.sourceSide && link.targetSide===input.targetSide);
      if(existing) return json(res,200,{connection:{...existing,sourceId:source.id},created:false});
      if(previous.length>=1000) return json(res,400,{error:'Este elemento tiene demasiadas conexiones'});
      if(input.id && [...items.values(),...writings.values()].some(item=>(item.connections || []).some(link=>link.id===input.id))) return json(res,409,{error:'La conexión ya existe'});
      const connection={id:input.id || randomUUID(),sourceSide:input.sourceSide,targetId:target.id,targetSide:input.targetSide,color:input.color || '#c67bea',unit:input.unit || (source.displayWidth || 320)/320};
      source.connections=[...previous,connection];
      try { await persist(); } catch(error) { source.connections=previous; throw error; }
      return json(res,201,{connection:{...connection,sourceId:source.id},created:true});
    }
    const connectionMatch=/^\/api\/connections\/([0-9a-f-]{36})$/.exec(pathname);
    if(req.method==='DELETE' && connectionMatch) {
      const source=[...items.values(),...writings.values()].find(item=>storage.accessible(writings.has(item.id)?'writings':'items',item.id,session) && (item.connections || []).some(link=>link.id===connectionMatch[1]));
      if(!source) return json(res,404,{error:'La conexión no está disponible'});
      const previous=source.connections;
      source.connections=previous.filter(link=>link.id!==connectionMatch[1]);
      try { await persist(); } catch(error) { source.connections=previous; throw error; }
      return json(res,200,{ok:true});
    }
    if (req.method === 'GET' && pathname === '/api/items') {
      const visible=[...items.values()].filter(o=>storage.accessible('items',o.id,session)),result=[];
      for(let i=0;i<visible.length;i+=64)result.push(...await Promise.all(visible.slice(i,i+64).map(mediaAvailability)));
      return json(res,200,result);
    }
    if (req.method === 'GET' && pathname === '/api/strokes') return json(res, 200, [...strokes.values()].filter(o => storage.accessible('strokes', o.id, session)));
    if (req.method === 'POST' && ['/api/group-scale','/api/frozen-release'].includes(pathname)) {
      const frozenRelease=pathname==='/api/frozen-release';
      if (req.headers['x-apoxia-protocol'] !== '16') return json(res, 409, { error: 'Recarga la interfaz' });
      const input = await readJson(req, 2000000);
      if(frozenRelease) { input.factor=1; input.x=0; input.y=0; }
      if (!Array.isArray(input.objects) || !input.objects.length || input.objects.length > 20000 || ![input.factor,input.x,input.y].every(Number.isFinite) || input.factor <= 0) return json(res, 400, { error: 'Escala inválida' });
      const maps = { items, writings, strokes }, changes = [], seen = new Set();
      for (const entry of input.objects) {
        if (!entry || typeof entry.kind !== 'string' || typeof entry.id !== 'string') return json(res,400,{error:'Elemento inválido'});
        const object = maps[entry.kind]?.get(entry.id), key = `${entry.kind}:${entry.id}`;
        if (!object || seen.has(key) || !storage.accessible(entry.kind,entry.id,session)) return json(res, 404, { error: 'Contenido no disponible' });
        if (object.locked) return json(res, 409, { error: 'Desbloquea los elementos para escalarlos' });
        seen.add(key);
        const before = {}, after = {}, factor = frozenRelease?entry.factor:input.factor;
        const dx=frozenRelease?entry.dx:0,dy=frozenRelease?entry.dy:0;
        if(![factor,dx,dy].every(Number.isFinite) || factor<=0) return json(res,400,{error:'Transformación inválida'});
        const position = (value,anchor,shift=0) => anchor + (value-anchor)*factor+shift;
        if (entry.kind === 'strokes') {
          before.points = object.points; before.width = object.width;
          after.points = object.points.map(([x,y]) => [position(x,input.x,dx),position(y,input.y,dy)]); after.width = object.width*factor;
          if (!after.points.every(point => point.every(Number.isFinite)) || !Number.isFinite(after.width) || after.width < 1e-12 || after.width > 1e12) return json(res,400,{error:'Escala del trazo inválida'});
        } else {
          before.x = object.x; before.y = object.y;
          after.x = position(object.x,input.x,dx); after.y = position(object.y,input.y,dy);
          const dimensions = entry.kind === 'writings' ? {size:object.size} : {
            displayWidth:object.displayWidth || (object.type === 'text' ? 300 : 320),
            displayHeight:object.displayHeight || (object.type === 'text' ? 160 : 180),
            ...(object.type === 'text' ? {chromeScale:object.chromeScale || 1,textFontSize:object.textFontSize || 17*(object.chromeScale || 1)} : {})
          };
          for (const [field,value] of Object.entries(dimensions)) { before[field]=value; after[field]=value*factor; }
          if (!Object.values(after).every(Number.isFinite) || Object.entries(after).some(([field,value]) => {
            if (field==='x' || field==='y') return false;
            return value < (field.startsWith('display') ? 1e-9 : 1e-12) || value > (field==='size' ? 1e16 : 1e12);
          })) return json(res,400,{error:'Escala fuera de los límites'});
        }
        changes.push({object,before,after});
      }
      for (const change of changes) Object.assign(change.object,change.after);
      try { await persist(); }
      catch (error) { for (const change of changes) Object.assign(change.object,change.before); throw error; }
      return json(res,200,{ok:true});
    }
    if(req.method==='POST'&&pathname==='/api/duplicate'){
      const input=await readJson(req,64000000),maps={items,writings,strokes};
      if(!Array.isArray(input.objects)||!input.objects.length||input.objects.length>2000||![input.dx??0,input.dy??0].every(Number.isFinite))return json(res,400,{error:'Copia inválida'});
      const sources=[],seen=new Set();
      for(const entry of input.objects){const source=maps[entry.kind]?.get(entry.id)||(entry.kind==='items'?deletedItems.get(entry.id):null),key=`${entry.kind}:${entry.id}`;
        if(!source||seen.has(key)||!storage.accessible(entry.kind,entry.id,session))return json(res,404,{error:'Contenido no disponible'});
        if(entry.kind==='items'&&!['text','image','video','audio'].includes(source.type))return json(res,400,{error:'Objeto no compatible'});
        if(entry.kind==='items'&&source.status!=='ready')return json(res,409,{error:'Espera a que termine la importación'});
        seen.add(key);sources.push({entry,source,owner:storage.owner(entry.kind,entry.id)});
      }
      const created=[],files=[],members=new Map(),ids=new Map(sources.map(({entry})=>[`${entry.kind}:${entry.id}`,randomUUID()]));
      const inventory=new Map(),indexAsset=relative=>{const name=path.basename(relative),id=name.slice(0,36);if(!/^[0-9a-f-]{36}(?:-thumb)?\.[a-z0-9]{1,8}$/.test(name))return;let list=inventory.get(id);if(!list)inventory.set(id,list=[]);list.push(relative);};
      if(sources.some(({source,entry})=>entry.kind==='items'&&source.type!=='text')){
        for(const directory of ['media','originals'])for(const name of await fsp.readdir(path.join(dataDir,directory)))indexAsset(`${directory}/${name}`);
        for(const owner of new Set(sources.map(source=>source.owner).filter(owner=>owner?.crypto)))for(const relative of Object.keys(storage.contexts.get(owner.id)?.assets||{}))indexAsset(relative);
      }

      try{
        for(const {entry,source,owner} of sources){
          const object=structuredClone(source);object.id=ids.get(`${entry.kind}:${entry.id}`);object.locked=false;object.createdAt=Date.now();delete object.deleted;delete object.importBatch;delete object.vaultId;
          const snapshot=entry.snapshot;
          if(snapshot){
            if('crop' in snapshot){if(source.type!=='image')throw Error('Recorte inválido');object.crop=Crop.normalize(snapshot.crop);}
            if(entry.kind==='strokes'){
              if('points' in snapshot){
                if(!Array.isArray(snapshot.points)||snapshot.points.length<2||snapshot.points.length>20000||!snapshot.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)))throw Error('Geometría de copia inválida');
                object.points=structuredClone(snapshot.points);
              }
              if('width' in snapshot){if(!Number.isFinite(snapshot.width)||snapshot.width<1e-12||snapshot.width>1e12)throw Error('Geometría de copia inválida');object.width=snapshot.width;}
              if('color' in snapshot){if(!/^#[0-9a-fA-F]{6}$/.test(snapshot.color))throw Error('Color de copia inválido');object.color=snapshot.color;}
            }
            const numbers=entry.kind==='strokes'?[]:entry.kind==='writings'?['x','y','size']:['x','y','displayWidth','displayHeight','chromeScale','textFontSize'];
            for(const key of numbers)if(key in snapshot){if(!Number.isFinite(snapshot[key])||(key!=='x'&&key!=='y'&&snapshot[key]<=0))throw Error('Geometría de copia inválida');object[key]=snapshot[key];}
            if(entry.kind==='writings'||source.type==='text'){
              if(typeof snapshot.text==='string'&&snapshot.text.length<=(entry.kind==='writings'?5000:1000000))object.text=snapshot.text;
              if(snapshot.color==='magic-gradient'&&source.type==='text'||/^#[0-9a-fA-F]{6}$/.test(snapshot.color||''))object.color=snapshot.color;
              if(typeof snapshot.backgroundHidden==='boolean'&&source.type==='text')object.backgroundHidden=snapshot.backgroundHidden;
            }
          }
          if(entry.kind==='strokes'){
            object.points=object.points.map(([x,y])=>[x+(input.dx||0),y+(input.dy||0)]);
            if(!object.points.every(p=>p.every(Number.isFinite)))throw Error('Coordenadas inválidas');
          }else{object.x+=(input.dx||0);object.y+=(input.dy||0);if(![object.x,object.y].every(Number.isFinite))throw Error('Coordenadas inválidas');}
          object.connections=(object.connections||[]).filter(link=>ids.has(`items:${link.targetId}`)||ids.has(`writings:${link.targetId}`)).map(link=>({...link,id:randomUUID(),targetId:ids.get(`items:${link.targetId}`)||ids.get(`writings:${link.targetId}`)}));
          if(owner){if(!members.has(owner.id))members.set(owner.id,{members:structuredClone(owner.members),privateIds:structuredClone(owner.privateIds)});await storage.assign(entry.kind,object.id,owner.id,session);}
          created.push({kind:entry.kind,object,vaultId:owner?.id||null});maps[entry.kind].set(object.id,object);
          if(entry.kind==='items'&&source.type!=='text')files.push(...await storage.copyItemAssets(owner,source.id,object.id,inventory));
        }
        await persist();
        return json(res,201,{objects:created});
      }catch(error){
        for(const entry of created)maps[entry.kind].delete(entry.object.id);
        for(const [id,before] of members){const vault=vaults.get(id);vault.members=before.members;vault.privateIds=before.privateIds;}storage.rebuildOwners();
        await Promise.all(files.map(file=>fsp.rm(file,{force:true})));throw error;
      }
    }
    if (req.method === 'POST' && pathname === '/api/group-move') {
      const input = await readJson(req, 2000000);
      if (!Array.isArray(input.objects) || !input.objects.length || input.objects.length > 20000 || ![input.dx, input.dy].every(Number.isFinite)) return json(res, 400, { error: 'Movimiento inválido' });
      const maps = { items, writings, strokes }, seen = new Set(), changes = [];
      for (const entry of input.objects) {
        const object = maps[entry.kind]?.get(entry.id), key = `${entry.kind}:${entry.id}`;
        if (!object || seen.has(key) || !storage.accessible(entry.kind, entry.id, session)) return json(res, 404, { error: 'Contenido no disponible' });
        if (object.locked) return json(res, 409, { error: 'Desbloquea los elementos para moverlos' });
        seen.add(key);
        const before = entry.kind === 'strokes' ? { points: object.points } : { x: object.x, y: object.y };
        const after = entry.kind === 'strokes' ? { points: object.points.map(([x,y]) => [x + input.dx, y + input.dy]) } : { x: object.x + input.dx, y: object.y + input.dy };
        if (entry.kind === 'strokes' ? !after.points.every(p => p.every(Number.isFinite)) : ![after.x, after.y].every(Number.isFinite)) return json(res, 400, { error: 'Coordenadas inválidas' });
        changes.push({ object, before, after });
      }
      for (const change of changes) Object.assign(change.object, change.after);
      try { await persist(); }
      catch (error) { for (const change of changes) Object.assign(change.object, change.before); throw error; }
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && pathname === '/api/writings') return json(res, 200, [...writings.values()].filter(o => storage.accessible('writings', o.id, session)));
    if (req.method === 'POST' && pathname === '/api/writings/restore') {
      const writing = await readJson(req, 20000);
      if (!storage.accessible('writings', writing.id, session)) return json(res, 404, { error: 'Contenido no disponible' });
      if (!/^[0-9a-f-]{36}$/.test(writing.id || '') || writings.has(writing.id) || typeof writing.text !== 'string' || !writing.text.trim() || writing.text.length > 5000 || ![writing.x, writing.y, writing.size].every(Number.isFinite) || writing.size < 1e-12 || writing.size > 1e16 || !/^#[0-9a-fA-F]{6}$/.test(writing.color)) return json(res, 400, { error: 'Texto vectorial inválido' });
      if (writing.vaultId) await storage.assign('writings', writing.id, writing.vaultId, session);
      delete writing.vaultId;
      writings.set(writing.id, writing);
      await saveWritings();
      return json(res, 201, writing);
    }
    if (req.method === 'POST' && pathname === '/api/writings') {
      const input = await readJson(req, 20000);
      if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 5000 || ![input.x, input.y, input.size].every(Number.isFinite) || input.size < 1e-12 || input.size > 1e16 || !/^#[0-9a-fA-F]{6}$/.test(input.color)) return json(res, 400, { error: 'Texto vectorial inválido' });
      const writing = { id: randomUUID(), text: input.text, x: input.x, y: input.y, size: input.size, color: input.color };
      if (input.vaultId) await storage.assign('writings', writing.id, input.vaultId, session);
      writings.set(writing.id, writing);
      await saveWritings();
      return json(res, 201, writing);
    }
    const writingMatch = /^\/api\/writings\/([0-9a-f-]{36})$/.exec(pathname);
    if (writingMatch && writings.has(writingMatch[1])) {
      const writing = writings.get(writingMatch[1]);
      if (req.method === 'PATCH') {
        const input = await readJson(req, 20000);
        if ('text' in input && (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 5000)) return json(res, 400, { error: 'Texto inválido' });
        if (['x', 'y', 'size'].some(key => key in input && !Number.isFinite(input[key]))) return json(res, 400, { error: 'Posición inválida' });
        if ('size' in input && (input.size < 1e-12 || input.size > 1e16)) return json(res, 400, { error: 'Tamaño inválido' });
        if ('locked' in input && typeof input.locked !== 'boolean') return json(res,400,{error:'Bloqueo inválido'});
        if (writing.locked && input.locked !== false && ['text','x','y','size'].some(key=>key in input && input[key]!==writing[key])) return json(res,409,{error:'Desbloquea el texto para editarlo, moverlo o cambiar su tamaño'});
        for (const key of ['text', 'x', 'y', 'size', 'color', 'locked']) if (key in input) writing[key] = input[key];
        await saveWritings();
        return json(res, 200, writing);
      }
      if (req.method === 'DELETE') {
        writings.delete(writing.id);
        await saveWritings();
        return json(res, 200, { ok: true });
      }
    }
    if (req.method === 'DELETE' && pathname === '/api/board') {
      const confirmation = await readJson(req, 1000);
      if (confirmation.confirm !== 'BORRAR TODO') return json(res, 400, { error: 'Confirmación inválida' });
      if (clearing || activeWrites || active || queue.length) return json(res, 409, { error: 'Espera a que terminen las importaciones y vuelve a intentarlo' });
      clearing = true;
      try {
        const deleted = { items: items.size, strokes: strokes.size, writings: writings.size };
        storage.eraseKeys(); items.clear(); deletedItems.clear(); strokes.clear(); writings.clear(); vaults.clear();
        await save(); await saveStrokes(); await saveWritings(); await saveVaults();
        await Promise.all([mediaDir, originalDir, tempDir].map(directory => fsp.rm(directory, { recursive: true, force: true })));
        await Promise.all([mediaDir, originalDir, tempDir].map(directory => fsp.mkdir(directory, { recursive: true })));
        return json(res, 200, { ok: true, deleted });
      } finally { clearing = false; }
    }
    if (req.method === 'POST' && pathname === '/api/strokes/delete-batch') {
      const input = await readJson(req, 2000000);
      if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 20000 || !input.ids.every(id => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id))) return json(res, 400, { error: 'Lista de trazados inválida' });
      const ids = [...new Set(input.ids)];
      if (ids.some(id => !storage.accessible('strokes', id, session))) return json(res, 404, { error: 'Contenido no disponible' });
      const removed = ids.map(id => strokes.get(id)).filter(Boolean);
      for (const id of ids) strokes.delete(id);
      try { await saveStrokes(); }
      catch (error) { for (const stroke of removed) strokes.set(stroke.id, stroke); throw error; }
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && pathname === '/api/strokes') {
      const input = await readJson(req, 2000000);
      if (!Array.isArray(input.points) || input.points.length < 2 || input.points.length > 20000 || !input.points.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)) || !/^#[0-9a-fA-F]{6}$/.test(input.color) || !Number.isFinite(input.width) || input.width < 1e-12 || input.width > 1e12) return json(res, 400, { error: 'Trazo inválido' });
      if(input.shape!==undefined&&!['rectangle','ellipse'].includes(input.shape))return json(res,400,{error:'Forma inválida'});
      const stroke = { id: randomUUID(), points: input.points, color: input.color, width: input.width };
      if(input.shape)stroke.shape=input.shape;
      if (input.vaultId) await storage.assign('strokes', stroke.id, input.vaultId, session);
      strokes.set(stroke.id, stroke);
      await saveStrokes();
      return json(res, 201, stroke);
    }
    if (req.method === 'POST' && pathname === '/api/strokes/restore-batch') {
      const input = await readJson(req, 64000000);
      const batch = input.strokes;
      if (!Array.isArray(batch) || !batch.length || batch.length > 20000 || new Set(batch.map(stroke => stroke?.id)).size !== batch.length) return json(res, 400, { error: 'Lista de trazados inválida' });
      for (const stroke of batch) {
        if (!stroke || (stroke.shape!==undefined&&!['rectangle','ellipse'].includes(stroke.shape)) || !/^[0-9a-f-]{36}$/.test(stroke.id || '') || strokes.has(stroke.id) || !Array.isArray(stroke.points) || stroke.points.length < 2 || stroke.points.length > 20000 || !stroke.points.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)) || !/^#[0-9a-fA-F]{6}$/.test(stroke.color) || !Number.isFinite(stroke.width) || stroke.width < 1e-12 || stroke.width > 1e12) return json(res, 400, { error: 'Trazo inválido' });
        if (!storage.accessible('strokes', stroke.id, session) || (stroke.vaultId && (!vaults.has(stroke.vaultId) || !storage.isOpen(vaults.get(stroke.vaultId), session)))) return json(res, 404, { error: 'Contenido no disponible' });
        const owner = storage.owner('strokes', stroke.id);
        if (owner && owner.id !== stroke.vaultId) return json(res, 409, { error: 'El trazo pertenece a otra Vault' });
      }
      const before = [...new Set(batch.map(stroke => stroke.vaultId).filter(Boolean))].map(id => {
        const vault = vaults.get(id);
        return { vault, members: [...vault.members.strokes], privateIds: vault.privateIds ? [...vault.privateIds.strokes] : null };
      });
      try {
        for (const stroke of batch) {
          if (stroke.vaultId) await storage.assign('strokes', stroke.id, stroke.vaultId, session);
          delete stroke.vaultId;
          strokes.set(stroke.id, stroke);
        }
        await saveStrokes();
      } catch (error) {
        for (const stroke of batch) strokes.delete(stroke.id);
        for (const entry of before) { entry.vault.members.strokes = entry.members; if(entry.privateIds) entry.vault.privateIds.strokes = entry.privateIds; }
        storage.rebuildOwners();
        throw error;
      }
      return json(res, 201, batch);
    }
    if (req.method === 'POST' && pathname === '/api/strokes/restore') {
      const stroke = await readJson(req, 2000000);
      if (!storage.accessible('strokes', stroke.id, session)) return json(res, 404, { error: 'Contenido no disponible' });
      if ((stroke.shape!==undefined&&!['rectangle','ellipse'].includes(stroke.shape)) || !/^[0-9a-f-]{36}$/.test(stroke.id || '') || strokes.has(stroke.id) || !Array.isArray(stroke.points) || stroke.points.length < 2 || stroke.points.length > 20000 || !stroke.points.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)) || !/^#[0-9a-fA-F]{6}$/.test(stroke.color) || !Number.isFinite(stroke.width) || stroke.width < 1e-12 || stroke.width > 1e12) return json(res, 400, { error: 'Trazo inválido' });
      if (stroke.vaultId) await storage.assign('strokes', stroke.id, stroke.vaultId, session);
      delete stroke.vaultId;
      strokes.set(stroke.id, stroke);
      await saveStrokes();
      return json(res, 201, stroke);
    }
    const strokeMatch = /^\/api\/strokes\/([0-9a-f-]{36})$/.exec(pathname);
    if (strokeMatch && req.method === 'DELETE' && strokes.has(strokeMatch[1])) {
      strokes.delete(strokeMatch[1]);
      await saveStrokes();
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && pathname === '/api/text') {
      const input = await readJson(req);
      if (!Number.isFinite(input.x) || !Number.isFinite(input.y) || ![input.displayWidth, input.displayHeight, input.textFontSize].every(value => Number.isFinite(value) && value >= 1e-9 && value <= 1e12)) return json(res, 400, { error: 'Tamaño o coordenadas inválidos' });
      const chromeScale = Number.isFinite(input.chromeScale) && input.chromeScale > 0 ? Math.min(1e12, Math.max(1e-9, input.chromeScale)) : 1;
      const item = { id: randomUUID(), type: 'text', name: 'Texto', x: input.x, y: input.y, displayWidth: input.displayWidth, displayHeight: input.displayHeight, textFontSize: input.textFontSize, chromeScale, text: '', color: input.color === 'magic-gradient' || /^#[0-9a-fA-F]{6}$/.test(input.color || '') ? input.color : '#1a2542', status: 'ready', createdAt: Date.now() };
      if (input.vaultId) {await clearPreviewPacks();await storage.assign('items', item.id, input.vaultId, session);}
      items.set(item.id, item);
      await save();
      return json(res, 201, item);
    }
    if (req.method === 'POST' && pathname === '/api/text/restore') {
      const item = await readJson(req, 30000);
      if (!storage.accessible('items', item.id, session)) return json(res, 404, { error: 'Contenido no disponible' });
      if (!/^[0-9a-f-]{36}$/.test(item.id || '') || items.has(item.id) || item.type !== 'text' || ![item.x, item.y, item.displayWidth, item.displayHeight, item.textFontSize].every(Number.isFinite) || item.displayWidth < 1e-9 || item.displayHeight < 1e-9 || typeof item.text !== 'string' || item.text.length > 1000000 || !(item.color === 'magic-gradient' || /^#[0-9a-fA-F]{6}$/.test(item.color))) return json(res, 400, { error: 'Nota inválida' });
      if (item.vaultId) {await clearPreviewPacks();await storage.assign('items', item.id, item.vaultId, session);}
      delete item.vaultId;
      items.set(item.id, item);
      await save();
      return json(res, 201, item);
    }
    if (req.method === 'POST' && pathname === '/api/items/restore') {
      const input = await readJson(req, 1000);
      if (!storage.accessible('items', input.id, session)) return json(res, 404, { error: 'Contenido no disponible' });
      const item = deletedItems.get(input.id);
      if (!item) return json(res, 404, { error: 'Elemento borrado no disponible' });
      const privateOwner = storage.owner('items', item.id);
      if (input.vaultId || privateOwner?.crypto) {await clearPreviewPacks();await storage.assign('items', item.id, input.vaultId || privateOwner.id, session);}
      deletedItems.delete(item.id);
      delete item.deleted;
      if (item.vaultId) {await clearPreviewPacks();await storage.assign('items', item.id, item.vaultId, session);}
      delete item.vaultId;
      items.set(item.id, item);
      await save();
      return json(res, 201, item);
    }
    if(req.method==='POST'&&pathname==='/api/pinterest-media'){
      // Network-only lookup: keep canvas edits available during long downloads.
      releaseMutation?.();releaseMutation=null;
      const input=await readJson(req,10000),controller=new AbortController();
      const cancel=()=>{if(!res.writableEnded)controller.abort();};res.once('close',cancel);
      try {
        const result=await resolvePinterestMedia(input,{signal:controller.signal});
        if(result.kind==='image')return json(res,200,result);
        res.writeHead(200,{'Content-Type':result.type,'Content-Length':result.bytes.length,'Cache-Control':'no-store'});
        res.end(result.bytes);return;
      }catch(error){if(res.destroyed)return;return json(res,400,{error:error.name==='TimeoutError'?'La descarga de Pinterest ha tardado demasiado':error.name==='TypeError'&&error.message==='fetch failed'?'No se pudo conectar con Pinterest':error.message});}
      finally{res.removeListener('close',cancel);}
    }
    if (req.method === 'POST' && pathname === '/api/pinterest-image') {
      releaseMutation?.();releaseMutation=null;
      const input=await readJson(req,10000);
      let remote;
      try { remote=new URL(input.url); } catch { return json(res,400,{error:'URL de imagen inválida'}); }
      const imageHost=url=>url.hostname==='pinimg.com' || url.hostname.endsWith('.pinimg.com');
      const pinHost=url=>url.hostname==='pin.it' || /^([a-z0-9-]+\.)?pinterest\.(com|es|co\.uk|fr|de|it|pt|ca|com\.au|jp|ch|at|nl|se|dk|no|fi|ie|co\.kr|com\.mx|com\.br)$/.test(url.hostname);
      const allowed=(url,page)=>url.protocol==='https:' && !url.username && !url.password && !url.port && (page?pinHost(url):imageHost(url));
      const signal=AbortSignal.timeout(30000), limit=32*1024*1024;
      const remoteFetch=async (start,page=false)=> {
        let target=new URL(start);
        for(let attempt=0;attempt<6;attempt++) {
          if(!allowed(target,page)) throw new Error('Enlace de Pinterest no permitido');
          const response=await fetch(target,{redirect:'manual',signal});
          if(![301,302,303,307,308].includes(response.status)) return response;
          const location=response.headers.get('location'); await response.body?.cancel();
          if(!location) break;
          target=new URL(location,target);
        }
        throw new Error('No se pudo obtener la imagen de Pinterest');
      };
      if(!imageHost(remote)) {
        if(!allowed(remote,true) || remote.hostname!=='pin.it' && !/^\/pin\/\d+/.test(remote.pathname)) return json(res,400,{error:'Arrastra una imagen o el enlace de un pin de Pinterest'});
        const page=await remoteFetch(remote,true);
        if(!page.ok) { await page.body?.cancel(); return json(res,400,{error:'Pinterest no permite acceder a este pin. Prueba arrastrando su foto abierta.'}); }
        const htmlChunks=[];let htmlSize=0;
        for await(const chunk of page.body) { htmlSize+=chunk.length; if(htmlSize>4*1024*1024) throw new Error('La página de Pinterest es demasiado grande'); htmlChunks.push(chunk); }
        const html=Buffer.concat(htmlChunks).toString('utf8');
        const decode=value=>value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#(\d+);/g,(_,code)=>String.fromCodePoint(Number(code)));
        let image;
        for(const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
          const attributes=Object.fromEntries([...tag[0].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map(match=>[match[1].toLowerCase(),decode(match[3])]));
          if(['og:image','og:image:secure_url','twitter:image'].includes(attributes.property || attributes.name) && attributes.content) {
            try { const candidate=new URL(attributes.content); if(allowed(candidate,false)) { image=candidate; break; } } catch {}
          }
        }
        if(!image) return json(res,400,{error:'No se pudo encontrar la foto de este pin. Ábrelo y arrastra la imagen.'});
        remote=image;
      }
      if(!allowed(remote,false)) return json(res,400,{error:'Arrastra una imagen alojada en Pinterest'});
      const versions=[remote];
      // Pinterest uses the same image identifier for its thumbnail and original.
      if(/^\/\d+x(?:\d+)?\//.test(remote.pathname)) {
        const original=new URL(remote); original.pathname=original.pathname.replace(/^\/\d+x(?:\d+)?\//,'/originals/');
        const large=new URL(remote); large.pathname=large.pathname.replace(/^\/\d+x(?:\d+)?\//,'/1200x/');
        versions.unshift(original,large);
      }
      let response;
      for(const version of versions) {
        response=await remoteFetch(version);
        if(response.ok && /^image\/(jpeg|png|webp|gif|avif)(;|$)/i.test(response.headers.get('content-type') || '')) break;
        await response.body?.cancel();
      }
      const type=response.headers.get('content-type')?.split(';')[0].toLowerCase();
      if(!response.ok || !['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(type)) {
        await response.body?.cancel(); return json(res,400,{error:'Pinterest no permite descargar esa imagen'});
      }
      if(Number(response.headers.get('content-length'))>limit) { await response.body.cancel(); return json(res,400,{error:'La imagen supera 32 MB'}); }
      const chunks=[];let size=0;
      for await(const chunk of response.body) {
        size+=chunk.length;
        if(size>limit) throw new Error('La imagen supera 32 MB');
        chunks.push(chunk);
      }
      if(!size) return json(res,400,{error:'La imagen está vacía'});
      res.writeHead(200,{'Content-Type':type,'Content-Length':size,'Cache-Control':'no-store'});
      res.end(Buffer.concat(chunks,size)); return;
    }
    if (req.method === 'POST' && pathname === '/api/items') {
      const id = randomUUID();
      const input = path.join(tempDir, id);
      const linked = url.searchParams.get('linked') === '1';
      let linkedPath;
      if (linked) {
        if (!localMediaKey || req.headers['x-apoxia-local-media-key'] !== localMediaKey) return json(res,403,{error:'Importación local no autorizada'});
        linkedPath=(await readJson(req,20000)).path;
        if(typeof linkedPath!=='string'||!path.isAbsolute(linkedPath)||!(await fsp.stat(linkedPath)).isFile()) return json(res,400,{error:'Archivo original inválido'});
      } else await receive(req, input);
      const x = Number(url.searchParams.get('x')), y = Number(url.searchParams.get('y'));
      const requestedType = url.searchParams.get('type');
      const type = ['image', 'audio'].includes(requestedType) ? requestedType : 'video';
      const name = (url.searchParams.get('name') || (type === 'image' ? 'Imagen' : 'Vídeo')).slice(0, 160);
      const requestedWidth = Number(url.searchParams.get('displayWidth'));
      const displayWidth = Number.isFinite(requestedWidth) && requestedWidth > 0 ? Math.min(1e12, Math.max(1e-9, requestedWidth)) : 320;
      const requestedChrome = Number(url.searchParams.get('chromeScale'));
      const chromeScale = Number.isFinite(requestedChrome) && requestedChrome > 0 ? Math.min(1e12, Math.max(1e-9, requestedChrome)) : 1;
      const item = { id, type, name, x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0, displayWidth, displayHeight: displayWidth * 9 / 16, chromeScale, status: 'processing', createdAt: Date.now() };
      const batchId = url.searchParams.get('importBatch');
      const batchIndex = Number(url.searchParams.get('batchIndex'));
      const batchX = Number(url.searchParams.get('batchX')), batchY = Number(url.searchParams.get('batchY'));
      if (/^[0-9a-f-]{36}$/.test(batchId || '') && Number.isInteger(batchIndex) && batchIndex >= 0 && batchIndex < 100000 && Number.isFinite(batchX) && Number.isFinite(batchY)) item.importBatch={id:batchId,index:batchIndex,x:batchX,y:batchY,columns:Math.min(1000,Math.max(1,Number(url.searchParams.get('batchColumns'))||4))};
      const ext = /^\.[a-z0-9]{1,8}$/i.test(path.extname(name)) ? path.extname(name).toLowerCase() : '.bin';
      const source = path.join(originalDir, `${id}${ext}`);
      if(linked) await fsp.symlink(await fsp.realpath(linkedPath),source);
      else await fsp.rename(input, source);
      item.originalExt = ext;
      item.originalAvailable = true;
      item.originalBytes = (await fsp.stat(source)).size;
      if(type==='video'){item.browserVideoCompatible=url.searchParams.get('nativeVideo')==='1';if(linked)item.linkedPlayback=true;}
      const nativeWidth=Number(url.searchParams.get('originalWidth')),nativeHeight=Number(url.searchParams.get('originalHeight'));
      const encoded=req.headers['x-apoxia-thumbnail'];let thumbnail;
      if(type==='image'&&url.searchParams.get('native')==='1'&&Number.isInteger(nativeWidth)&&Number.isInteger(nativeHeight)&&nativeWidth>0&&nativeHeight>0&&nativeWidth<=1000000&&nativeHeight<=1000000&&typeof encoded==='string'&&encoded.length<12000){const decoded=Buffer.from(encoded,'base64');if(decoded.subarray(0,4).toString()==='RIFF'&&decoded.subarray(8,12).toString()==='WEBP')thumbnail=decoded;}
      if(thumbnail){await fsp.writeFile(path.join(mediaDir,`${id}-thumb.webp`),thumbnail);Object.assign(item,{gpuOriginalOnly:true,status:'ready',width:nativeWidth,height:nativeHeight,originalWidth:nativeWidth,originalHeight:nativeHeight,displayHeight:displayWidth*nativeHeight/nativeWidth,bytes:item.originalBytes});}
      items.set(id,item);
      arrangeImportBatch(item.importBatch?.id);
      await save();
      if(!thumbnail){queue.push({id,input:source});pump();}
      return json(res,thumbnail?201:202,item);
    }
    const originalPath = /^\/api\/items\/([0-9a-f-]{36})\/original-path$/.exec(pathname);
    if (originalPath && req.method === 'GET') {
      const item = items.get(originalPath[1]);
      if (!item || !item.originalAvailable || !/^\.[a-z0-9]{1,8}$/.test(item.originalExt || '')) return json(res, 404, { error: 'Original no disponible' });
      if (storage.owner('items', item.id)?.crypto) return json(res, 409, { error: 'El original es privado dentro de una Vault; usa la descarga para obtener una copia' });
      const originalFile = path.join(originalDir, `${item.id}${item.originalExt}`);
      try { await fsp.access(originalFile); }
      catch { return json(res, 404, { error: 'El archivo original ya no está disponible' }); }
      return json(res, 200, { path: originalFile });
    }
    const match = /^\/api\/items\/([0-9a-f-]{36})$/.exec(pathname);
    if (match && items.has(match[1])) {
      const id = match[1], item = items.get(id);
      if (req.method === 'PATCH') {
        const changes = await readJson(req, 8000000);
        if ('backgroundHidden' in changes && (item.type !== 'text' || typeof changes.backgroundHidden !== 'boolean')) return json(res, 400, { error: 'Fondo de nota inválido' });
        if ('backgroundHidden' in changes) item.backgroundHidden = changes.backgroundHidden;
        if ('locked' in changes && typeof changes.locked !== 'boolean') return json(res, 400, { error: 'Bloqueo inválido' });
        const cropChanged='crop' in changes;
        if(cropChanged&&(item.type!=='image'))return json(res,400,{error:'Solo las imágenes admiten recorte'});
        const nextCrop=cropChanged?Crop.normalize(changes.crop):item.crop;
        const geometryChanged = ['crop', 'x', 'y', 'displayWidth', 'displayHeight', 'chromeScale', 'textFontSize'].some(key => key in changes);
        if (item.locked && changes.locked !== false && geometryChanged) return json(res, 409, { error: 'Desbloquea la referencia para moverla o cambiar su tamaño' });
        for (const key of ['chromeScale', 'textFontSize']) {
          if (key in changes && (item.type !== 'text' || !Number.isFinite(changes[key]) || changes[key] < 1e-12 || changes[key] > 1e12)) return json(res, 400, { error: 'Escala de nota inválida' });
        }
        for (const key of ['x', 'y', 'displayWidth', 'displayHeight']) {
          if (key in changes) {
            if (!Number.isFinite(changes[key]) || (key.startsWith('display') && (changes[key] < 1e-9 || changes[key] > 1e12))) return json(res, 400, { error: 'Tamaño o coordenadas inválidos' });
            item[key] = changes[key];
          }
        }
        for (const key of ['chromeScale', 'textFontSize']) if (key in changes) item[key] = changes[key];
        if(cropChanged)item.crop=nextCrop;
        // User positioning takes precedence over automatic import placement.
        if (['crop','x', 'y', 'displayWidth', 'displayHeight'].some(key => key in changes)) delete item.importBatch;
        if ('locked' in changes) {
          item.locked = changes.locked;
          if (item.locked) delete item.importBatch;
        }
        if (item.type !== 'text' && item.width && item.height && ('displayWidth' in changes || 'displayHeight' in changes || cropChanged)) {
          if (!('displayWidth' in changes)&&'displayHeight' in changes) item.displayWidth = item.displayHeight * Crop.aspect(item);
          item.displayHeight = item.displayWidth / Crop.aspect(item);
        }
        if ('text' in changes) {
          if (item.type !== 'text' || typeof changes.text !== 'string' || changes.text.length > 1000000) return json(res, 400, { error: 'Texto inválido' });
          item.text = changes.text;
        }
        if ('color' in changes) {
          if (item.type !== 'text' || !(changes.color === 'magic-gradient' || /^#[0-9a-fA-F]{6}$/.test(changes.color))) return json(res, 400, { error: 'Color inválido' });
          item.color = changes.color;
        }
        await save();
        return json(res, 200, item);
      }
      if (req.method === 'DELETE') {
        if (item.type !== 'text') { item.deleted = true; deletedItems.set(id, item); }
        items.delete(id);
        await save();
        return json(res, 200, { ok: true });
      }
    }
    const original = /^\/original\/([0-9a-f-]{36})$/.exec(pathname);
    if (original && (req.method === 'GET' || req.method === 'HEAD')) {
      const item = items.get(original[1]);
      if (!item || !item.originalAvailable || !/^\.[a-z0-9]{1,8}$/.test(item.originalExt || '')) return json(res, 404, { error: 'Original no disponible' });
      const contentType = ({ '.mp4': 'video/mp4', '.m4v': 'video/x-m4v', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.heic': 'image/heic', '.heif': 'image/heif' })[item.originalExt] || 'application/octet-stream';
      if(item.originalExt==='.svg')res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:;");
      const privateVault = storage.owner('items', item.id);
      if (privateVault?.crypto) return await storage.serve(req, res, privateVault, `originals/${item.id}${item.originalExt}`, contentType, session, { 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(item.name)}` }, () => serveFile(req, res, path.join(originalDir, `${item.id}${item.originalExt}`), contentType, 'private, no-store', { 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(item.name)}` }));
      return serveFile(req, res, path.join(originalDir, `${item.id}${item.originalExt}`), contentType, 'private, no-cache', { 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(item.name)}` });
    }
    const media = /^\/media\/([0-9a-f-]{36})(-thumb)?\.(mp4|jpg|webp)$/.exec(pathname);
    if (media && (req.method === 'GET' || req.method === 'HEAD')) {
      if (!items.has(media[1]) || items.get(media[1]).status !== 'ready') return json(res, 404, { error: 'Archivo no encontrado' });
      const privateVault = storage.owner('items', media[1]);
      const item=items.get(media[1]);
      if(item.gpuOriginalOnly&&!media[2]&&media[3]==='webp'){
        const relative=`originals/${item.id}${item.originalExt}`;
        if(item.originalExt==='.svg')res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:;");
        const nativeType=({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.gif':'image/gif','.bmp':'image/bmp','.svg':'image/svg+xml'})[item.originalExt]||'application/octet-stream';
        if(privateVault?.crypto)return await storage.serve(req,res,privateVault,relative,nativeType,session,{},()=>serveFile(req,res,path.join(originalDir,`${item.id}${item.originalExt}`),nativeType,'private, no-store'));
        return serveFile(req,res,path.join(originalDir,`${item.id}${item.originalExt}`),nativeType,'private, no-cache');
      }
      const filename = `${media[1]}${media[2] || ''}.${media[3]}`, type = ({ mp4: 'video/mp4', jpg: 'image/jpeg', webp: 'image/webp' })[media[3]];
      if (privateVault?.crypto) return await storage.serve(req, res, privateVault, `media/${filename}`, type, session, {}, () => serveFile(req, res, path.join(mediaDir, filename), type, 'private, no-store'));
      return serveFile(req, res, path.join(mediaDir, filename), type, 'private, no-cache');
    }
    const staticFiles = { '/assets/PatrickHand-Regular.ttf': ['assets/PatrickHand-Regular.ttf','font/ttf'], '/assets/patrick-hand-outlines.json': ['assets/patrick-hand-outlines.json','application/json; charset=utf-8'], '/assets/PaperMono-Regular.woff2': ['assets/PaperMono-Regular.woff2', 'font/woff2'], '/assets/paper-mono-outlines.json': ['assets/paper-mono-outlines.json', 'application/json'], '/gpu-renderer.js':['gpu-renderer.js','text/javascript; charset=utf-8'], '/image-crop.js':['image-crop.js','text/javascript; charset=utf-8'], '/svg-vector.js':['svg-vector.js','text/javascript; charset=utf-8'], '/svg-vector-worker.js':['svg-vector-worker.js','text/javascript; charset=utf-8'], '/gpu-worker.js':['gpu-worker.js','text/javascript; charset=utf-8'], '/gpu-spatial.js':['gpu-spatial.js','text/javascript; charset=utf-8'], '/i18n.js': ['i18n.js', 'text/javascript; charset=utf-8'], '/locales/en.json': ['locales/en.json', 'application/json; charset=utf-8'], '/desktop-bootstrap.js': ['desktop-bootstrap.js', 'text/javascript; charset=utf-8'], '/assets/NimbusRoman-Regular.otf': ['assets/NimbusRoman-Regular.otf', 'font/otf'], '/assets/nimbus-roman-outlines.json': ['assets/nimbus-roman-outlines.json', 'application/json'], '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/vault-coordinates.js': ['vault-coordinates.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/assets/Satisfy-Regular.ttf': ['assets/Satisfy-Regular.ttf', 'font/ttf'], '/assets/satisfy-outlines.json': ['assets/satisfy-outlines.json', 'application/json; charset=utf-8'] };
    staticFiles['/assets/GloriaHallelujah-Regular.ttf']=['assets/GloriaHallelujah-Regular.ttf','font/ttf'];
    staticFiles['/assets/gloria-hallelujah-outlines.json']=['assets/gloria-hallelujah-outlines.json.gz','application/json; charset=utf-8',{'Content-Encoding':'gzip'}];
    staticFiles['/assets/NanumBrushScript-Regular.ttf']=['assets/NanumBrushScript-Regular.ttf','font/ttf'];
    staticFiles['/assets/nanum-brush-script-outlines.json']=['assets/nanum-brush-script-outlines.json.gz','application/json; charset=utf-8',{'Content-Encoding':'gzip'}];
    staticFiles['/assets/LondrinaSolid-Regular.ttf']=['assets/LondrinaSolid-Regular.ttf','font/ttf'];
    staticFiles['/assets/londrina-solid-outlines.json']=['assets/londrina-solid-outlines.json.gz','application/json; charset=utf-8',{'Content-Encoding':'gzip'}];
    staticFiles['/assets/MetalMania-Regular.ttf']=['assets/MetalMania-Regular.ttf','font/ttf'];
    staticFiles['/assets/metal-mania-outlines.json']=['assets/metal-mania-outlines.json.gz','application/json; charset=utf-8',{'Content-Encoding':'gzip'}];
    staticFiles['/assets/GoogleSans-Regular.ttf']=['assets/GoogleSans-Regular.ttf','font/ttf'];
    staticFiles['/assets/google-sans-outlines.json']=['assets/google-sans-outlines.json.gz','application/json; charset=utf-8',{'Content-Encoding':'gzip'}];
    if (req.method === 'GET' && staticFiles[pathname]) return serveFile(req,res,path.join(root,staticFiles[pathname][0]),staticFiles[pathname][1],'private, no-cache',staticFiles[pathname][2]||{});
    json(res, 404, { error: 'No encontrado' });
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    json(res, error.message.includes('2 GB') ? 413 : 400, { error: error.message });
  } finally { releaseMutation?.(); if (writeRequest) activeWrites--; }
}));
setInterval(async () => {
  if(shuttingDown || backupRelease) return;
  const expired = [...browserSessions].filter(([, last]) => Date.now() - last > 120000).map(([id]) => id);
  if (!expired.length) return;
  const release = await acquireMutation();
  try {
    for (const session of expired) {
      if (Date.now() - (browserSessions.get(session) || 0) <= 120000) continue;
      for (const vault of vaults.values()) if (storage.isOpen(vault, session)) await storage.lock(vault, session, persist);
      browserSessions.delete(session);
    }
  } catch (error) { console.error('No se pudo cerrar una sesión de Vault:', error.message); }
  finally { release(); }
}, 30000).unref();
server.on('error',error=> {process.parentPort?.postMessage({type:'startup-error',code:error.code,message:error.message});releaseLock();process.exit(1);});
server.listen(port,'127.0.0.1',()=> {port=server.address().port;console.log(`Apoxia SketchBook: http://127.0.0.1:${port}`);process.parentPort?.postMessage({type:'ready',port});});
let shuttingDown=false;
let backupRelease=null;
process.parentPort?.on('message',async event=> {
  const message=event.data;
  if(!['backup-begin','backup-end'].includes(message?.type)) return;
  try {
    if(message.type==='backup-end') {backupRelease?.();backupRelease=null;}
    else {
      if(backupRelease || shuttingDown) throw new Error('Ya hay una operación de archivos en curso');
      while(active || queue.length || activeWrites) await new Promise(resolve=>setTimeout(resolve,50));
      backupRelease=await acquireMutation();
      // Seal pending private media for a consistent, encrypted on-disk snapshot,
      // while keeping the open Vault session and live contents available afterward.
      for(const vault of vaults.values()) if(storage.contexts.has(vault.id)) await persist({sealAssetsFor:vault.id});
      await persist();
      const ids=new Set();
      for(const map of [items,writings,strokes]) for(const object of map.values()) if(object.fileLink?.id) ids.add(object.fileLink.id);
      const unknown=[];
      for(const vault of vaults.values()) {
        if(Array.isArray(vault.fileLinkIds)) for(const id of vault.fileLinkIds) ids.add(id);
        else if(vault.crypto && !storage.contexts.has(vault.id)) unknown.push(vault.id);
      }
      process.parentPort.postMessage({type:'backup-reply',requestId:message.requestId,value:{ids:[...ids],unknown}});return;
    }
    process.parentPort.postMessage({type:'backup-reply',requestId:message.requestId,value:{ok:true}});
  } catch(error) {
    if(message.type==='backup-begin') {backupRelease?.();backupRelease=null;}
    process.parentPort.postMessage({type:'backup-reply',requestId:message.requestId,error:error.message});
  }
});
process.parentPort?.on('message',async event=> {
  if(event.data?.type!=='shutdown' || shuttingDown) return;
  shuttingDown=true;
  try {
    await new Promise(resolve=>server.close(resolve));
    while(active || queue.length || activeWrites) await new Promise(resolve=>setTimeout(resolve,50));
    const release=await acquireMutation();
    try {for(const vault of vaults.values()) if(vault.crypto && storage.contexts.has(vault.id)) await storage.lock(vault,storage.contexts.get(vault.id).session,persist);await persist();}
    finally {release();}
    await saveChain;releaseLock();process.parentPort.postMessage({type:'stopped'});process.exit(0);
  } catch(error) {process.parentPort.postMessage({type:'shutdown-error',message:error.message});shuttingDown=false;if(!server.listening) server.listen(port,'127.0.0.1');}
});
