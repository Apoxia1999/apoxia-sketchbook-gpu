exec(open('verification/test-text-interactions.py').read().split("cmd('/url'")[0])
cmd('/url',{'url':'http://localhost:4188'});time.sleep(8)
js('setMode("draw",false);camera.scale=.07;camera.x=100-210000*.07;camera.y=120;renderCamera();')
n=js('return strokes.size')
move(400,500,150,40);time.sleep(1)
assert js('return strokes.size')==n+1
asyncjs('await travelHistory(false);return true;');assert js('return strokes.size')==n
asyncjs('await travelHistory(true);return true;');assert js('return strokes.size')==n+1
asyncjs('await travelHistory(false);return true;');assert js('return strokes.size')==n
print('DRAW_UNDO_REDO ok',flush=True)
js('setMode("move",false);renderCamera();')
assert js('return strokeTiles.size')>0
# Delete one exact synthetic stroke and undo using normal history helpers.
js('window.__eraseStroke=[...strokes.values()].find(a=>a.testStress);')
res=asyncjs('const a=__eraseStroke;const snap=structuredClone(a);await deleteStroke(a.id);remember({label:"test eraser",undo:()=>setStrokePresent(snap,true),redo:()=>setStrokePresent(snap,false)});renderCamera();return !strokes.has(a.id);')
assert res is True,res
asyncjs('await travelHistory(false);return true;');assert js('return strokes.has(__eraseStroke.id)')
js('setStrokesVisible(false);renderCamera();');assert js('return drawingLayer.hidden')
js('setStrokesVisible(true);renderCamera();');assert js('return !drawingLayer.hidden')
print('ERASE_UNDO_VISIBILITY ok',flush=True)
# Compare cached tiles to an uncached vector repaint; anti-aliasing may differ.
r=js('''camera.scale=.07;camera.x=100-210000*.07;camera.y=120;renderCamera();let a=drawingContext.getImageData(0,0,drawingLayer.width,drawingLayer.height).data;redrawStrokes(false);let b=drawingContext.getImageData(0,0,drawingLayer.width,drawingLayer.height).data;let total=0,count=0,max=0;for(let i=3;i<a.length;i+=4){if(a[i]||b[i]){total+=Math.abs(a[i]-b[i]);max=Math.max(max,Math.abs(a[i]-b[i]));count++;}}return {alphaMeanError:total/count,inkPixels:count,maxAlphaDifference:max};''')
assert r['inkPixels']>1000 and r['alphaMeanError']<30,r
print('PIXELS',r,flush=True)
js('renderCamera();')
open('verification/stroke-preview.png','wb').write(base64.b64decode(cmd('/screenshot')))
logs=cmd('/log',{'type':'browser'});assert not [x for x in logs if x['level']=='SEVERE'],logs
json.dump({'drawUndoRedo':True,'eraseUndo':True,'visibility':True,'pixels':r,'errors':logs},open('verification/stroke-interactions-report.json','w'),indent=2)
