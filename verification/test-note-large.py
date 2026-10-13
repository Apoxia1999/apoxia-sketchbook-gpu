exec(open('verification/test-text-stress.py').read().split("command('/goog/cdp/execute'")[0])
exec(open('verification/test-text-interactions.py').read().split("cmd('/url'")[0])
cmd('/url',{'url':'http://localhost:4190'});time.sleep(4)
asyncjs('await initialBoardReady;sharedLastInteraction=performance.now()+1e9;window.__largeNote=await apiChange("/api/text","POST",{x:10000000,y:0,displayWidth:300,displayHeight:160,textFontSize:17,chromeScale:1,color:"#f7f7f4"});items.set(__largeNote.id,__largeNote);updateCard(__largeNote);await applyItemChanges(__largeNote.id,{text:Array.from({length:100},(_,i)=>"Line "+i).join("\\n")});camera.scale=1;camera.x=300-10000000;camera.y=250;renderCamera();return true;')
try:
 assert js('const start={x:0,y:0,width:300,height:160};const tall=resizeNote(start,0,3000,"s",1),wide=resizeNote(start,3000,0,"e",1);return tall.displayWidth===300&&tall.displayHeight===3160&&wide.displayWidth===3300&&wide.displayHeight===160&&noteLayoutUnit({...__largeNote,...tall})===1;')
 assert js('const card=cards.get(__largeNote.id),editor=card.querySelector(".text-editor");const scale=camera.scale;card.querySelector(".video-frame").dispatchEvent(new WheelEvent("wheel",{bubbles:true,cancelable:true,deltaY:100}));return editor.scrollTop>0&&camera.scale===scale;')
 asyncjs('await applyItemChanges(__largeNote.id,{displayHeight:3160});return true;')
 assert js('const editor=cards.get(__largeNote.id).querySelector(".text-editor");return notePreviewLayout(__largeNote).lines.length===100&&getComputedStyle(editor).fontSize==="17px"&&editor.scrollHeight<=editor.clientHeight+1;')
 print('Unlimited box growth, stable font, 100 lines and wheel scroll passed',flush=True)
finally:
 asyncjs('await setNotePresent(__largeNote,false);return true;')
