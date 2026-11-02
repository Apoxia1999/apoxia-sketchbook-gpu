require('./node2shell-guard.cjs');
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, utilityProcess, clipboard } = require('electron');
const fs = require('node:fs/promises');
const archive = require('./archive.cjs');
let transferPromise=null;
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');

app.setName('Apoxia SketchBook GPU');
const root = path.resolve(__dirname, '..');
let window, backend, origin, token, quitting = false, closing = false;
let config = {}, preferences = {}, links = {};
const english = require('../locales/en.json');
function t(message) {return preferences['apoxia-language']==='en' ? english[message] || message : message;}
const profile=process.env.APOXIA_GPU_PROFILE?path.resolve(process.env.APOXIA_GPU_PROFILE):app.getPath('userData');
app.setPath('userData',profile);
const localMediaKey=randomBytes(32).toString('hex');
const configPath = path.join(profile, 'desktop.json');
const prefsPath = path.join(profile, 'preferences.json');
const linksPath = path.join(profile, 'native-links.json');
const runtimePath=path.join(profile,'desktop-runtime.json');
let canvasDir=process.env.APOXIA_GPU_DATA_DIR?path.resolve(process.env.APOXIA_GPU_DATA_DIR):path.join(profile,'canvas');
async function readJson(file, fallback) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; } }
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(value), { mode: 0o600 });
  await fs.rename(`${file}.tmp`, file);
}
function trusted(event) {
  if (!window || event.sender !== window.webContents || !event.senderFrame || new URL(event.senderFrame.url).origin !== origin) throw new Error(t('Solicitud de escritorio no autorizada'));
}
function external(url) {
  try { const parsed = new URL(url); if (['https:', 'http:'].includes(parsed.protocol)) shell.openExternal(parsed.href).catch(() => {}); } catch {}
}
async function openLocalFile(file) {
  if(process.platform==='linux') {
    // GIO uses the file's MIME association, as Nautilus does. Avoid xdg-open's
    // generic browser fallback, which can download local files instead of opening them.
    try {
      await new Promise((resolve,reject)=> {
        const child=spawn('gio',['open',file],{stdio:['ignore','ignore','pipe']});
        let details='';
        child.stderr.on('data',chunk=> {details=(details+chunk).slice(-2000);});
        child.once('error',reject);
        child.once('close',code=>code===0?resolve():reject(new Error(details.trim() || 'Could not open this file with its default application.')));
      });
      return;
    } catch(error) {if(error.code!=='ENOENT') throw error;}
  }
  const error=await shell.openPath(file);
  if(error) throw new Error(error);
}
function startBackend(port) {
  const tools = app.isPackaged ? path.join(process.resourcesPath, 'tools') : path.join(root, '.desktop-tools', `${process.platform}-${process.arch}`);
  return new Promise((resolve, reject) => {
    token = randomBytes(32).toString('hex');
    const child = utilityProcess.fork(path.join(__dirname, 'backend.cjs'), [], {
      cwd: app.isPackaged ? profile : root, serviceName: 'Apoxia SketchBook · Canvas', stdio: 'pipe',
      env: { ...process.env, PORT: String(port), REFERENCIAS_DATA_DIR: canvasDir, APOXIA_DESKTOP_TOKEN: token, APOXIA_LOCAL_MEDIA_KEY: localMediaKey,
        APOXIA_FFMPEG: path.join(tools, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
        APOXIA_FFPROBE: path.join(tools, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe') },
    });
    backend = child;
    let ready = false, details = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(t('El motor del canvas no pudo arrancar a tiempo.'))); }, 60000);
    child.stderr?.on('data', chunk => { details = (details + chunk).slice(-5000); });
    child.on('message', message => {
      if (message.type === 'ready') {
        ready=true;clearTimeout(timer);origin=`http://127.0.0.1:${message.port}`;
        writeJson(runtimePath,{port:message.port,token,pid:child.pid,canvasDir}).then(()=>resolve(message.port),reject);
      }
      if (message.type === 'startup-error') { clearTimeout(timer); reject(Object.assign(new Error(message.message), { code: message.code })); }
    });
    child.on('exit', code => {
      clearTimeout(timer);
      if (!ready) reject(new Error(details || `No se pudo iniciar el canvas (${code}).`));
      else if (!closing && !quitting) { dialog.showErrorBox('Apoxia SketchBook', `El motor del canvas se ha detenido.\n${details}`); quitting = true; app.quit(); }
    });
  });
}
async function stopBackend() {
  if (!backend?.pid) return;
  await new Promise((resolve, reject) => {
    const child = backend;
    const cleanup = () => { child.removeListener('message', message); child.removeListener('exit', exit); };
    const message = value => { if (value.type === 'shutdown-error') { cleanup(); reject(new Error(value.message)); } };
    const exit = () => { cleanup(); resolve(); };
    child.on('message', message); child.once('exit', exit); child.postMessage({ type: 'shutdown' });
  });
  await fs.rm(runtimePath,{force:true});
}
async function closeApp() {
  if (closing) return;
  closing = true;
  try {
    if(transferPromise) await transferPromise;
    if (window && !window.isDestroyed()) await window.webContents.executeJavaScript('window.apoxiaPrepareQuit?.()', true);
    await stopBackend(); quitting = true; app.quit();
  } catch (error) {
    closing = false;
    if (window && !window.isDestroyed()) window.webContents.executeJavaScript('document.body.style.pointerEvents=""').catch(() => {});
    dialog.showErrorBox(t('No se pudo terminar el guardado'), error.message);
  }
}
// systemd stops the main process first, leaving the backend alive long enough
// to flush edits and seal open Vaults before the app exits.
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{if(!quitting)closeApp();});
async function importCanvas() {
  if(transferPromise) throw new Error(t("Ya hay una operación de archivos en curso"));
  const { canceled, filePaths } = await dialog.showOpenDialog(window, { title: t('Importar una copia de la carpeta data de otro canvas'), properties: ['openDirectory'] });
  if (canceled) return;
  const source = filePaths[0];
  const state = await readJson(path.join(source, 'state.json'), null);
  if (!state || !Array.isArray(state.items) || !Array.isArray(state.vaults)) throw new Error(t('Selecciona la carpeta data que contiene state.json.'));
  try { await fs.access(path.join(source, '.server.lock')); throw new Error(t('Cierra el servidor o la app que utiliza ese canvas antes de copiarlo.')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const destination = path.join(profile, 'canvases', `importado-${Date.now()}`);
  await fs.cp(source, destination, { recursive: true, dereference: false, filter: value => !['.server.lock', 'tmp'].includes(path.basename(value)) });
  config.canvasDir = destination; await writeJson(configPath, config);
  app.relaunch(); app.quit();
}
function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: t('Archivo'), submenu: [
      { label: t('Carpeta del canvas'), click: () => shell.openPath(canvasDir) },
      { label: t('Importar copia de un canvas…'), click: () => importCanvas().catch(error => dialog.showErrorBox(t('Importar canvas'), error.message)) },
      { type: 'separator' }, { label: t('Salir'), accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
    ] },
    { label: t('Editar'), submenu: [{ role: 'undo',label:t('Deshacer') }, { role: 'redo',label:t('Rehacer') }, { type: 'separator' }, { role: 'cut',label:t('Cortar') }, { role: 'copy',label:t('Copiar') }, { id:'paste-canvas',label:t('Pegar'),accelerator:'CmdOrCtrl+V',click:()=>window.webContents.send('desktop:paste-command') }, { role: 'selectAll',label:t('Seleccionar todo') }] },
    { label: t('Ver'), submenu: [{ role: 'togglefullscreen',label:t('Pantalla completa') }, { role: 'reload',label:t('Recargar') }, ...(!app.isPackaged ? [{ role: 'toggleDevTools',label:t('Herramientas de desarrollo') }] : [])] },
    { label: t('Ayuda'), submenu: [{ label: t('Acerca de Apoxia SketchBook'), click: () => dialog.showMessageBox(window, { title: 'Apoxia SketchBook', message: `Apoxia SketchBook ${app.getVersion()}`, detail: t('Canvas local · Magic Laser · Vaults cifradas\nTus datos se guardan en este ordenador.') }) }] },
  ]));
}
function backendCall(type) {
  const child=backend,requestId=randomUUID();
  return new Promise((resolve,reject)=> {
    const cleanup=()=>{child.removeListener('message',reply);child.removeListener('exit',exit);};
    const reply=value=>{if(value.type!=='backup-reply' || value.requestId!==requestId)return;cleanup();value.error?reject(new Error(t(value.error))):resolve(value.value);};
    const exit=()=>{cleanup();reject(new Error(t('El motor del canvas se ha detenido.')));};
    child.on('message',reply);child.once('exit',exit);child.postMessage({type,requestId});
  });
}
async function transferCanvas(action) {
  let last=0,phase='';
  const progress=value=>{const now=Date.now();if(value.phase!==phase || now-last>100 || value.completed===value.total){phase=value.phase;last=now;if(!window.isDestroyed())window.webContents.send('desktop:transfer-progress',value);}};
  if(action==='import') {
    const choice=await dialog.showOpenDialog(window,{title:t('Importar canvas ZIP'),properties:['openFile'],filters:[{name:'ZIP',extensions:['zip']}]});
    if(choice.canceled)return {cancelled:true};
    const directory=path.join(profile,'canvases',`zip-${randomUUID()}`);
    await fs.mkdir(directory,{recursive:true});
    let imported;
    try {progress({phase:'import',completed:0,total:0});imported=await archive.extractZip(choice.filePaths[0],directory,progress);}
    catch(error){await fs.rm(directory,{recursive:true,force:true});throw error;}
    const previous={canvasDir,config:{...config},links:{...links},preferences:{...preferences}};
    const wasClosing=closing;closing=true;
    try {
      await stopBackend();
      canvasDir=imported.data;links={...links,...imported.registry};
      preferences=Object.fromEntries(Object.entries(imported.preferences).filter(([key,value])=>/^(apoxia|referencias\.)/.test(key) && typeof value==='string'));
      config.canvasDir=canvasDir;
      config.port=await startBackend(config.port || 0);
      await writeJson(configPath,config);await writeJson(linksPath,links);await writeJson(prefsPath,preferences);
      await window.webContents.executeJavaScript('for(const key of Object.keys(localStorage)) if(/^(apoxia|referencias\\.)/.test(key)) localStorage.removeItem(key)');
      installMenu();await window.loadURL(`${origin}/`);
      return {action};
    } catch(error) {
      await stopBackend().catch(()=>{});
      canvasDir=previous.canvasDir;config=previous.config;links=previous.links;preferences=previous.preferences;
      await writeJson(configPath,config);await writeJson(linksPath,links);await writeJson(prefsPath,preferences);
      config.port=await startBackend(config.port || 0);await writeJson(configPath,config);await window.loadURL(`${origin}/`);
      throw error;
    } finally {closing=wasClosing;}
  }
  let includeLinks=action==='copy',destination;
  if(action==='export') {
    const choice=await dialog.showMessageBox(window,{type:'question',title:t('Exportar canvas ZIP'),message:t('¿Incluir los archivos vinculados?'),detail:t('Las imágenes, vídeos y vaults del canvas se incluyen siempre. Los archivos vinculados se copiarán primero a DATA.'),buttons:[t('Solo canvas'),t('Canvas y archivos vinculados'),t('Cancelar')],cancelId:2,defaultId:1});
    if(choice.response===2)return {cancelled:true};includeLinks=choice.response===1;
    const save=await dialog.showSaveDialog(window,{title:t('Exportar canvas ZIP'),defaultPath:path.join(app.getPath('documents'),`ApoxiaSketchBook-${new Date().toISOString().slice(0,10)}.zip`),filters:[{name:'ZIP',extensions:['zip']}]});
    if(save.canceled)return {cancelled:true};destination=save.filePath;
  }
  let leased=false;
  try {
    const inventory=await backendCall('backup-begin');leased=true;
    if(inventory.unknown.length && Object.keys(links).length)throw new Error(t('Abre las vaults antiguas una vez antes de copiar sus archivos vinculados.'));
    let copied={count:0,files:{}};
    if(action==='copy-media'){progress({phase:'copy',completed:0,total:0});copied.count=await archive.copyMediaFiles(canvasDir,progress);}
    if(includeLinks){progress({phase:'copy',completed:0,total:0});copied=await archive.copyLinkedFiles(canvasDir,inventory.ids,links,progress);links=copied.registry;await writeJson(linksPath,links);}
    if(action==='export') {
      const entries={};for(const id of inventory.ids) {if(includeLinks && copied.files[id])entries[id]=copied.files[id];else if(links[id])entries[id]={external:links[id]};}
      progress({phase:'export',completed:0,total:0});
      await archive.exportZip(canvasDir,destination,{format:'apoxia-sketchbook',version:1,appVersion:app.getVersion(),includeLinks,links:entries},preferences,progress);
    }
    return {action,count:copied.count};
  } finally {if(leased)await backendCall('backup-end');}
}
ipcMain.handle('desktop:transfer',async (event,action)=> {
  trusted(event);
  if(!['copy','copy-media','export','import'].includes(action))throw new Error('Invalid action');
  if(transferPromise)throw new Error(t('Ya hay una operación de archivos en curso'));
  transferPromise=transferCanvas(action);
  try{return await transferPromise;}catch(error){throw new Error(t(error.message));}finally{transferPromise=null;}
});
ipcMain.handle('desktop:choose-file', async event => {
  trusted(event);
  const result = await dialog.showOpenDialog(window, { title: t('Enlazar la selección con un archivo'), properties: ['openFile'] });
  if (result.canceled) return null;
  const file = path.resolve(result.filePaths[0]);
  if (!(await fs.stat(file)).isFile()) throw new Error(t('Selecciona un archivo.'));
  const id = randomUUID(); links[id] = file; await writeJson(linksPath, links);
  return { id, name: path.basename(file) };
});
ipcMain.handle('desktop:import-linked-media',async(event,file,query,headers)=>{
  trusted(event);
  if(typeof file!=='string'||!path.isAbsolute(file)||!(await fs.stat(file)).isFile())throw new Error(t('Selecciona un archivo.'));
  if(typeof query!=='string'||query.length>10000)throw new Error('Importación inválida');
  const params=new URLSearchParams(query);params.set('linked','1');
  const response=await fetch(`${origin}/api/items?${params}`,{method:'POST',headers:{'Content-Type':'application/json','X-Apoxia-Desktop-Token':token,'X-Apoxia-Local-Media-Key':localMediaKey,...(typeof headers?.['X-Apoxia-Thumbnail']==='string'?{'X-Apoxia-Thumbnail':headers['X-Apoxia-Thumbnail']}:{})},body:JSON.stringify({path:file})});
  const item=await response.json();if(!response.ok)throw new Error(item.error||'No se pudo importar');return item;
});
ipcMain.handle('desktop:register-picked-file', async (event, file) => {
  trusted(event);
  if(typeof file!=='string' || !path.isAbsolute(file) || !(await fs.stat(file)).isFile()) throw new Error(t('Selecciona un archivo.'));
  const id=randomUUID();links[id]=file;await writeJson(linksPath,links);
  return {id,name:path.basename(file)};
});
ipcMain.handle('desktop:open-file', async (event, id) => {
  trusted(event);
  if (typeof id !== 'string' || !links[id]) throw new Error(t('Este archivo no está enlazado en este ordenador.'));
  const file = links[id], stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) throw new Error(t('El archivo se ha movido o ya no existe. Vuelve a enlazarlo.'));
  let nativeExecutable = /\.AppImage$/i.test(file);
  if(process.platform==='linux' && stat.mode & 0o111) {
    const handle=await fs.open(file,'r');
    try {const header=Buffer.alloc(4);await handle.read(header,0,4,0);nativeExecutable ||= header.equals(Buffer.from([0x7f,0x45,0x4c,0x46]));}
    finally {await handle.close();}
  }
  if (process.platform === 'linux' && nativeExecutable) {
    if (!(stat.mode & 0o111)) throw new Error(t('Esta aplicación no tiene permiso de ejecución.'));
    await new Promise((resolve, reject) => { const child = spawn(file, [], { detached: true, stdio: 'ignore' }); child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); }); });
  } else await openLocalFile(file);
});
ipcMain.handle('desktop:open-original', async (event, id) => {
  trusted(event);
  if(typeof id!=='string' || !/^[0-9a-f-]{36}$/.test(id)) throw new Error(t('Referencia inválida.'));
  // Ask the backend: it checks availability and protects encrypted Vault originals.
  const response=await fetch(`${origin}/api/items/${id}/original-path`,{headers:{'X-Apoxia-Desktop-Token':token}});
  const result=await response.json();
  if(!response.ok) throw new Error(result.error || t('Original no disponible.'));
  const managed=path.resolve(result.path);
  const originals=path.resolve(canvasDir,'originals');
  if(path.dirname(managed)!==originals || !path.basename(managed).startsWith(`${id}.`))throw new Error(t('Ruta del original inválida.'));
  const file=await fs.realpath(managed);
  if(!(await fs.stat(file)).isFile())
    throw new Error(t('Ruta del original inválida.'));
  await openLocalFile(file);
});
ipcMain.handle('desktop:clipboard-image',async event=>{
  trusted(event);
  const entries=await clipboard.read();
  for(const entry of entries) {
    const type=entry.types.find(type=>type==='image/png')||entry.types.find(type=>type.startsWith('image/'));
    if(type){const blob=await entry.getType(type);return {type,bytes:new Uint8Array(await blob.arrayBuffer())};}
  }
  return null;
});
ipcMain.handle('desktop:paste-native',event=>{trusted(event);window.webContents.paste();});
ipcMain.handle('desktop:show-canvas-folder', async event => { trusted(event); return shell.openPath(canvasDir); });
ipcMain.handle('desktop:restore-preferences', event => { trusted(event); return preferences; });
ipcMain.handle('desktop:set-language', async (event, language) => {
  trusted(event);
  if(!['es','en'].includes(language)) throw new Error('Invalid language');
  preferences['apoxia-language']=language;
  await writeJson(prefsPath,preferences);
  installMenu();
});
ipcMain.handle('desktop:save-preferences', async (event, values) => {
  trusted(event);
  if (!values || typeof values !== 'object' || JSON.stringify(values).length > 1000000) throw new Error(t('Preferencias inválidas.'));
  preferences = Object.fromEntries(Object.entries(values).filter(([key, value]) => /^(apoxia|referencias\.)/.test(key) && typeof value === 'string'));
  await writeJson(prefsPath, preferences);
});
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('before-quit', event => { if (!quitting) { event.preventDefault(); closeApp(); } });
  app.whenReady().then(async () => {
    await fs.mkdir(profile, { recursive: true });
    config = await readJson(configPath, {}); preferences = await readJson(prefsPath, {}); links = await readJson(linksPath, {});
    canvasDir=process.env.APOXIA_GPU_DATA_DIR?path.resolve(process.env.APOXIA_GPU_DATA_DIR):config.canvasDir||canvasDir;
    if(process.env.APOXIA_IMPORT_CANVAS) {
      const source=path.resolve(process.env.APOXIA_IMPORT_CANVAS);
      const state=await readJson(path.join(source,'state.json'),null);
      if(!state || !Array.isArray(state.items)) throw new Error(t('El canvas de origen no contiene state.json válido.'));
      try {await fs.access(path.join(source,'.server.lock'));throw new Error(t('Cierra primero el servidor del canvas de origen.'));} catch(error) {if(error.code!=='ENOENT') throw error;}
      const imported=path.join(profile,'canvases',`importado-${Date.now()}`);
      await fs.cp(source,imported,{recursive:true,dereference:false,filter:value=>!['.server.lock','tmp'].includes(path.basename(value))});
      canvasDir=imported;config.canvasDir=imported;
    }
    const port = await startBackend(config.port || 0).catch(error => { if (error.code === 'EADDRINUSE') return startBackend(0); throw error; });
    config.port = port; await writeJson(configPath, config);
    window = new BrowserWindow({ title: 'Apoxia SketchBook', width: config.width || 1440, height: config.height || 960, minWidth: 700, minHeight: 500,
      icon: path.join(root, 'build/icon.png'), backgroundColor: '#132124', show: false, autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false },
    });
    const session = window.webContents.session;
    session.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders };
      if (new URL(details.url).origin === origin) headers['X-Apoxia-Desktop-Token'] = token;
      callback({ requestHeaders: headers });
    });
    session.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
    window.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
    window.webContents.on('will-navigate', (event, url) => { if (url !== `${origin}/`) { event.preventDefault(); external(url); } });
    window.on('close', event => { if (!quitting) { event.preventDefault(); const size = window.getSize(); config.width = size[0]; config.height = size[1]; writeJson(configPath, config).catch(() => {}); if(process.env.APOXIA_KEEP_SERVER==='1') window.hide(); else app.quit(); } });
    window.once('ready-to-show', () => { window.show(); });
    installMenu(); await window.loadURL(`${origin}/`);
  }).catch(error => { dialog.showErrorBox(t('No se pudo abrir Apoxia SketchBook'), t(error.message)); backend?.kill(); quitting = true; app.quit(); });
}
