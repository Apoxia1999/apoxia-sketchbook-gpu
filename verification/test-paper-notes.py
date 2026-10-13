exec(open('verification/test-text-stress.py').read().split("command('/goog/cdp/execute'")[0])
exec(open('verification/test-text-interactions.py').read().split("cmd('/url'")[0])
cmd('/goog/cdp/execute',{'cmd':'Emulation.setDeviceMetricsOverride','params':{'width':1440,'height':1000,'deviceScaleFactor':1,'mobile':False}})
cmd('/url',{'url':'http://localhost:4188'});time.sleep(7)
asyncjs('await initialBoardReady;return true;')
js('sharedLastInteraction=performance.now()+1e9;window.addEventListener("wheel",e=>{e.preventDefault();e.stopImmediatePropagation();},{capture:true,passive:false});')
asyncjs("window.__paperNote=await apiChange('/api/text','POST',{x:500000,y:0,displayWidth:2666.666666666667,displayHeight:1422.2222222222224,textFontSize:151.11111111111111,chromeScale:8.88888888888889,color:'#f7f7f4'});items.set(__paperNote.id,__paperNote);createCard(__paperNote);await applyItemChanges(__paperNote.id,{text:'At Paper, we could not find the mono we wanted — so we made it. Beautiful for headlines, text, user interfaces, and code alike.'});return true;")
js("window.__paperSaved={...__paperNote};camera.scale=.135;camera.x=300-__paperNote.x*.135;camera.y=230-__paperNote.y*.135;renderCamera();")
move(420,280)
assert js('return activeTheme.id')=='paper'
assert js('return cards.get(__paperNote.id).querySelector("textarea").readOnly')
assert js('const c=cards.get(__paperNote.id);return getComputedStyle(c.querySelector(".card-head")).position')=='absolute'
move(630,210)
assert js('return getComputedStyle(cards.get(__paperNote.id).querySelector(".card-head")).opacity')=='1'
print('HOVER_CONTROLS ok',flush=True)
move(420,280)
before=js('const c=cards.get(__paperNote.id),r=c.querySelector("textarea").getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};')
move(1200,750);move(420,280)
after=js('const r=cards.get(__paperNote.id).querySelector("textarea").getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};')
assert before==after,(before,after)
assert js('return getComputedStyle(cards.get(__paperNote.id).querySelector(".resize-se"),"::after").display')=='none'
print('NATIVE_HOVER_ALIGNMENT_AND_HIDDEN_CORNERS ok',flush=True)
h=js('const r=cards.get(__paperNote.id).querySelector(".resize-se").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};')
w=js('return __paperNote.displayWidth');move(int(h['x']),int(h['y']),30,20)
assert js('return __paperNote.displayWidth')>w
asyncjs('await travelHistory(false);return true;')
assert abs(js('return __paperNote.displayWidth')-w)<.01
move(420,280)
print('INVISIBLE_CORNERS_RESIZE_UNDO ok',flush=True)
for side,delta in [('n',(0,-20)),('e',(25,0)),('s',(0,20)),('w',(-25,0))]:
 r=js('const r=cards.get(__paperNote.id).querySelector(".video-frame").getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};')
 x=r['x']+(r['w']*.25 if side in ['n','s'] else r['w'] if side=='e' else 0)
 y=r['y']+(r['h']*.25 if side in ['e','w'] else r['h'] if side=='s' else 0)
 before=js('return {w:__paperNote.displayWidth,h:__paperNote.displayHeight,x:__paperNote.x,y:__paperNote.y};')
 assert js('return getComputedStyle(cards.get(__paperNote.id).querySelector(".resize-'+side+'")).cursor')==side+'-resize'
 move(round(x),round(y),*delta)
 after=js('return {w:__paperNote.displayWidth,h:__paperNote.displayHeight,x:__paperNote.x,y:__paperNote.y};')
 assert abs(after['w']-before['w']-(25/.135 if side in ['e','w'] else 0))<.01,(side,before,after)
 assert abs(after['h']-before['h']-(20/.135 if side in ['n','s'] else 0))<.01,(side,before,after)
 asyncjs('await travelHistory(false);return true;')
move(480,230)
time.sleep(.3)
point=js('const p=connectorPoint(__paperNote,"n");return p;')
cmd('/actions',{'actions':[{'type':'pointer','id':'mouse','parameters':{'pointerType':'mouse'},'actions':[{'type':'pointerMove','x':round(point['x']),'y':round(point['y']),'duration':100},{'type':'pointerDown','button':0}]}]})
assert js('return gesture?.type')=='connector'
cmd('/actions',{'actions':[{'type':'pointer','id':'mouse','parameters':{'pointerType':'mouse'},'actions':[{'type':'pointerUp','button':0}]}]})
time.sleep(.3)
print('FOUR_EDGES_RESIZE_UNDO_AND_CONNECTOR_PRIORITY ok',flush=True)

# Actual native double click.
def double(x,y):
 cmd('/actions',{'actions':[{'type':'pointer','id':'mouse','parameters':{'pointerType':'mouse'},'actions':[{'type':'pointerMove','x':x,'y':y,'duration':100},{'type':'pointerDown','button':0},{'type':'pointerUp','button':0},{'type':'pause','duration':80},{'type':'pointerDown','button':0},{'type':'pointerUp','button':0}]}]});time.sleep(.4)
double(420,280)
print('EDIT_STATE',js('return {edit:editingNoteId,readonly:cards.get(__paperNote.id).querySelector("textarea").readOnly,cam:camera,mode,gesture:gesture?.type}'),flush=True)
assert js('return !cards.get(__paperNote.id).querySelector("textarea").readOnly && editingNoteId===__paperNote.id')
print('DOUBLE_CLICK_EDIT ok',flush=True)
el=js('return cards.get(__paperNote.id).querySelector("textarea")')['element-6066-11e4-a52e-4f735466cecf']
cmd('/element/'+el+'/value',{'text':' Papel','value':list(' Papel')});time.sleep(.7)
double(420,280)
assert js('return cards.get(__paperNote.id).querySelector("textarea").readOnly&&editingNoteId===null')
print('DOUBLE_CLICK_END_EDIT ok',flush=True)
b=js('return __paperNote.x');move(420,280,60,35)
assert abs(js('return __paperNote.x')-b-60/.135)<.1
asyncjs('await travelHistory(false);return true;')
print('BODY_DRAG_UNDO ok',flush=True)
asyncjs('window.__magnetOther=await apiChange("/api/text","POST",{x:__paperNote.x+65/.135,y:__paperNote.y-__paperNote.displayHeight-30/.135,displayWidth:__paperNote.displayWidth,displayHeight:__paperNote.displayHeight,textFontSize:__paperNote.textFontSize,chromeScale:__paperNote.chromeScale,color:"#f7f7f4"});items.set(__magnetOther.id,__magnetOther);createCard(__magnetOther);renderCamera();return true;')
time.sleep(.3)
b=js('return __paperNote.x');move(420,280,60,35)
assert abs(js('return __paperNote.x-__magnetOther.x'))<.001
assert abs(js('return __paperNote.y-__paperSaved.y')-35/.135)<.001
asyncjs('await travelHistory(false);return true;')
assert abs(js('return __paperNote.x')-b)<.001
assert js('const state={};const x=__magnetOther.x+20/camera.scale;return magneticNoteX(__paperNote,x,__paperNote.y,state)===x')
assert js('const state={};const x=__magnetOther.x+4/camera.scale;return magneticNoteX(__paperNote,x,__paperNote.y,state,true)===x')
asyncjs('await apiChange("/api/items/"+__magnetOther.id,"DELETE");removeCard(__magnetOther.id);return true;')
print('MAGNETIC_LEFT_ALIGNMENT_REAL_DRAG_UNDO ok',flush=True)
# Eye button and V share the persisted state, without interfering with editing.
js('cards.get(__paperNote.id).querySelector(".note-eye").click();')
time.sleep(.4)
assert js('return __paperNote.backgroundHidden&&getComputedStyle(cards.get(__paperNote.id).querySelector(".video-frame")).backgroundColor==="rgba(0, 0, 0, 0)"')
assert asyncjs('const r=await fetch("/api/items");const data=await r.json();return (Array.isArray(data)?data:data.items).find(x=>x.id===__paperNote.id).backgroundHidden;')
js('window.dispatchEvent(new KeyboardEvent("keydown",{key:"v"}));')
time.sleep(.4)
assert js('return !__paperNote.backgroundHidden')
print('EYE_V_PERSISTENCE ok',flush=True)

js('setMode("draw",false);window.__beforeTestDraw=strokes.size;')
move(1000,700,100,25);time.sleep(.8)
assert js('return strokes.size===__beforeTestDraw+1&&mode==="draw"')
b=js('return __paperNote.x');move(420,280,60,35)
assert js('return mode')=='move'
assert abs(js('return __paperNote.x')-b-60/.135)<.1
asyncjs('await travelHistory(false);await travelHistory(false);return true;')
assert js('return strokes.size===__beforeTestDraw')
print('DRAW_THEN_DRAG_WITHOUT_ESCAPE ok',flush=True)
asyncjs('await applyItemChanges(__paperNote.id,{text:__paperSaved.text});return true;')
move(1200,750)
js('setNoteHover(null);document.activeElement.blur();renderCamera();');time.sleep(2)
assert js('return noteGPU.models.get(__paperNote.id).h===__paperNote.displayHeight')
# Cold atlas: the native card must survive the first frame of zoom-out.
js('noteGPU.reset();camera.scale=.05;camera.x=300-__paperNote.x*.05;camera.y=230-__paperNote.y*.05;renderCamera();')
assert js('return cards.get(__paperNote.id).isConnected'), 'Readable 7.56px text should remain native'
assert js('noteGPU.reset();camera.scale=.04;camera.x=300-__paperNote.x*.04;camera.y=230-__paperNote.y*.04;renderCamera();return cards.get(__paperNote.id).isConnected'), 'Cold preview must retain native card'
time.sleep(1)
print('COLD_ZOOM_TRANSITION_AND_LATER_LINES ok',flush=True)
r=js('renderCamera();const gl=noteGPU.gl,p=new Uint8Array(4);gl.readPixels(350,gl.drawingBufferHeight-288,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];')
assert r[2]>r[0] and r[3]>0,r
print('GPU_ALWAYS_VISIBLE_SHADOW',r,flush=True)
open('verification/paper-distant-lines.png','wb').write(base64.b64decode(cmd('/screenshot')))
assert js('return !noteGPU.models.get(__paperNote.id).dom')
asyncjs('toggleNoteEditing(__paperNote.id);return true;')
assert js('return cards.get(__paperNote.id).isConnected&&!cards.get(__paperNote.id).querySelector("textarea").readOnly')
asyncjs('toggleNoteEditing(__paperNote.id);return true;')
print('DISTANT_LINES_AND_EDIT ok',flush=True)
asyncjs('await toggleNoteBackground(__paperNote.id);return true;');time.sleep(1)
assert js('const gl=noteGPU.gl,p=new Uint8Array(4);gl.readPixels(400,gl.drawingBufferHeight-280,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return p[3]===0'), 'GPU background must be transparent'
asyncjs('await toggleNoteBackground(__paperNote.id);return true;');time.sleep(.5)
print('GPU_TEXT_ONLY ok',flush=True)
asyncjs('window.__rectWriting=await apiChange("/api/writings","POST",{...screenToWorld(330,330),text:"Rect selection",size:22/camera.scale,color:"#272727"});writings.set(__rectWriting.id,__rectWriting);renderWritings();window.__rectStroke=await apiChange("/api/strokes","POST",{points:[[screenToWorld(400,380).x,screenToWorld(400,380).y],[screenToWorld(470,390).x,screenToWorld(470,390).y]],width:3/camera.scale,color:"#272727"});addStroke(__rectStroke,true);window.__rectImage=[...items.values()].find(x=>x.type==="image"&&x.status==="ready"&&!vaultOwner("items",x.id));window.__rectImageBefore={x:__rectImage.x,y:__rectImage.y,displayWidth:__rectImage.displayWidth,displayHeight:__rectImage.displayHeight};await applyItemChanges(__rectImage.id,{...screenToWorld(520,310),displayWidth:800,displayHeight:800*__rectImage.height/__rectImage.width});renderCamera();return true;')
cam=js('return {...camera}')
move(250,180,450,270)
assert js('return camera.x')==cam['x'] and js('return camera.y')==cam['y']
assert js('return rectangleSelection&&magicSelection.has("items:"+__paperNote.id)&&magicSelection.has("items:"+__rectImage.id)&&magicSelection.has("writings:"+__rectWriting.id)&&![...magicSelection.values()].some(x=>x.kind==="strokes")')
b=js('return {noteX:__paperNote.x,imageX:__rectImage.x,writingX:__rectWriting.x,strokeX:__rectStroke.points[0][0]};')
move(330,250,30,20)
a=js('return {noteX:__paperNote.x,imageX:__rectImage.x,writingX:__rectWriting.x,strokeX:__rectStroke.points[0][0]};')
assert abs(a['noteX']-b['noteX']-30/.04)<.01,(a,b)
assert abs(a['imageX']-b['imageX']-30/.04)<.01,(a,b)
assert abs(a['writingX']-b['writingX']-30/.04)<.01,(a,b)
assert a['strokeX']==b['strokeX']
assert js('return photoGPU.models.get(__rectImage.id).x===__rectImage.x')
asyncjs('await travelHistory(false);return true;')
assert abs(js('return __paperNote.x')-b['noteX'])<.01
js('clearMagicSelection();')
asyncjs('await applyItemChanges(__rectImage.id,__rectImageBefore);await apiChange("/api/writings/"+__rectWriting.id,"DELETE");writings.delete(__rectWriting.id);writingNodes.get(__rectWriting.id)?.remove();writingNodes.delete(__rectWriting.id);await apiChange("/api/strokes/"+__rectStroke.id,"DELETE");strokes.delete(__rectStroke.id);strokeBounds.delete(__rectStroke.id);strokeChunks.delete(__rectStroke.id);renderCamera();return true;')
print('RECTANGLE_MIXED_SELECTION_NO_STROKES_GROUP_MOVE_UNDO ok',flush=True)

js('camera.scale=.135;camera.x=300-__paperNote.x*.135;camera.y=230-__paperNote.y*.135;renderCamera();')
open('verification/paper-theme-preview.png','wb').write(base64.b64decode(cmd('/screenshot')))
logs=cmd('/log',{'type':'browser'});assert not [x for x in logs if x['level']=='SEVERE'],logs
json.dump({'doubleClickEdit':True,'doubleClickEndEdit':True,'bodyDragUndo':True,'noHeaderGeometry':True,'stableHoverPosition':True,'invisibleCornersResizeUndo':True,'distantLinePreview':True,'drawThenDragWithoutEscape':True,'gpuAlwaysVisibleShadow':True,'logs':logs},open('verification/paper-notes-report.json','w'),indent=2)
print('PAPER_THEME ok',flush=True)

asyncjs('await apiChange("/api/items/"+__paperNote.id,"DELETE");removeCard(__paperNote.id);return true;')
