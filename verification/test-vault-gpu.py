exec(open('/tmp/test-features-gpu.py').read().split("command('/url'")[0])
command('/url',{'url':'http://localhost:4180'});time.sleep(1)
script="""const done=arguments[0];(async()=>{setMode('move',false);const image=[...items.values()].find(a=>a.type==='image');const v=await apiChange('/api/vaults','POST',{x:image.x-600,y:image.y-700,width:4200,height:3500});vaults.set(v.id,v);createVaultNode(v);const {contents,...opened}=await apiChange(`/api/vaults/${v.id}/unlock`,'POST',{password:'gpu-test-only',confirm:'gpu-test-only'});Object.assign(v,opened,{open:true});installVaultContents(v,contents);await reconcileVaults({kind:'items',id:image.id,vaultId:v.id});camera.scale=.3;camera.x=250-image.x*.3;camera.y=200-image.y*.3;renderCamera();done({id:v.id,image:image.id,members:v.members});})().catch(e=>done({error:String(e)}));"""
v=command('/execute/async',{'script':script,'args':[]});print('VAULT_OPEN',v,flush=True);assert 'error' not in v and v['image'] in v['members']['items']
time.sleep(2);print('OWNED_GPU',js('return __sketchGPU.stats()'),flush=True);assert js('return ownedPhotoGPU.models.size')==1
js(f"vaultNodes.get('{v['id']}').lock.click()")
for i in range(40):
 time.sleep(.3)
 if js(f"return !vaults.get('{v['id']}').open&&!vaultBusy"):break
print('VAULT_CLOSED',js('return __sketchGPU.stats()'),flush=True)
assert js('return ownedPhotoGPU.models.size')==0
assert js('return ownedPhotoGPU.native.entries.size')==0
closed=command('/execute/async',{'script':f"const done=arguments[0];fetch('/original/{v['image']}').then(r=>done(r.status));",'args':[]});assert closed==404;print('PRIVATE_ORIGINAL_BLOCKED',closed,flush=True)
script=f"""const done=arguments[0];(async()=>{{const v=vaults.get('{v['id']}');const {{contents,...state}}=await apiChange(`/api/vaults/${{v.id}}/unlock`,'POST',{{password:'gpu-test-only'}});Object.assign(v,state,{{open:true}});installVaultContents(v,contents);refreshVaultVisibility();done(contents.items.length);}})().catch(e=>done({{error:String(e)}}));"""
opened=command('/execute/async',{'script':script,'args':[]});assert opened==1;time.sleep(2);assert js('return ownedPhotoGPU.models.size')==1;print('VAULT_REOPEN','ok',flush=True)
# Remove the temporary Vault while retaining its synthetic test media publicly.
script=f"""const done=arguments[0];(async()=>{{await apiChange('/api/vaults/{v['id']}','DELETE',{{confirm:'BORRAR VAULT',action:'release'}});vaults.delete('{v['id']}');const n=vaultNodes.get('{v['id']}');n.frame.remove();n.back.remove();vaultNodes.delete('{v['id']}');rebuildVaultOwners();refreshVaultVisibility();done();}})().catch(e=>done(String(e)));"""
command('/execute/async',{'script':script,'args':[]})
print('ERRORS',command('/log',{'type':'browser'}),flush=True)
