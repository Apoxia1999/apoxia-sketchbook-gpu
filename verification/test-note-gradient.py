exec(open('verification/test-text-stress.py').read().split("command('/goog/cdp/execute'")[0])
exec(open('verification/test-text-interactions.py').read().split("cmd('/url'")[0])
cmd('/goog/cdp/execute',{'cmd':'Emulation.setDeviceMetricsOverride','params':{'width':1440,'height':1000,'deviceScaleFactor':1,'mobile':False}})
cmd('/url',{'url':'http://localhost:4190'});time.sleep(7)
asyncjs('await initialBoardReady;return true;')
js('sharedLastInteraction=performance.now()+1e9;window.addEventListener("wheel",e=>{e.preventDefault();e.stopImmediatePropagation();},{capture:true,passive:false});')


asyncjs(r'window.__gradientNote=await apiChange("/api/text","POST",{x:9000000,y:0,displayWidth:300,displayHeight:160,textFontSize:17,chromeScale:1,color:"magic-gradient"});items.set(__gradientNote.id,__gradientNote);createCard(__gradientNote);await applyItemChanges(__gradientNote.id,{text:"Gradient note\nKeep the gradient visible"});camera.scale=.3;camera.x=400-__gradientNote.x*.3;camera.y=300;renderCamera();return true;')
time.sleep(1.5)
print('GRADIENT_STATE',js('const m=noteGPU.models.get(__gradientNote.id);return {color:__gradientNote.color,magic:cards.get(__gradientNote.id).classList.contains("note-magic"),dom:m.dom,neon:m.neon,source:noteRasterSource(__gradientNote.id).neon};'),flush=True)
assert js('const m=noteGPU.models.get(__gradientNote.id);return !m.dom&&!m.neon&&noteRasterSource(__gradientNote.id).neon')
r=js('noteGPU.render(camera);const gl=noteGPU.gl,result=[];for(const x of [410,435,465,480]){const p=new Uint8Array(4);gl.readPixels(x,gl.drawingBufferHeight-335,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);result.push([...p]);}return result;')
print('GRADIENT_PIXELS',r,flush=True)
assert len({tuple(p[:3]) for p in r})>2,r
assert all(p[3]>240 for p in r),r
frame=js('return noteGPU.frame');time.sleep(.7);assert js('return noteGPU.frame')==frame
open('verification/gradient-distant-preview.png','wb').write(base64.b64decode(cmd('/screenshot')))
asyncjs('await apiChange("/api/items/"+__gradientNote.id,"DELETE");removeCard(__gradientNote.id);return true;')
print('STATIC_DISTANT_GRADIENT ok',flush=True)
