// Compressed files are reused inside the worker; HTTP cache revalidates access
// after reload. Vault responses remain no-store on the server.
const blobs=new Map();let bytes=0;
async function sourceBlob(job){
 if(job.file)return job.file;
 const cached=blobs.get(job.url);if(cached){blobs.delete(job.url);blobs.set(job.url,cached);return cached;}
 let response=await fetch(job.url,{credentials:'same-origin',cache:'default'});
 if(!response.ok&&job.fallbackURL)response=await fetch(job.fallbackURL,{credentials:'same-origin',cache:'default'});
 if(!response.ok)throw Error(`HTTP ${response.status}`);
 const blob=await response.blob();if(blob.size<32*1048576){blobs.set(job.url,blob);bytes+=blob.size;while(bytes>32*1048576){const [key,value]=blobs.entries().next().value;blobs.delete(key);bytes-=value.size;}}return blob;
}
let noteFontReady;
function loadNoteFont(){return noteFontReady ||= (async()=>{const face=new FontFace('Paper Mono','url(/assets/PaperMono-Regular.woff2)');self.fonts.add(await face.load());})();}
async function noteBitmap(job){
 await loadNoteFont();
 const n=job.note,target=job.size===64?128:job.size,scale=Math.min(2,target/Math.max(n.width+3,n.height+3)),w=Math.max(1,Math.round((n.width+3)*scale)),h=Math.max(1,Math.round((n.height+3)*scale));
 const overview=job.size===64;
 const bodyWidth=overview?n.width+3:n.width,bodyHeight=overview?n.height+3:n.height;
 const c=new OffscreenCanvas(w,h),ctx=c.getContext('2d');ctx.scale(scale,scale);if(n.shadow&&!overview){ctx.fillStyle=n.shadow;ctx.beginPath();ctx.roundRect(3,3,n.width,n.height,6);ctx.fill();}ctx.beginPath();ctx.roundRect(0,0,bodyWidth,bodyHeight,Math.min(6,bodyWidth/2,bodyHeight/2));ctx.clip();
 if(!n.backgroundHidden){
  if(n.neon){
   // Opaque cached gradient: the shadow must not turn the entire body into the shader's text mask.
   const angle=115*Math.PI/180,dx=Math.sin(angle),dy=-Math.cos(angle),length=Math.abs(n.width*dx)+Math.abs(n.height*dy);
   const gradient=ctx.createLinearGradient(n.width/2-dx*length/2,n.height/2-dy*length/2,n.width/2+dx*length/2,n.height/2+dy*length/2);
   for(const [stop,color] of [[0,'#ff55c8'],[.18,'#ad72ff'],[.36,'#32ead5'],[.54,'#ff55c8'],[.74,'#32ead5'],[.88,'#ad72ff'],[1,'#ff55c8']])gradient.addColorStop(stop,color);
   ctx.fillStyle=gradient;
  }else ctx.fillStyle=n.background;
  ctx.fillRect(0,0,bodyWidth,bodyHeight);
 }
 if(!overview&&n.border){ctx.strokeStyle=n.border;ctx.lineWidth=1.5;ctx.stroke();}
 ctx.fillStyle=n.ink;ctx.globalAlpha=n.empty?.6:1;ctx.font=`${n.font}px "Paper Mono",monospace`;ctx.textBaseline='alphabetic';
 const metrics=ctx.measureText('Mg'),ascent=metrics.fontBoundingBoxAscent??metrics.actualBoundingBoxAscent,descent=metrics.fontBoundingBoxDescent??metrics.actualBoundingBoxDescent;
 const baseline=(n.font*1.5-ascent-descent)/2+ascent;
 for(let i=0;i<n.lines.length;i++){const top=16+i*n.font*1.5;if(top>n.height)break;
  if(job.size===64){ctx.globalAlpha=.85;ctx.fillRect(16,top+n.font*.65,Math.max(n.font*.5,n.lengths?.[i]||0),Math.max(2.2,n.font*.22));}
  else ctx.fillText(n.lines[i],16,top+baseline);
 }
 return createImageBitmap(c,{premultiplyAlpha:'none'});
}
async function decode(job){
 let source,bitmap;const results=[];
 try{
  if(job.note){bitmap=await noteBitmap(job);return {...job,bitmap,width:job.note.width,height:job.note.height};}
  source=await createImageBitmap(await sourceBlob(job),{imageOrientation:'from-image'});
  const width=source.width,height=source.height;
  if(job.tiles){
   for(const tile of job.tiles){const x=tile.tx*512,y=tile.ty*512,w=Math.min(512,width-x),h=Math.min(512,height-y);if(w<=0||h<=0)continue;results.push({...tile,bitmap:await createImageBitmap(source,x,y,w,h)});}
   return {...job,file:undefined,width,height,tiles:results};
  }
  const scale=Math.min(1,job.size/Math.max(width,height));const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));bitmap=await createImageBitmap(source,{resizeWidth:w,resizeHeight:h,resizeQuality:'high'});
  let blob;if(job.prepare){const c=new OffscreenCanvas(w,h);c.getContext('2d').drawImage(bitmap,0,0);blob=await c.convertToBlob({type:'image/webp',quality:.85});}
  return {...job,file:undefined,width,height,bitmap,blob};
 }catch(error){bitmap?.close();for(const t of results)t.bitmap.close();return {...job,file:undefined,error:String(error)};}
 finally{source?.close();}
}
self.onmessage=async({data:job})=>{
 if(job.pack){
  try{const response=await fetch('/api/gpu-preview-pack',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:job.entries.map(a=>a.id)}),cache:'no-store'});if(!response.ok)throw Error(`HTTP ${response.status}`);const bitmap=await createImageBitmap(await response.blob());self.postMessage({...job,bitmap},[bitmap]);}
  catch(error){self.postMessage({...job,error:String(error)});}return;
 }
 if(job.batch){
  const batch=[];
  // Limit simultaneous decoding and deliver one GPU update per thumbnail batch.
  for(let i=0;i<job.batch.length;i+=6)batch.push(...await Promise.all(job.batch.slice(i,i+6).map(decode)));
  self.postMessage({batch},batch.flatMap(a=>a.bitmap?[a.bitmap]:[]));
 }else{
  const result=await decode(job);
  self.postMessage(result,result.bitmap?[result.bitmap]:(result.tiles||[]).map(t=>t.bitmap));
 }
};
