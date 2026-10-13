exec(open('verification/test-text-stress.py').read().split("command('/goog/cdp/execute'")[0])
exec(open('verification/test-text-interactions.py').read().split("cmd('/url'")[0])
cmd('/url',{'url':'http://localhost:4190'});time.sleep(4)
asyncjs('await initialBoardReady;sharedLastInteraction=performance.now()+1e9;window.__deleteTest=[];const note=await apiChange("/api/text","POST",{x:10000000,y:0,displayWidth:300,displayHeight:160,textFontSize:17,chromeScale:1,color:"#ffffff"});items.set(note.id,note);updateCard(note);__deleteTest.push({kind:"items",id:note.id});const writing=await apiChange("/api/writings","POST",{x:10000000,y:200,size:24,color:"#272727",text:"Delete selection"});writings.set(writing.id,writing);__deleteTest.push({kind:"writings",id:writing.id});return true;')
try:
 for key in ['Delete','x']:
  js('clearMagicSelection();for(const entry of __deleteTest)magicSelection.set(entry.kind+":"+entry.id,entry);window.__historyBefore=undoStack.length;window.dispatchEvent(new KeyboardEvent("keydown",{key:'+json.dumps(key)+'}));')
  for _ in range(100):
   if js('return !hoverDeleteBusy'):break
   time.sleep(.05)
  assert js('return __deleteTest.every(e=>!magicMap(e.kind).has(e.id))&&undoStack.length===__historyBefore+1&&magicSelection.size===0')
  js('window.dispatchEvent(new KeyboardEvent("keydown",{key:"z",ctrlKey:true}));')
  for _ in range(100):
   if js('return !historyBusy'):break
   time.sleep(.05)
  assert js('return __deleteTest.every(e=>magicMap(e.kind).has(e.id))')
  asyncjs('await travelHistory(true);return true;')
  assert js('return __deleteTest.every(e=>!magicMap(e.kind).has(e.id))')
  asyncjs('await travelHistory(false);return true;')
  print(key,'mixed selection delete, Ctrl+Z, redo passed',flush=True)
finally:
 asyncjs('clearMagicSelection();for(const entry of __deleteTest){if(magicMap(entry.kind).has(entry.id)){const snapshot=magicMap(entry.kind).get(entry.id);await setCopyPresent({kind:entry.kind,snapshot},false);}}return true;')
