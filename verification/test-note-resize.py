exec(open('verification/test-text-interactions.py').read().split("cmd('/url'")[0])
cmd('/url',{'url':'http://localhost:4186'});time.sleep(8)
js("window.__resizeNote=[...items.values()].find(a=>a.testStress);setMode('move',false);camera.scale=.15;camera.x=200-__resizeNote.x*.15;camera.y=180-__resizeNote.y*.15;renderCamera();")
move(350,250)
h=js('const r=cards.get(__resizeNote.id).querySelector(".resize-se").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width}')
b=js('return __resizeNote.displayWidth');assert h['w']>0,h
move(int(h['x']),int(h['y']),45,30)
assert js('return __resizeNote.displayWidth')>b
asyncjs('await travelHistory(false);return true;');time.sleep(.3)
assert abs(js('return __resizeNote.displayWidth')-b)<.01
print('NOTE_RESIZE_UNDO ok',flush=True)
cmd('/url',{'url':'http://localhost:4182'});time.sleep(2)
js('const a=[...items.values()].find(a=>a.type==="image");camera.scale=.5;camera.x=100-a.x*.5;camera.y=180-a.y*.5;renderCamera();');time.sleep(3)
assert js('return photoGPU.native.entries.size')>0
print('ORIGINAL_IMAGE_TILES ok',flush=True)
logs=cmd('/log',{'type':'browser'});assert not [x for x in logs if x['level']=='SEVERE'],logs
cmd('/url',{'url':'http://localhost:4186'});time.sleep(7)
js('setNoteHover(null);const a=[...items.values()].find(a=>a.testStress);camera.scale=.035;camera.x=100-a.x*.035;camera.y=160-a.y*.035;renderCamera();persistLastCanvasView();')
json.dump({'noteResize':True,'resizeUndo':True,'originalImageTiles':True,'errors':logs},open('verification/note-resize-report.json','w'),indent=2)
