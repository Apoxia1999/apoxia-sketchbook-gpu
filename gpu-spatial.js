window.GPUSpatialIndex = class SpatialIndex {
 constructor(size=512){this.size=size;this.cells=new Map();this.large=new Set();}
 keys(item){if((Math.floor((item.x+item.w)/this.size)-Math.floor(item.x/this.size)+1)*(Math.floor((item.y+item.h)/this.size)-Math.floor(item.y/this.size)+1)>64)return null;const out=[];for(let y=Math.floor(item.y/this.size);y<=Math.floor((item.y+item.h)/this.size);y++)for(let x=Math.floor(item.x/this.size);x<=Math.floor((item.x+item.w)/this.size);x++)out.push(`${x},${y}`);return out;}
 insert(item){item.cells=this.keys(item);if(!item.cells){this.large.add(item);return;}for(const key of item.cells){let cell=this.cells.get(key);if(!cell)this.cells.set(key,cell=new Set());cell.add(item);}}
 remove(item){this.large.delete(item);for(const key of item.cells||[]){const cell=this.cells.get(key);cell?.delete(item);if(!cell?.size)this.cells.delete(key);}}
 update(item){this.remove(item);this.insert(item);}
 query(x,y,w,h){const found=new Set();for(const a of this.large)if(a.x<=x+w&&a.x+a.w>=x&&a.y<=y+h&&a.y+a.h>=y)found.add(a);const x0=Math.floor(x/this.size),x1=Math.floor((x+w)/this.size),y0=Math.floor(y/this.size),y1=Math.floor((y+h)/this.size);const visit=cell=>{for(const a of cell||[])if(a.x<=x+w&&a.x+a.w>=x&&a.y<=y+h&&a.y+a.h>=y)found.add(a);};if((x1-x0+1)*(y1-y0+1)>this.cells.size*2){for(const cell of this.cells.values())visit(cell);}else for(let cy=y0;cy<=y1;cy++)for(let cx=x0;cx<=x1;cx++)visit(this.cells.get(`${cx},${cy}`));return [...found];}
}
