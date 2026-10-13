exec(open('verification/test-text-interactions.py').read().split("cmd('/url'")[0])
cmd('/url',{'url':'http://localhost:4184'});time.sleep(3);move(1200,900)
r=asyncjs("const a=[...items.values()].find(a=>a.type==='text');if(!a)throw Error('Missing fixture note');window.__privateNoteId=a.id;const v=await apiChange('/api/vaults','POST',{x:a.x-1000,y:a.y-1000,width:a.displayWidth+2000,height:a.displayHeight+3000});vaults.set(v.id,v);createVaultNode(v);const {contents,...opened}=await apiChange(`/api/vaults/${v.id}/unlock`,'POST',{password:'text-gpu-test-only',confirm:'text-gpu-test-only'});Object.assign(v,opened,{open:true});installVaultContents(v,contents);await reconcileVaults({kind:'items',id:a.id,vaultId:v.id});setNoteHover(null);camera.scale=.07;camera.x=200-a.x*.07;camera.y=180-a.y*.07;renderCamera();return {id:v.id,note:a.id};")
assert not r.get('error'),r
time.sleep(2)
assert js('return ownedNoteGPU.models.size')==1
assert js('return ownedNoteGPU.low.entries.size+ownedNoteGPU.high.entries.size')>0
js("vaultNodes.get('"+r['id']+"').lock.click()")
for _ in range(80):
 time.sleep(.2)
 if js("return !vaults.get('"+r['id']+"').open&&!vaultBusy"):break
assert js('return ownedNoteGPU.models.size')==0
assert js('return ownedNoteGPU.low.entries.size+ownedNoteGPU.high.entries.size')==0
assert js('return !items.has(__privateNoteId)')
assert js('return ![...noteGPU.models.values()].some(a=>a.id===__privateNoteId)')
print('PRIVATE_NOTE_CLEARED ok',flush=True)
r2=asyncjs("const v=vaults.get('"+r['id']+"');const {contents,...state}=await apiChange(`/api/vaults/${v.id}/unlock`,'POST',{password:'text-gpu-test-only'});Object.assign(v,state,{open:true});installVaultContents(v,contents);refreshVaultVisibility();renderCamera();return contents.items.length;")
assert isinstance(r2,int) and r2>0,r2
time.sleep(2);assert js('return ownedNoteGPU.models.size')==1
asyncjs("const id='"+r['id']+"';await apiChange('/api/vaults/'+id,'DELETE',{confirm:'BORRAR VAULT',action:'release'});vaults.delete(id);const n=vaultNodes.get(id);n.frame.remove();n.back.remove();vaultNodes.delete(id);rebuildVaultOwners();refreshVaultVisibility();return true;")
print('PRIVATE_NOTE_REOPEN ok',flush=True)
logs=cmd('/log',{'type':'browser'});assert not [x for x in logs if x['level']=='SEVERE'],logs
json.dump({'clearedModels':True,'clearedTextures':True,'clearedPlaintext':True,'reopen':True,'errors':logs},open('verification/note-vault-report.json','w'),indent=2)
