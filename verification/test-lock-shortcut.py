exec(open('verification/test-text-stress.py').read().split("command('/goog/cdp/execute'")[0])
exec(open('verification/test-text-interactions.py').read().split("cmd('/url'")[0])
cmd('/url',{'url':'http://localhost:4190'});time.sleep(4)
asyncjs('await initialBoardReady;sharedLastInteraction=performance.now()+1e9;window.__lockObjects=[];const note=await apiChange("/api/text","POST",{x:10000000,y:0,displayWidth:300,displayHeight:160,textFontSize:17,chromeScale:1,color:"#f7f7f4"});items.set(note.id,note);updateCard(note);__lockObjects.push({kind:"items",id:note.id});const writing=await apiChange("/api/writings","POST",{x:10000450,y:0,size:24,color:"#272727",text:"Lock this vector text"});writings.set(writing.id,writing);__lockObjects.push({kind:"writings",id:writing.id});setMode("move",false);camera.scale=1;camera.x=300-10000000;camera.y=300;renderCamera();return true;')
try:
 for entry in js('return __lockObjects'):
  js('pointerOnPage=false;pointerPosition={x:0,y:0};hoveredWriting=null;clearMagicSelection();selectedWriting=null;lastSelectedItem=null;const entry='+json.dumps(entry)+';if(entry.kind==="items")lastSelectedItem=entry.id;else selectWriting(entry.id);window.dispatchEvent(new KeyboardEvent("keydown",{key:"l"}));')
  time.sleep(.4)
  assert js('const e='+json.dumps(entry)+';return magicMap(e.kind).get(e.id).locked')
  if entry['kind']=='items':assert js('return getComputedStyle(cards.get('+json.dumps(entry['id'])+').querySelector(".card-head")).display==="none"')
  else:assert js('return getComputedStyle(writingControls).display==="none"')
  asyncjs('await travelHistory(false);return true;')
  assert js('const e='+json.dumps(entry)+';return !magicMap(e.kind).get(e.id).locked')
  asyncjs('await travelHistory(true);return true;')
  js('window.dispatchEvent(new KeyboardEvent("keydown",{key:"l"}));');time.sleep(.4)
  assert js('const e='+json.dumps(entry)+';return !magicMap(e.kind).get(e.id).locked')
 print('L locks/unlocks notes and Scribe, hides controls, and supports undo/redo',flush=True)
finally:
 asyncjs('for(const e of __lockObjects)await setCopyPresent({kind:e.kind,snapshot:magicMap(e.kind).get(e.id)},false);return true;')
