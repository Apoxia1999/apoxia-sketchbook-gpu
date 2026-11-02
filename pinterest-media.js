// Resolve only the requested Pinterest pin and its own public CDN media.
const pinDomain=/^([a-z0-9-]+\.)?pinterest\.(com|es|co\.uk|fr|de|it|pt|ca|com\.au|jp|ch|at|nl|se|dk|no|fi|ie|co\.kr|com\.mx|com\.br)$/i;
const pinPath=/^\/pin\/(?:[^/]+--)?(\d+)\/?$/i;
export function pinterestHost(url){return url.hostname==='pin.it'||pinDomain.test(url.hostname);}
export function pinterestCdn(url){return url.hostname==='pinimg.com'||url.hostname.endsWith('.pinimg.com');}
function allowed(url,page){return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&(page?pinterestHost(url):pinterestCdn(url));}
function candidate(value,base){try{const url=new URL(value,base);return allowed(url,false)?url:null;}catch{return null;}}
function videoType(url){if(/\.mp4$/i.test(url.pathname))return 'video/mp4';if(/\.webm$/i.test(url.pathname))return 'video/webm';return null;}
function decodeHtml(s){return s.replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&#(\d+);/g,(_,n)=>{const v=Number(n);return v<=0x10ffff?String.fromCodePoint(v):'';});}
function walk(value,fn){const stack=[value];while(stack.length){const v=stack.pop();if(!v||typeof v!=='object')continue;if(Array.isArray(v)){for(const item of v)stack.push(item);}else{fn(v);for(const child of Object.values(v))if(child&&typeof child==='object')stack.push(child);}}}
function score(url){const match=url.pathname.match(/\/(\d{3,4})p\//i);return (match?Number(match[1]):0)-(url.pathname.includes('/h265/')?5000:0)+(videoType(url)==='video/mp4'?10:0);}
export function extractPinterestPage(html,pinId,base){
 const videos=[],images=[],seen=new Set();let pinFound=false,videoIndicated=false;
 const addVideo=value=>{const u=candidate(value,base);if(!u)return;const type=videoType(u);if(type&&!seen.has(u.href)){seen.add(u.href);videos.push(u);}else if(/\.(m3u8|mpd)$/i.test(u.pathname))videoIndicated=true;};
 const addImage=value=>{const u=candidate(value,base);if(u&&/\.(jpe?g|png|webp|gif|avif)$/i.test(u.pathname))images.push(u);};
 for(const tag of html.matchAll(/<meta\b[^>]*>/gi)){
  const attrs=Object.fromEntries([...tag[0].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map(m=>[m[1].toLowerCase(),decodeHtml(m[3])]));
  const name=(attrs.property||attrs.name||'').toLowerCase();
  if(['og:video','og:video:url','og:video:secure_url','twitter:player:stream'].includes(name)){videoIndicated=true;addVideo(attrs.content);}
  if(['og:image','og:image:secure_url','twitter:image'].includes(name))addImage(attrs.content);
 }
 for(const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)){
  let raw=script[1].trim(),data;
  const relay=raw.match(/^window\.__PWS_RELAY_REGISTER_COMPLETED_REQUEST__\(\s*"(?:[^"\\]|\\.)*"\s*,\s*(\{[\s\S]*\})\s*\);?\s*$/);
  if(relay)raw=relay[1];else if(!raw.startsWith('{')&&!raw.startsWith('['))continue;
  try{data=JSON.parse(raw);}catch{continue;}
  walk(data,obj=>{
   if(!pinId||String(obj.entityId??obj.id??'')!==pinId)return;
   pinFound=true;
   const source=obj.videos||obj.video||null;
   const story=obj.storyPinData||obj.story_pin_data||null;
   if(obj.isVideo===true||obj.is_video===true)videoIndicated=true;
   for(const root of [source,story])if(root)walk(root,v=>{
    if(typeof v.url==='string')addVideo(v.url);
    for(const urls of [v.videoUrls,v.video_urls])if(Array.isArray(urls))for(const u of urls)if(typeof u==='string')addVideo(u);
   });
  });
 }
 videos.sort((a,b)=>score(b)-score(a));
 return {videos, image:images[0]||null, videoIndicated, pinFound};
}
async function fetchAllowed(start,page,signal,fetcher){
 let target=new URL(start);
 for(let i=0;i<6;i++){
  if(!allowed(target,page))throw Error('Enlace de Pinterest no permitido');
  const response=await fetcher(target,{redirect:'manual',signal,headers:{'User-Agent':'Mozilla/5.0 (compatible; ApoxiaSketchbook/1.0)','Accept':page?'text/html,application/json':'video/mp4,video/webm,*/*;q=0.5'}});
  if(![301,302,303,307,308].includes(response.status))return {response,url:target};
  const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('Redirección de Pinterest inválida');target=new URL(location,target);
 }
 throw Error('Demasiadas redirecciones de Pinterest');
}
async function readLimited(response,limit,message){
 if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw Error(message);}
 const chunks=[];let size=0;
 for await(const chunk of response.body||[]){size+=chunk.length;if(size>limit){await response.body?.cancel().catch(()=>{});throw Error(message);}chunks.push(chunk);}
 if(!size)throw Error('El archivo de Pinterest está vacío');return Buffer.concat(chunks,size);
}
export async function resolvePinterestMedia(input,{fetcher=fetch,timeout=180000,maxVideoBytes=256*1024*1024,signal:externalSignal}={}){
 let remote;try{remote=new URL(input?.url);}catch{throw Error('Enlace de Pinterest inválido');}
 if(!allowed(remote,true)&&!allowed(remote,false))throw Error('Enlace de Pinterest no permitido');
 const signal=externalSignal?AbortSignal.any([AbortSignal.timeout(timeout),externalSignal]):AbortSignal.timeout(timeout);let videos=[],image=null,videoIndicated=Boolean(input.expectVideo);
 if(pinterestHost(remote)){
  if(remote.hostname!=='pin.it'&&!pinPath.test(remote.pathname))throw Error('Arrastra el enlace de un pin de Pinterest');
  const page=await fetchAllowed(remote,true,signal,fetcher);
  if(!page.response.ok){await page.response.body?.cancel();throw Error('Pinterest no permite acceder a este pin. Ábrelo y arrastra su enlace.');}
  const pinId=page.url.pathname.match(pinPath)?.[1];if(!pinId)throw Error('El enlace no lleva a un pin de Pinterest');
  const html=(await readLimited(page.response,4*1024*1024,'La página de Pinterest es demasiado grande')).toString('utf8');
  const found=extractPinterestPage(html,pinId,page.url);videos=found.videos;image=found.image;videoIndicated||=found.videoIndicated;
 }else if(videoType(remote)){videos=[remote];videoIndicated=true;}
 else if(/\.(m3u8|mpd)$/i.test(remote.pathname)){videoIndicated=true;}
 else image=remote;
 if(!videos.length){if(videoIndicated)throw Error('Este pin no ofrece un vídeo MP4 o WebM accesible');return {kind:'image',url:(image||remote).href};}
 for(const video of videos){
  const {response}=await fetchAllowed(video,false,signal,fetcher);const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(!response.ok||!['video/mp4','video/webm','application/octet-stream'].includes(type)){await response.body?.cancel();continue;}
  const bytes=await readLimited(response,maxVideoBytes,'El vídeo de Pinterest supera 256 MB');
  const format=videoType(video),mp4=bytes.length>=12&&bytes.toString('ascii',4,8)==='ftyp',webm=bytes.length>=4&&bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
  if(format==='video/mp4'&&mp4||format==='video/webm'&&webm)return {kind:'video',type:format,bytes};
 }
 throw Error('Pinterest no permite descargar el vídeo de este pin');
}
