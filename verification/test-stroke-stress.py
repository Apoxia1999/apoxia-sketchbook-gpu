import json,time,sys
exec(open('verification/test-text-interactions.py').read().split("cmd('/url'")[0])
cmd('/url',{'url':'http://localhost:4188'});time.sleep(10)
cmd('/timeouts',{'script':60000})
report={'strokes':js('return strokes.size'),'addedStrokes':2000,'notes':1000,'images':7685,'viewport':js('return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio}'),'mode':'headed hardware WebGL, frame cap disabled'}
script='''const done=arguments[0];let times=[],cpu=[],n=0,last=performance.now();const base={...window.__strokeBase};function step(t){times.push(t-last);last=t;const start=performance.now();Object.assign(camera,base);camera.x+=n%2?2:0;if(__strokeZoom)zoomAt(n%2?1.004:1/1.004,700,450);renderCamera();cpu.push(performance.now()-start);if(++n<240)requestAnimationFrame(step);else{times.sort((a,b)=>a-b);cpu.sort((a,b)=>a-b);done({medianMs:times[120],p95Ms:times[228],cpuMedianMs:cpu[120],fpsMedian:Math.round(1000/times[120])});}}requestAnimationFrame(step);'''
for name,scale,zoom in [('overviewPan',.012,False),('overviewZoom',.012,True),('detailPan',.07,False),('detailZoom',.07,True)]:
 js('setMode("move",false);setNoteHover(null);camera.scale='+str(scale)+';camera.x=80-210000*camera.scale;camera.y=70;renderCamera();window.__strokeBase={...camera};window.__strokeZoom='+str(zoom).lower())
 time.sleep(2)
 report[name]=cmd('/execute/async',{'script':script,'args':[]})
 report[name]['drawingCpuMs']=js('let t=performance.now();for(let i=0;i<10;i++)redrawStrokes();return (performance.now()-t)/10')
 print(name,report[name],flush=True)
report['errors']=[a for a in cmd('/log',{'type':'browser'}) if a['level']=='SEVERE']
json.dump(report,open(sys.argv[1],'w'),indent=2)
