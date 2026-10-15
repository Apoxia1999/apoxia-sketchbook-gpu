/* Contour SVG import and persistent, instanced WebGL geometry. */
(() => {
  const namespace = 'http://www.w3.org/2000/svg';
  const unsupported = message => { throw Error(message || 'Este SVG contiene rellenos, efectos o formas no compatibles. Usa contornos de segmentos rectos.'); };
  function parse(text) {
    if (text.length > 25 * 1024 * 1024) unsupported('El SVG supera 25 MB');
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) unsupported('El SVG contiene declaraciones externas no compatibles');
    const document = new DOMParser().parseFromString(text, 'image/svg+xml'), root = document.documentElement;
    if (document.querySelector('parsererror') || root.localName !== 'svg' || root.namespaceURI !== namespace) unsupported('SVG inválido');
    const dimension = name => { const value = root.getAttribute(name) || ''; return /^\d+(?:\.\d+)?(?:px)?$/.test(value) ? parseFloat(value) : 0; };
    let box = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (!root.hasAttribute('viewBox')) box = [0, 0, dimension('width'), dimension('height')];
    if (box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) unsupported('El SVG necesita dimensiones o un viewBox válido');
    let width = dimension('width'), height = dimension('height');
    if (!width && !height) { width = box[2]; height = box[3]; }
    else if (!width) width = height * box[2] / box[3];
    else if (!height) height = width * box[3] / box[2];
    width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height));
    if (width > 1000000 || height > 1000000) unsupported('Dimensiones SVG demasiado grandes');
    if (root.hasAttribute('preserveAspectRatio') && !['xMidYMid', 'xMidYMid meet'].includes(root.getAttribute('preserveAspectRatio').trim())) unsupported('La alineación de este SVG todavía no es compatible');
    const sourceScale = Math.min(width / box[2], height / box[3]);
    const contours = [], colorCanvas = self.document.createElement('canvas'); colorCanvas.width = colorCanvas.height = 1;
    const context = colorCanvas.getContext('2d', {willReadFrequently: true}), colors = new Map();
    const color = value => {
      if (colors.has(value)) return colors.get(value);
      if (/url\(|var\(|currentcolor|context-/i.test(value) || !CSS.supports('color', value)) unsupported('El color del contorno SVG no es compatible');
      context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
      const rgba = [...context.getImageData(0, 0, 1, 1).data]; if (rgba[3] !== 255) unsupported('Los contornos SVG semitransparentes todavía no son compatibles');
      const result = rgba.slice(0, 3).map(v => v / 255); colors.set(value, result); return result;
    };
    const properties = new Set(['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'stroke-opacity', 'fill-opacity', 'display', 'visibility']);
    function visit(element, inherited, isRoot = false) {
      const tag = element.localName;
      if (['title', 'desc', 'metadata'].includes(tag)) return;
      if (element.namespaceURI !== namespace || !['svg', 'g', 'path', 'polyline', 'polygon', 'line'].includes(tag) || (tag === 'svg' && !isRoot)) unsupported();
      const style = {...inherited};
      for (const attr of element.attributes) {
        const name = attr.name;
        if (name.startsWith('xmlns') || name.startsWith('data-') || name.startsWith('aria-') || ['id', 'version', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'd', 'points', 'x1', 'y1', 'x2', 'y2', 'style'].includes(name)) continue;
        if (!properties.has(name)) unsupported();
        style[name] = attr.value.trim();
      }
      if (element.hasAttribute('style')) for (const declaration of element.getAttribute('style').split(';')) {
        if (!declaration.trim()) continue;
        const colon = declaration.indexOf(':'), name = declaration.slice(0, colon).trim(), value = declaration.slice(colon + 1).trim();
        if (colon < 0 || !properties.has(name)) unsupported(); style[name] = value;
      }
      if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)) return;
      for (const name of ['opacity', 'stroke-opacity', 'fill-opacity']) if (name in style && Number(style[name]) !== 1) unsupported('La transparencia por grupos de este SVG todavía no es compatible');
      if (tag === 'svg' || tag === 'g') { for (const child of element.children) visit(child, style); return; }
      if (style.fill !== 'none' && tag !== 'line') unsupported();
      if (!style.stroke || style.stroke === 'none') return;
      if (style['stroke-linecap'] !== 'round' || style['stroke-linejoin'] !== 'round') unsupported('Usa extremos y uniones redondos al exportar los contornos SVG');
      const pen = Number(style['stroke-width']); if (!Number.isFinite(pen) || pen < 0) unsupported('Grosor SVG inválido'); if (!pen) return;
      let d = element.getAttribute('d') || '';
      if (tag === 'line') {
        const values = ['x1', 'y1', 'x2', 'y2'].map(name => Number(element.getAttribute(name) || 0));
        if (!values.every(Number.isFinite)) unsupported('Coordenadas SVG inválidas'); d = `M${values[0]} ${values[1]}L${values[2]} ${values[3]}`;
      } else if (tag === 'polyline' || tag === 'polygon') {
        const values = (element.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
        if (values.length < 4 || values.length % 2 || !values.every(Number.isFinite)) unsupported('Coordenadas SVG inválidas');
        d = values.reduce((text, value, i) => text + (i % 2 ? ` ${value}` : `${i ? 'L' : 'M'}${value}`), '') + (tag === 'polygon' ? 'Z' : '');
      }
      if (d.trim()) contours.push({d, color: color(style.stroke), width: pen});
    }
    visit(root, {fill: 'black', stroke: 'none', 'stroke-width': '1', 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter'}, true);
    if (!contours.length) unsupported('El SVG no contiene contornos visibles');
    return {width, height, originX: box[0], originY: box[1], sourceScale, offsetX: (width - box[2] * sourceScale) / 2, offsetY: (height - box[3] * sourceScale) / 2, contours};
  }
  function compile(descriptor, signal) {
    return new Promise((resolve, reject) => {
      const worker = new Worker('/svg-vector-worker.js');
      const finish = (error, data) => { worker.terminate(); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(data); };
      const abort = () => finish(new DOMException('SVG descartado', 'AbortError'));
      if (signal?.aborted) return abort(); signal?.addEventListener('abort', abort, {once: true});
      worker.onmessage = ({data}) => finish(data.error ? Error(data.error) : null, data);
      worker.onerror = () => finish(Error('No se pudo preparar la geometría SVG'));
      worker.postMessage(descriptor);
    });
  }
  async function prepare(file) {
    const descriptor = parse(await file.text()), vector = await compile(descriptor);
    const url = URL.createObjectURL(new Blob([await file.arrayBuffer()], {type: 'image/svg+xml'})), image = new Image();
    try {
      image.src = url; await image.decode();
      const canvas = self.document.createElement('canvas'), scale = 64 / Math.max(vector.width, vector.height);
      canvas.width = Math.max(1, Math.round(vector.width * scale)); canvas.height = Math.max(1, Math.round(vector.height * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      return {width: vector.width, height: vector.height, thumbnail: canvas.toDataURL('image/webp', .85).split(',')[1], vector};
    } finally { image.removeAttribute('src'); URL.revokeObjectURL(url); }
  }
  class SVGRenderer {
    constructor(engine) { this.engine = engine; this.gl = engine.gl; this.entries = new Map(); this.pending = new Map(); this.failed = new Map(); this.bytes = 0; this.uploads = 0; this.drawCalls = 0; this.selectedSegments = 0; }
    init() {
      if (this.program) return;
      const gl = this.gl, compileShader = (type, source) => { const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader)); return shader; };
      const vertex = compileShader(gl.VERTEX_SHADER, `#version 300 es
precision highp float;layout(location=0) in vec4 segment;uniform vec2 viewport;uniform vec4 objectCamera;uniform vec2 sourceOrigin;uniform float penWidth;
out vec2 local;flat out float segmentLength;flat out float radius;
void main(){vec2 a=(segment.xy-sourceOrigin)*objectCamera.zw+objectCamera.xy,delta=(segment.zw-segment.xy)*objectCamera.zw;float len=length(delta);vec2 direction=len>0.?delta/len:vec2(1.,0.),normal=vec2(-direction.y,direction.x);float r=penWidth*objectCamera.z*.5,pad=r+1.;float along=(gl_VertexID==1||gl_VertexID==3)?len+pad:-pad;float across=gl_VertexID>=2?pad:-pad;vec2 screen=a+direction*along+normal*across;gl_Position=vec4(screen.x/viewport.x*2.-1.,1.-screen.y/viewport.y*2.,0,1);local=vec2(along,across);segmentLength=len;radius=r;}`);
      const fragment = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;in vec2 local;flat in float segmentLength;flat in float radius;uniform vec3 ink;uniform float inkOpacity;out vec4 color;
void main(){float distanceToLine=length(vec2(local.x-clamp(local.x,0.,segmentLength),local.y));float aa=max(fwidth(distanceToLine),.00001),alpha=1.-smoothstep(radius-aa*.5,radius+aa*.5,distanceToLine);if(alpha<=0.)discard;color=vec4(ink,alpha*inkOpacity);}`);
      const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
      this.program = program; this.locations = Object.fromEntries(['viewport', 'objectCamera', 'sourceOrigin', 'penWidth', 'ink','inkOpacity'].map(name => [name, gl.getUniformLocation(program, name)]));
    }
    seed(id, geometry) {
      const gl = this.gl; this.remove(id); this.init();
      const bytes = geometry.groups.reduce((sum, group) => sum + group.levels.reduce((n, data) => n + data.byteLength, 0), 0);
      if (bytes > 128 * 1024 * 1024) throw Error('La geometría SVG supera la memoria disponible');
      for (const [key, old] of [...this.entries].sort((a, b) => a[1].used - b[1].used)) {
        if (this.bytes + bytes <= 128 * 1024 * 1024) break;
        if (old.used !== this.engine.frame) this.remove(key);
      }
      if (this.bytes + bytes > 128 * 1024 * 1024) throw Error('Demasiados SVG visibles para la memoria disponible');
      const previous = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
      const groups = geometry.groups.map(group => ({color: group.color, width: group.width, levels: group.levels.map(data => {
        const vao = gl.createVertexArray(), buffer = gl.createBuffer(); gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(0, 1); this.uploads++; return {vao, buffer, segments: data.length / 4};
      })}));
      gl.bindVertexArray(previous);
      const entry = {width: geometry.width, height: geometry.height, tolerance: geometry.tolerance, pathCount: geometry.pathCount, segmentCount: geometry.segmentCount, groups, bytes, used: this.engine.frame};
      this.entries.set(id, entry); this.bytes += bytes; this.engine.textureVersion++; this.engine.requestRender(); return entry;
    }
    ensure(model) {
      const cached = this.entries.get(model.id); if (cached) { cached.used = this.engine.frame; return cached; }
      if (this.pending.has(model.id) || this.failed.has(model.id)) return null;
      const controller = new AbortController(); this.pending.set(model.id, controller);
      (async () => {
        try {
          const response = await fetch(model.originalURL, {credentials: 'same-origin', signal: controller.signal}); if (!response.ok) throw Error(`HTTP ${response.status}`);
          const descriptor = parse(await response.text()), geometry = await compile(descriptor, controller.signal);
          if (!controller.signal.aborted && this.engine.models.has(model.id)) this.seed(model.id, geometry);
        } catch (error) {
          if (!controller.signal.aborted) { this.failed.set(model.id, error.message); window.dispatchEvent(new CustomEvent('apoxia-svg-error', {detail: {id: model.id, message: error.message}})); }
        } finally { if (this.pending.get(model.id) === controller) this.pending.delete(model.id); this.engine.requestRender(); }
      })();
      return null;
    }
    sync(models) {
      for (const id of [...this.entries.keys(), ...this.pending.keys(), ...this.failed.keys()]) if (!models.get(id)?.svg) this.remove(id);
    }
    draw(model, camera, dpr, opacity=1) {
      const entry = this.entries.get(model.id); if (!entry) return;
      const gl = this.gl, sx = model.w / entry.width * camera.scale, sy = model.h / entry.height * camera.scale;
      const level = entry.tolerance * Math.max(sx, sy) * dpr <= .45 ? 1 : 0;
      const x=camera.x+model.x*camera.scale,y=camera.y+model.y*camera.scale,originX=Math.floor((innerWidth/2-x)/sx),originY=Math.floor((innerHeight/2-y)/sy);
      gl.useProgram(this.program); gl.uniform2f(this.locations.viewport, innerWidth, innerHeight); gl.uniform2f(this.locations.sourceOrigin,originX,originY); gl.uniform4f(this.locations.objectCamera,x+originX*sx,y+originY*sy,sx,sy);
      gl.uniform1f(this.locations.inkOpacity,opacity);
      this.selectedSegments = 0;
      for (const group of entry.groups) {
        const buffer = group.levels[level]; gl.uniform1f(this.locations.penWidth, group.width); gl.uniform3fv(this.locations.ink, group.color); gl.bindVertexArray(buffer.vao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, buffer.segments); this.drawCalls++; this.selectedSegments += buffer.segments;
      }
      gl.bindVertexArray(null); entry.used = this.engine.frame;
    }
    remove(id) {
      this.pending.get(id)?.abort(); this.pending.delete(id); this.failed.delete(id);
      const entry = this.entries.get(id); if (!entry) return;
      for (const group of entry.groups) for (const level of group.levels) { this.gl.deleteBuffer(level.buffer); this.gl.deleteVertexArray(level.vao); }
      this.bytes -= entry.bytes; this.entries.delete(id);
    }
    reset() { for (const id of new Set([...this.entries.keys(), ...this.pending.keys(), ...this.failed.keys()])) this.remove(id); }
    get stats() { return {objects: this.entries.size, pending: this.pending.size, failed: this.failed.size, gpuBytes: this.bytes, uploads: this.uploads, drawCalls: this.drawCalls, selectedSegments: this.selectedSegments}; }
  }
  window.ApoxiaSVG = {parse, compile, prepare}; window.ApoxiaSVGRenderer = SVGRenderer;
})();
