exec(open('verification/test-text-stress.py').read().split("command('/goog/cdp/execute'")[0])
exec(open('verification/test-text-interactions.py').read().split("cmd('/url'")[0])
cmd('/goog/cdp/execute',{'cmd':'Emulation.setDeviceMetricsOverride','params':{'width':1440,'height':1000,'deviceScaleFactor':1,'mobile':False}})
cmd('/url',{'url':'http://localhost:4190'});time.sleep(7)
asyncjs('await initialBoardReady;return true;')
js('sharedLastInteraction=performance.now()+1e9;window.addEventListener("wheel",e=>{e.preventDefault();e.stopImmediatePropagation();},{capture:true,passive:false});')




asyncjs('window.__copyNote=await apiChange("/api/text","POST",{x:10000000,y:0,displayWidth:300,displayHeight:160,textFontSize:17,chromeScale:1,color:"magic-gradient"});items.set(__copyNote.id,__copyNote);createCard(__copyNote);await applyItemChanges(__copyNote.id,{text:"Copy this note",backgroundHidden:true});window.__copyWriting=await apiChange("/api/writings","POST",{x:10000450,y:100,size:24,color:"#272727",text:"Copy"});writings.set(__copyWriting.id,__copyWriting);const image=[...items.values()].find(item=>item.type==="image"&&item.status==="ready"&&!vaultOwner("items",item.id));const result=await apiChange("/api/duplicate","POST",{objects:[{kind:"items",id:image.id,snapshot:{x:10000750,y:0,displayWidth:200,displayHeight:200*image.height/image.width}}]});window.__copyImage=result.objects[0].object;items.set(__copyImage.id,__copyImage);updateCard(__copyImage);setMode("move",false);camera.scale=1;camera.x=300-10000000;camera.y=200;renderCamera();return true;')
video=base64.b64encode(open('/tmp/apoxia-duplicate-test.mp4','rb').read()).decode()
asyncjs('const data=Uint8Array.from(atob('+json.dumps(video)+'),c=>c.charCodeAt(0));const r=await fetch("/api/items?type=video&name=duplicate-test.mp4&x=10000750&y=250&displayWidth=200",{method:"POST",body:data});window.__copyVideo=await r.json();return true;')
for i in range(50):
 ready=asyncjs('const r=await fetch("/api/items");const list=await r.json();const item=list.find(x=>x.id===__copyVideo.id);if(item?.status==="ready"){__copyVideo=item;items.set(item.id,item);updateCard(item);renderCamera();return true;}return false;')
 if ready:break
 time.sleep(.2)
assert ready,'Video import did not complete'
def ctrl_drag(x,y,dx,dy):
 cmd('/actions',{'actions':[{'type':'key','id':'keyboard','actions':[{'type':'keyDown','value':'\ue009'}]}]})
 move(x,y,dx,dy)
 cmd('/actions',{'actions':[{'type':'key','id':'keyboard','actions':[{'type':'keyUp','value':'\ue009'}]}]})
 time.sleep(.5)
for name,kind,x,y in [('__copyNote','items',350,245),('__copyImage','items',1090,245),('__copyVideo','items',1090,485),('__copyWriting','writings',756,292)]:
 js('clearMagicSelection();selectedWriting=null;window.__source='+name+';window.__idsBefore=new Set(magicMap('+json.dumps(kind)+').keys());window.__sourceBefore={x:__source.x,y:__source.y};')
 ctrl_drag(x,y,80,35)
 state=js('const copies=[...magicMap('+json.dumps(kind)+').values()].filter(x=>!__idsBefore.has(x.id));window.__lastCopy=copies[0];return {copies:copies.length,x:__lastCopy?.x,y:__lastCopy?.y,sourceX:__source.x,sourceY:__source.y,before:__sourceBefore};')
 assert state['copies']==1,(name,state)
 assert abs(state['x']-state['before']['x']-80)<.01 and abs(state['y']-state['before']['y']-35)<.01,(name,state)
 assert state['sourceX']==state['before']['x'] and state['sourceY']==state['before']['y'],(name,state)
 if name=='__copyNote':assert js('return __lastCopy.text===__source.text&&__lastCopy.backgroundHidden&&__lastCopy.color===__source.color')
 if name in ['__copyImage','__copyVideo']:
  assert asyncjs('const a=await fetch("/original/"+__source.id),b=await fetch("/original/"+__lastCopy.id);const x=new Uint8Array(await a.arrayBuffer()),y=new Uint8Array(await b.arrayBuffer());return a.ok&&b.ok&&x.length===y.length&&x.every((v,i)=>v===y[i]);')
 asyncjs('await travelHistory(false);return true;')
 assert js('return !magicMap('+json.dumps(kind)+').has(__lastCopy.id)')
 asyncjs('await travelHistory(true);return true;')
 assert js('return magicMap('+json.dumps(kind)+').has(__lastCopy.id)')
 asyncjs('await travelHistory(false);return true;')
 print('CTRL_DRAG_DUPLICATE_UNDO_REDO',name,flush=True)
js('clearMagicSelection();lastSelectedItem=__copyNote.id;selectedWriting=null;window.dispatchEvent(new KeyboardEvent("keydown",{key:"c",ctrlKey:true}));')
asyncjs('await applyItemChanges(__copyNote.id,{text:"Changed after copying"});return true;')
js('window.__pasteBefore=new Set(items.keys());window.dispatchEvent(new KeyboardEvent("keydown",{key:"v",ctrlKey:true}));');time.sleep(.7)
assert js('const copy=[...items.values()].find(x=>!__pasteBefore.has(x.id));window.__pastedCopy=copy;return copy?.text==="Copy this note"&&copy.x===__copyNote.x+24&&copy.backgroundHidden')
asyncjs('await travelHistory(false);return true;')
js('clearMagicSelection();magicSelection.set("items:"+__copyNote.id,{kind:"items",id:__copyNote.id});magicSelection.set("writings:"+__copyWriting.id,{kind:"writings",id:__copyWriting.id});copyCanvasObjects();')
asyncjs('await pasteCanvasObjects();return true;')
assert js('return magicSelection.size===2')
asyncjs('await travelHistory(false);return true;')
logs=cmd('/log',{'type':'browser'});assert not [x for x in logs if x['level']=='SEVERE'],logs
asyncjs('for(const object of [__copyNote,__copyImage,__copyVideo]){await apiChange("/api/items/"+object.id,"DELETE");removeCard(object.id);}await apiChange("/api/writings/"+__copyWriting.id,"DELETE");writings.delete(__copyWriting.id);return true;')
print('CTRL_C_V_SNAPSHOT_AND_MIXED_SELECTION ok',flush=True)
