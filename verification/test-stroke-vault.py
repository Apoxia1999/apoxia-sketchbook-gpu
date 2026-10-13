exec(open('verification/test-text-interactions.py').read().split("cmd('/url'")[0])
assert cmd('/url')=='http://localhost:4188/'
r=asyncjs("const a=[...strokes.values()].find(a=>a.testStress),b=strokeWorldBounds(a.id);window.__privateStrokeId=a.id;const v=await apiChange('/api/vaults','POST',{x:b.minX-1000,y:b.minY-1000,width:5000,height:5000});vaults.set(v.id,v);createVaultNode(v);const {contents,...opened}=await apiChange(`/api/vaults/${v.id}/unlock`,'POST',{password:'stroke-gpu-test-only',confirm:'stroke-gpu-test-only'});Object.assign(v,opened,{open:true});installVaultContents(v,contents);await reconcileVaults({kind:'strokes',id:a.id,vaultId:v.id});renderCamera();return {id:v.id,members:v.members};")
assert not r.get('error') and len(r['members']['strokes'])==1,r
assert js('return strokeTiles.size')==0
assert js('return vaultOwner("strokes",__privateStrokeId)')==r['id']
js("vaultNodes.get('"+r['id']+"').lock.click()")
for _ in range(80):
 time.sleep(.2)
 if js("return !vaults.get('"+r['id']+"').open&&!vaultBusy"):break
assert js('return !strokes.has(__privateStrokeId)&&strokeTiles.size===0')
assert js('return !ownedDrawingLayer.getContext("2d").getImageData(0,0,ownedDrawingLayer.width,ownedDrawingLayer.height).data.some((v,i)=>i%4===3&&v)')
print('PRIVATE_STROKE_CLEARED ok',flush=True)
opened=asyncjs("const v=vaults.get('"+r['id']+"');const {contents,...state}=await apiChange(`/api/vaults/${v.id}/unlock`,'POST',{password:'stroke-gpu-test-only'});Object.assign(v,state,{open:true});installVaultContents(v,contents);refreshVaultVisibility();renderCamera();return contents.strokes.length;")
assert opened==1,opened
asyncjs("const id='"+r['id']+"';await apiChange('/api/vaults/'+id,'DELETE',{confirm:'BORRAR VAULT',action:'release'});vaults.delete(id);const n=vaultNodes.get(id);n.frame.remove();n.back.remove();vaultNodes.delete(id);rebuildVaultOwners();refreshVaultVisibility();renderCamera();return true;")
assert js('return strokes.has(__privateStrokeId)')
print('PRIVATE_STROKE_REOPEN ok',flush=True)
logs=cmd('/log',{'type':'browser'});assert not [x for x in logs if x['level']=='SEVERE'],logs
json.dump({'publicCachePurged':True,'privateStrokeCleared':True,'privateCanvasCleared':True,'reopen':True,'errors':logs},open('verification/stroke-vault-report.json','w'),indent=2)
