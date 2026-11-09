import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {VaultStorage} from '../vault-storage.js';

test('open containers preserve content through movement, scaling, save, reload and release',async()=>{
 const dir=await fs.mkdtemp('/tmp/sfw-container-');
 try {
  for(const name of ['media','originals','tmp','vault-data'])await fs.mkdir(dir+'/'+name);
  const maps=()=>Object.fromEntries(['vaults','items','deletedItems','writings','strokes'].map(k=>[k,new Map()]));
  const state=maps();const storage=new VaultStorage({dataDir:dir,...state});
  const vault={id:randomUUID(),x:100,y:100,width:640,height:480,members:{items:[],writings:[],strokes:[]}};
  state.vaults.set(vault.id,vault);
  const item={id:randomUUID(),type:'text',x:120,y:130,displayWidth:100,displayHeight:80,status:'ready'};
  state.items.set(item.id,item);await storage.assign('items',item.id,vault.id);
  globalThis.VaultCoordinates.bind(item,'items',vault);
  vault.x+=50;assert.equal(item.x,170);vault.width*=2;assert.equal(item.displayWidth,200);
  await storage.persist();const restored=maps();const reopened=new VaultStorage({dataDir:dir,...restored});await reopened.load();
  const loaded=restored.items.get(item.id);assert.equal(loaded.x,item.x);assert(reopened.publicVault(restored.vaults.get(vault.id)).open);
  await reopened.releaseContainer(restored.vaults.get(vault.id),null,()=>reopened.persist());assert.equal(restored.vaults.size,0);assert.equal(loaded.x,item.x);
  await fs.writeFile(dir+'/state.json',JSON.stringify({version:1,vaults:[{crypto:{}}]}));await assert.rejects(reopened.load(),/SFW/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
