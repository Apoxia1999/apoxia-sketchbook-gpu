// Shared by the browser and Node. Coordinate values live in the Vault's local
// space; enumerable accessors expose world coordinates to existing editing APIs.
(() => {
  const bindings = new WeakMap();
  const fields = kind => kind === 'strokes' ? ['width'] : kind === 'writings'
    ? ['x', 'y', 'size'] : ['x', 'y', 'displayWidth', 'displayHeight', 'chromeScale', 'textFontSize'];
  const unit = vault => vault.width / 640;
  function bind(object, kind, vault, localInput = false) {
    const previous = bindings.get(object);
    if (!previous && !vault) return object;
    if (previous?.vault === vault) return object;
    const values = {};
    for (const field of fields(kind)) if (Number.isFinite(object[field])) values[field] = object[field];
    const points = kind === 'strokes' ? object.points : null;
    for (const field of Object.keys(values)) Object.defineProperty(object, field, { value: values[field], writable: true, enumerable: true, configurable: true });
    if (points) Object.defineProperty(object, 'points', { value: points, writable: true, enumerable: true, configurable: true });
    bindings.delete(object);
    if (!vault) return object;
    const scale = unit(vault);
    const local = {};
    for (const [field, value] of Object.entries(values)) local[field] = localInput ? value
      : (value - (field === 'x' ? vault.x : field === 'y' ? vault.y : 0)) / scale;
    const state = { vault, kind, local, points: points && (localInput ? points : points.map(([x, y]) => [(x - vault.x) / scale, (y - vault.y) / scale])), worldPoints: null, pointsKey: '' };
    bindings.set(object, state);
    for (const field of fields(kind)) {
      Object.defineProperty(object, field, {
        enumerable: Object.hasOwn(local, field), configurable: true,
        get() { return Object.hasOwn(local, field) ? local[field] * unit(vault) + (field === 'x' ? vault.x : field === 'y' ? vault.y : 0) : undefined; },
        set(value) {
          if (!Object.hasOwn(local, field)) Object.defineProperty(object, field, { ...Object.getOwnPropertyDescriptor(object, field), enumerable: true });
          local[field] = (value - (field === 'x' ? vault.x : field === 'y' ? vault.y : 0)) / unit(vault);
        }
      });
    }
    if (points) Object.defineProperty(object, 'points', {
      enumerable: true, configurable: true,
      get() {
        const key = `${vault.x}:${vault.y}:${vault.width}`;
        if (!state.worldPoints || state.pointsKey !== key) {
          const scale = unit(vault);
          state.worldPoints = state.points.map(([x, y]) => [vault.x + x * scale, vault.y + y * scale]);
          state.pointsKey = key;
        }
        return state.worldPoints;
      },
      set(value) { const scale = unit(vault); state.points = value.map(([x, y]) => [(x - vault.x) / scale, (y - vault.y) / scale]); state.worldPoints = null; }
    });
    return object;
  }
  function serialize(object, kind, vault) {
    bind(object, kind, vault);
    const state = bindings.get(object), result = {};
    const geometry = new Set([...fields(kind), ...(kind === 'strokes' ? ['points'] : [])]);
    for (const key of Object.keys(object)) if (!geometry.has(key)) result[key] = object[key];
    Object.assign(result, state.local);
    if (kind === 'strokes') result.points = state.points;
    return result;
  }
  function attachMap(map, kind, owner) {
    const set = map.set;
    map.set = function(id, object) { bind(object, kind, owner(id)); return set.call(this, id, object); };
  }
  globalThis.VaultCoordinates = { bind, serialize, attachMap, binding: object => bindings.get(object) };
})();
