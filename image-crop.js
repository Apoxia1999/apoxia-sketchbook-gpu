/* Source-normalized, non-destructive image crop geometry. Shared by client/server. */
(() => {
  const full = Object.freeze({x:0,y:0,width:1,height:1});
  function normalize(value) {
    if(value==null)return null;
    if(typeof value!=='object'||Array.isArray(value))throw Error('Recorte inválido');
    const {x,y,width,height}=value;
    if(![x,y,width,height].every(Number.isFinite)||x<0||y<0||width<1e-9||height<1e-9||x+width>1+1e-9||y+height>1+1e-9)throw Error('Recorte inválido');
    const result={x,y,width:Math.min(width,1-x),height:Math.min(height,1-y)};
    return x<=1e-9&&y<=1e-9&&result.width>=1-1e-9&&result.height>=1-1e-9?null:result;
  }
  function sourceBounds(item) {
    const c=item.crop||full,w=(item.displayWidth??item.w??320)/c.width,h=(item.displayHeight??item.h??180)/c.height;
    return {x:item.x-c.x*w,y:item.y-c.y*h,width:w,height:h};
  }
  function aspect(item) {const c=item.crop||full;return item.width*c.width/(item.height*c.height);}
  function drag(original,start,direction,dx,dy,minimum,tolerance=0) {
    let left=start.x,top=start.y,right=start.x+start.displayWidth,bottom=start.y+start.displayHeight;
    if(direction.includes('w'))left=Math.min(right-minimum,left+dx);
    if(direction.includes('e'))right=Math.max(left+minimum,right+dx);
    if(direction.includes('n'))top=Math.min(bottom-minimum,top+dy);
    if(direction.includes('s'))bottom=Math.max(top+minimum,bottom+dy);
    const endX=original.x+original.width,endY=original.y+original.height;
    if(left<original.x-tolerance||top<original.y-tolerance||right>endX+tolerance||bottom>endY+tolerance)return {x:original.x,y:original.y,displayWidth:original.width,displayHeight:original.height,crop:null};
    left=Math.max(left,original.x);top=Math.max(top,original.y);right=Math.min(right,endX);bottom=Math.min(bottom,endY);
    const crop=normalize({x:(left-original.x)/original.width,y:(top-original.y)/original.height,width:(right-left)/original.width,height:(bottom-top)/original.height});
    return {x:left,y:top,displayWidth:right-left,displayHeight:bottom-top,crop};
  }
  globalThis.ApoxiaCrop={full,normalize,sourceBounds,aspect,drag};
})();
