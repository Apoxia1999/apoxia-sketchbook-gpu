exec(open('verification/test-text-interactions.py').read().split("cmd('/url'")[0])
cmd('/url',{'url':'http://localhost:4188'});time.sleep(8)
cmd('/timeouts',{'script':60000})
js('setMode("move",false);camera.scale=.008;camera.x=100-210000*.008;camera.y=100;renderCamera();')
r=cmd('/execute/async',{'script':'''const done=arguments[0];let times=[],n=0,last=performance.now(),bytes=0;function step(t){times.push(t-last);last=t;zoomAt(n<210?1.008:1/1.008,700,450);renderCamera();bytes=Math.max(bytes,[...strokeTiles.values()].reduce((sum,a)=>sum+a.width*a.height*4,0));if(++n<420)requestAnimationFrame(step);else{times.sort((a,b)=>a-b);done({fpsMedian:Math.round(1000/times[210]),medianMs:times[210],p95Ms:times[399],p99Ms:times[415],maxMs:times[419],maxCacheBytes:bytes,tiles:strokeTiles.size});}}requestAnimationFrame(step);''','args':[]})
assert r['maxCacheBytes']<64*1048576,r
print('CONTINUOUS_ZOOM',r,flush=True)
p=js('''camera.scale=.2;camera.x=100-210000*.2;camera.y=120;renderCamera();let a=drawingContext.getImageData(0,0,drawingLayer.width,drawingLayer.height).data;redrawStrokes(false);let b=drawingContext.getImageData(0,0,drawingLayer.width,drawingLayer.height).data;let total=0,count=0;for(let i=3;i<a.length;i+=4)if(a[i]||b[i]){total+=Math.abs(a[i]-b[i]);count++;}return {alphaMeanError:total/count,inkPixels:count};''')
assert p['alphaMeanError']<20,p
print('FULL_DETAIL_PIXELS',p,flush=True)
js('camera.scale=.025;camera.x=100-210000*.025;camera.y=140;renderCamera();persistLastCanvasView();')
logs=cmd('/log',{'type':'browser'});assert not [x for x in logs if x['level']=='SEVERE'],logs
json.dump({'continuousZoom':r,'fullDetailPixels':p,'errors':logs},open('verification/stroke-continuous-zoom-report.json','w'),indent=2)
