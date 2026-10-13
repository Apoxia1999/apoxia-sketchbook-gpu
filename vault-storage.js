import fsp from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import './vault-coordinates.js';
const coordinates = globalThis.VaultCoordinates;
const scrypt = promisify(scryptCallback);
const CHUNK = 1024 * 1024;
const OVERHEAD = 32;
const MAGIC = Buffer.from('ASBVLT01');
const KDF = { N: 131072, r: 8, p: 1 };
const kinds = ['items', 'writings', 'strokes'];
const emptyMembers = () => ({ items: [], writings: [], strokes: [] });
const validId = id => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id);
function seal(key, plaintext, aad) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function unseal(key, envelope, aad) {
  if (!envelope || typeof envelope.iv !== 'string' || typeof envelope.tag !== 'string' || typeof envelope.data !== 'string') throw new Error('Contenido cifrado inválido');
  const iv = Buffer.from(envelope.iv, 'base64'), tag = Buffer.from(envelope.tag, 'base64');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Contenido cifrado inválido');
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(tag);
  const partial = decipher.update(Buffer.from(envelope.data, 'base64'));
  try { return Buffer.concat([partial, decipher.final()]); }
  catch (error) { partial.fill(0); throw error; }
  finally { partial.fill(0); }
}
async function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  const handle = await fsp.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function atomicJson(file, data) {
  const temp = `${file}.tmp`;
  const handle = await fsp.open(temp, 'w', 0o600);
  try { await handle.writeFile(JSON.stringify(data)); await handle.sync(); }
  finally { await handle.close(); }
  await fsp.rename(temp, file);
  // Persist the rename on systems that support syncing directory handles.
  await syncDirectory(path.dirname(file));
}
export class VaultStorage {
  constructor({ dataDir, vaults, items, deletedItems, writings, strokes }) {
    Object.assign(this, { dataDir, vaults, items, deletedItems, writings, strokes });
    this.root = path.join(dataDir, 'vault-data');
    this.stateFile = path.join(dataDir, 'state.json');
    this.contexts = new Map();
    this.removedVaults = [];
    this.owners = new Map();
    this.rebuildOwners();
    for (const kind of kinds) coordinates.attachMap(this[kind], kind, id => this.owner(kind, id));
    coordinates.attachMap(this.deletedItems, 'items', id => this.owner('items', id));
  }
  async load() {
    await fsp.mkdir(this.root, { recursive: true, mode: 0o700 });
    let state;
    try { state = JSON.parse(await fsp.readFile(this.stateFile, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (state) {
      this.removedVaults = state.removedVaults || [];
      if (state.version !== 1 || !Array.isArray(state.vaults)) throw new Error('Formato de datos del canvas incompatible');
      for (const map of [this.items, this.deletedItems, this.writings, this.strokes, this.vaults]) map.clear();
      for (const item of state.items) this.items.set(item.id, item);
      for (const item of state.deletedItems) this.deletedItems.set(item.id, item);
      for (const writing of state.writings) this.writings.set(writing.id, writing);
      for (const stroke of state.strokes) this.strokes.set(stroke.id, stroke);
      for (const vault of state.vaults) this.vaults.set(vault.id, vault);
    }
    this.rebuildOwners();
    for (const vault of this.vaults.values()) if (vault.crypto) {
      for (const kind of kinds) for (const id of vault.privateIds?.[kind] || []) this[kind].delete(id);
      for (const id of vault.privateIds?.items || []) this.deletedItems.delete(id);
    }
    await this.cleanupRemovedVaults();
    await this.cleanupPlaintext();
    try { await fsp.unlink(`${this.stateFile}.tmp`); await syncDirectory(this.dataDir); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (state) { await this.removeLegacyFiles(); await this.cleanupCiphertext(); }
    for (const item of this.items.values()) if (item.status === 'processing') { item.status = 'error'; item.error = 'Conversión interrumpida. Elimina el elemento y vuelve a importarlo.'; }
    for (const kind of kinds) for (const [id, object] of this[kind]) coordinates.bind(object, kind, this.owner(kind, id));
  }
  rebuildOwners() {
    this.owners.clear();
    for (const vault of this.vaults.values()) for (const kind of kinds)
      for (const id of vault.privateIds?.[kind] || vault.members[kind]) this.owners.set(`${kind}:${id}`, vault.id);
  }
  owner(kind, id) { return this.vaults.get(this.owners.get(`${kind}:${id}`)) || null; }
  accessible(kind, id, session) {
    const vault = this.owner(kind, id);
    if (!vault?.crypto) return true;
    return this.contexts.get(vault.id)?.session === session;
  }
  isOpen(vault, session) { return !vault.crypto && !vault.passwordHash || this.contexts.get(vault.id)?.session === session; }
  publicVault(vault, session) {
    const hasContents = kinds.some(kind => (vault.members[kind]?.length || 0) + (vault.privateIds?.[kind]?.length || 0) > 0) || Boolean(vault.assetIds?.length || vault.pendingAssets?.length);
    return { id: vault.id, x: vault.x, y: vault.y, width: vault.width, height: vault.height, locked: Boolean(vault.locked), hint: vault.hint || [], hasContents, members: vault.members, configured: Boolean(vault.crypto || vault.passwordHash), encrypted: Boolean(vault.crypto), open: this.isOpen(vault, session) };
  }
  async unlock(vault, password, confirm, session) {
    const current = this.contexts.get(vault.id);
    if (current && current.session !== session) throw new Error('Esta Vault está abierta en otra ventana');
    if (current) return;
    let key, kek;
    try {
      if (vault.crypto) {
        if (vault.crypto.version !== 1 || JSON.stringify(vault.crypto.kdf) !== JSON.stringify(KDF)) throw new Error('Formato de cifrado incompatible');
        kek = await scrypt(password, Buffer.from(vault.crypto.salt, 'base64'), 32, { ...KDF, maxmem: 256 * 1024 * 1024 });
        key = unseal(kek, vault.crypto.wrappedKey, `apoxia:key:1:${vault.id}`);
        if (key.length !== 32) throw new Error('Clave inválida');
        const bytes = unseal(key, vault.crypto.payload, `apoxia:payload:1:${vault.id}`);
        let payload; try { payload = JSON.parse(bytes.toString('utf8')); } finally { bytes.fill(0); }
        if (payload.version !== 1 || !payload.geometry || !payload.assets || ![payload.geometry.x, payload.geometry.y, payload.geometry.width, payload.geometry.height].every(Number.isFinite) || payload.geometry.width <= 0 || payload.geometry.height <= 0) throw new Error('Contenido inválido');
        for (const [relative, descriptor] of Object.entries(payload.assets)) {
          if (!/^(media|originals)\/[0-9a-f-]{36}(?:-thumb)?\.[a-z0-9]{1,8}$/.test(relative) || !vault.privateIds.items.includes(path.basename(relative).slice(0, 36))) throw new Error('Contenido inválido');
          this.assetPath(vault, descriptor);
        }
        const localCoordinates = payload.coordinateSystem === 'vault-local-v1';
        if (payload.coordinateSystem && !localCoordinates) throw new Error('Coordenadas incompatibles');
        const factor = vault.width / payload.geometry.width;
        const transform = object => { object.x = vault.x + (object.x - payload.geometry.x) * factor; object.y = vault.y + (object.y - payload.geometry.y) * factor; };
        for (const kind of kinds) {
          if (!Array.isArray(payload[kind])) throw new Error('Contenido inválido');
          for (const object of payload[kind]) {
            if (!validId(object.id) || !vault.privateIds[kind].includes(object.id)) throw new Error('Contenido inválido');
            if (localCoordinates) { coordinates.bind(object, kind, vault, true); continue; }
            if (kind === 'strokes') { object.points = object.points.map(([x,y]) => [vault.x + (x - payload.geometry.x) * factor, vault.y + (y - payload.geometry.y) * factor]); object.width *= factor; }
            else { transform(object); for (const field of kind === 'items' ? ['displayWidth','displayHeight','chromeScale','textFontSize'] : ['size']) if (Number.isFinite(object[field])) object[field] *= factor; }
          }
        }
        // Restore only after all authentication and structural checks succeed.
        this.contexts.set(vault.id, { key, session, assets: payload.assets });
        for (const kind of kinds) for (const object of payload[kind]) this[kind].set(object.id, object);
        for (const object of payload.deletedItems || []) {
          if (localCoordinates) coordinates.bind(object, 'items', vault, true);
          this.deletedItems.set(object.id, object);
        }
      } else {
        if (vault.passwordHash) {
          const verifier = await scrypt(password, vault.salt, 32);
          try { if (!timingSafeEqual(verifier, Buffer.from(vault.passwordHash, 'hex'))) throw new Error('Contraseña incorrecta'); }
          finally { verifier.fill(0); }
        } else if (confirm !== password) throw new Error('Las contraseñas no coinciden');
        if (vault.members.items.some(id => this.items.get(id)?.status === 'processing')) throw new Error('Espera a que termine la importación antes de cifrar la Vault');
        const salt = randomBytes(32);
        kek = await scrypt(password, salt, 32, { ...KDF, maxmem: 256 * 1024 * 1024 });
        key = randomBytes(32);
        vault.crypto = { version: 1, kdf: KDF, salt: salt.toString('base64'), wrappedKey: seal(kek, key, `apoxia:key:1:${vault.id}`) };
        vault.privateIds = structuredClone(vault.members);
        this.contexts.set(vault.id, { key, session, assets: {} });
        delete vault.passwordHash; delete vault.salt;
      }
    } catch (error) {
      if (!this.contexts.has(vault.id)) key?.fill(0);
      if (vault.crypto?.payload && error.message !== 'Esta Vault está abierta en otra ventana') throw new Error('Contraseña incorrecta o contenido cifrado dañado');
      throw error;
    } finally { kek?.fill(0); }
  }
  async assign(kind, id, vaultId, session) {
    const vault = this.vaults.get(vaultId);
    if (!vault || !this.isOpen(vault, session)) throw new Error('Abre la Vault antes de añadir contenido');
    const previous = this.owner(kind, id);
    if (previous && previous.id !== vaultId) throw new Error('El elemento ya pertenece a otra Vault');
    if (!vault.members[kind].includes(id)) vault.members[kind].push(id);
    if (vault.crypto && !vault.privateIds[kind].includes(id)) vault.privateIds[kind].push(id);
    this.owners.set(`${kind}:${id}`, vault.id);
  }
  async changeMembership(records, session) {
    const incoming = new Map(records.map(record => [record.id, record.members]));
    for (const vault of this.vaults.values()) {
      const next = incoming.get(vault.id);
      if (JSON.stringify(next) !== JSON.stringify(vault.members) && vault.crypto && !this.isOpen(vault, session)) throw new Error('No se puede modificar una Vault cerrada');
      for (const id of next.items) if (this.items.get(id)?.status === 'processing') throw new Error('Espera a que termine la importación antes de introducirla en una Vault');
      for (const kind of kinds) for (const id of next[kind]) {
        const previous = this.owner(kind, id);
        if (previous?.crypto && !this.isOpen(previous, session) && previous.id !== vault.id) throw new Error('El elemento pertenece a una Vault cerrada');
        if (!this[kind].has(id) && !vault.members[kind].includes(id)) throw new Error('Elemento no disponible');
      }
    }
    // Materialize released files before relinquishing their encrypted ownership.
    for (const vault of this.vaults.values()) if (this.isOpen(vault, session)) {
      const next = incoming.get(vault.id);
      for (const id of vault.members.items) if (!next.items.includes(id) && this.items.has(id)) {
        const target = records.find(record => record.members.items.includes(id));
        if (!target || target.id !== vault.id) await this.materializeItem(vault, id);
      }
    }
    for (const vault of this.vaults.values()) {
      const next = incoming.get(vault.id);
      if (vault.crypto && !this.isOpen(vault, session)) continue;
      const trash = (vault.privateIds?.items || []).filter(id => this.deletedItems.has(id));
      vault.members = structuredClone(next);
      if (vault.crypto) vault.privateIds = { ...structuredClone(next), items: [...new Set([...next.items, ...trash])] };
    }
    this.rebuildOwners();
    for (const kind of kinds) for (const [id, object] of this[kind]) coordinates.bind(object, kind, this.owner(kind, id));
  }
  async encryptAsset(vault, context, relative, source) {
    const fileId = createHash('sha256').update(relative).digest('hex');
    const dir = path.join(this.root, vault.id); await fsp.mkdir(dir, { recursive: true, mode: 0o700 }); await syncDirectory(this.root);
    const output = path.join(dir, `${fileId}.enc`), temp = `${output}.tmp`;
    const input = await fsp.open(source, 'r'), writer = await fsp.open(temp, 'w', 0o600);
    const size = (await input.stat()).size;
    const header = Buffer.alloc(16); MAGIC.copy(header); header.writeBigUInt64BE(BigInt(size), 8);
    let buffer = Buffer.alloc(CHUNK);
    try {
      await writer.writeFile(header);
      for (let offset = 0, index = 0; offset < size; offset += CHUNK, index++) {
        const length = Math.min(CHUNK, size - offset);
        let read = 0;
        while (read < length) { const part = await input.read(buffer, read, length - read, offset + read); if (!part.bytesRead) throw new Error('Archivo incompleto'); read += part.bytesRead; }
        const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', context.key, iv, { authTagLength: 16 });
        cipher.setAAD(Buffer.from(`apoxia:asset:1:${vault.id}:${fileId}:${index}:${size}`));
        const ciphertext = Buffer.concat([cipher.update(buffer.subarray(0, length)), cipher.final()]);
        const prefix = Buffer.alloc(16); iv.copy(prefix); prefix.writeUInt32BE(length, 12);
        await writer.writeFile(Buffer.concat([prefix, ciphertext, cipher.getAuthTag()])); buffer.fill(0, 0, length);
      }
      await writer.sync();
    } finally { buffer.fill(0); buffer = null; await input.close(); await writer.close(); }
    await fsp.rename(temp, output); await syncDirectory(dir);
    context.assets[relative] = { fileId, size };
  }
  assetPath(vault, descriptor) {
    if (!/^[a-f0-9]{64}$/.test(descriptor.fileId) || !Number.isSafeInteger(descriptor.size) || descriptor.size < 0 || descriptor.size > 2 * 1024 * 1024 * 1024) throw new Error('Archivo cifrado inválido');
    return path.join(this.root, vault.id, `${descriptor.fileId}.enc`);
  }
  async readChunk(vault, context, descriptor, index, handle) {
    const length = Math.min(CHUNK, descriptor.size - index * CHUNK);
    const record = Buffer.alloc(length + OVERHEAD);
    let read = 0;
    while (read < record.length) { const part = await handle.read(record, read, record.length - read, 16 + index * (CHUNK + OVERHEAD) + read); if (!part.bytesRead) throw new Error('Archivo cifrado incompleto'); read += part.bytesRead; }
    if (record.readUInt32BE(12) !== length) throw new Error('Archivo cifrado inválido');
    const decipher = createDecipheriv('aes-256-gcm', context.key, record.subarray(0, 12), { authTagLength: 16 });
    decipher.setAAD(Buffer.from(`apoxia:asset:1:${vault.id}:${descriptor.fileId}:${index}:${descriptor.size}`));
    decipher.setAuthTag(record.subarray(16 + length));
    const partial = decipher.update(record.subarray(16, 16 + length));
    try { return Buffer.concat([partial, decipher.final()]); }
    finally { partial.fill(0); }
  }
  async withAsset(vault, context, relative, operation) {
    const descriptor = context.assets[relative]; if (!descriptor) throw new Error('Archivo no disponible');
    const handle = await fsp.open(this.assetPath(vault, descriptor), 'r');
    try {
      const header = Buffer.alloc(16); const { bytesRead } = await handle.read(header, 0, 16, 0);
      if (bytesRead !== 16 || !header.subarray(0, 8).equals(MAGIC) || header.readBigUInt64BE(8) !== BigInt(descriptor.size)) throw new Error('Archivo cifrado inválido');
      return await operation(descriptor, handle);
    } finally { await handle.close(); }
  }
  async copyItemAssets(vault, sourceId, destinationId, inventory = null) {
    const context=vault?.crypto?this.contexts.get(vault.id):null, created=[];
    try {
      for(const directory of ['media','originals']) {
        const prefix=`${directory}/`,pattern=new RegExp(`^${sourceId}(?:-thumb)?\\.[a-z0-9]{1,8}$`);
        const names=new Set(inventory?(inventory.get(sourceId)||[]).filter(relative=>relative.startsWith(prefix)).map(relative=>path.basename(relative)):(await fsp.readdir(path.join(this.dataDir,directory))).filter(name=>pattern.test(name)));
        if(!inventory)for(const relative of Object.keys(context?.assets||{}))if(relative.startsWith(prefix)&&pattern.test(path.basename(relative)))names.add(path.basename(relative));
        for(const name of names){const relative=prefix+name,destination=path.join(this.dataDir,directory,destinationId+name.slice(sourceId.length));created.push(destination);
          if(context?.assets[relative]){
            const output=await fsp.open(destination,'wx',0o600);
            try{await this.withAsset(vault,context,relative,async(descriptor,handle)=>{
              for(let index=0;index*CHUNK<descriptor.size;index++){const plaintext=await this.readChunk(vault,context,descriptor,index,handle);try{await output.writeFile(plaintext);}finally{plaintext.fill(0);}}
            });await output.sync();}finally{await output.close();}
          }else {const source=path.join(this.dataDir,relative);if((await fsp.lstat(source)).isSymbolicLink())await fsp.symlink(await fsp.readlink(source),destination);else await fsp.copyFile(source,destination,fsConstants.COPYFILE_FICLONE);}
        }
      }
      return created;
    }catch(error){await Promise.all(created.map(file=>fsp.rm(file,{force:true})));throw error;}
  }
  async materializeItem(vault, id) {
    if(!vault.crypto) return;
    const context = this.contexts.get(vault.id);
    for (const relative of Object.keys(context.assets).filter(name => path.basename(name).startsWith(id))) {
      const destination = path.join(this.dataDir, relative), temp = `${destination}.release`;
      const output = await fsp.open(temp, 'w', 0o600);
      let complete = false;
      try {
        await this.withAsset(vault, context, relative, async (descriptor, handle) => {
          for (let index = 0; index * CHUNK < descriptor.size; index++) {
            const plaintext = await this.readChunk(vault, context, descriptor, index, handle);
            try { await output.writeFile(plaintext); } finally { plaintext.fill(0); }
          }
        });
        await output.sync(); complete = true;
      } finally { await output.close(); if (!complete) await fsp.rm(temp, { force: true }); }
      try { await fsp.rename(temp, destination); await syncDirectory(path.dirname(destination)); }
      catch (error) { await fsp.rm(temp, { force: true }); throw error; }
    }
  }
  async persist({ geometryOnly = false, sealAssetsFor = null, cleanup = true } = {}) {
    for (const vault of this.vaults.values()) {
      const context = this.contexts.get(vault.id); if (!context) continue;
      if (geometryOnly && vault.crypto?.payload) continue;
      const trash = (vault.privateIds?.items || []).filter(id => this.deletedItems.has(id));
      vault.privateIds = { ...structuredClone(vault.members), items: [...new Set([...vault.members.items, ...trash])] };
      const pendingAssets = [];
      for (const directory of ['media', 'originals']) for (const name of await fsp.readdir(path.join(this.dataDir, directory))) {
        const id = name.slice(0, 36);
        if (!vault.privateIds.items.includes(id) || !new RegExp(`^${id}(?:-thumb)?\\.[a-z0-9]{1,8}$`).test(name)) continue;
        const relative = `${directory}/${name}`;
        // New files remain session-protected plaintext until an explicit lock.
        // Metadata is still saved encrypted so reopening can restore membership.
        if (!context.assets[relative]) {
          if (sealAssetsFor === vault.id) await this.encryptAsset(vault, context, relative, path.join(this.dataDir, relative));
          else pendingAssets.push(relative);
        }
      }
      vault.pendingAssets = pendingAssets;
      const payload = { version: 1, coordinateSystem: 'vault-local-v1', geometry: { x: 0, y: 0, width: 640, height: vault.height * 640 / vault.width }, assets: Object.fromEntries(Object.entries(context.assets).filter(([name]) => vault.privateIds.items.includes(path.basename(name).slice(0, 36)))), deletedItems: trash.map(id => coordinates.serialize(this.deletedItems.get(id), 'items', vault)), items: vault.members.items.map(id => this.items.get(id)).filter(Boolean).map(object => coordinates.serialize(object, 'items', vault)), writings: vault.members.writings.map(id => this.writings.get(id)).filter(Boolean).map(object => coordinates.serialize(object, 'writings', vault)), strokes: vault.members.strokes.map(id => this.strokes.get(id)).filter(Boolean).map(object => coordinates.serialize(object, 'strokes', vault)) };
      // Opaque IDs let backups include linked files without unlocking the payload.
      vault.fileLinkIds=[...new Set([...payload.items,...payload.writings,...payload.strokes].map(object=>object.fileLink?.id).filter(Boolean))];
      const plaintext = Buffer.from(JSON.stringify(payload));
      try { vault.crypto.payload = seal(context.key, plaintext, `apoxia:payload:1:${vault.id}`); }
      finally { plaintext.fill(0); }
      context.assets = payload.assets;
      vault.assetIds = Object.values(payload.assets).map(asset => asset.fileId);
    }
    const isPublic = (kind, object) => !this.owner(kind, object.id)?.crypto;
    const state = { version: 1, items: [...this.items.values()].filter(o => isPublic('items', o)), deletedItems: [...this.deletedItems.values()].filter(o => isPublic('items', o)), writings: [...this.writings.values()].filter(o => isPublic('writings', o)), strokes: [...this.strokes.values()].filter(o => isPublic('strokes', o)), vaults: [...this.vaults.values()], removedVaults: this.removedVaults };
    await atomicJson(this.stateFile, state);
    if (cleanup) { await this.cleanupRemovedVaults(); await this.cleanupPlaintext(); await this.removeLegacyFiles(); await this.cleanupCiphertext(); }
  }
  async cleanupRemovedVaults() {
    for (const record of [...this.removedVaults]) {
      if (!validId(record.id) || !Array.isArray(record.items) || !record.items.every(validId)) throw new Error('Borrado de Vault inválido');
      if (this.vaults.has(record.id)) continue;
      const ids = new Set(record.items.filter(id => !this.items.has(id) && !this.deletedItems.has(id) && !this.owner('items', id)));
      for (const directory of ['media', 'originals', 'tmp']) {
        const folder = path.join(this.dataDir, directory);
        for (const name of await fsp.readdir(folder)) if (ids.has(name.slice(0, 36)) && /^[0-9a-f-]{36}(?:-thumb)?(?:\.[a-z0-9]{1,8})?(?:\.release)?$/.test(name)) await fsp.rm(path.join(folder, name), { force: true });
        await syncDirectory(folder);
      }
      await fsp.rm(path.join(this.root, record.id), { recursive: true, force: true });
      await syncDirectory(this.root);
      this.removedVaults = this.removedVaults.filter(entry => entry !== record);
    }
  }
  async discardVault(vault, session, persist) {
    const context = this.contexts.get(vault.id);
    if (context && context.session !== session) throw new Error('Esta Vault está abierta en otra ventana');
    const ids = Object.fromEntries(kinds.map(kind => [kind, [...new Set([...(vault.members[kind] || []), ...(vault.privateIds?.[kind] || [])])]]));
    const snapshots = [];
    for (const kind of kinds) for (const id of ids[kind]) {
      const object = this[kind].get(id);
      if (object) snapshots.push([this[kind], id, object]);
      this[kind].delete(id);
    }
    for (const id of ids.items) {
      const object = this.deletedItems.get(id);
      if (object) snapshots.push([this.deletedItems, id, object]);
      this.deletedItems.delete(id);
    }
    const record = { id: vault.id, items: ids.items };
    this.vaults.delete(vault.id); this.removedVaults.push(record);
    try { await persist({ geometryOnly: true, cleanup: false }); }
    catch (error) {
      this.vaults.set(vault.id, vault);
      this.removedVaults = this.removedVaults.filter(entry => entry !== record);
      this.rebuildOwners();
      for (const [map, id, object] of snapshots) map.set(id, object);
      throw error;
    }
    for (const response of context?.pendingResponses || []) response.destroy();
    this.contexts.delete(vault.id); context?.key.fill(0); this.rebuildOwners();
    try { await this.cleanupRemovedVaults(); return { cleanupPending: false }; }
    catch (error) { console.error('Limpieza de Vault pendiente:', error.message); return { cleanupPending: true }; }
  }
  async removeLegacyFiles() {
    let changed = false;
    for (const name of ['board.json', 'strokes.json', 'writings.json', 'vaults.json']) for (const suffix of ['', '.tmp']) {
      try { await fsp.unlink(path.join(this.dataDir, `${name}${suffix}`)); changed = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (changed) await syncDirectory(this.dataDir);
  }
  async cleanupCiphertext() {
    for (const entry of await fsp.readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !validId(entry.name)) continue;
      const vault = this.vaults.get(entry.name);
      const directory = path.join(this.root, entry.name);
      if (!vault) { await fsp.rm(directory, { recursive: true, force: true }); continue; }
      if (!vault.crypto?.payload) continue;
      const keep = new Set(vault.assetIds || []);
      for (const name of await fsp.readdir(directory)) if (/^[a-f0-9]{64}\.enc(?:\.tmp)?$/.test(name) && (!keep.has(name.slice(0, 64)) || name.endsWith('.tmp'))) await fsp.rm(path.join(directory, name), { force: true });
    }
  }
  async cleanupPlaintext() {
    const ids = new Set([...this.vaults.values()].filter(v => v.crypto).flatMap(v => v.privateIds?.items || []));
    if(!ids.size)return;
    const pending = new Set([...this.vaults.values()].filter(v => v.crypto).flatMap(v => v.pendingAssets || []));
    for (const directory of ['media', 'originals', 'tmp']) {
      let changed = false;
      const folder = path.join(this.dataDir, directory);
      for (const name of await fsp.readdir(folder)) if (ids.has(name.slice(0, 36)) && !pending.has(`${directory}/${name}`) && /^[0-9a-f-]{36}(?:-thumb)?(?:\.[a-z0-9]{1,8})?(?:\.release)?$/.test(name)) { await fsp.rm(path.join(folder, name), { force: true }); changed = true; }
      if (changed) await syncDirectory(folder);
    }
  }
  async lock(vault, session, persist) {
    if (!vault.crypto && !vault.passwordHash) return;
    if (!vault.crypto) throw new Error('Abre esta Vault con su contraseña para activar el cifrado');
    if (!this.contexts.has(vault.id)) return;
    if (!this.isOpen(vault, session)) throw new Error('Esta Vault está abierta en otra ventana');
    await persist({ sealAssetsFor: vault.id });
    const context = this.contexts.get(vault.id);
    for (const response of context.pendingResponses || []) response.destroy();
    this.contexts.delete(vault.id); context.key.fill(0);
    for (const kind of kinds) for (const id of vault.privateIds[kind]) this[kind].delete(id);
    for (const id of vault.privateIds.items) this.deletedItems.delete(id);
  }
  async releaseVault(vault, session) {
    if (vault.crypto && !this.isOpen(vault, session)) throw new Error('Abre la Vault antes de eliminarla');
    for (const id of vault.members.items) await this.materializeItem(vault, id);
    for (const id of vault.privateIds?.items || []) this.deletedItems.delete(id);
  }
  async releaseContainer(vault, session, persist) {
    if (!this.isOpen(vault, session)) throw new Error('Abre la Vault para conservar su contenido');
    const context = this.contexts.get(vault.id);
    const ids = Object.fromEntries(kinds.map(kind => [kind, [...new Set([...(vault.members[kind] || []), ...(vault.privateIds?.[kind] || [])])]]));
    // Existing encrypted files are decrypted; newly added files are already on
    // disk. Materialize before removing the encrypted ownership or its key.
    for (const id of ids.items) await this.materializeItem(vault, id);
    const objects = [];
    for (const kind of kinds) for (const id of ids[kind]) {
      const object = this[kind].get(id);
      if (object) { coordinates.bind(object, kind, null); objects.push([kind, object]); }
    }
    for (const id of ids.items) {
      const object = this.deletedItems.get(id);
      if (object) { coordinates.bind(object, 'items', null); objects.push(['items', object]); }
    }
    const record = { id: vault.id, items: [] }; // Remove ciphertext, retain public files.
    this.vaults.delete(vault.id); this.removedVaults.push(record);
    try { await persist({ geometryOnly: true, cleanup: false }); }
    catch (error) {
      this.vaults.set(vault.id, vault); this.removedVaults = this.removedVaults.filter(entry => entry !== record);
      this.rebuildOwners();
      for (const [kind, object] of objects) coordinates.bind(object, kind, vault);
      await this.cleanupPlaintext();
      throw error;
    }
    for (const response of context?.pendingResponses || []) response.destroy();
    this.contexts.delete(vault.id); context?.key.fill(0); this.rebuildOwners();
    try { await this.cleanupRemovedVaults(); return { cleanupPending: false, preserved: true }; }
    catch (error) { console.error('Limpieza de Vault pendiente:', error.message); return { cleanupPending: true, preserved: true }; }
  }
  async serve(req, res, vault, relative, type, session, extraHeaders = {}, servePending = null) {
    const context = this.contexts.get(vault.id);
    if (!context || context.session !== session) { res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end(); return; }
    if (!context.assets[relative]) {
      if (servePending) {
        context.pendingResponses ||= new Set();
        context.pendingResponses.add(res);
        const release = () => context.pendingResponses.delete(res);
        res.once('close', release); res.once('finish', release);
        return servePending();
      }
      res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end(); return;
    }
    return this.withAsset(vault, context, relative, async (descriptor, handle) => {
      const size = descriptor.size; let start = 0, end = size - 1, status = 200;
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
        start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1; status = 206;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
      }
      res.writeHead(status, { 'Content-Type': type, 'Content-Length': Math.max(0, end - start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', ...extraHeaders, ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
      if (req.method === 'HEAD') { res.end(); return; }
      try {
        for (let index = Math.floor(start / CHUNK); index * CHUNK <= end; index++) {
          if (res.destroyed || this.contexts.get(vault.id) !== context) { res.destroy(); return; }
          const plaintext = await this.readChunk(vault, context, descriptor, index, handle);
          try {
            const portion = plaintext.subarray(Math.max(0, start - index * CHUNK), Math.min(plaintext.length, end - index * CHUNK + 1));
            await new Promise((resolve, reject) => res.write(portion, error => error ? reject(error) : resolve()));
          } finally { plaintext.fill(0); }
        }
        res.end();
      } catch { res.destroy(); }
    });
  }
  eraseKeys() { for (const context of this.contexts.values()) { for (const response of context.pendingResponses || []) response.destroy(); context.key.fill(0); } this.contexts.clear(); }
}
