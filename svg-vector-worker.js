/* Build immutable contour buffers off the UI thread. No SVG rasterization. */
const MAX_SEGMENTS = 1000000;
function parsePath(text) {
  const tokens = []; const token = /[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  let match, end = 0;
  while ((match = token.exec(text))) {
    if (!/^[\s,]*$/.test(text.slice(end, match.index))) throw Error('Coordenadas SVG inválidas');
    const value = /^[a-zA-Z]$/.test(match[0]) ? match[0] : Number(match[0]);
    if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 1e9)) throw Error('Coordenadas SVG fuera de rango');
    tokens.push(value); end = token.lastIndex;
  }
  if (!/^[\s,]*$/.test(text.slice(end))) throw Error('Trazado SVG inválido');
  const paths = []; let points = null, command = null, x = 0, y = 0, i = 0, count = 0;
  while (i < tokens.length) {
    if (typeof tokens[i] === 'string') command = tokens[i++];
    if (!command || !/^[MmLlHhVvZz]$/.test(command)) throw Error('Este SVG contiene curvas. Exporta contornos de segmentos rectos para importarlo.');
    const relative = command === command.toLowerCase(), kind = command.toUpperCase();
    if (kind === 'Z') {
      if (!points) throw Error('Trazado SVG inválido');
      points.push([...points[0]]); [x, y] = points[0]; command = null; continue;
    }
    const take = () => { const value = tokens[i++]; if (typeof value !== 'number') throw Error('Coordenadas SVG incompletas'); return value; };
    if (kind === 'M' || kind === 'L') { const a = take(), b = take(); x = a + (relative ? x : 0); y = b + (relative ? y : 0); }
    else if (kind === 'H') x = take() + (relative ? x : 0);
    else y = take() + (relative ? y : 0);
    if (kind === 'M') { points = []; paths.push(points); command = relative ? 'l' : 'L'; }
    if (!points) throw Error('El trazado SVG debe empezar con M');
    points.push([x, y]); if (++count > MAX_SEGMENTS * 2) throw Error('SVG demasiado complejo');
  }
  return paths;
}
function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = [0, points.length - 1];
  while (stack.length) {
    const b = stack.pop(), a = stack.pop(), [ax, ay] = points[a], [bx, by] = points[b], dx = bx - ax, dy = by - ay, denominator = dx * dx + dy * dy;
    let best = tolerance * tolerance, chosen = -1;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = points[i], t = denominator ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / denominator)) : 0;
      const distance = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
      if (distance > best) { best = distance; chosen = i; }
    }
    if (chosen >= 0) { keep[chosen] = 1; stack.push(a, chosen, chosen, b); }
  }
  return points.filter((_, i) => keep[i]);
}
self.onmessage = ({data}) => {
  try {
    const {width, height, originX, originY, sourceScale, offsetX, offsetY, contours} = data;
    const groups = []; let segmentCount = 0, pathCount = 0;
    for (const contour of contours) {
      const paths = parsePath(contour.d).map(path => path.map(([x, y]) => [(x - originX) * sourceScale + offsetX, (y - originY) * sourceScale + offsetY]));
      const key = `${contour.color}:${contour.width}`; let group = groups.at(-1);
      if (!group || group.key !== key) { group = {key, color: contour.color, width: contour.width * sourceScale, full: [], coarse: []}; groups.push(group); if(groups.length>1024)throw Error('El SVG contiene demasiados estilos de contorno'); }
      const append = (target, points) => { for (let i = 1; i < points.length; i++) target.push(...points[i - 1], ...points[i]); };
      for (const path of paths) {
        if (path.length < 2) continue;
        pathCount++; segmentCount += path.length - 1;
        if (segmentCount > MAX_SEGMENTS) throw Error('SVG demasiado complejo: supera un millón de segmentos');
        append(group.full, path); append(group.coarse, simplify(path, .7));
      }
    }
    if (!segmentCount) throw Error('El SVG no contiene contornos visibles');
    const transfers = [];
    for (const group of groups) {
      delete group.key;
      group.levels = [group.full, group.coarse].map(values => { const buffer = new Float32Array(values); transfers.push(buffer.buffer); return buffer; });
      delete group.full; delete group.coarse;
    }
    self.postMessage({width, height, tolerance: .7, pathCount, segmentCount, groups}, transfers);
  } catch (error) { self.postMessage({error: error.message}); }
};
