exec(open('verification/test-text-interactions.py').read().split("cmd('/url'")[0])
cmd('/url',{'url':'http://localhost:4186'});time.sleep(8)
asyncjs('await initialBoardReady;return true;')
cmd('/goog/cdp/execute',{'cmd':'Emulation.setDeviceMetricsOverride','params':{'width':1440,'height':1000,'deviceScaleFactor':1,'mobile':False}})
js('window.__sharpTesting=true;sharedLastInteraction=performance.now()+1e9;for(const name of ["wheel","pointerdown","keydown"])window.addEventListener(name,e=>{if(window.__sharpTesting)e.stopImmediatePropagation();},{capture:true});')
js('''window.__sharpNotes=[...items.values()].filter(a=>a.type==='text');window.__sharpOriginal={...__sharpNotes[999]};__sharpNotes.forEach((a,i)=>{a.x=220000+(i%40)*250;a.y=4000+Math.floor(i/40)*250;a.displayWidth=700;a.displayHeight=400;a.textFontSize=40;updateCard(a);});setMode('move',false);setNoteHover(null);camera.scale=.135;camera.x=70-220000*.135;camera.y=70;renderCamera();''');time.sleep(4)
for _ in range(60):
 time.sleep(.2)
 if js('return noteGPU.high.entries.size')==128:break
assert js('return noteGPU.high.entries.size')==128
js('''const a=__sharpNotes[999];Object.assign(a,{...__sharpOriginal,x:225000,y:700});updateCard(a);renderCamera();''')
for _ in range(60):
 time.sleep(.1)
 if js('const a=__sharpNotes[999],m=noteGPU.models.get(a.id),t=noteGPU.texture(m,512);return !!t'):break
r=js('const a=__sharpNotes[999],m=noteGPU.models.get(a.id),t=noteGPU.texture(m,512);return {width:a.displayWidth*camera.scale,highResolutionReady:!!t,native:m.dom,capacity:noteGPU.high.entries.size};')
assert r['highResolutionReady'] and not r['native'],r
print('FULL_ATLAS_PROMOTION',r,flush=True)
open('verification/note-sharpness.png','wb').write(base64.b64decode(cmd('/screenshot')))
cmd('/goog/cdp/execute',{'cmd':'Emulation.setDeviceMetricsOverride','params':{'width':1440,'height':1000,'deviceScaleFactor':2,'mobile':False}})
js('renderCamera();');time.sleep(1)
assert js('return noteGPU.models.get(__sharpNotes[999].id).dom')
print('HIDPI_NATIVE_PROMOTION ok',flush=True)
logs=cmd('/log',{'type':'browser'});assert not [x for x in logs if x['level']=='SEVERE'],logs
json.dump({'fullAtlas':r,'highDpiNative':True,'errors':logs},open('verification/note-sharpness-report.json','w'),indent=2)
cmd('/goog/cdp/execute',{'cmd':'Emulation.setDeviceMetricsOverride','params':{'width':1440,'height':1000,'deviceScaleFactor':1,'mobile':False}})
cmd('/url',{'url':'http://localhost:4188'});time.sleep(5)
js('camera.scale=.025;camera.x=100-210000*.025;camera.y=140;renderCamera();')
