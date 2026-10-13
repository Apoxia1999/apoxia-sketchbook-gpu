exec(open('verification/test-text-stress.py').read().split("command('/goog/cdp/execute'")[0])
exec(open('verification/test-text-interactions.py').read().split("cmd('/url'")[0])
cmd('/goog/cdp/execute',{'cmd':'Emulation.setDeviceMetricsOverride','params':{'width':1440,'height':1000,'deviceScaleFactor':1,'mobile':False}})
cmd('/url',{'url':'http://localhost:4190'});time.sleep(7)
asyncjs('await initialBoardReady;return true;')
js('sharedLastInteraction=performance.now()+1e9;window.addEventListener("wheel",e=>{e.preventDefault();e.stopImmediatePropagation();},{capture:true,passive:false});')



asyncjs('window.__detailNote=await apiChange("/api/text","POST",{x:9500000,y:0,displayWidth:300,displayHeight:160,textFontSize:17,chromeScale:1,color:"#f7f7f4"});items.set(__detailNote.id,__detailNote);createCard(__detailNote);await applyItemChanges(__detailNote.id,{text:"Draw between these letters"});camera.scale=8;camera.x=300-__detailNote.x*8;camera.y=300;renderCamera();setMode("draw",false);window.__beforeStrokes=new Set(strokes.keys());return true;')
assert js('return cards.get(__detailNote.id).classList.contains("note-detail-view")&&notePick(600,350)===null')
move(600,350,50,25)
assert js('return mode==="draw"&&strokes.size===__beforeStrokes.size+1&&__detailNote.x===9500000')
asyncjs('for(const id of strokes.keys())if(!__beforeStrokes.has(id)){await apiChange("/api/strokes/"+id,"DELETE");strokes.delete(id);strokeBounds.delete(id);strokeChunks.delete(id);}camera.scale=2;camera.x=300-__detailNote.x*2;renderCamera();return true;')
assert js('return !cards.get(__detailNote.id).classList.contains("note-detail-view")&&notePick(450,350)?.id===__detailNote.id')
asyncjs('await apiChange("/api/items/"+__detailNote.id,"DELETE");removeCard(__detailNote.id);return true;')
print('LETTER_DETAIL_DRAW_AND_RESTORED_INTERACTION ok',flush=True)
