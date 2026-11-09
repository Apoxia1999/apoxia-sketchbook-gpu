import fsp from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import './vault-coordinates.js';
const coordinates = globalThis.VaultCoordinates;
const kinds = ['items', 'writings', 'strokes'];
const validId = id => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id);
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
    await fsp.mkdir(this.root, {recursive:true, mode:0o700});
    let state;
    try { state = JSON.parse(await fsp.readFile(this.stateFile, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!state) {
      if ([...this.vaults.values()].some(vault => vault.crypto || vault.passwordHash)) throw new Error('SFW requiere contenedores abiertos');
      return;
    }
    if (state.version !== 1 || !Array.isArray(state.vaults)) throw new Error('Formato de canvas incompatible');
    if (state.vaults.some(vault => vault.crypto || vault.passwordHash)) throw new Error('SFW requiere contenedores abiertos. Exporta el contenido desde la app original antes de importarlo.');
    this.removedVaults = state.removedVaults || [];
    for (const kind of [...kinds, 'deletedItems', 'vaults']) {
      this[kind].clear();
      for (const object of state[kind] || []) this[kind].set(object.id, object);
    }
    this.rebuildOwners();
    for (const kind of kinds) for (const object of this[kind].values()) coordinates.bind(object, kind, this.owner(kind, object.id));
    for (const item of this.items.values()) if (item.status === 'processing') Object.assign(item, {status:'error', error:'Conversión interrumpida. Vuelve a importar el archivo.'});
    await this.cleanupRemovedVaults();
  }
  rebuildOwners() {
    this.owners.clear();
    for (const vault of this.vaults.values()) for (const kind of kinds)
      for (const id of vault.members[kind]) this.owners.set(`${kind}:${id}`, vault.id);
  }
  owner(kind, id) { return this.vaults.get(this.owners.get(`${kind}:${id}`)) || null; }
  accessible() { return true; }
  isOpen() { return true; }
  publicVault(vault) {
    return {...vault, open:true, configured:false, encrypted:false, hasContents:kinds.some(kind => vault.members[kind].length > 0)};
  }
  async assign(kind, id, vaultId) {
    const vault = this.vaults.get(vaultId);
    if (!vault) throw new Error('Contenedor no disponible');
    const previous = this.owner(kind, id);
    if (previous && previous.id !== vaultId) throw new Error('El elemento ya pertenece a otro contenedor');
    if (!vault.members[kind].includes(id)) vault.members[kind].push(id);
    this.owners.set(`${kind}:${id}`, vaultId);
  }
  async changeMembership(records) {
    const incoming = new Map(records.map(record => [record.id, record.members]));
    for (const vault of this.vaults.values()) {
      const next = incoming.get(vault.id);
      if (!next) throw new Error('Falta un contenedor');
      for (const kind of kinds) for (const id of next[kind]) {
        if (!this[kind].has(id)) throw new Error('Elemento no disponible');
        if (kind === 'items' && this.items.get(id).status === 'processing') throw new Error('Espera a que termine la importación');
      }
    }
    for (const vault of this.vaults.values()) vault.members = structuredClone(incoming.get(vault.id));
    this.rebuildOwners();
    for (const kind of kinds) for (const object of this[kind].values()) coordinates.bind(object, kind, this.owner(kind, object.id));
  }
  async copyItemAssets(vault, sourceId, destinationId, inventory = null) {
    const created = [];
    try {
      for (const directory of ['media', 'originals']) {
        const names = inventory ? (inventory.get(sourceId) || []).filter(name => name.startsWith(directory + '/')).map(name => path.basename(name)) : await fsp.readdir(path.join(this.dataDir, directory));
        for (const name of names) {
          if (!new RegExp(`^${sourceId}(?:-thumb)?\\.[a-z0-9]{1,8}$`).test(name)) continue;
          const destination = path.join(this.dataDir, directory, destinationId + name.slice(sourceId.length));
          await fsp.copyFile(path.join(this.dataDir, directory, name), destination, fsConstants.COPYFILE_EXCL);
          created.push(destination);
        }
      }
      return created;
    } catch (error) {
      await Promise.all(created.map(file => fsp.rm(file, {force:true})));
      throw error;
    }
  }
  async persist() {
    const state = {version:1, removedVaults:this.removedVaults};
    for (const kind of [...kinds, 'deletedItems', 'vaults']) state[kind] = [...this[kind].values()];
    await atomicJson(this.stateFile, state);
    await this.cleanupRemovedVaults();
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
    const snapshots = [];
    for (const kind of kinds) for (const id of vault.members[kind]) {
      const object = this[kind].get(id);
      if (object) { snapshots.push([kind, object]); this[kind].delete(id); }
    }
    this.vaults.delete(vault.id);
    const record = {id:vault.id, items:[...vault.members.items]};
    this.removedVaults.push(record);
    this.rebuildOwners();
    try { await persist(); }
    catch (error) {
      this.vaults.set(vault.id, vault);
      this.removedVaults = this.removedVaults.filter(entry => entry !== record);
      this.rebuildOwners();
      for (const [kind, object] of snapshots) this[kind].set(object.id, object);
      throw error;
    }
    return {cleanupPending:false};
  }
  async releaseContainer(vault, session, persist) {
    for (const kind of kinds) for (const id of vault.members[kind]) {
      const object = this[kind].get(id);
      if (object) coordinates.bind(object, kind, null);
    }
    this.vaults.delete(vault.id);
    this.rebuildOwners();
    try { await persist(); }
    catch (error) {
      this.vaults.set(vault.id, vault);
      this.rebuildOwners();
      for (const kind of kinds) for (const id of vault.members[kind]) {
        const object = this[kind].get(id);
        if (object) coordinates.bind(object, kind, vault);
      }
      throw error;
    }
    return {cleanupPending:false, preserved:true};
  }
  async lock() {}
  eraseKeys() {}
}
