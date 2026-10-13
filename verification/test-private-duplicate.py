exec(open('verification/test-text-stress.py').read().split("command('/goog/cdp/execute'")[0])
exec(open('verification/test-text-interactions.py').read().split("cmd('/url'")[0])
cmd('/goog/cdp/execute',{'cmd':'Emulation.setDeviceMetricsOverride','params':{'width':1440,'height':1000,'deviceScaleFactor':1,'mobile':False}})
cmd('/url',{'url':'http://localhost:4190'});time.sleep(7)
asyncjs('await initialBoardReady;return true;')
js('sharedLastInteraction=performance.now()+1e9;window.addEventListener("wheel",e=>{e.preventDefault();e.stopImmediatePropagation();},{capture:true,passive:false});')





r=asyncjs('const image=[...items.values()].find(item=>item.type==="image"&&item.status==="ready"&&!vaultOwner("items",item.id));const a=await apiChange("/api/duplicate","POST",{objects:[{kind:"items",id:image.id}]});window.__privateCopySource=a.objects[0].object;window.__privateCopyVault=await apiChange("/api/vaults","POST",{x:20000000,y:0,width:1000,height:800});const v=__privateCopyVault;await apiChange("/api/vaults/"+v.id+"/unlock","POST",{password:"duplicate-test",confirm:"duplicate-test"});const all=await(await fetch("/api/vaults")).json();await apiChange("/api/vault-memberships","PUT",all.map(x=>({id:x.id,members:x.id===v.id?{items:[__privateCopySource.id],writings:[],strokes:[]}:x.members})));await apiChange("/api/vaults/"+v.id+"/lock","POST");await apiChange("/api/vaults/"+v.id+"/unlock","POST",{password:"duplicate-test"});const b=await apiChange("/api/duplicate","POST",{objects:[{kind:"items",id:__privateCopySource.id}],dx:10,dy:10});window.__privateCopy=b.objects[0].object;const source=await fetch("/original/"+__privateCopySource.id),copy=await fetch("/original/"+__privateCopy.id);const x=new Uint8Array(await source.arrayBuffer()),y=new Uint8Array(await copy.arrayBuffer());return {owner:b.objects[0].vaultId,expected:v.id,equal:source.ok&&copy.ok&&x.length===y.length&&x.every((value,i)=>value===y[i])};')
assert r['equal'] and r['owner']==r['expected'],r
asyncjs('await apiChange("/api/vaults/"+__privateCopyVault.id+"/lock","POST");return true;')
assert asyncjs('const r=await fetch("/original/"+__privateCopy.id);return r.status;')==404
r=asyncjs('const opened=await apiChange("/api/vaults/"+__privateCopyVault.id+"/unlock","POST",{password:"duplicate-test"});const a=await fetch("/original/"+__privateCopySource.id),b=await fetch("/original/"+__privateCopy.id);const x=new Uint8Array(await a.arrayBuffer()),y=new Uint8Array(await b.arrayBuffer());return {count:opened.contents.items.length,equal:a.ok&&b.ok&&x.length===y.length&&x.every((v,i)=>v===y[i])};')
assert r['equal'] and r['count']==2,r
asyncjs('await apiChange("/api/vaults/"+__privateCopyVault.id,"DELETE",{confirm:"BORRAR VAULT",action:"release"});await apiChange("/api/items/"+__privateCopySource.id,"DELETE");await apiChange("/api/items/"+__privateCopy.id,"DELETE");return true;')
print('ENCRYPTED_ASSET_DUPLICATE_AND_LOCK_REOPEN ok',flush=True)
