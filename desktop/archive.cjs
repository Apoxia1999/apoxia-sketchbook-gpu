const fs=require('node:fs/promises');
const nativeFs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {pipeline}=require('node:stream/promises');
const {Transform}=require('node:stream');
const yazl=require('yazl');
const yauzl=require('yauzl');
const crc32=require('buffer-crc32');
const uuid=/^[0-9a-f-]{36}$/;

async function readJson(file,fallback) {
  try {return JSON.parse(await fs.readFile(file,'utf8'));} catch(error) {if(error.code==='ENOENT') return fallback;throw error;}
}
async function writeJson(file,value) {
  const temporary=`${file}.${randomUUID()}.tmp`;
  try {await fs.writeFile(temporary,JSON.stringify(value),{mode:0o600});await fs.rename(temporary,file);}
  finally {await fs.rm(temporary,{force:true});}
}
function relativeFile(value) {
  if(typeof value!=='string' || !value || value.includes('\\') || value.includes(':') || value.includes('\0') || value.startsWith('/') || value.split('/').some(part=>['.','..',''].includes(part))) throw new Error('Ruta inválida en el ZIP');
  return value;
}
async function managedFile(data,id,registry,manifest) {
  const relative=manifest.files?.[id]?.relative;
  if(relative && relative.startsWith('linked-files/')) {
    const candidate=path.join(data,relativeFile(relative));
    if((await fs.stat(candidate).catch(()=>null))?.isFile()) {
      const actual=await fs.realpath(candidate),base=await fs.realpath(data);
      const inside=path.relative(base,actual);
      if(inside.startsWith('..'+path.sep) || path.isAbsolute(inside)) throw new Error('Ruta inválida en el ZIP');
      return candidate;
    }
  }
  const candidate=registry[id];
  if(!candidate || !(await fs.stat(candidate).catch(()=>null))?.isFile()) throw new Error('No se encuentra un archivo vinculado. Vuelve a enlazarlo antes de copiar o exportar.');
  return candidate;
}
async function copyLinkedFiles(data,ids,registry,progress) {
  const manifest=await readJson(path.join(data,'linked-files.json'),{version:1,files:{}});
  const jobs=[];let total=0;
  for(const id of ids) {
    if(!uuid.test(id)) throw new Error('Enlace inválido');
    const source=await managedFile(data,id,registry,manifest),stat=await fs.stat(source);
    const name='file-'+path.basename(source).replace(/^file-/,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,160);
    const existing=manifest.files?.[id]?.relative;
    const relative=existing || `linked-files/${id}/${name}`;
    relativeFile(relative);
    if(!relative.startsWith("linked-files/")) throw new Error("Ruta inválida en el ZIP");
    jobs.push({id,source,relative,stat});total+=stat.size;
  }
  const files={},nextRegistry={...registry};let completed=0;
  for(const job of jobs) {
    const destination=path.join(data,job.relative);
    await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});
    if(path.resolve(job.source)!==path.resolve(destination)) {
      const temporary=`${destination}.${randomUUID()}.tmp`;
      try {
        await pipeline(nativeFs.createReadStream(job.source),new Transform({transform(chunk,encoding,callback){completed+=chunk.length;progress({phase:'copy',completed,total});callback(null,chunk);}}),nativeFs.createWriteStream(temporary,{flags:'wx',mode:job.stat.mode&0o111?0o700:0o600}));
        if((await fs.stat(temporary)).size!==job.stat.size) throw new Error('El archivo cambió durante la copia. Vuelve a intentarlo.');
        await fs.rename(temporary,destination);
      } finally {await fs.rm(temporary,{force:true});}
    } else completed+=job.stat.size;
    files[job.id]={relative:job.relative};nextRegistry[job.id]=destination;
    progress({phase:'copy',completed,total});
  }
  await writeJson(path.join(data,'linked-files.json'),{version:1,files});
  return {registry:nextRegistry,files,count:jobs.length};
}
// Replace only our original-media links, atomically; never write into their targets.
async function copyMediaFiles(data,progress) {
  const folder=path.join(data,'originals'),jobs=[];let total=0,completed=0;
  for(const name of await fs.readdir(folder)) {
    if(!/^[0-9a-f-]{36}\.[a-z0-9]{1,8}$/.test(name))continue;
    const destination=path.join(folder,name);
    if(!(await fs.lstat(destination)).isSymbolicLink())continue;
    const source=await fs.realpath(destination),stat=await fs.stat(source);
    if(!stat.isFile())throw new Error('El archivo original ya no está disponible');
    jobs.push({source,destination,stat});total+=stat.size;
  }
  for(const {source,destination,stat} of jobs) {
    const temporary=`${destination}.${randomUUID()}.tmp`;
    try {
      await pipeline(nativeFs.createReadStream(source),new Transform({transform(chunk,encoding,callback){completed+=chunk.length;progress({phase:'copy',completed,total});callback(null,chunk);}}),nativeFs.createWriteStream(temporary,{flags:'wx',mode:0o600}));
      if((await fs.stat(temporary)).size!==stat.size)throw new Error('El archivo cambió durante la copia. Vuelve a intentarlo.');
      await fs.rename(temporary,destination);
    } finally {await fs.rm(temporary,{force:true});}
  }
  return jobs.length;
}
async function canvasFiles(data,includeLinks) {
  const files=[];
  async function walk(directory,prefix='') {
    for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
      if(entry.name==='tmp' || entry.name==='.server.lock' || entry.name.endsWith('.tmp') || (['linked-files','linked-files.json'].includes(entry.name))) continue;
      const relative=prefix+entry.name,file=path.join(directory,entry.name);
      if(entry.isSymbolicLink()) {
        if(prefix!=='originals/'||!/^[0-9a-f-]{36}\.[a-z0-9]{1,8}$/.test(entry.name))throw new Error('Enlace simbólico inválido dentro de DATA');
        const stat=await fs.stat(file);if(!stat.isFile())throw new Error('El archivo original ya no está disponible');
        files.push({file,relative,stat});continue;
      }
      if(entry.isDirectory()) await walk(file,relative+'/');
      else if(entry.isFile()) files.push({file,relative,stat:await fs.stat(file)});
    }
  }
  await walk(data);return files;
}
async function exportZip(data,destination,manifest,preferences,progress) {
  const relative=path.relative(data,destination);
  if(!relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative)) throw new Error('Guarda el ZIP fuera de la carpeta DATA');
  const files=await canvasFiles(data,false),zip=new yazl.ZipFile();
  if(manifest.includeLinks) {
    for(const record of Object.values(manifest.links)) if(record.relative) {
      const relative=relativeFile(record.relative),file=path.join(data,relative);
      files.push({file,relative,stat:await fs.stat(file)});
    }
    const file=path.join(data,'linked-files.json');files.push({file,relative:'linked-files.json',stat:await fs.stat(file)});
  }
  const temporary=`${destination}.${randomUUID()}.partial`;
  const total=files.reduce((sum,file)=>sum+file.stat.size,0);let completed=0;
  const done=pipeline(zip.outputStream,nativeFs.createWriteStream(temporary,{flags:'wx',mode:0o600}));
  // Attach rejection immediately, before files are added to the archive.
  done.catch(()=>{});zip.on('error',error=>zip.outputStream.destroy(error));
  try {
    zip.addBuffer(Buffer.from(JSON.stringify(manifest)),'apoxia-backup.json');
    zip.addBuffer(Buffer.from(JSON.stringify(preferences)),'preferences.json');
    for(const entry of files) {
      zip.addReadStreamLazy('data/'+entry.relative,{size:entry.stat.size,mtime:entry.stat.mtime,mode:entry.stat.mode,compress:entry.relative.endsWith('.json'),compressionLevel:entry.relative.endsWith('.json')?3:0},callback=> {
        const input=nativeFs.createReadStream(entry.file);
        const meter=new Transform({transform(chunk,encoding,next){completed+=chunk.length;progress({phase:'export',completed,total});next(null,chunk);}});
        input.on('error',error=>meter.destroy(error));callback(null,input.pipe(meter));
      });
    }
    zip.end();await done;await fs.rename(temporary,destination);
  } catch(error) {zip.outputStream.destroy();await done.catch(()=>{});throw error;}
  finally {await fs.rm(temporary,{force:true});}
}
function openZip(file) {return new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true,autoClose:false,validateEntrySizes:true},(error,zip)=>error?reject(error):resolve(zip)));}
async function extractZip(file,destination,progress) {
  const zip=await openZip(file);let completed=0;
  try {
    const entries=await new Promise((resolve,reject)=> {
      const result=[],seen=new Set();
      zip.on('error',reject);
      zip.on('entry',entry=> {
        try {
          const name=entry.fileName.endsWith('/')?entry.fileName.slice(0,-1):entry.fileName;
          relativeFile(name);
          if(!(name==='data' || name.startsWith('data/') || ['apoxia-backup.json','preferences.json'].includes(name))) throw new Error('Este ZIP no es un backup de Apoxia SketchBook');
          if((name==='apoxia-backup.json' && entry.uncompressedSize>10*1024*1024) || (name==='preferences.json' && entry.uncompressedSize>1024*1024)) throw new Error('Metadatos del ZIP demasiado grandes');
          const type=(entry.externalFileAttributes>>>16)&0xf000;
          if(type && ![0x8000,0x4000].includes(type)) throw new Error('El ZIP contiene un tipo de archivo no permitido');
          const key=name.toLowerCase();if(seen.has(key) || result.length>=100000) throw new Error('El ZIP contiene rutas duplicadas o demasiados archivos');
          seen.add(key);result.push(entry);zip.readEntry();
        } catch(error) {reject(error);}
      });
      zip.once('end',()=>resolve(result));zip.readEntry();
    });
    const total=entries.reduce((sum,entry)=>sum+entry.uncompressedSize,0);
    const disk=await fs.statfs(destination);
    if(!Number.isSafeInteger(total) || total>disk.bavail*disk.bsize-16*1024*1024) throw new Error('No hay espacio suficiente para importar el canvas');
    for(const entry of entries) {
      const target=path.join(destination,entry.fileName);
      if(entry.fileName.endsWith('/')) {await fs.mkdir(target,{recursive:true,mode:0o700});continue;}
      await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});
      const input=await new Promise((resolve,reject)=>zip.openReadStream(entry,(error,stream)=>error?reject(error):resolve(stream)));
      const mode=0o600;
      let checksum=0;
      await pipeline(input,new Transform({transform(chunk,encoding,callback){checksum=crc32.unsigned(chunk,checksum);completed+=chunk.length;progress({phase:'import',completed,total});callback(null,chunk);}}),nativeFs.createWriteStream(target,{flags:'wx',mode}));
      if(checksum!==entry.crc32) throw new Error('El ZIP está dañado');
    }
    const metadataFile=path.join(destination,'apoxia-backup.json');
    if((await fs.stat(metadataFile)).size>10*1024*1024 || (await fs.stat(path.join(destination,'preferences.json'))).size>1024*1024) throw new Error('Metadatos del ZIP demasiado grandes');
    const manifest=await readJson(metadataFile,null),preferences=await readJson(path.join(destination,'preferences.json'),{});
    const data=path.join(destination,'data'),state=await readJson(path.join(data,'state.json'),null);
    if(manifest?.format!=='apoxia-sketchbook' || manifest.version!==1 || state?.version!==1 || !['items','deletedItems','strokes','writings','vaults'].every(kind=>Array.isArray(state[kind]) && state[kind].every(object=>object && uuid.test(object.id)))) throw new Error('Este ZIP no es un backup compatible de Apoxia SketchBook');
    if(!preferences || typeof preferences!=='object' || Array.isArray(preferences)) throw new Error('Este ZIP no es un backup compatible de Apoxia SketchBook');
    const registry={};
    for(const [id,record] of Object.entries(manifest.links || {})) {
      if(!uuid.test(id) || !record || typeof record!=='object') throw new Error('Enlaces del ZIP inválidos');
      if(record.relative) {
        const relative=relativeFile(record.relative);
        if(!relative.startsWith('linked-files/') || !(await fs.stat(path.join(data,relative))).isFile()) throw new Error('Falta un archivo vinculado en el ZIP');
        if (/\.(exe|com|bat|cmd|ps1|vbs|vbe|wsf|wsh|msi|scr|desktop|appimage|sh|bash|js|mjs|cjs|py|pl|rb)$/i.test(relative)) continue;
        registry[id]=path.join(data,relative);
      }
    }
    return {data,registry,preferences};
  } finally {zip.close();}
}
module.exports={copyMediaFiles,copyLinkedFiles,exportZip,extractZip,readJson,writeJson};
