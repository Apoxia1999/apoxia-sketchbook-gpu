exec(open('verification/test-text-stress.py').read().split("command('/goog/cdp/execute'")[0])
exec(open('verification/test-text-interactions.py').read().split("cmd('/url'")[0])
cmd('/url',{'url':'http://localhost:4190'});time.sleep(4)
asyncjs('await initialBoardReady;sharedLastInteraction=performance.now()+1e9;window.__lockedToolNote=await apiChange("/api/text","POST",{x:10000000,y:0,displayWidth:300,displayHeight:160,textFontSize:17,chromeScale:1,color:"#f7f7f4"});items.set(__lockedToolNote.id,__lockedToolNote);updateCard(__lockedToolNote);await applyItemChanges(__lockedToolNote.id,{locked:true});camera.scale=1;camera.x=300-10000000;camera.y=250;renderCamera();window.__strokeIdsBefore=new Set(strokes.keys());setMode("draw",false);return true;')
try:
 cmd('/actions',{'actions':[{'type':'pointer','id':'mouse','parameters':{'pointerType':'mouse'},'actions':[{'type':'pointerMove','x':350,'y':300,'duration':100},{'type':'pointerDown','button':0}]}]})
 assert js('return mode==="draw"&&gesture?.type==="draw"&&notePick(350,300)===null&&getComputedStyle(cards.get(__lockedToolNote.id)).pointerEvents==="none"')
 cmd('/actions',{'actions':[{'type':'pointer','id':'mouse','parameters':{'pointerType':'mouse'},'actions':[{'type':'pointerMove','x':410,'y':330,'duration':100},{'type':'pointerUp','button':0}]}]});time.sleep(.5)
 assert js('return mode==="draw"&&[...strokes.keys()].some(id=>!__strokeIdsBefore.has(id))')
 js('window.dispatchEvent(new KeyboardEvent("keydown",{key:"l"}));');time.sleep(.4)
 assert js('return !__lockedToolNote.locked&&notePick(350,300)?.id===__lockedToolNote.id')
 print('Locked note ignored by drawing, actual stroke created, L unlocks under pointer',flush=True)
finally:
 asyncjs('for(const stroke of [...strokes.values()])if(!__strokeIdsBefore.has(stroke.id))await setStrokePresent(stroke,false);await setNotePresent(__lockedToolNote,false);return true;')
