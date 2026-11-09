import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createWriteStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createHash } from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function prepareTools(platform=process.platform,arch=process.arch) {
  if(!['linux','win32'].includes(platform) || !['x64','arm64'].includes(arch)) throw new Error('Plataforma de escritorio no preparada: '+platform+'-'+arch);
  if (platform === 'win32' && arch === 'arm64') throw new Error('La publicación fijada de FFmpeg no ofrece Windows ARM64');
  const dir=path.join(root,'.desktop-tools',`${platform}-${arch}`);await fs.mkdir(dir,{recursive:true});
  const executable=platform==='win32'?'ffmpeg.exe':'ffmpeg', output=path.join(dir,executable);
  const release=JSON.parse(await fs.readFile(path.join(root,'node_modules/ffmpeg-static/package.json'),'utf8'))['ffmpeg-static']['binary-release-tag'];
  const base=`https://github.com/eugeneware/ffmpeg-static/releases/download/${release}`;
  try {if((await fs.stat(output)).size<1000000) throw new Error('incomplete');}
  catch {
    console.log(`Descargando FFmpeg ${platform}-${arch}…`);
    const response=await fetch(`${base}/ffmpeg-${platform}-${arch}.gz`,{signal:AbortSignal.timeout(180000)});
    if(!response.ok) throw new Error(`FFmpeg no disponible para ${platform}-${arch}: ${response.status}`);
    try {await pipeline(Readable.fromWeb(response.body),createGunzip(),createWriteStream(`${output}.tmp`));await fs.rename(`${output}.tmp`,output);}
    catch(error) {await fs.rm(`${output}.tmp`,{force:true});throw error;}
  }
  const pins = JSON.parse(await fs.readFile(path.join(root,'scripts/tools-pin.json'),'utf8'));
  const expected = pins[`${platform}-${arch}`];
  const actual = createHash('sha256').update(await fs.readFile(output)).digest('hex');
  if (!expected || actual !== expected) {
    await fs.rm(output, {force:true});
    throw new Error('FFmpeg no coincide con el hash de seguridad para ' + platform + '-' + arch);
  }
  await fs.chmod(output,0o755);
  for(const suffix of ['LICENSE','README']) {
    const target=path.join(dir,`FFmpeg.${suffix}`);
    try {await fs.access(target);} catch {const response=await fetch(`${base}/${platform}-${arch}.${suffix}`);if(!response.ok) throw new Error('No se pudo obtener la licencia de FFmpeg');await fs.writeFile(target,await response.text());}
  }
  const probe=platform==='win32'?'ffprobe.exe':'ffprobe';
  await fs.copyFile(path.join(root,'node_modules/ffprobe-static/bin',platform,arch,probe),path.join(dir,probe));
  await fs.chmod(path.join(dir,probe),0o755);
  await fs.copyFile(path.join(root,'node_modules/ffprobe-static/LICENSE'),path.join(dir,'ffprobe-package.LICENSE'));
  const hashes={};
  for(const file of [executable,probe]) hashes[file]=createHash('sha256').update(await fs.readFile(path.join(dir,file))).digest('hex');
  await fs.writeFile(path.join(dir,'tools.json'),JSON.stringify({platform,arch,ffmpegRelease:release,sha256:hashes},null,2));
  return dir;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) await prepareTools(process.argv[2],process.argv[3]);
