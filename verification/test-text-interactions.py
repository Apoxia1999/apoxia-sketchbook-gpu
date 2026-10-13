import urllib.request,json,time,base64
s=json.load(open('/tmp/sketch-text-session.json'))['session']
def cmd(path,data=None):
 r=urllib.request.Request('http://localhost:9515/session/'+s+path,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json'},method='POST' if data is not None else 'GET')
 out=json.load(urllib.request.urlopen(r))['value']
 if isinstance(out,dict) and 'error' in out:raise RuntimeError(out)
 return out
def js(code):return cmd('/execute/sync',{'script':code,'args':[]})
def asyncjs(code):return cmd('/execute/async',{'script':'const done=arguments[0];(async()=>{'+code+'})().then(done).catch(e=>done({error:String(e)}));','args':[]})
def move(x,y,dx=None,dy=None):
 a=[{'type':'pointerMove','x':x,'y':y,'duration':100},{'type':'pause','duration':150}]
 if dx is not None:a += [{'type':'pointerDown','button':0},{'type':'pointerMove','x':x+dx,'y':y+dy,'duration':300},{'type':'pointerUp','button':0}]
 cmd('/actions',{'actions':[{'type':'pointer','id':'mouse','parameters':{'pointerType':'mouse'},'actions':a}]});time.sleep(.6)
cmd('/url',{'url':'http://localhost:4186'});time.sleep(8)
js("window.__testNote=[...items.values()].filter(a=>a.testStress&&!a.color?.includes('gradient'))[5];window.__savedNote={...__testNote};setMode('move',false);camera.scale=.07;camera.x=200-__testNote.x*.07;camera.y=150-__testNote.y*.07;renderCamera();")
time.sleep(2);move(280,210)
assert js('return cards.get(__testNote.id).classList.contains("note-active")')
assert js('return noteGPU.models.get(__testNote.id).dom')
print('HOVER_NATIVE ok',flush=True)
el=js('return cards.get(__testNote.id).querySelector("textarea")')
key=el['element-6066-11e4-a52e-4f735466cecf']
cmd('/element/'+key+'/value',{'text':'\nEdicion GPU probada','value':list('\nEdicion GPU probada')});time.sleep(.9)
assert js('return items.get(__testNote.id).text.includes("Edicion GPU probada")')
js('document.activeElement.blur();setNoteHover(null);camera.scale=.024;camera.x=200-__testNote.x*.024;camera.y=150-__testNote.y*.024;renderCamera();');time.sleep(2)
assert js('const m=noteGPU.models.get(__testNote.id),t=noteGPU.low.entries.get(__testNote.id+":64");return t?.noteVersion===m.noteVersion && m.noteKey.includes("Edicion GPU probada")')
print('EDIT_AND_GPU_INVALIDATION ok',flush=True)
js('camera.scale=.07;camera.x=200-__testNote.x*.07;camera.y=150-__testNote.y*.07;renderCamera();');time.sleep(.5)
before=js('return {x:__testNote.x,y:__testNote.y}')
move(250,160,70,35)
after=js('return {x:__testNote.x,y:__testNote.y}')
assert abs(after['x']-before['x']-1000)<1, (before,after)
assert abs(after['y']-before['y']-500)<1
asyncjs('await travelHistory(false);return true;');time.sleep(.3)
assert js('return __testNote.x')==before['x']
asyncjs('await travelHistory(true);return true;');time.sleep(.3)
assert js('return __testNote.x')==after['x']
asyncjs('await travelHistory(false);return true;');time.sleep(.3)
print('DRAG_UNDO_REDO ok',flush=True)
js('cards.get(__testNote.id).querySelector(".reference-lock-button").click()');time.sleep(.7)
assert js('return __testNote.locked')
move(250,160,70,35)
assert js('return __testNote.x')==before['x']
js('cards.get(__testNote.id).querySelector(".reference-lock-button").click()');time.sleep(.7)
print('LOCK ok',flush=True)
asyncjs('await setTextsVisible(false);return true;');assert js('return noteGPU.models.size')==0
asyncjs('await setTextsVisible(true);return true;');time.sleep(2);assert js('return noteGPU.models.size')==1000
print('HIDE_SHOW ok',flush=True)
asyncjs('await patchItem(__testNote.id,{text:__savedNote.text,locked:__savedNote.locked||false});return true;')
js('setNoteHover(null);camera.scale=.15;camera.x=100-__testNote.x*.15;camera.y=180-__testNote.y*.15;renderCamera();');time.sleep(2)
open('verification/text-preview.png','wb').write(base64.b64decode(cmd('/screenshot')))
print('ERRORS',cmd('/log',{'type':'browser'}),flush=True)
