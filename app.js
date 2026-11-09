let canvasTransferBusy=false;
window.addEventListener('keydown',event=>{if(canvasTransferBusy){event.preventDefault();event.stopImmediatePropagation();}},true);
const i18n = window.apoxiaI18n;
const viewport = document.querySelector('#viewport');
const world = document.querySelector('#world');
const textLayer = document.querySelector('#textLayer');
const writingLayer = document.querySelector('#writingLayer');
const writingEditor = document.querySelector('#writingEditor');
const writingDetail = document.querySelector('#writingDetail');
const writingDetailContext = writingDetail.getContext('2d');
const writingControls = document.querySelector('#writingControls');
const grid = document.querySelector('#grid');
const drawingLayer = document.querySelector('#drawingLayer');
const drawingContext = drawingLayer.getContext('2d');
const panBuffer = document.createElement('canvas');
const panContext = panBuffer.getContext('2d');
const preview = document.querySelector('#drawingPreview');
const eraserCursor = document.querySelector('#eraserCursor');
const eraserRadiusInput = document.querySelector('#eraserRadius');
const drawWidthInput = document.querySelector('#drawWidth');
const savedDrawWidth = Number(localStorage.getItem('apoxiaSketchBook.drawWidth'));
if (Number.isFinite(savedDrawWidth) && savedDrawWidth >= 1 && savedDrawWidth <= 40) drawWidthInput.value = String(savedDrawWidth);
document.querySelector('#drawWidthValue').textContent = `${drawWidthInput.value} px`;
drawWidthInput.addEventListener('input', () => {
  document.querySelector('#drawWidthValue').textContent = `${drawWidthInput.value} px`;
  localStorage.setItem('apoxiaSketchBook.drawWidth', drawWidthInput.value);
});
const dropHint = document.querySelector('#dropHint');
const fileInput = document.querySelector('#fileInput');
const toastEl = document.querySelector('#toast');
const help = document.querySelector('#help');
const clearButton = document.querySelector('#clearButton');
const clearDialog = document.querySelector('#clearDialog');
const clearTrack = document.querySelector('#clearTrack');
const clearThumb = document.querySelector('#clearThumb');
// Vault contents are encrypted at rest; closed Vaults are absent from the live canvas maps.
const vaults = new Map();
const vaultNodes = new Map();
const vaultOwners = new Map();
let vaultBusy = false;
let vaultSyncChain = Promise.resolve();
let vaultDrag = null;
let vaultDragFrame = 0;
let canvasActions = 0;
let privateMemoryEpoch = 0;
const originalControllers = new Map();
const pendingDraws = new Map();
const mediaSession = crypto.randomUUID();
const vaultBackdrop = document.createElement('div');
vaultBackdrop.id = 'vaultBackdrop';
const vaultLayer = document.createElement('div');
vaultLayer.id = 'vaultLayer';
viewport.prepend(vaultBackdrop);
viewport.append(vaultLayer);
// Members render above the Vault glass; unrelated canvas objects stay below it.
const pendingVaultImports = new Map();
const vaultOwnedLayer = document.createElement('div');
vaultOwnedLayer.id = 'vaultOwnedLayer';
viewport.append(vaultOwnedLayer);
function ownedSurface(tag, className) {
  const node = tag === 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  node.classList.add(className);
  if (tag === 'canvas') node.setAttribute('aria-hidden', 'true');
  vaultOwnedLayer.append(node);
  return node;
}
const ownedMediaLayer = ownedSurface('div', 'owned-media-layer');
const ownedTextLayer = ownedSurface('div', 'owned-text-layer');
const ownedDrawingLayer = ownedSurface('canvas', 'owned-drawing-layer');
const ownedWritingLayer = ownedSurface('svg', 'owned-writing-layer');
const ownedWritingDetail = ownedSurface('canvas', 'owned-writing-detail');
const ownedPhotoPreview = document.createElement('canvas');
ownedPhotoPreview.className = 'owned-photo-preview'; ownedMediaLayer.prepend(ownedPhotoPreview);
const ownedNotePreview = document.createElement('canvas');
ownedNotePreview.className = 'owned-note-preview'; ownedTextLayer.prepend(ownedNotePreview);
vaultOwnedLayer.append(preview);
function cardRenderParent(item) {
  const owned = Boolean(vaultOwner('items', item.id)) || (gesture?.id === item.id && ['card', 'resize'].includes(gesture.type));
  return item.type === 'text' ? (owned ? ownedTextLayer : textLayer) : (owned ? ownedMediaLayer : world);
}
function syncCardRenderParent(card, item) {
  if (!card.isConnected) return;
  const parent = cardRenderParent(item);
  if (card.parentElement !== parent) parent.append(card);
}
function vaultInterior(vault) {
  const unit = vault.width / 640;
  return { x: vault.x + 16 * unit, y: vault.y + 48 * unit, width: vault.width - 32 * unit, height: vault.height - 64 * unit };
}
function containsVaultPoint(box, x, y) { return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height; }
function vaultAt(x, y, openOnly = false) {
  return [...vaults.values()].find(v => (!openOnly || v.open) && containsVaultPoint(vaultInterior(v), x, y));
}
function vaultScopeAtScreen(x, y) { const point = screenToWorld(x, y); return vaultAt(point.x, point.y)?.id || null; }
function vaultOwner(kind, id) { return vaultOwners.get(`${kind}:${id}`) || (kind === 'strokes' ? pendingDraws.get(id)?.vaultId : null) || null; }
function vaultContentVisible(kind, id) {
  if (kind === 'writings' && !showTexts) return false;
  if (kind === 'items') { const item = items.get(id); if (item && !(item.type === 'text' ? showTexts : showMedia)) return false; }
  const owner = vaultOwner(kind, id); return !owner || (Boolean(vaults.get(owner)?.open) && !vaults.get(owner)?.closing); }
function rebuildVaultOwners() {
  gpuSceneDirty=true;noteGPUSceneDirty=true;
  vaultOwners.clear();
  for (const vault of vaults.values()) for (const kind of ['items', 'writings', 'strokes']) for (const id of vault.members[kind]) vaultOwners.set(`${kind}:${id}`, vault.id);
  for (const [kind, objects] of [['items', items], ['writings', writings], ['strokes', strokes]]) for (const [id, object] of objects) {
    const owner = vaults.get(vaultOwner(kind, id)) || null;
    VaultCoordinates.bind(object, kind, owner);
    if (kind === 'strokes' && strokeChunks.has(id) && (strokeSpaces.get(id)?.id || null) !== (owner?.id || null)) {
      strokes.delete(id); addStroke(object, true);
    }
  }
}
function vaultObjectBounds(kind, object) {
  if (kind === 'items') return { x: object.x, y: object.y, width: object.displayWidth || 320, height: (object.displayHeight || 180) };
  if (kind === 'writings') {
    const ink = writingInkBounds(object.text), scale = object.size / 48;
    return { x: object.x + ink.left * scale, y: object.y + ink.top * scale, width: (ink.right - ink.left) * scale, height: (ink.bottom - ink.top) * scale };
  }
  if (kind === 'strokes') {
    const bounds=strokeWorldBounds(object.id);
    if(!bounds) return null;
    const radius=object.width/2;
    return {x:bounds.minX-radius,y:bounds.minY-radius,width:bounds.maxX-bounds.minX+radius*2,height:bounds.maxY-bounds.minY+radius*2};
  }
  return null;
}
function vaultFits(box, bounds) {
  const epsilon = Math.min(box.width, box.height) * 1e-9;
  return bounds.x >= box.x - epsilon && bounds.y >= box.y - epsilon && bounds.x + bounds.width <= box.x + box.width + epsilon && bounds.y + bounds.height <= box.y + box.height + epsilon;
}
function freeVaultObjectPreview(kind, object) {
  if(screenFrozen.has(`${kind}:${object.id}`)) return true;
  if(gesture?.type==='magic-move' && gesture.movingKeys.has(`${kind}:${object.id}`)) return true;
  if (gesture?.id === object.id && ['card', 'resize', 'writing', 'writing-resize'].includes(gesture.type)) return true;
  // Keep the released object visible while its position and membership requests
  // finish. Only fully contained objects belong to a Vault.
  const owner = vaults.get(vaultOwner(kind, object.id));
  const bounds = owner && vaultObjectBounds(kind, object);
  return Boolean(bounds && !vaultFits(vaultInterior(owner), bounds));
}
function collectVaultMembership(admission = null) {
  const admissions=new Map((Array.isArray(admission)?admission:admission?[admission]:[]).map(entry=>[`${entry.kind}:${entry.id}`,entry]));
  const open = [...vaults.values()].filter(v => v.open).map(vault => ({ vault, box: vaultInterior(vault), members: { items: [], writings: [] } }));
  for (const kind of ['items', 'writings']) {
    const objects = kind === 'items' ? items : writings;
    for (const [id, object] of objects) {
      const previous = vaults.get(vaultOwner(kind, id));
      if (previous && !previous.open) continue;
      const bounds = vaultObjectBounds(kind, object);
      // Only a deliberate object drag may introduce a new member. Routine
      // reconciliation retains existing members and releases those taken out.
      const requested=admissions.get(`${kind}:${id}`), canEnter=Boolean(requested);
      const next = object.status === 'processing' ? null : open.find(entry =>
        (canEnter ? (!requested.vaultId || requested.vaultId === entry.vault.id) : previous?.id === entry.vault.id)
        && (screenFrozen.has(`${kind}:${id}`) && previous?.id===entry.vault.id || vaultFits(entry.box, bounds)));
      if (next) next.members[kind].push(id);
    }
    for (const entry of open) entry.vault.members[kind] = entry.members[kind];
  }
  for (const vault of vaults.values()) if (vault.open) {
    vault.members.strokes = vault.members.strokes.filter(id => strokes.has(id));
  }
  // Existing drawn strokes retain their scope. Only dragged strokes are checked
  // for admission, using their complete bounds including the brush thickness.
  for(const request of admissions.values()) if(request.kind==='strokes') {
    const stroke=strokes.get(request.id), previous=vaults.get(vaultOwner('strokes',request.id));
    if(!stroke || previous && !previous.open) continue;
    const bounds=vaultObjectBounds('strokes',stroke);
    const destination=bounds && open.find(entry=>(!request.vaultId || request.vaultId===entry.vault.id) && vaultFits(entry.box,bounds));
    for(const entry of open) entry.vault.members.strokes=entry.vault.members.strokes.filter(id=>id!==request.id);
    if(destination) destination.vault.members.strokes.push(request.id);
  }
  rebuildVaultOwners();
}
function saveVaultMembership() {
  const snapshots = [...vaults.values()].map(v => ({ id: v.id, members: structuredClone(v.members) }));
  vaultSyncChain = vaultSyncChain.catch(() => {}).then(async () => {
    await apiChange('/api/vault-memberships', 'PUT', snapshots);
  });
  return vaultSyncChain;
}
async function reconcileVaults(admission = null) {
  if (!vaults.size || vaultBusy || gesture || vaultDrag) return;
  const before = JSON.stringify([...vaults.values()].map(v => v.members));
  const previousOwners = new Map(vaultOwners);
  collectVaultMembership(admission);
  if (before !== JSON.stringify([...vaults.values()].map(v => v.members))) {
    const changedItems = [];
    for (const [id, item] of items) if ((previousOwners.get(`items:${id}`) || null) !== vaultOwner('items', id)) {
      changedItems.push(id); updateCard(item);
    }
    const changedWritings = [...writings.keys()].some(id => (previousOwners.get(`writings:${id}`) || null) !== vaultOwner('writings', id));
    // Membership changes do not move Vault boundaries or public strokes.
    // Refresh only the affected cards and the shared image/text previews.
    updateImageSources(changedItems); renderNotePreviews();
    if (changedWritings) renderWritings();
    if([...strokes.keys()].some(id=>(previousOwners.get(`strokes:${id}`) || null)!==vaultOwner('strokes',id))) { paintedCamera=null; redrawStrokes(); renderMagicLaser(); }
    await saveVaultMembership();
  }
}
function privateMediaURL(url, id) {
  const owner = vaults.get(vaultOwner('items', id));
  return owner?.encrypted ? `${url}?vault=${owner.id}&session=${mediaSession}` : url;
}
function purgeVaultMemory(vault) {
  objectClipboard=objectClipboard.filter(entry=>entry.vaultId!==vault.id);
  clearStrokeTileCache();
  photoGPU.reset(); ownedPhotoGPU.reset();noteGPU.reset();ownedNoteGPU.reset();noteGPUSceneDirty=true;
  fileHover=null; fileLinkTap=null; renderFileGlow();
  for(const [key,entry] of screenFrozen) if(entry.owner===vault.id) { entry.visual.remove(); screenFrozen.delete(key); }
  clearMagicSelection();
  if (vaultDrag?.id === vault.id) for (const key of ['strokeCache', 'privateStrokeCache']) {
    const cache = vaultDrag[key];
    if (cache) { cache.width = 0; cache.height = 0; vaultDrag[key] = null; }
  }
  for (const [id, pending] of pendingDraws) if (pending.vaultId === vault.id) dropPendingDraw(id);
  privateMemoryEpoch++;
  if (editingWriting && (editingWriting.vaultId === vault.id || vault.members.writings.includes(editingWriting.id))) {
    editingWriting = null; writingEditor.hidden = true; writingEditor.value = ''; writingEditor.blur();
  }
  for (const controller of originalControllers.values()) controller.abort();
  originalControllers.clear(); originalFetches.clear(); originalFiles.clear();
  for (const id of vault.members.items) {
    clearTimeout(textTimers.get(id)); textTimers.delete(id); colorWrites.delete(id);
    const card = cards.get(id);
    if (card) {
      const editor = card.querySelector('textarea'); if (editor) editor.value = '';
      const linkView = card.querySelector('.note-links-view'); if (linkView) { linkView.replaceChildren(); linkView.noteText = ''; }
      const video = card.querySelector('video'); if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
      for (const image of card.querySelectorAll('img')) image.removeAttribute('src');
    }
    removeCard(id);
  }
  for (const id of vault.members.writings) { writings.delete(id); writingNodes.get(id)?.remove(); writingNodes.delete(id); writingLayer.querySelector(`#vault-writing-clip-${id}`)?.remove(); }
  for (const id of vault.members.strokes) { strokes.delete(id); strokeBounds.delete(id); strokeChunks.delete(id); strokeSpaces.delete(id); pendingErase.delete(id); }
  if(noteReader.open)closeNoteReader();
  if(imageReader.open)closeImageReader();
  if(videoReader.open)closeVideoReader();
  if(!canvasFind.hidden)closeCanvasFind();
  writingEditor.value = ''; selectedWriting = null; hoveredWriting = null; writingControls.hidden = true;
  writingWidthCache.clear(); writingInkCache.clear(); writingEraseMask.width = 1; writingEraseMask.height = 1;
  panBuffer.width = panBuffer.width;
  drawingContext.setTransform(1, 0, 0, 1, 0, 0); drawingContext.clearRect(0, 0, drawingLayer.width, drawingLayer.height);
  writingDetailContext.setTransform(1, 0, 0, 1, 0, 0); writingDetailContext.clearRect(0, 0, writingDetail.width, writingDetail.height);
  preview.replaceChildren(); paintedCamera = null; forgetHistory(); updateCount();
}
function installVaultContents(vault, contents) {
  rebuildVaultOwners();
  // Install the whole decrypted snapshot before laying out any of its nodes.
  for (const item of contents.items) items.set(item.id, item);
  for (const writing of contents.writings) { writings.set(writing.id, writing); writingNodes.get(writing.id)?.remove(); writingNodes.delete(writing.id); }
  for (const stroke of contents.strokes) { strokes.delete(stroke.id); strokeBounds.delete(stroke.id); strokeChunks.delete(stroke.id); addStroke(stroke, true); }
  for (const item of contents.items) updateCard(items.get(item.id));
  updateCount();
}
function refreshVaultVisibility() {
  gpuSceneDirty=true;noteGPUSceneDirty=true;
  paintedCamera = null;
  for (const [id, card] of cards) {
    const item = items.get(id); if (item) applyCardChrome(card, item);
    if (!vaultContentVisible('items', id)) { card.hidden = true; card.querySelector('video')?.pause(); }
  }
  for (const [id, node] of writingNodes) if (!vaultContentVisible('writings', id)) node.setAttribute('hidden', '');
  renderVaults(); renderWritings(); redrawStrokes(); renderSolidPreviews(); renderNotePreviews(); scheduleVideoHover(); scheduleConnectionRender();
}
function scheduleVaultDragRender() {
  gpuSceneDirty=true;noteGPUSceneDirty=true;
  if (vaultDragFrame) return;
  vaultDragFrame = requestAnimationFrame(() => {
    vaultDragFrame = 0;
    if (!vaultDrag) return;
    // Public cards stay still; owned cards follow their local transform.
    renderVaults();
    const moving = vaults.get(vaultDrag.id);
    for (const id of moving?.members.items || []) {
      const item = items.get(id), card = cards.get(id);
      if (item && card) applyCardChrome(card, item);
    }
    redrawVaultDragStrokes();
    updateImageSources(moving?.members.items || []);
    renderNotePreviews();
    renderWritings();
    renderConnections();
  });
}
function applyVaultCard(card, item) {
  if(screenFrozen.has(`items:${item.id}`)) { card.style.clipPath=""; return true; }
  if (!vaultContentVisible('items', item.id)) { card.hidden = true; return false; }
  if (item.type !== 'text') card.hidden = false;
  const owner = vaults.get(vaultOwner('items', item.id));
  if (!owner || freeVaultObjectPreview('items', item)) { card.style.clipPath = ''; return true; }
  const box = vaultInterior(owner);
  const factor = item.type === 'text' ? noteLayoutUnit(item) : Math.max(1 / camera.scale, (item.displayWidth || 320) / 8192, (item.displayHeight || 180) / 8192);
  const bounds = vaultObjectBounds('items', item);
  // Clip at the Vault boundary, not at the card's own rectangular bounds.
  // Leave room for rounded corners, shadows and the complete resize handles.
  const top = Math.max(-48, (box.y - bounds.y) / factor);
  const left = Math.max(-48, (box.x - bounds.x) / factor);
  const right = Math.max(-48, (bounds.x + bounds.width - box.x - box.width) / factor);
  const bottom = Math.max(-48, (bounds.y + bounds.height - box.y - box.height) / factor);
  card.style.clipPath = [top, right, bottom, left].every(value => value === -48)
    ? '' : `inset(${top}px ${right}px ${bottom}px ${left}px)`;
  return true;
}
function clipVaultCanvas(context, owner, dpr, originX = camera.x, originY = camera.y, excludedVault = null) {
  if (!vaults.size) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.beginPath();
  if (owner && vaults.has(owner)) {
    const box = vaultInterior(vaults.get(owner));
    context.rect(originX + box.x * camera.scale, originY + box.y * camera.scale, box.width * camera.scale, box.height * camera.scale);
    context.clip();
  }
}
function applyVaultWritingClip(group, writing) {
  const owner = vaults.get(vaultOwner('writings', writing.id) || (writing.id === '__writing_draft' ? editingWriting?.vaultId : null));
  const clipId = `vault-writing-clip-${writing.id}`;
  let clip = writingLayer.querySelector(`#${clipId}`);
  if (!owner || freeVaultObjectPreview('writings', writing)) { group.removeAttribute('clip-path'); clip?.remove(); return; }
  if (!clip) {
    clip = document.createElementNS(svgNS, 'clipPath'); clip.id = clipId;
    clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
    clip.append(document.createElementNS(svgNS, 'rect')); writingLayer.append(clip);
  }
  const box = vaultInterior(owner), unit = writing.size / 48, rect = clip.firstChild;
  rect.setAttribute('x', (box.x - writing.x) / unit); rect.setAttribute('y', (box.y - writing.y) / unit);
  rect.setAttribute('width', box.width / unit); rect.setAttribute('height', box.height / unit);
  group.setAttribute('clip-path', `url(#${clipId})`);
}
function vaultGestureAllows(event) {
  if (!gesture || !['draw', 'erase'].includes(gesture.type)) return true;
  return vaultScopeAtScreen(event.clientX, event.clientY) === gesture.vaultId && (!gesture.vaultId || vaults.get(gesture.vaultId)?.open);
}
function vaultSegmentLimit(a, b, scope) {
  let limit = 1;
  for (const vault of vaults.values()) {
    const box = vaultInterior(vault);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    let enter = 0, exit = 1, intersects = true;
    for (const [p, q] of [[-dx, a[0] - box.x], [dx, box.x + box.width - a[0]], [-dy, a[1] - box.y], [dy, box.y + box.height - a[1]]]) {
      if (!p) { if (q < 0) intersects = false; continue; }
      const t = q / p;
      if (p < 0) enter = Math.max(enter, t); else exit = Math.min(exit, t);
    }
    if (!intersects || enter > exit || exit < 0 || enter > 1) continue;
    if (vault.id === scope) limit = Math.min(limit, Math.max(0, exit));
    else limit = Math.min(limit, Math.max(0, enter));
  }
  return limit;
}
function clipVaultPreview(owner) {
  const boxes = owner ? [vaults.get(owner)] : [...vaults.values()];
  if (!boxes.length) { preview.style.clipPath = ''; return; }
  const path = [];
  if (!owner) path.push(`M0 0H${innerWidth}V${innerHeight}H0Z`);
  for (const v of boxes) {
    const box = vaultInterior(v), x = camera.x + box.x * camera.scale, y = camera.y + box.y * camera.scale;
    path.push(`M${x} ${y}h${box.width * camera.scale}v${box.height * camera.scale}h${-box.width * camera.scale}Z`);
  }
  preview.style.clipPath = `path(evenodd, "${path.join(' ')}")`;
}
function renderVaults() {
  for (const vault of vaults.values()) {
    const nodes = vaultNodes.get(vault.id); if (!nodes) continue;
    const unit = vault.width / 640;
    for (const node of [nodes.frame, nodes.back]) {
      node.style.left = `${camera.x + vault.x * camera.scale}px`;
      node.style.top = `${camera.y + vault.y * camera.scale}px`;
      node.style.width = '640px'; node.style.height = `${vault.height / unit}px`;
      node.style.transform = `scale(${unit * camera.scale})`;
    }
    const screenX = camera.x + vault.x * camera.scale, screenY = camera.y + vault.y * camera.scale;
    const left = Math.max(-16, screenX), top = Math.max(-16, screenY);
    const right = Math.min(innerWidth + 16, screenX + vault.width * camera.scale);
    const bottom = Math.min(innerHeight + 16, screenY + vault.height * camera.scale);
    nodes.back.style.transform = 'none';
    nodes.back.style.left = `${left}px`; nodes.back.style.top = `${top}px`;
    nodes.back.style.width = `${Math.max(0, right - left)}px`;
    nodes.back.style.height = `${Math.max(0, bottom - top)}px`;
    nodes.back.hidden = right <= left || bottom <= top;
    nodes.back.style.borderRadius = left !== screenX || top !== screenY || right !== screenX + vault.width * camera.scale || bottom !== screenY + vault.height * camera.scale ? '0' : `${Math.min(32, 18 * unit * camera.scale)}px`;
    nodes.back.classList.toggle('vault-back-open', Boolean(vault.open && !vault.closing));
    // Use visible coverage, so a large Vault off to one side stays translucent.
    const visibleWidth=Math.max(0,Math.min(innerWidth,screenX+vault.width*camera.scale)-Math.max(0,screenX));
    const visibleHeight=Math.max(0,Math.min(innerHeight,screenY+vault.height*camera.scale)-Math.max(0,screenY));
    const coverage=visibleWidth*visibleHeight/(innerWidth*innerHeight);
    const opaqueThreshold=nodes.back.classList.contains('vault-back-opaque') ? .85 : .9;
    nodes.back.classList.toggle('vault-back-opaque',coverage>=opaqueThreshold);
    nodes.frame.classList.toggle('vault-dragging', vaultDrag?.id === vault.id);
    nodes.frame.classList.toggle('vault-open', Boolean(vault.open));
    nodes.frame.classList.toggle('vault-sealing', Boolean(vault.closing));
    nodes.frame.classList.toggle('vault-position-locked', Boolean(vault.locked));
    nodes.positionLock.setAttribute('aria-pressed', String(Boolean(vault.locked)));
    nodes.positionLock.title = vault.locked ? i18n.t('Desbloquear movimiento y tamaño') : i18n.t('Bloquear movimiento y tamaño');
    nodes.positionLock.setAttribute('aria-label', nodes.positionLock.title);
    const lockPath = vault.locked ? 'M8 10V6a4 4 0 0 1 8 0v4' : 'M8 10V6a4 4 0 0 1 8 0';
    if (nodes.positionLock.dataset.locked !== String(Boolean(vault.locked))) {
      nodes.positionLock.dataset.locked = String(Boolean(vault.locked));
      nodes.positionLock.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" class="ui-icon"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="${lockPath}"/></svg>`;
    }
    nodes.positionLock.disabled = Boolean(vault.closing);
    nodes.resize.hidden = Boolean(vault.locked || vault.closing);
    nodes.frame.setAttribute('aria-busy', String(Boolean(vault.closing)));
    nodes.form.hidden = Boolean(vault.open && !vault.closing && !vault.configuring);
    nodes.hintBox.hidden=Boolean(vault.open||vault.closing||!vault.configured);
    renderVaultHint(vault);
    nodes.password.disabled = Boolean(vault.closing);
    nodes.lock.hidden = false;
    nodes.lock.querySelector('path').setAttribute('d', vault.open ? 'M12 64V23C12 10 19 5 32 5S52 10 52 23V40' : 'M12 64V23C12 10 19 5 32 5S52 10 52 23V52');
    nodes.lock.setAttribute('aria-label', vault.open ? i18n.t('Cerrar Vault') : i18n.t('Introducir contraseña para abrir Vault'));
    nodes.lock.title = vault.open ? i18n.t('Cerrar Vault') : i18n.t('Abrir Vault');
    nodes.lock.setAttribute('aria-expanded', String(Boolean(vault.open)));
    nodes.form.classList.toggle('vault-configured', vault.configured);
    const status = nodes.form.querySelector('small');
    status.textContent = !vault.configured ? i18n.t('Guarda tu contraseña: no se puede recuperar.') : !vault.encrypted ? i18n.t('Pendiente de cifrado: abre con tu contraseña para migrar el contenido.') : '';
    status.hidden = !status.textContent;
    nodes.confirm.required = !vault.configured;
    nodes.remove.hidden = Boolean(vault.closing);
    nodes.remove.title = vault.open ? i18n.t('Borrar caja y conservar su contenido') : i18n.t('Borrar Vault y su contenido');
    nodes.remove.setAttribute('aria-label', nodes.remove.title);
    nodes.confirm.hidden = vault.configured;
    nodes.password.placeholder = vault.configured ? '*****' : i18n.t('Contraseña');
    const screenWidth = vault.width * camera.scale, screenHeight = vault.height * camera.scale;
    const small = screenWidth < 180 || screenHeight < 120;
    nodes.frame.classList.toggle('vault-small', small);
    nodes.submit.textContent = vault.configured ? i18n.t('Abrir') : i18n.t('Cifrar');
  }
}
function cancelVaultPasswordSetup(outsideTarget = null) {
  if(vaultBusy) return false;
  let cancelled=false;
  for(const vault of vaults.values()) {
    if(!vault.open || !vault.configuring || vault.configured || vault.closing) continue;
    const nodes=vaultNodes.get(vault.id);
    if(outsideTarget && nodes?.form.contains(outsideTarget)) continue;
    vault.configuring=false;
    if(nodes) {
      nodes.password.value=''; nodes.confirm.value='';
      nodes.form.querySelector('.vault-error').textContent='';
      if(nodes.form.contains(document.activeElement)) document.activeElement.blur();
    }
    cancelled=true;
  }
  if(cancelled) renderVaults();
  return cancelled;
}
// Consume the dismissal so clicking outside cannot also draw or activate a button.
let vaultSetupDismissedClick=null;
window.addEventListener('pointerdown',event=> {
  if(!cancelVaultPasswordSetup(event.target)) return;
  vaultSetupDismissedClick={target:event.target,time:performance.now()};
  event.preventDefault(); event.stopImmediatePropagation();
},true);
window.addEventListener('click',event=> {
  const dismissed=vaultSetupDismissedClick; vaultSetupDismissedClick=null;
  if(dismissed && dismissed.target===event.target && performance.now()-dismissed.time<1000) {
    event.preventDefault(); event.stopImmediatePropagation();
  }
},true);
window.addEventListener('keydown',event=> {
  if(event.key==='Escape' && cancelVaultPasswordSetup()) {
    event.preventDefault(); event.stopImmediatePropagation();
  }
},true);
function renderVaultHint(vault){
 const nodes=vaultNodes.get(vault.id);if(!nodes)return;
 const signature=JSON.stringify(vault.hint||[]);if(nodes.hintSVG.dataset.signature===signature)return;
 nodes.hintSVG.dataset.signature=signature;
 nodes.hintSVG.replaceChildren(...(vault.hint||[]).map(points=>{const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',points.map((p,i)=>`${i?'L':'M'}${p[0]} ${p[1]}`).join(' ')+(points.length===1?`l.01 0`:''));return path;}));
}
function setupVaultHint(vault){
 const nodes=vaultNodes.get(vault.id),svg=nodes.hintSVG;let drawing=null,writes=Promise.resolve();
 const save=(before,after)=>{writes=writes.catch(()=>{}).then(async()=>{await apiChange(`/api/vaults/${vault.id}/hint`,'PATCH',{hint:after});remember({label:'pista de Vault',undo:()=>restore(before),redo:()=>restore(after)});}).catch(error=>toast(error.message));};
 const restore=async hint=>{await apiChange(`/api/vaults/${vault.id}/hint`,'PATCH',{hint});vault.hint=structuredClone(hint);renderVaultHint(vault);};
 const point=event=>{const rect=svg.getBoundingClientRect();return [Math.max(0,Math.min(640,(event.clientX-rect.left)/rect.width*640)),Math.max(0,Math.min(160,(event.clientY-rect.top)/rect.height*160))];};
 svg.addEventListener('pointerdown',event=>{event.preventDefault();event.stopPropagation();if(event.button!==0||vault.open||vault.closing||(vault.hint||[]).length>=200)return;const before=structuredClone(vault.hint||[]);vault.hint||=[];const points=[point(event)];vault.hint.push(points);drawing={pointer:event.pointerId,before,points};svg.setPointerCapture(event.pointerId);renderVaultHint(vault);});
 svg.addEventListener('pointermove',event=>{if(!drawing||drawing.pointer!==event.pointerId)return;event.preventDefault();event.stopPropagation();const next=point(event),last=drawing.points.at(-1);if(drawing.points.length<2000&&Math.hypot(next[0]-last[0],next[1]-last[1])>1){drawing.points.push(next);renderVaultHint(vault);}});
 const end=event=>{if(!drawing||drawing.pointer!==event.pointerId)return;event.stopPropagation();const current=drawing;drawing=null;if(event.type==='pointercancel'){vault.hint=current.before;renderVaultHint(vault);}else save(current.before,structuredClone(vault.hint));};
 svg.addEventListener('pointerup',end);svg.addEventListener('pointercancel',end);
 nodes.hintBox.querySelector('button').addEventListener('pointerdown',event=>event.stopPropagation());
 nodes.hintBox.querySelector('button').addEventListener('click',event=>{event.stopPropagation();const before=structuredClone(vault.hint||[]);vault.hint=[];renderVaultHint(vault);save(before,[]);});
}
function createVaultNode(vault) {
  const back = document.createElement('div'); back.className = 'vault-back'; vaultBackdrop.append(back);
  const frame = document.createElement('section'); frame.className = 'vault-frame'; frame.setAttribute('aria-label', 'Vault');
  frame.innerHTML = i18n.html(`<header class="vault-head"><button class="vault-lock" type="button" aria-label="Cerrar Vault" title="Cerrar Vault"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M12 64V23C12 10 19 5 32 5S52 10 52 23V52"/></svg></button><button class="vault-position-lock" type="button" aria-label="Bloquear movimiento y tamaño" aria-pressed="false"></button><button class="vault-remove" type="button" title="Borrar Vault y su contenido" aria-label="Borrar Vault y su contenido">×</button></header><div class="vault-edge vault-left"></div><div class="vault-edge vault-right"></div><div class="vault-edge vault-bottom"></div><form class="vault-form"><label><span class="vault-cipher" aria-hidden="true">*****</span><input aria-label="Contraseña de la Vault" class="vault-password" type="password" autocomplete="off" maxlength="1024" required placeholder="Contraseña"></label><div class="vault-hint" hidden><svg viewBox="0 0 640 160" preserveAspectRatio="none" aria-label="Dibuja una nota o pista para esta Vault"></svg><button class="vault-hint-clear" type="button" aria-label="Borrar pista dibujada">Borrar</button></div><input class="vault-confirm" aria-label="Confirmar contraseña" type="password" autocomplete="off" maxlength="1024" placeholder="Repetir"><button type="submit">Crear y abrir</button><p class="vault-error" role="status"></p><small></small></form><button class="vault-resize" type="button" title="Escalar Vault y contenido" aria-label="Escalar Vault y contenido">◢</button>`);
  vaultLayer.append(frame);
  const form = frame.querySelector('form'), password = frame.querySelector('.vault-password'), confirm = frame.querySelector('.vault-confirm');
  const lock = frame.querySelector('.vault-lock'), remove = frame.querySelector('.vault-remove'), submit = form.querySelector('button[type=submit]');
  const positionLock = frame.querySelector('.vault-position-lock'), resize = frame.querySelector('.vault-resize');
  vaultNodes.set(vault.id, { frame, back, form, password, confirm, lock, remove, submit, positionLock, resize, hintBox:frame.querySelector('.vault-hint'), hintSVG:frame.querySelector('.vault-hint svg') });
  setupVaultHint(vault);
  positionLock.addEventListener('pointerdown', event => event.stopPropagation());
  positionLock.addEventListener('click', async event => {
    event.stopPropagation();
    if (vaultBusy || clearBusy || vaultDrag || gesture || vault.closing) return;
    vaultBusy = true; positionLock.disabled = true;
    try {
      await vaultSyncChain;
      const updated = await apiChange(`/api/vaults/${vault.id}`, 'PATCH', { locked: !vault.locked });
      Object.assign(vault, updated); renderVaults();
    } catch (error) { toast(error.message); }
    finally { vaultBusy = false; positionLock.disabled = false; }
  });
  frame.addEventListener('dblclick', event => {
    if (!frame.classList.contains('vault-small')) return;
    event.preventDefault(); event.stopPropagation();
    const factor = Math.min((innerWidth - 140) / vault.width, (innerHeight - 140) / vault.height);
    camera.scale = Math.max(minZoom, Math.min(maxZoom, factor));
    camera.x = innerWidth / 2 - (vault.x + vault.width / 2) * camera.scale;
    camera.y = innerHeight / 2 - (vault.y + vault.height / 2) * camera.scale;
    renderCamera();
  });
  frame.addEventListener('pointerdown', event => {
    if (!event.target.closest('.vault-head,.vault-edge,.vault-resize') || event.target.closest('button:not(.vault-resize)')) { event.stopPropagation(); return; }
    if (event.button !== 0 || gesture || vaultBusy || historyBusy || canvasActions || vault.locked || clearDialog.open || event.target.closest('input')) return;
    event.preventDefault(); event.stopPropagation();
    finishWritingEdit(true);
    document.activeElement?.blur();
    vaultDrag = { id: vault.id, pointer: event.pointerId, resize: Boolean(event.target.closest('.vault-resize')), clientX: event.clientX, clientY: event.clientY, before: { x: vault.x, y: vault.y, width: vault.width, height: vault.height } };
    frame.setPointerCapture(event.pointerId);
    refreshVaultVisibility();
    redrawVaultDragStrokes();
  });
  frame.addEventListener('pointermove', event => {
    if (vaultDrag?.id !== vault.id || vaultDrag.pointer !== event.pointerId) return;
    const drag = vaultDrag, before = drag.before;
    if (drag.resize) {
      const factor = Math.max(.05, 1 + (event.clientX - drag.clientX) / (before.width * camera.scale));
      vault.width = before.width * factor; vault.height = before.height * factor;
    } else { vault.x = before.x + (event.clientX - drag.clientX) / camera.scale; vault.y = before.y + (event.clientY - drag.clientY) / camera.scale; }
    // Moving any Vault changes the clipping of public strokes underneath it,
    // including when closed. Invalidate the painted canvas as the frame moves.
    scheduleVaultDragRender();
  });
  const finishDrag = async event => {
    if (vaultDrag?.id !== vault.id || vaultDrag.pointer !== event.pointerId) return;
    const drag = vaultDrag; vaultDrag = null;
    if (vaultDragFrame) { cancelAnimationFrame(vaultDragFrame); vaultDragFrame = 0; }
    if (drag.strokeCache) {
      drag.strokeCache.width = 0; drag.strokeCache.height = 0;
      drag.strokeCache = null;
    }
    if (drag.privateStrokeCache) {
      drag.privateStrokeCache.width = 0; drag.privateStrokeCache.height = 0;
      drag.privateStrokeCache = null;
    }
    const geometry = { x: vault.x, y: vault.y, width: vault.width, height: vault.height };
    if (event.type === 'pointercancel') { Object.assign(vault, drag.before); refreshVaultVisibility(); return; }
    vaultBusy = true;
    forgetHistory();
    // Local coordinates already follow the new container transform. Show the
    // contents before waiting for the geometry-only commit to finish.
    refreshVaultVisibility(); updateImageSources();
    try {
      await saveVaultMembership();
      const updated = await apiChange(`/api/vaults/${vault.id}`, 'PATCH', geometry);
      Object.assign(vault, updated); forgetHistory();
    } catch (error) { Object.assign(vault, drag.before); toast(error.message); }
    finally { vaultBusy = false; refreshVaultVisibility(); updateImageSources(); }
  };
  frame.addEventListener('pointerup', finishDrag); frame.addEventListener('pointercancel', finishDrag);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (vaultBusy) return;
    const firstSeal=Boolean(vault.configuring && !vault.configured);
    let opened=false;
    vaultBusy = true; submit.disabled = true;
    try {
      const { contents, ...updated } = await apiChange(`/api/vaults/${vault.id}/unlock`, 'POST', { password: password.value, confirm: confirm.value });
      Object.assign(vault, updated, { open: true, closing: false, configuring: false });
      opened=true;
      renderVaults();
      installVaultContents(vault, contents);
      forgetHistory();
      password.value = ''; confirm.value = ''; form.querySelector('.vault-error').textContent = '';
      refreshVaultVisibility();
      // Run the same complete layout used by zoom/pan after the opened frame
      // and the restored private surfaces have been installed in the DOM.
      renderCamera();
      scheduleCameraRender();
    } catch (error) { form.querySelector('.vault-error').textContent = i18n.t(error.message); }
    finally { vaultBusy = false; submit.disabled = false; }
    if(firstSeal && opened) lock.click();
  });
  lock.addEventListener('click', async () => {
    if (!vault.open) { password.focus({ preventScroll: true }); return; }
    if (vaultBusy || gesture || historyBusy || canvasActions) return toast(i18n.t('Termina la acción actual antes de cerrar la Vault'));
    if(!vault.configured) {
      vault.configuring=!vault.configuring;
      password.value=''; confirm.value=''; form.querySelector('.vault-error').textContent='';
      renderVaults();
      if(vault.configuring) password.focus({preventScroll:true});
      return;
    }
    if ([...pendingVaultImports.values()].includes(vault.id)) return toast(i18n.t('Espera a que terminen las importaciones antes de cerrar'));
    vaultBusy = true; lock.disabled = true;
    collectVaultMembership();
    vault.closing = true;
    password.value = ''; confirm.value = '';
    const cipher = form.querySelector('.vault-cipher');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cipherFrame = 0;
    let cycleStarted = performance.now();
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&';
    const tick = now => {
      const progress = reducedMotion ? 5 : Math.min(5, (now - cycleStarted) / 400);
      const settled = Math.floor(progress);
      cipher.textContent = Array.from({ length: 5 }, (_, i) => i < settled ? '*' : i === settled ? characters[Math.floor(Math.random() * characters.length)] : '·').join('');
      if (progress < 5) cipherFrame = requestAnimationFrame(tick);
      else {
        cipher.textContent = '*****';
        if (!reducedMotion) { cycleStarted = now; cipherFrame = requestAnimationFrame(tick); }
      }
    };
    cipherFrame = requestAnimationFrame(tick);
    refreshVaultVisibility();
    writingEditor.style.visibility = 'hidden';
    try {
      await finishWritingEdit(true);
      const active = document.activeElement;
      if (active?.matches('.text-editor')) {
        const card = active.closest('.video-card'), item = items.get(card?.dataset.id);
        if (item) { clearTimeout(textTimers.get(item.id)); await patchItem(item.id, { text: active.value }); }
        active.blur();
      }
      collectVaultMembership(); await saveVaultMembership();
      const updated = await apiChange(`/api/vaults/${vault.id}/lock`, 'POST');
      Object.assign(vault, updated, { open: false });
      purgeVaultMemory(vault);
      cancelAnimationFrame(cipherFrame);
      cipher.textContent = '*****';
      refreshVaultVisibility();
      vault.closing = false;
      const arc = lock.querySelector('svg');
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const animation = arc.animate([
          { transform: 'translateY(-10px)' },
          { transform: 'translateY(-16px)', offset: .3 },
          { transform: 'translateY(2px)', offset: .8 },
          { transform: 'translateY(0)' }
        ], { duration: 300, easing: 'ease-in-out' });
        await animation.finished.catch(() => {});
        frame.classList.remove('vault-glow');
        void frame.offsetWidth;
        frame.classList.add('vault-glow');
      }
      vault.open = false; selectedWriting = null; hoveredWriting = null;
      forgetHistory(); refreshVaultVisibility();
      toast(i18n.t('Vault cifrada y cerrada'));
    } catch (error) { toast(error.message); }
    finally {
      cancelAnimationFrame(cipherFrame);
      vault.closing = false; vaultBusy = false; lock.disabled = false;
      writingEditor.style.visibility = '';
      refreshVaultVisibility();
    }
  });
  remove.addEventListener('click', () => requestDeleteVault(vault).catch(error => toast(error.message)));
}
async function addVault() {
  if (vaultBusy || gesture) return;
  const point = screenToWorld(innerWidth / 2 - 160, innerHeight / 2 - 120);
  const geometry = { x: point.x, y: point.y, width: 320 / camera.scale, height: 240 / camera.scale };
  for (let attempt = 0; attempt < 100; attempt++) {
    if (![...vaults.values()].some(v => geometry.x < v.x + v.width && geometry.x + geometry.width > v.x && geometry.y < v.y + v.height && geometry.y + geometry.height > v.y)) break;
    geometry.x += 360 / camera.scale;
  }
  vaultBusy = true;
  try { const vault = await apiChange('/api/vaults', 'POST', geometry); vaults.set(vault.id, vault); createVaultNode(vault); refreshVaultVisibility(); updateCount(); forgetHistory(); }
  catch (error) { toast(error.message); }
  finally { vaultBusy = false; }
}
document.querySelector('#vaultButton').addEventListener('click', addVault);

const cards = new Map();
const videoPreviews = new Map();
let playingVideoId=null,videoPlayVersion=0;
let videoHoverFrame = 0;
let pointerOnPage = false;
const items = new Map();
const strokes = new Map();
const writings = new Map();
const writingNodes = new Map();
const strokeBounds = new Map();
const strokeChunks = new Map();
// Public drawing tiles retain raster work across camera changes, bounded to 64 MiB.
const strokeTiles = new Map();
let strokeTileIndex = null;
function clearStrokeTileCache() {
  for (const tile of strokeTiles.values()) { tile.width=0; tile.height=0; }
  strokeTiles.clear(); strokeTileIndex=null;
}
function renderStrokeTiles(dpr, width, height) {
  if(strokeTiles.size && paintedCamera?.x===camera.x && paintedCamera.y===camera.y && paintedCamera.scale===camera.scale && paintedCamera.width===width && paintedCamera.height===height)return true;
  const side=512,pad=2,rasterScale=2**Math.ceil(Math.log2(camera.scale*dpr));
  if(!Number.isFinite(rasterScale)||rasterScale<=0)return false;
  const unit=side/rasterScale, left=-camera.x/camera.scale, top=-camera.y/camera.scale;
  const x0=Math.floor(left/unit),y0=Math.floor(top/unit),x1=Math.floor((left+width/dpr/camera.scale)/unit),y1=Math.floor((top+height/dpr/camera.scale)/unit);
  if((x1-x0+1)*(y1-y0+1)>60)return false;
  if(!strokeTileIndex){
    strokeTileIndex=new GPUSpatialIndex(4096);let rank=0;
    for(const [id,stroke] of strokes){const b=strokeWorldBounds(id);if(!b)continue;const r=stroke.width/2;strokeTileIndex.insert({id,rank:rank++,x:b.minX-r,y:b.minY-r,w:b.maxX-b.minX+2*r,h:b.maxY-b.minY+2*r});}
  }
  const wanted=new Set();for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)wanted.add(`${rasterScale}:${x}:${y}`);
  drawingContext.setTransform(1,0,0,1,0,0);drawingContext.clearRect(0,0,width,height);
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const key=`${rasterScale}:${x}:${y}`;let tile=strokeTiles.get(key);
    if(!tile){
      while(strokeTiles.size>=60){const victim=[...strokeTiles.keys()].find(k=>!wanted.has(k));if(!victim)return false;const old=strokeTiles.get(victim);old.width=0;old.height=0;strokeTiles.delete(victim);}
      const candidates=strokeTileIndex.query(x*unit-pad/rasterScale,y*unit-pad/rasterScale,unit+2*pad/rasterScale,unit+2*pad/rasterScale).sort((a,b)=>a.rank-b.rank).map(a=>[a.id,strokes.get(a.id)]);
      tile=candidates.length?document.createElement('canvas'):{empty:true,width:0,height:0};
      if(!tile.empty){tile.width=tile.height=side+2*pad;
      const savedScale=camera.scale;
      try{camera.scale=rasterScale;paintStrokes([[0,0,tile.width,tile.height]],pad-x*side,pad-y*side,1,null,null,tile.getContext('2d'),candidates);}finally{camera.scale=savedScale;}}
      strokeTiles.set(key,tile);
    }else{strokeTiles.delete(key);strokeTiles.set(key,tile);}
    const scale=camera.scale*dpr/rasterScale;
    if(!tile.empty)drawingContext.drawImage(tile,pad,pad,side,side,(camera.x+x*unit*camera.scale)*dpr,(camera.y+y*unit*camera.scale)*dpr,side*scale,side*scale);
  }
  return true;
}
const strokeSpaces = new Map();
for (const [kind, objects] of [['items', items], ['writings', writings], ['strokes', strokes]]) {
  VaultCoordinates.attachMap(objects, kind, id => vaults.get(vaultOwner(kind, id)) || null);
}
const pendingErase = new Set();
const pendingWritingErase = new Set();
const originalFiles = new Map();
const originalFetches = new Set();
const textTimers = new Map();
const colorWrites = new Map();
let historyEpoch = 0;
const undoStack = [];
const redoStack = [];
const noteHint = document.querySelector('#noteHint');
const camera = { x: 100, y: 100, scale: .12 };
const svgNS = 'http://www.w3.org/2000/svg';
let gesture = null;
let mode = 'move';
let pointerPosition = { x: innerWidth / 2, y: innerHeight / 2 };
let restoredCanvasPointer=false;
try {
  const saved=JSON.parse(sessionStorage.getItem('apoxia-canvas-pointer') || 'null');
  if(saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    pointerPosition={x:saved.x,y:saved.y};restoredCanvasPointer=Boolean(saved.inside);
  }
} catch {}
window.addEventListener('pagehide',()=> {
  try {sessionStorage.setItem('apoxia-canvas-pointer',JSON.stringify({...pointerPosition,inside:connectorPointerInside}));} catch {}
});
window.addEventListener('pointermove', event => {
  pointerPosition = { x: event.clientX, y: event.clientY };
  pointerOnPage = true;
  scheduleVideoHover();
}, { capture: true });
let dragDepth = 0;
let toastTimer;
let audioEnabled = false;
let showStrokes = true;
let showTexts = true;
let showMedia = true;
let exportDragging = false;
let stackingScheduled = false;
let clearSlide = null;
let clearBusy = false;
let clearTargetVaultId = null;
let clearVaultDeleteMode = null;
let historyBusy = false;
let zHeld = false;
let inverseZoomHeld = false, inverseZoomSaving = false;
// Keep identifiers while Alt is held; refresh geometry for each new sweep.
let inversePinnedTargets = null;
const screenFrozen = new Map();
let lastSelectedItem = null;
let spaceHeld = false;
let spatialAudio = null;
let spatialAudioContext = null;
let spatialAudioFrame = 0;
let modeBeforeSpace = null;
let cameraFrame = 0;
let previewFrame = 0;
let paintedCamera = null;
let selectedWriting = null;
let hoveredWriting = null;
let writingHoverTimer = 0;
let editingWriting = null;
const textDoubleClickDistance = 20;
const textDoubleClickTime = 500;
const textDragDistance = 12;
let lastTextTap = null;
let pendingTextTap = null;
let textPointerDownSequence = 0;
function textEditTap(event, kind, id) {
  const previous = lastTextTap;
  lastTextTap = null;
  if (previous?.kind === kind && previous.id === id && previous.sequence === textPointerDownSequence - 1 &&
      event.timeStamp - previous.time <= textDoubleClickTime &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= textDoubleClickDistance) {
    pendingTextTap = null;
    event.preventDefault(); event.stopPropagation();
    if (kind === 'writing') beginWritingEdit(id);
    else toggleNoteEditing(id);
    return true;
  }
  pendingTextTap = { kind, id, sequence: textPointerDownSequence, pointer: event.pointerId, x: event.clientX, y: event.clientY };
  return false;
}
window.addEventListener('pointerdown', event => {
  textPointerDownSequence++;
  pendingTextTap = null;
  if (event.button !== 0 || event.ctrlKey || event.metaKey || spaceHeld || zHeld ||
      event.target.closest('button,a,.resize-handle,.writing-handle')) lastTextTap = null;
}, true);
window.addEventListener('pointermove', event => {
  if (pendingTextTap?.pointer === event.pointerId &&
      Math.hypot(event.clientX - pendingTextTap.x, event.clientY - pendingTextTap.y) > textDragDistance) {
    pendingTextTap = null; lastTextTap = null;
  }
}, true);
window.addEventListener('pointerup', event => {
  if (pendingTextTap?.pointer !== event.pointerId) return;
  if (Math.hypot(event.clientX - pendingTextTap.x, event.clientY - pendingTextTap.y) <= textDragDistance)
    lastTextTap = { ...pendingTextTap, time: event.timeStamp };
  pendingTextTap = null;
}, true);
window.addEventListener('pointercancel', () => { pendingTextTap = null; lastTextTap = null; }, true);
let scribeOutlines = null;
const scribeFonts=[{id:"google-sans",family:"Google Sans"},{id:"londrina-solid",family:"Londrina Solid"},{id:"gloria-hallelujah",family:"Gloria Hallelujah"}];
let storedScribeFont;try{storedScribeFont=localStorage.getItem('apoxia.scribeFont');}catch{}
let activeScribeFont=scribeFonts.find(font=>font.id===storedScribeFont)||scribeFonts[0];
const scribeFontChoice=document.querySelector('#scribeFontChoice'),scribeFontStatus=document.querySelector('#scribeFontStatus');
syncScribeFontButtons();
const scribeFontLoads=new Map();let scribeFontRequest=0;
function scribeCanvasFont(){return `48px "${activeScribeFont.family}", "Patrick Hand"`;}
async function loadScribeFont(id,persist=true){
 const font=scribeFonts.find(font=>font.id===id);if(!font)return false;
 const request=++scribeFontRequest;scribeFontChoice.setAttribute('aria-busy','true');scribeFontStatus.textContent=i18n.t('Cargando fuente…');
 try{
  let loaded=scribeFontLoads.get(id);
  if(!loaded){
   loaded=Promise.all([fetch(`/assets/${id}-outlines.json`).then(response=>{if(!response.ok)throw Error(i18n.t('No se pudo cargar la fuente de Scribe'));return response.json();}),document.fonts.load(`48px "${font.family}"`),document.fonts.load('48px "Patrick Hand"')]).then(([outlines,faces])=>{if(!faces.length||!outlines.units||!outlines.chars?.[63])throw Error(i18n.t('No se pudo cargar la fuente de Scribe'));return outlines;});
   scribeFontLoads.set(id,loaded);loaded.catch(()=>{if(scribeFontLoads.get(id)===loaded)scribeFontLoads.delete(id);});
  }
  const outlines=await loaded;if(request!==scribeFontRequest)return false;
  activeScribeFont=font;scribeOutlines=outlines;document.documentElement.style.setProperty('--scribe-font',JSON.stringify(font.family));syncScribeFontButtons();
  writingWidthCache.clear();writingInkCache.clear();renderWritings();renderMagicLaser();scheduleConnectionRender();
  for(const entry of screenFrozen.values())if(entry.kind==='writings'){const object=writings.get(entry.id);if(object){entry.visual.remove();entry.visual=screenFrozenVisual(entry,object);}}
  if(persist)try{localStorage.setItem('apoxia.scribeFont',id);}catch{}
  // Bound retained outline data; large script fonts are fetched only when chosen.
  while(scribeFontLoads.size>2){const oldest=scribeFontLoads.keys().next().value;if(oldest===id){const value=scribeFontLoads.get(oldest);scribeFontLoads.delete(oldest);scribeFontLoads.set(oldest,value);}else scribeFontLoads.delete(oldest);}
  return true;
 }catch(error){if(request===scribeFontRequest){syncScribeFontButtons();toast(error.message);}return false;}
 finally{if(request===scribeFontRequest){scribeFontChoice.removeAttribute('aria-busy');scribeFontStatus.textContent='';}}
}
function syncScribeFontButtons(){for(const button of scribeFontChoice.querySelectorAll('[data-scribe-font]'))button.setAttribute('aria-pressed',String(button.dataset.scribeFont===activeScribeFont.id));}
for(const button of scribeFontChoice.querySelectorAll('[data-scribe-font]'))button.addEventListener('click',()=>loadScribeFont(button.dataset.scribeFont));
const minZoom = 1e-12;
const maxZoom = 1e8;
let lastViewTimer = 0;
try {
  const view = JSON.parse(localStorage.getItem('apoxiaSketchBook.lastView') || 'null');
  if (view && Number.isFinite(view.x) && Number.isFinite(view.y) && Number.isFinite(view.scale) && view.scale >= minZoom && view.scale <= maxZoom) {
    const x = innerWidth / 2 - view.x * view.scale;
    const y = innerHeight / 2 - view.y * view.scale;
    if (Number.isFinite(x) && Number.isFinite(y)) Object.assign(camera, { x, y, scale: view.scale });
  }
} catch {}
function persistLastCanvasView() {
  clearTimeout(lastViewTimer);
  const center = screenToWorld(innerWidth / 2, innerHeight / 2);
  try {
    localStorage.setItem('apoxiaSketchBook.lastView', JSON.stringify({ x: center.x, y: center.y, scale: camera.scale }));
  } catch {}
}
const savedViews = {};
try {
  const storedViews = JSON.parse(localStorage.getItem('apoxiaSketchBook.views') || '{}');
  for (const slot of ['1', '2', '3', '4', '5']) {
    const view = storedViews?.[slot];
    if (view && Number.isFinite(view.x) && Number.isFinite(view.y) && Number.isFinite(view.scale) && view.scale >= minZoom && view.scale <= maxZoom) savedViews[slot] = view;
  }
} catch {}
// Palettes have no fixed length. UI roles and canvas shades are independent
// from the colors offered for notes, drawing and writing.
const themes = [
  {id:'paper',name:'Paper',colors:['#202124','#1646b8','#ba2035','#087443','#7130a3'],noteColors:['#f7f7f4','#243650','#2457b2','#14736f','#754293','#ad453d'],ui:{canvas:'#f7f7f5',panel:'#ffffff',text:'#272727',muted:'#63738a',border:'#d6e0ef',accent:'#80aaf0',accentInk:'#17335c'},backgrounds:['#f7f7f5']},
  { id: 'lime', name: i18n.t('Lima'), colors: ['#132123', '#dfdcc7', '#eeeeee', '#a2c1c5', '#dfff00'],
    ui: { canvas: '#132123', panel: '#1b2b2d', text: '#eeeeee', muted: '#a2c1c5', border: '#405659', accent: '#dfff00', accentInk: '#132123' },
    backgrounds: ['#132123', '#1b3032', '#233e41'] },
  { id: 'kairo', name: 'Kairo', colors: ['#403d38', '#e54e23', '#cdc5ba', '#736a65'],
    ui: { canvas: '#262522', panel: '#403d38', text: '#cdc5ba', muted: '#b5aca2', border: '#736a65', accent: '#e54e23', accentInk: '#181715' },
    backgrounds: ['#262522', '#332f2b', '#403d38'] },
  { id: 'indigo', name: 'Indigo', colors: ['#20275f', '#fff0d2', '#edab78', '#b7b49f', '#7793a8', '#a95838'],
    ui: { canvas: '#171e48', panel: '#242d5b', text: '#fff0d2', muted: '#b7b49f', border: '#596385', accent: '#edab78', accentInk: '#171e48' },
    backgrounds: ['#171e48', '#20275f', '#2b3569'] },
  { id: 'oled', name: 'OLED', colors: ['#000000', '#303030', '#707070', '#b5b5b5', '#eeeeee', '#ff2638'],
    ui: { canvas: '#000000', panel: '#101010', text: '#eeeeee', muted: '#a5a5a5', border: '#333333', accent: '#ff2638', accentInk: '#000000' },
    backgrounds: ['#000000'] },
  { id: 'acid', name: 'Acid', colors: ['#211e25', '#ff5418', '#ffb900', '#d5f500', '#91a526', '#cf4261'],
    ui: { canvas: '#19171c', panel: '#29252f', text: '#f4eddd', muted: '#ada596', border: '#514852', accent: '#d5f500', accentInk: '#19171c' },
    backgrounds: ['#19171c', '#211e25', '#2a2530'] }
];
const oldPaperPalette = ['#f7f7f4','#eef4ff','#f9f3e5','#edf6ed','#f9eef3'];
const oldPalette = ['#0c0c6d', '#de512b', '#98d0c1', '#5bb226', '#023c0d'];
let storedTheme;
try { storedTheme = localStorage.getItem('referencias.theme'); } catch {}
try {
  if(!localStorage.getItem('apoxia.paperTheme.v1')){
    // Paper is a default for fresh profiles, never an override of a saved choice.
    if(!storedTheme){storedTheme='paper';if(!localStorage.getItem('apoxiaSketchBook.background'))localStorage.setItem('apoxiaSketchBook.background','squares');}
    localStorage.setItem('apoxia.paperTheme.v1','1');
  }
} catch {}
let activeTheme = themes.find(theme => theme.id === (storedTheme === 'original' ? 'acid' : storedTheme)) || themes[0];
let palette = activeTheme.colors;
const magicNoteColor = 'magic-gradient';
const penColor = document.querySelector('#penColor');
let canvasNoteInk = contrastingInk(activeTheme.ui.canvas);

function notePalette() { return activeTheme.noteColors || activeTheme.colors; }
function noteColorIndex(color) {
  const colorsForNotes = notePalette();
  if(color===magicNoteColor) return colorsForNotes.length;
  const current = colorsForNotes.indexOf(color);
  if (current >= 0) return current;
  for (const colors of [oldPaperPalette, oldPalette, ...themes.flatMap(theme => [theme.colors, ...(theme.noteColors ? [theme.noteColors] : [])])]) {
    const index = colors.indexOf(color);
    if (index >= 0) return index % colorsForNotes.length;
  }
  return -1;
}
function contrastingInk(color) {
  const channels = [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  return luminance > .179 ? '#132123' : '#eeeeee';
}
function setNoteColor(card, color) {
  const colorsForNotes = notePalette();
  const index = noteColorIndex(color);
  const neon=color===magicNoteColor;
  card.classList.toggle('note-magic',neon);
  const background = neon?'#ad72ff':index >= 0 ? colorsForNotes[index] : color || colorsForNotes[0];
  const hidden=Boolean(items.get(card.dataset.id)?.backgroundHidden);
  const ink = hidden?canvasNoteInk:neon?'#132123':background==='#f7f7f4'?'#272727':contrastingInk(background);
  card.style.setProperty('--note-color', background);
  card.style.setProperty('--note-ink', ink);
  card.style.setProperty('--note-muted', ink);
  noteGPUSceneDirty=true;
  scheduleNotePreviewRender();
}
function zoomBackground() {
  const shades = activeTheme.backgrounds;
  const progress = Math.max(0, Math.min(shades.length - 1, Math.log2(camera.scale) / 2));
  const index = Math.min(Math.max(0, shades.length - 2), Math.floor(progress));
  const fraction = progress - index;
  const rgb = [shades[index], shades[Math.min(index + 1, shades.length - 1)]].map(color => [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16)));
  const blend = rgb[0].map((channel, part) => Math.round(channel + (rgb[1][part] - channel) * fraction));
  viewport.style.backgroundColor = `rgb(${blend.join(' ')})`;
  const nextInk=contrastingInk('#'+blend.map(channel=>channel.toString(16).padStart(2,'0')).join(''));
  if(nextInk!==canvasNoteInk){
    canvasNoteInk=nextInk;
    for(const [id,card] of cards){const item=items.get(id);if(item?.type==='text'&&item.backgroundHidden)setNoteColor(card,item.color);}
  }
  grid.style.setProperty('--grid-dot', activeTheme.ui.muted);
  grid.style.opacity = '1';
}
function refreshColorSelection() {
  document.querySelector('#colorButton').style.setProperty('--selected-color', penColor.value);
  document.querySelectorAll('#themeSwatches button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.color === penColor.value)));
}
function applyTheme(theme) {
  activeTheme = theme;document.documentElement.dataset.theme=theme.id;if(window.__sketchGPU){noteGPUSceneDirty=true;noteTextLayouts.clear();}
  palette = theme.colors;
  for (const [role, color] of Object.entries(theme.ui)) document.documentElement.style.setProperty(`--theme-${role}`, color);
  document.documentElement.style.setProperty('--theme-panelText', theme.ui.panelText || theme.ui.text);
  document.documentElement.style.setProperty('--theme-panelMuted', theme.ui.panelMuted || theme.ui.muted);
  document.querySelector('meta[name="theme-color"]').content = theme.ui.canvas;
  document.querySelectorAll('[data-theme]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.theme === theme.id)));
  const swatches = document.querySelector('#themeSwatches');
  swatches.replaceChildren(...palette.map(color => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'color-swatch'; button.dataset.color = color;
    button.style.setProperty('--swatch', color); button.title = color;
    button.setAttribute('aria-label', i18n.t(`Usar color ${color}`));
    button.addEventListener('click', () => { penColor.value = color; refreshColorSelection(); });
    return button;
  }));
  document.querySelector('.palette-dots').replaceChildren(...palette.map(color => {
    const dot = document.createElement('i'); dot.style.background = color; return dot;
  }));
  penColor.value = theme.id==='paper'?theme.colors[0]:theme.ui.accent;
  refreshColorSelection();
  for (const [id, card] of cards) { const item = items.get(id); if (item?.type === 'text') setNoteColor(card, item.color); }
  zoomBackground();
  try { localStorage.setItem('referencias.theme', theme.id); } catch {}
}
const themeChoices = document.querySelector('#themeChoices');
for (const theme of themes) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'theme-choice'; button.dataset.theme = theme.id;
  const label = document.createElement('span'); label.textContent = theme.name;
  button.append(label); button.addEventListener('click', () => { applyTheme(theme); renderGridBackground(); }); themeChoices.append(button);
}
penColor.addEventListener('input', refreshColorSelection);
applyTheme(activeTheme);

function resizeAspect(start, dx, dy, direction, ratio, minWidth = 1) {
  const fromHorizontal = direction.includes('e') || direction.includes('w');
  const fromVertical = direction.includes('n') || direction.includes('s');
  const horizontal = start.width + (direction.includes('e') ? dx : -dx);
  const vertical = (start.height + (direction.includes('s') ? dy : -dy)) * ratio;
  let width;
  if (fromHorizontal && fromVertical) width = Math.abs(horizontal - start.width) >= Math.abs(vertical - start.width) ? horizontal : vertical;
  else width = fromHorizontal ? horizontal : vertical;
  width = Math.max(minWidth, width);
  const height = width / ratio;
  return { x: direction.includes('w') ? start.x + start.width - width : start.x, y: direction.includes('n') ? start.y + start.height - height : start.y, width, height };
}
function smoothStrokePoints(points, width) {
  if (points.length < 3) return points;
  const radius = width * 4;
  const distance = [0];
  for (let index = 1; index < points.length; index++) distance[index] = distance[index - 1] + Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
  const result = points.map(([x, y], index) => {
    if (index === 0 || index === points.length - 1) return [x, y];
    let sumX = x, sumY = y, weightSum = 1;
    for (const direction of [-1, 1]) {
      for (let next = index + direction; next >= 0 && next < points.length && Math.abs(next - index) <= 24; next += direction) {
        const separation = Math.abs(distance[next] - distance[index]);
        if (separation >= radius) break;
        const weight = 1 - separation / radius;
        sumX += points[next][0] * weight;
        sumY += points[next][1] * weight;
        weightSum += weight;
      }
    }
    return [sumX / weightSum, sumY / weightSum];
  });
  return result;
}
function smoothPath(points, start = 0, end = points.length - 1, originX = 0, originY = 0) {
  if (!points.length) return '';
  const number = value => Number(value).toString();
  const [firstX, firstY] = points[start];
  if (start === end) return `M${number(firstX - originX)} ${number(firstY - originY)}`;
  if (points.length === 2) return `M${number(firstX - originX)} ${number(firstY - originY)} L${number(points[1][0] - originX)} ${number(points[1][1] - originY)}`;
  let path = `M${number(firstX - originX)} ${number(firstY - originY)}`;
  for (let index = start; index < end; index++) {
    const previous = points[Math.max(0, index - 1)];
    const from = points[index], to = points[index + 1];
    const following = points[Math.min(points.length - 1, index + 2)];
    const segment = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const before = Math.hypot(from[0] - previous[0], from[1] - previous[1]);
    const after = Math.hypot(following[0] - to[0], following[1] - to[1]);
    const firstHandle = segment / (3 * (before + segment || 1));
    const secondHandle = segment / (3 * (segment + after || 1));
    const c1x = from[0] + (to[0] - previous[0]) * firstHandle;
    const c1y = from[1] + (to[1] - previous[1]) * firstHandle;
    const c2x = to[0] - (following[0] - from[0]) * secondHandle;
    const c2y = to[1] - (following[1] - from[1]) * secondHandle;
    path += ` C${number(c1x - originX)} ${number(c1y - originY)} ${number(c2x - originX)} ${number(c2y - originY)} ${number(to[0] - originX)} ${number(to[1] - originY)}`;
  }
  return path;
}
function simplifyPoints(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const limit = tolerance * tolerance;
  while (stack.length) {
    const [start, end] = stack.pop();
    let farthest = -1, distance = limit;
    for (let index = start + 1; index < end; index++) {
      const next = pointSegmentDistanceSquared(...points[index], ...points[start], ...points[end]);
      if (next > distance) { distance = next; farthest = index; }
    }
    if (farthest !== -1) {
      keep[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

function toast(message) {
  toastEl.textContent = i18n.t(message);
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3500);
}
function screenToWorld(x, y) { return { x: (x - camera.x) / camera.scale, y: (y - camera.y) / camera.scale }; }
function worldToScreen(point) { return [camera.x + point[0] * camera.scale, camera.y + point[1] * camera.scale]; }
function noteLayoutUnit(item) {
  const base = Number.isFinite(item.chromeScale) && item.chromeScale > 0 ? item.chromeScale : 1;
  const width = item.displayWidth || 300, height = item.displayHeight || 160;
  return Math.min(base, width / 180, height / 80);
}
function resizeNote(start, dx, dy, direction, base) {
  const unit = noteLayoutUnit({ displayWidth: start.width, displayHeight: start.height, chromeScale: base });
  const totalHeight = start.height;
  const width = Math.max(1e-9, start.width + (direction.includes('w') ? -dx : direction.includes('e') ? dx : 0));
  const height = Math.max(1e-9, totalHeight + (direction.includes('n') ? -dy : direction.includes('s') ? dy : 0));
  const minWidth = 180 * base, minHeight = 80 * base;
  let nextWidth = width, nextBodyHeight = height, nextTotalHeight = height;
  if (width < minWidth || height < minHeight) {
    let boundaryWidth, boundaryHeight;
    if (unit < base) {
      // Reconstruct the comfortable layout of an already scaled note.
      boundaryWidth = start.width * base / unit;
      boundaryHeight = totalHeight * base / unit;
    } else {
      // Find the first edge to reach the layout limit during this drag.
      let fraction = 1;
      if (width < minWidth) fraction = Math.min(fraction, (start.width - minWidth) / (start.width - width));
      if (height < minHeight) fraction = Math.min(fraction, (totalHeight - minHeight) / (totalHeight - height));
      fraction = Math.max(0, fraction);
      boundaryWidth = start.width + (width - start.width) * fraction;
      boundaryHeight = totalHeight + (height - totalHeight) * fraction;
    }
    const factors = [];
    if (direction.includes('e') || direction.includes('w')) factors.push(width / boundaryWidth);
    if (direction.includes('n') || direction.includes('s')) factors.push(height / boundaryHeight);
    const factor = Math.min(...factors);
    if (factor < 1) {
      nextWidth = boundaryWidth * factor;
      nextTotalHeight = boundaryHeight * factor;
      nextBodyHeight = (boundaryHeight) * factor;
    } else {
      nextWidth = direction.includes('e') || direction.includes('w') ? width : boundaryWidth;
      nextTotalHeight = direction.includes('n') || direction.includes('s') ? height : boundaryHeight;
      nextBodyHeight = nextTotalHeight;
    }
  }
  return {
    x: direction.includes('w') ? start.x + start.width - nextWidth : start.x,
    y: direction.includes('n') ? start.y + totalHeight - nextTotalHeight : start.y,
    displayWidth: nextWidth, displayHeight: nextBodyHeight
  };
}
function applyCardChrome(card, item) {
  if (item.type === 'audio') {
    syncCardRenderParent(card, item);
    card.hidden = !showMedia || !vaultContentVisible('items', item.id);
    const diameter = (item.displayWidth || 160) * camera.scale;
    card.style.left = `${camera.x + item.x * camera.scale}px`;
    card.style.top = `${camera.y + item.y * camera.scale}px`;
    card.style.transformOrigin = 'top left';
    card.style.transform = `scale(${diameter / 160})`;
    card.style.width = '160px';
    card.querySelector('.video-frame').style.height = '160px';
    card.classList.toggle('actions-ready', diameter >= 100);
    return;
  }
  if(item.type==='text'){card.classList.toggle('note-detail-view',!noteInteractionAllowed(item));const model=noteGPU.models.get(item.id)||ownedNoteGPU.models.get(item.id),unit=noteLayoutUnit(item);if(!model||model.x!==item.x||model.y!==item.y||model.w!==(item.displayWidth||300)||model.h!==(item.displayHeight||160))noteGPUSceneDirty=true;}
  syncCardRenderParent(card, item);
  if (syncCardViewport(card, item)) return;
  if (syncNotePreview(card, item)) return;
  if (syncSolidPreview(card, item)) return;
  if (!applyVaultCard(card, item)) return;
  const base = Number.isFinite(item.chromeScale) && item.chromeScale > 0 ? item.chromeScale : 1;
  if (item.type === 'text') {
    const unit = noteLayoutUnit(item);
    // Lay out notes at readable CSS sizes, then scale the whole card into world coordinates.
    // Tiny CSS font, padding and handle sizes are rounded up by the browser at deep zoom.
    card.classList.remove('scaled-title');
    const screenWidth = (item.displayWidth || 300) * camera.scale;
    const screenHeight = ((item.displayHeight || 160)) * camera.scale;
    const cornerHitPixels=Math.min(40,Math.min(screenWidth,screenHeight)*.7);
    card.style.setProperty('--note-corner-hit',`${cornerHitPixels/(unit*camera.scale)}px`);
    card.style.setProperty('--note-edge-hit',`${12/(unit*camera.scale)}px`);
    const screenX = camera.x + item.x * camera.scale;
    const screenY = camera.y + item.y * camera.scale;
    const outside = !cardPinned(card, item) && (screenX > innerWidth + 100 || screenX + screenWidth < -100 || screenY > innerHeight + 100 || screenY + screenHeight < -100);
    if (card.hidden !== outside) card.hidden = outside;
    if (outside) return;
    const tooSmallToInteract = screenWidth < 24 || screenHeight < 16;
    if (tooSmallToInteract && card.contains(document.activeElement)) document.activeElement.blur();
    if (card.inert !== tooSmallToInteract) card.inert = tooSmallToInteract;
    card.classList.toggle('note-small', tooSmallToInteract);
    // Native textareas stop shrinking reliably below a few screen pixels.
    // Use the same small preview for every note, regardless of the zoom at creation.
    if (screenWidth < 8 || screenHeight < 6) {
      card.classList.add('note-tiny');
      card.style.left = `${camera.x + item.x * camera.scale}px`;
      card.style.top = `${camera.y + item.y * camera.scale}px`;
      card.style.transform = 'none';
      card.style.width = `${Math.max(0, screenWidth)}px`;
      card.style.height = `${Math.max(0, screenHeight)}px`;
      return;
    }
    card.classList.remove('note-tiny');
    card.style.height = '';
    card.style.transformOrigin = '0 0';
    card.style.left = `${camera.x + item.x * camera.scale}px`;
    card.style.top = `${camera.y + item.y * camera.scale}px`;
    card.style.transform = `scale(${unit * camera.scale})`;
    card.style.width = `${(item.displayWidth || 300) / unit}px`;
    card.querySelector('.video-frame').style.height = `${(item.displayHeight || 160) / unit}px`;
    const editor = card.querySelector('.text-editor');
    if (editor) editor.style.fontSize = `${(item.textFontSize || 17 * base) / base}px`;
    renderNoteLinks(card);
    return;
  }
  // Media lives in screen space. Tiny world-space CSS values are rounded by the
  // browser before zooming, which used to enlarge corners and resize handles.
  const cardScreenWidth = (item.displayWidth || 320) * camera.scale;
  const cardScreenHeight = (item.displayHeight || 180) * camera.scale;
  const screenX = camera.x + item.x * camera.scale;
  const screenY = camera.y + item.y * camera.scale;
  const layoutScale = Math.max(1, cardScreenWidth / 8192, cardScreenHeight / 8192);
  card.classList.toggle('media-huge', layoutScale > 1);
  if(item.type==='video'){const small=card.classList.contains('playback-small');card.classList.toggle('playback-small',cardScreenWidth<(small?220:180)||cardScreenHeight<(small?110:90));}
  card.style.left = layoutScale > 1 ? '0px' : `${screenX}px`;
  card.style.top = layoutScale > 1 ? '0px' : `${screenY}px`;
  card.style.transformOrigin = 'top left';
  card.style.transform = layoutScale > 1 ? `translate(${screenX}px, ${screenY}px) scale(${layoutScale})` : 'none';
  card.style.width = `${cardScreenWidth / layoutScale}px`;
  card.querySelector('.video-frame').style.height = `${cardScreenHeight / layoutScale}px`;
  if (item.type === 'image' && !card.classList.contains('gradient-preview')) {
    const image = card.querySelector('.video-frame img');
    // Use the full preview's resolution: originals can be larger than the
    // optimized image actually displayed, and thumbnails must not shift the threshold.
    const nativeSize = Math.max(item.width || 0, item.height || 0);
    const enlargement = nativeSize > 0 ? Math.max(cardScreenWidth, cardScreenHeight) / nativeSize : 0;
    // Keep the radius in screen pixels, even when huge cards use a layout transform.
    const radius = Math.min(60, Math.max(0, enlargement - 3) * 40) / layoutScale;
    const filter = radius > 0 ? `blur(${radius}px)` : '';
    if (image && image.style.filter !== filter) image.style.filter = filter;
  }
  if (item.type === 'image' && waitingPhotos.has(item.id) && !cardPinned(card, item)) card.hidden = true;
  card.classList.toggle('actions-ready', item.type === 'image' ? cardScreenWidth >= 150 : cardScreenWidth >= 320 && cardScreenHeight >= 180);
  card.style.setProperty('--action-scale', '1');
  card.style.setProperty('--handle-size', '12px');
  // Scale the complete icon from the frame dimensions, including its glyph.
  // A transform keeps browser minimum font sizes from enlarging tiny previews.
  card.style.setProperty('--play-scale', String(Math.min(cardScreenWidth, cardScreenHeight) / (180 * layoutScale)));
}
let gridBackground = localStorage.getItem('apoxiaSketchBook.background') || 'dots';
if (!['dots', 'squares', 'technical', 'isometric'].includes(gridBackground)) gridBackground = 'dots';
let gridPatternKey = '';
const gridScaleLayers = [0, 1].map(() => {
  const layer = document.createElement('div');
  layer.className = 'grid-scale-layer';
  grid.append(layer);
  return layer;
});
function renderGridBackground() {
  // Adjacent powers of two stay anchored in world space. At an octave
  // boundary the visible layer is identical; only the invisible one changes.
  const zoomLevel = Math.log2(camera.scale);
  const octave = Math.floor(zoomLevel);
  const fraction = zoomLevel - octave;
  const spacing = 32 * 2 ** fraction;
  const color = activeTheme.ui.muted;
  grid.dataset.background = gridBackground;
  const key = `${gridBackground}:${color}`;
  if (key !== gridPatternKey) {
    gridPatternKey = key;
    if (gridBackground === 'dots') {
      grid.style.backgroundImage = 'radial-gradient(circle,var(--grid-dot) 1px,transparent 1.2px)';
    } else if (gridBackground === 'squares') {
      grid.style.backgroundImage = 'linear-gradient(to right,var(--grid-dot) 1px,transparent 1px),linear-gradient(to bottom,var(--grid-dot) 1px,transparent 1px)';
    } else if (gridBackground === 'isometric') {
      const height = 128 * 2 / Math.sqrt(3);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="${height}" viewBox="0 0 128 ${height}"><path d="M0 0V${height}M128 0V${height}M0 0L128 ${height/2}L0 ${height}M128 0L0 ${height/2}L128 ${height}" fill="none" stroke="${color}" stroke-width="1"/></svg>`;
      grid.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    } else {
      const dots = [];
      for (let y = 4; y < 128; y += 8) for (let x = 4; x < 128; x += 8) {
        dots.push(`<circle cx="${x}" cy="${y}" r=".65" opacity=".32"/>`);
      }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><g fill="${color}">${dots.join('')}<circle cx="0" cy="0" r="1.1"/><circle cx="128" cy="0" r="1.1"/><circle cx="0" cy="128" r="1.1"/><circle cx="128" cy="128" r="1.1"/></g><path d="M58 64H70M64 58V70" fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round"/></svg>`;
      grid.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    }
  }
  const pattern = grid.style.backgroundImage;
  if (pattern && pattern !== 'none') {
    for (const layer of gridScaleLayers) layer.style.backgroundImage = pattern;
    grid.style.backgroundImage = 'none';
  }
  const fade = fraction * fraction * (3 - 2 * fraction);
  for (let index = 0; index < gridScaleLayers.length; index++) {
    const layer = gridScaleLayers[index];
    const tile = spacing * (gridBackground === 'technical' ? 4 : 1) * 2 ** index;
    // Center the dots and crosses on world lattice intersections, so the
    // coarser layer occupies a subset of the finer layer's intersections.
    const tileHeight = gridBackground === 'isometric' ? tile * 2 / Math.sqrt(3) : tile;
    const offset = ['squares', 'isometric'].includes(gridBackground) ? 0 : tile / 2;
    layer.style.backgroundSize = `${tile}px ${tileHeight}px`;
    layer.style.backgroundPosition = `${camera.x % tile - offset}px ${camera.y % tileHeight - offset}px`;
    const patternOpacity = activeTheme.id==='paper'?0.36:gridBackground === 'squares' ? 0.06 : 0.10;
    layer.style.opacity = String((index === 0 ? fade : 1 - fade) * patternOpacity);
  }
  grid.style.opacity = '1';
}
for (const button of document.querySelectorAll('[data-background]')) {
  button.setAttribute('aria-pressed', String(button.dataset.background === gridBackground));
  button.addEventListener('click', () => {
    gridBackground = button.dataset.background;
    localStorage.setItem('apoxiaSketchBook.background', gridBackground);
    for (const choice of document.querySelectorAll('[data-background]')) choice.setAttribute('aria-pressed', String(choice.dataset.background === gridBackground));
    renderGridBackground();
  });
}
function renderCamera() {
  updateScreenFrozen();
  updateSpatialAudio();
  if (gesture?.type === 'pan' && gesture.frozen?.length) applyInversePanSnapshot(gesture.frozen, gesture.inverseDx, gesture.inverseDy);
  if (gesture?.type === "zoom" && gesture.frozen?.length) applyInverseSnapshot(gesture.frozen, gesture.scale / camera.scale, gesture.worldX, gesture.worldY);
  if (cameraFrame) { cancelAnimationFrame(cameraFrame); cameraFrame = 0; }
  clearTimeout(lastViewTimer);
  lastViewTimer = setTimeout(persistLastCanvasView, 250);
  zoomBackground();
  renderVaults();
  const chromeIds=new Set([...gpuUIIds].filter(id=>items.get(id)?.type!=='text'));for(const id of activeNoteCards)chromeIds.add(id);for(const id of activeMediaCards)chromeIds.add(id);if(gpuHoverId)chromeIds.add(gpuHoverId);if(playingVideoId)chromeIds.add(playingVideoId);if(gesture?.id)chromeIds.add(gesture.id);for(const entry of screenFrozen.values())if(entry.kind==='items')chromeIds.add(entry.id);const focused=document.activeElement?.closest('.video-card');if(focused)chromeIds.add(focused.dataset.id);for(const id of chromeIds){const card=cards.get(id),item=items.get(id);if(card&&item)applyCardChrome(card,item);}
  renderGridBackground();
  const percent = camera.scale * 100;
  document.querySelector('#zoomValue').textContent = percent >= 10 ? `${Math.round(percent).toLocaleString(i18n.locale)}%` : `${percent.toPrecision(2)}%`;
  renderSolidPreviews();
  renderNotePreviews();
  renderWritings();
  redrawStrokes(true);
  scheduleVideoHover();
  renderMagicLaser();
  renderConnections();
  renderFileGlow();
  if(window.__canvasFindReady)renderCanvasFindHighlight();
}
// Media remains transparent to drawing gestures. Detect hover geometrically,
// including while pointer capture routes an active stroke to the viewport.
function scheduleVideoHover() {
  if (videoHoverFrame) return;
  videoHoverFrame = requestAnimationFrame(() => {
    videoHoverFrame = 0;
    let topCard = null;
    let topRank = -1;
    if (showMedia && pointerOnPage && (mode === 'draw' || mode === 'erase')) {
      const target = document.elementFromPoint(pointerPosition.x, pointerPosition.y);
      if (target && viewport.contains(target) && !target.closest('#textLayer,.owned-text-layer,.canvas-writing,.empty-state')) {
        for (const [id, card] of cards) {
          if (items.get(id)?.locked || items.get(id)?.type !== 'video' || !vaultContentVisible('items', id)) continue;
          const frame = card.querySelector('.video-frame');
          const rect = frame.getBoundingClientRect();
          const rank = Number(card.style.zIndex) || 0;
          if (rect.width > 0 && rect.height > 0 && pointerPosition.x >= rect.left && pointerPosition.x < rect.right && pointerPosition.y >= rect.top && pointerPosition.y < rect.bottom && rank >= topRank) {
            topCard = id; topRank = rank;
          }
        }
      }
    }
    for (const [id, controller] of videoPreviews) controller.setDrawingHover(id === topCard);
  });
}
viewport.addEventListener('pointerleave', () => { pointerOnPage = false; scheduleVideoHover(); });
function scheduleCameraRender() {
  if (!cameraFrame) cameraFrame = requestAnimationFrame(renderCamera);
}
function updateStacking() {
  stackingScheduled = false;
  const ranked = [...cards.keys()].map(id => items.get(id)).filter(Boolean);
  ranked.sort((a, b) => {
    if (a.type === 'text' || b.type === 'text') {
      if (a.type !== b.type) return a.type === 'text' ? 1 : -1;
      const areaA = (a.displayWidth || 300) * ((a.displayHeight || 160));
      const areaB = (b.displayWidth || 300) * ((b.displayHeight || 160));
      if (areaA !== areaB) return areaB - areaA;
    } else {
      const areaA = (a.displayWidth || 320) * (a.displayHeight || 180);
      const areaB = (b.displayWidth || 320) * (b.displayHeight || 180);
      if (areaA !== areaB) return areaB - areaA;
    }
    return (a.createdAt || 0) - (b.createdAt || 0) || a.id.localeCompare(b.id);
  });
  ranked.forEach((item,index)=>{gpuRanks.set(item.id,index+1);cards.get(item.id).style.zIndex=String(index+1);});gpuSceneDirty=true;noteGPUSceneDirty=true;requestGPU();
  scheduleNotePreviewRender();
}
function scheduleStacking() {
  if (stackingScheduled) return;
  stackingScheduled = true;
  requestAnimationFrame(updateStacking);
}
let gradientPreviewEnabled = true;
const solidProxyCards = new Set();
const solidProxyColors = new Map();
let noteCanvasEnabled = true;
let editingNoteId=null;
const activeNoteCards=new Set();let noteHoverId=null,noteGPUSceneDirty=true,noteDetailScale=Infinity,notePreviewDpr=Math.min(devicePixelRatio,2);
const noteProxyCards = new Set();
const noteTextLayouts = new Map();
let notePreviewFrame = 0;
const notePreviewLayer = document.createElement('canvas');
notePreviewLayer.id = 'notePreviewLayer'; notePreviewLayer.setAttribute('aria-hidden', 'true');
textLayer.prepend(notePreviewLayer);
const noteGPU=new window.ApoxiaMediaRenderer(notePreviewLayer,scheduleNotePreviewRender,null,{lowTile:128,lowPages:4,highPages:8,nativePages:0,noteSource:noteRasterSource});
const ownedNoteGPU=new window.ApoxiaMediaRenderer(ownedNotePreview,scheduleNotePreviewRender,null,{lowTile:128,lowPages:4,highPages:8,nativePages:0,noteSource:noteRasterSource});
const noteReducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
const updateNoteMotion=()=>{noteGPU.reducedMotion=ownedNoteGPU.reducedMotion=noteReducedMotion.matches;scheduleNotePreviewRender();};noteReducedMotion.addEventListener('change',updateNoteMotion);updateNoteMotion();
const notePreviewMeasure = document.createElement('canvas').getContext('2d');
function noteInteractionAllowed(item){
 if(item?.type!=='text'||editingNoteId===item.id||gesture?.id===item.id)return true;
 const base=item.chromeScale>0?item.chromeScale:1;
 return (item.textFontSize||17*base)/base*noteLayoutUnit(item)*camera.scale<96;
}
function noteNeedsNativeBase(item) {
  const base=Number.isFinite(item.chromeScale)&&item.chromeScale>0?item.chromeScale:1,unit=noteLayoutUnit(item);
  const pixels=Math.max(item.displayWidth||300,(item.displayHeight||160))*camera.scale*Math.min(devicePixelRatio,2);
  const font=(item.textFontSize||17*base)/base*unit*camera.scale;
  return pixels>480||font>=6.25;
}
function noteNeedsNative(item) {
  if(noteNeedsNativeBase(item))return true;
  // A smaller note must remain above an overlapping native note, across LODs.
  const engine=vaultOwner('items',item.id)?ownedNoteGPU:noteGPU;
  const width=item.displayWidth||300,height=item.displayHeight||160,area=width*height;
  for(const model of engine.index.query(item.x,item.y,width,height)){
    if(model.id===item.id||model.w*model.h<=area)continue;
    const other=items.get(model.id),card=cards.get(model.id);
    if(other&&card&&(noteNeedsNativeBase(other)||cardPinned(card,other)))return true;
  }
  return false;
}
function syncNotePreview(card, item) {
  if (item.type !== 'text') return false;
  const base = Number.isFinite(item.chromeScale) && item.chromeScale > 0 ? item.chromeScale : 1;
  const unit = noteLayoutUnit(item);
  const width = (item.displayWidth || 300) * camera.scale;
  const font = (item.textFontSize || 17 * base) / base * unit * camera.scale;
  const wasProxy = noteProxyCards.has(item.id);
  const hovered=noteHoverId===item.id&&width>=90&&font>=6.25;
  const detailed=noteNeedsNative(item);
  const engine=vaultOwner('items',item.id)?ownedNoteGPU:noteGPU,model=engine.models.get(item.id);
  // Keep the native note visible until its overview texture is ready.
  const ready=model&&Boolean(model.backgroundHidden)===Boolean(item.backgroundHidden)&&engine.texture(model,64);
  const proxy=noteCanvasEnabled&&!cardPinned(card,item)&&!hovered&&!detailed&&Boolean(ready);
  card.classList.toggle('note-active',!proxy);
  if (proxy) {
    if (!wasProxy) { noteProxyCards.add(item.id); card.remove(); noteGPUSceneDirty=true; }
    if(activeNoteCards.delete(item.id))noteGPUSceneDirty=true;
    return true;
  }
  if (noteProxyCards.delete(item.id)) {cardRenderParent(item).append(card);noteGPUSceneDirty=true;}
  if(!activeNoteCards.has(item.id)){activeNoteCards.add(item.id);noteGPUSceneDirty=true;}
  return false;
}
function notePreviewLayout(item) {
  const base = Number.isFinite(item.chromeScale) && item.chromeScale > 0 ? item.chromeScale : 1;
  const unit = noteLayoutUnit(item);
  const width = Math.max(1, (item.displayWidth || 300) / unit - 32);
  const font = (item.textFontSize || 17 * base) / base;
  const text = item.text || '';
  const limit = Math.ceil((item.displayHeight || 160) / unit / (font * 1.5)) + 1;
  const previous = noteTextLayouts.get(item.id);
  if (previous && previous.text === text && previous.width === width && previous.font === font && previous.limit === limit) return previous;
  notePreviewMeasure.font = `${font}px "Paper Mono",monospace`;
  const lines = [];
  for (const paragraph of text.slice(0, 20000).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? line + ' ' + word : word;
      if (line && notePreviewMeasure.measureText(candidate).width > width) { lines.push(line); line = ''; }
      if (lines.length >= limit) break;
      if (notePreviewMeasure.measureText(word).width > width) {
        for (const character of word) {
          if (line && notePreviewMeasure.measureText(line + character).width > width) { lines.push(line); line = ''; }
          if (lines.length >= limit) break;
          line += character;
        }
      } else line = line ? line + ' ' + word : word;
    }
    if (lines.length < limit) lines.push(line);
    if (lines.length >= limit) break;
  }
  const layout = { text, width, font, limit, lines, lengths: lines.map(line => Math.min(width, notePreviewMeasure.measureText(line).width)) };
  noteTextLayouts.set(item.id, layout); return layout;
}
function scheduleNotePreviewRender() {
  if (!notePreviewFrame) notePreviewFrame = requestAnimationFrame(() => renderNotePreviews());
}
// Inactive notes share bounded GPU atlases; native controls attach on interaction.
function noteRasterSource(id){
 const item=items.get(id),card=cards.get(id),unit=noteLayoutUnit(item),layout=notePreviewLayout(item);
 return {width:(item.displayWidth||300)/unit,height:(item.displayHeight||160)/unit,font:layout.font,lines:layout.lines,lengths:layout.lengths,empty:!item.text,neon:card.classList.contains('note-magic'),backgroundHidden:Boolean(item.backgroundHidden),shadow:item.backgroundHidden?null:activeTheme.ui.accent,border:!item.backgroundHidden&&activeTheme.id==='paper'?'#80aaf0':null,background:card.style.getPropertyValue('--note-color')||item.color||palette[0],ink:card.style.getPropertyValue('--note-ink')||contrastingInk(item.color||palette[0])};
}
function syncNoteGPUScene(){
 if(!showTexts){noteGPU.sync([]);ownedNoteGPU.sync([]);noteGPUSceneDirty=false;return;}
 const publicRecords=[],ownedRecords=[];noteDetailScale=Infinity;
 for(const id of gpuUIIds){const item=items.get(id),card=cards.get(id);if(item?.type!=='text'||!card||!vaultContentVisible('items',id))continue;
  const unit=noteLayoutUnit(item),base=Number.isFinite(item.chromeScale)&&item.chromeScale>0?item.chromeScale:1,w=item.displayWidth||300,h=(item.displayHeight||160);
  noteDetailScale=Math.min(noteDetailScale,480/(Math.max(w,h)*Math.min(devicePixelRatio,2)),6.25/((item.textFontSize||17*base)/base*unit));
  const owner=vaultOwner('items',id),vault=owner?vaults.get(owner):null;let clip=null;
  if(vault&&!freeVaultObjectPreview('items',item)&&!screenFrozen.has(`items:${id}`)){const box=vaultInterior(vault);clip={x:box.x,y:box.y,w:box.width,h:box.height};}
  const background=card.style.getPropertyValue('--note-color')||item.color||palette[0],ink=card.style.getPropertyValue('--note-ink')||contrastingInk(item.color||palette[0]);
  const record={id,type:'note',borderColor:activeTheme.ui.accent,backgroundHidden:Boolean(item.backgroundHidden),x:item.x,y:item.y,w,h,shadow:item.backgroundHidden?0:3*unit,textFont:(item.textFontSize||17*base)/base*unit,rank:gpuRanks.get(id)||0,clip,dom:activeNoteCards.has(id)&&card.isConnected,neon:false,noteKey:JSON.stringify([activeTheme.id,item.text||'',w/unit,h/unit,(item.textFontSize||17*base)/base,background,ink,Boolean(item.backgroundHidden)])};
  (owner?ownedRecords:publicRecords).push(record);
 }
 noteGPU.sync(publicRecords);ownedNoteGPU.sync(ownedRecords);noteGPUSceneDirty=false;
}
function renderNotePreviews(){
 const dpr=Math.min(devicePixelRatio,2);if(dpr!==notePreviewDpr){notePreviewDpr=dpr;noteGPUSceneDirty=true;}
 if(notePreviewFrame){cancelAnimationFrame(notePreviewFrame);notePreviewFrame=0;}
 if(noteGPUSceneDirty||screenFrozen.size||gesture?.frozen?.length||vaultDrag)syncNoteGPUScene();
 if(!showTexts){noteGPU.render({...camera,scale:camera.scale});ownedNoteGPU.render({...camera,scale:camera.scale});return;}
 if(camera.scale>=noteDetailScale){const margin=100/camera.scale,x=(-camera.x-100)/camera.scale,y=(-camera.y-100)/camera.scale,w=(innerWidth+200)/camera.scale,h=(innerHeight+200)/camera.scale;
  for(const model of [...noteGPU.index.query(x,y,w,h),...ownedNoteGPU.index.query(x,y,w,h)]){const item=items.get(model.id),card=cards.get(model.id);if(item&&card&&noteNeedsNative(item))applyCardChrome(card,item);}
  if(noteGPUSceneDirty)syncNoteGPUScene();
 }
 // Prepare distant previews before detaching their native cards.
 for(const id of [...activeNoteCards]){const item=items.get(id),card=cards.get(id);if(!item||!card||noteNeedsNative(item)||cardPinned(card,item))continue;
  const engine=vaultOwner('items',id)?ownedNoteGPU:noteGPU,model=engine.models.get(id);if(!model)continue;
  if(engine.texture(model,64))applyCardChrome(card,item);else if(engine.low.available())engine.enqueue(model,64);
 }
 if(noteGPUSceneDirty)syncNoteGPUScene();
 noteGPU.pump();ownedNoteGPU.pump();
 noteGPU.render(camera);ownedNoteGPU.render(camera);
}
function notePick(x,y,includeLocked=false){if(!showTexts)return null;const p=screenToWorld(x,y);const hit=ownedNoteGPU.hit(p.x,p.y)||noteGPU.hit(p.x,p.y);return hit&&(includeLocked||!items.get(hit.id)?.locked)&&noteInteractionAllowed(items.get(hit.id))?hit:null;}
function setNoteHover(id){if(noteHoverId===id)return;const previous=noteHoverId;noteHoverId=id;noteGPUSceneDirty=true;for(const key of [previous,id]){const item=items.get(key),card=cards.get(key);if(item&&card)applyCardChrome(card,item);}scheduleNotePreviewRender();}
viewport.addEventListener('pointermove',event=>{
 if(gesture||vaultDrag||spaceHeld||zHeld||['draw','erase','write','laser','rectangle','ellipse'].includes(mode))return;
 if(event.target.closest('button,a,.vault-frame,.canvas-writing,.resize-handle'))return;
 const native=event.target.closest('.text-card'),hit=native?{id:native.dataset.id}:notePick(event.clientX,event.clientY),item=hit&&items.get(hit.id);
 const unit=item?noteLayoutUnit(item):1,base=item?.chromeScale||1;
 setNoteHover(item&&!item.locked&&(item.displayWidth||300)*camera.scale>=90&&(item.textFontSize||17*base)/base*unit*camera.scale>=6.25?item.id:null);
},{capture:true});
viewport.addEventListener('pointerleave',()=>{if(!gesture)setNoteHover(null);});
viewport.addEventListener('pointerdown',event=>{
 if(event.button===0&&!gesture&&!spaceHeld&&!zHeld&&mode==='draw'&&!event.target.closest('button,a,.resize-handle,.vault-frame,.canvas-writing')){
  const hit=notePick(event.clientX,event.clientY);if(hit){setMode('move',false);setNoteHover(hit.id);event.preventDefault();event.stopImmediatePropagation();startCardMove(event,hit.id);return;}
 }
 if(rectangleSelectionHit(event))return;
 if(event.button!==0||gesture||spaceHeld||zHeld||['draw','erase','write','laser','rectangle','ellipse'].includes(mode)||event.target.closest('.text-card,button,a,.resize-handle,.vault-frame,.canvas-writing'))return;
 const hit=notePick(event.clientX,event.clientY),item=hit&&items.get(hit.id);if(!item)return;
 const unit=noteLayoutUnit(item),base=item.chromeScale||1;if((item.displayWidth||300)*camera.scale<90||(item.textFontSize||17*base)/base*unit*camera.scale<5)return;
 setNoteHover(item.id);const card=cards.get(item.id);event.preventDefault();event.stopImmediatePropagation();
 card.focus({preventScroll:true});startCardMove(event,item.id);
},{capture:true});
// Keep layout and decoded image work near the viewport, with hysteresis.
const parkedCards = new Set();
const waitingPhotos = new Set();
const imageUpgradeRequests = new Map();
const parkedImageCache = new Map();
const parkedImageBudget = 32 * 1024 * 1024;
function cardPinned(card, item) {
  return editingNoteId===item.id || gesture?.id === item.id || card.contains(document.activeElement);
}
function cancelImageUpgrade(id) {
  const request = imageUpgradeRequests.get(id);
  if (!request) return;
  imageUpgradeRequests.delete(id);
  request.image.onload = null; request.image.onerror = null;
  request.image.removeAttribute('src');
}
function upgradeImage(card, item, currentImage, variant) {
  if (currentImage.dataset.failedUpgrade === variant) return;
  if (imageUpgradeRequests.get(item.id)?.variant === variant) return;
  cancelImageUpgrade(item.id);
  const nextImage = new Image();
  nextImage.loading = 'eager'; nextImage.decoding = 'async';
  const request = { image: nextImage, variant };
  imageUpgradeRequests.set(item.id, request);
  nextImage.onerror = () => {
    if (imageUpgradeRequests.get(item.id) !== request) return;
    imageUpgradeRequests.delete(item.id);
    currentImage.dataset.failedUpgrade = variant;
  };
  nextImage.onload = async () => {
    try { await nextImage.decode(); } catch { nextImage.onerror?.(); return; }
    if (imageUpgradeRequests.get(item.id) !== request) return;
    imageUpgradeRequests.delete(item.id);
    const current = items.get(item.id);
    if (!current || parkedCards.has(item.id) || solidProxyCards.has(item.id) || !vaultContentVisible('items', item.id)) return;
    const frame = card.querySelector('.video-frame');
    if (frame.querySelector('img') !== currentImage) return;
    nextImage.alt = currentImage.alt; nextImage.draggable = false;
    nextImage.style.cssText = currentImage.style.cssText;
    Object.assign(nextImage.dataset, currentImage.dataset, { variant });
    delete nextImage.dataset.failedUpgrade;
    nextImage.onload = currentImage.onload; nextImage.onerror = currentImage.onerror;
    frame.replaceChildren(nextImage);
    currentImage.removeAttribute('src');
    waitingPhotos.delete(item.id);
    applyCardChrome(card, current); renderSolidPreviews();
  };
  nextImage.src = privateMediaURL(variant === 'full' ? `/media/${item.id}.webp` : `/media/${item.id}-thumb.webp`, item.id);
}
function releasePhoto(id, image) {
  cancelImageUpgrade(id);
  parkedImageCache.delete(id); waitingPhotos.delete(id);
  if (!image) return;
  image.dataset.variant = 'parked';
  image.removeAttribute('src');
}
function rememberParkedPhoto(item, image) {
  cancelImageUpgrade(item.id);
  waitingPhotos.delete(item.id);
  if (!image?.complete || !image.naturalWidth || !image.hasAttribute('src')) { releasePhoto(item.id, image); return; }
  const bytes = image.naturalWidth * image.naturalHeight * 4;
  if (bytes > parkedImageBudget) { releasePhoto(item.id, image); return; }
  parkedImageCache.delete(item.id);
  parkedImageCache.set(item.id, { image, bytes });
  let total = [...parkedImageCache.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  while (total > parkedImageBudget || parkedImageCache.size > 24) {
    const [id, entry] = parkedImageCache.entries().next().value;
    total -= entry.bytes; releasePhoto(id, entry.image);
  }
}
function syncCardViewport(card, item) {
  if (item.type !== 'image' && item.type !== 'text') return false;
  const pinned = cardPinned(card, item);
  const margin = parkedCards.has(item.id) ? 240 : 360;
  const x = camera.x + item.x * camera.scale, y = camera.y + item.y * camera.scale;
  const width = (item.displayWidth || (item.type === 'text' ? 300 : 320)) * camera.scale;
  const height = ((item.displayHeight || (item.type === 'text' ? 160 : 180))) * camera.scale;
  const outside = x > innerWidth + margin || x + width < -margin || y > innerHeight + margin || y + height < -margin;
  const hidden = !vaultContentVisible('items', item.id);
  if (hidden || (outside && !pinned)) {
    if (!parkedCards.has(item.id)) {
      parkedCards.add(item.id); observer.unobserve(card); card.remove();
      if (item.type === 'image') {
        const image = card.querySelector('.video-frame img');
        if (hidden) releasePhoto(item.id, image); else rememberParkedPhoto(item, image);
      }
    } else if (hidden && parkedImageCache.has(item.id)) releasePhoto(item.id, parkedImageCache.get(item.id).image);
    return true;
  }
  if (parkedCards.delete(item.id)) {
    parkedImageCache.delete(item.id);
    if (!solidProxyCards.has(item.id) && !noteProxyCards.has(item.id)) cardRenderParent(item).append(card);
  }
  return false;
}
const solidPreviewLayer = document.createElement('canvas');
solidPreviewLayer.id = 'solidPreviewLayer';
solidPreviewLayer.setAttribute('aria-hidden', 'true');
world.prepend(solidPreviewLayer);
const activeMediaCards=new Set();
const gpuRanks=new Map(),gpuConnectionSources=new Set(),gpuUIIds=new Set();let gpuHoverId=null,gpuRenderFrame=0,gpuForwarding=false,gpuSceneDirty=true;
const requestGPU=()=>{if(!gpuRenderFrame)gpuRenderFrame=requestAnimationFrame(()=>{gpuRenderFrame=0;renderSolidPreviews();});};
const photoGPU=new window.ApoxiaMediaRenderer(solidPreviewLayer,requestGPU,id=>cards.get(id)?.querySelector('video'));
const ownedPhotoGPU=new window.ApoxiaMediaRenderer(ownedPhotoPreview,requestGPU,id=>cards.get(id)?.querySelector('video'));
// Alt temporarily changes image edges from resize handles to crop handles.
let cropAltHeld=false,cropPreviewId=null;
const cropOutline=document.createElementNS(svgNS,'svg');cropOutline.id='imageCropOutline';cropOutline.setAttribute('aria-hidden','true');cropOutline.setAttribute('hidden','');
const cropOutlinePath=document.createElementNS(svgNS,'path');cropOutline.append(cropOutlinePath);viewport.append(cropOutline);
function cropImageUnderPointer(){
 if(!pointerOnPage)return null;
 const node=document.elementFromPoint(pointerPosition.x,pointerPosition.y);
 if(node?.closest('button,a,input,textarea,.text-card,.canvas-writing,.vault-frame'))return null;
 const hit=gpuPick(pointerPosition.x,pointerPosition.y),item=hit&&items.get(hit.id);
 return item?.type==='image'&&item.status==='ready'&&!item.locked&&!screenFrozen.has(`items:${item.id}`)&&vaultContentVisible('items',item.id)?item:null;
}
function cropDirection(item,x,y){
 if(!item)return '';
 const left=camera.x+item.x*camera.scale,top=camera.y+item.y*camera.scale,w=item.displayWidth*camera.scale,h=item.displayHeight*camera.scale;
 const margin=Math.min(12,w*.25,h*.25);
 if(x<left||y<top||x>left+w||y>top+h)return '';
 return (y<top+margin?'n':y>top+h-margin?'s':'')+(x<left+margin?'w':x>left+w-margin?'e':'');
}
function syncCropPreview(){
 viewport.classList.toggle('image-crop-alt',cropAltHeld||gesture?.type==='crop');
 const item=gesture?.type==='crop'?items.get(gesture.id):cropAltHeld?cropImageUnderPointer():null;
 const id=item?.id||null;
 if(cropPreviewId!==id){cropPreviewId=id;gpuSceneDirty=true;requestGPU();}
 cropOutline.toggleAttribute('hidden',!item);
 if(!item){delete viewport.dataset.cropEdge;return;}
 cropOutline.setAttribute('viewBox',`0 0 ${innerWidth} ${innerHeight}`);
 const x=camera.x+item.x*camera.scale,y=camera.y+item.y*camera.scale,w=item.displayWidth*camera.scale,h=item.displayHeight*camera.scale,t=Math.min(8,w/3,h/3);
 cropOutlinePath.setAttribute('d',`M${x+t} ${y}H${x}V${y+t}M${x+w-t} ${y}H${x+w}V${y+t}M${x} ${y+h-t}V${y+h}H${x+t}M${x+w-t} ${y+h}H${x+w}V${y+h-t}M${x+w/2-4} ${y}h8M${x+w/2-4} ${y+h}h8M${x} ${y+h/2-4}v8M${x+w} ${y+h/2-4}v8`);
 const direction=gesture?.type==='crop'?gesture.direction:cropDirection(item,pointerPosition.x,pointerPosition.y);
 if(direction)viewport.dataset.cropEdge=direction;else delete viewport.dataset.cropEdge;
}
function cropSnapshot(item){return {x:item.x,y:item.y,displayWidth:item.displayWidth,displayHeight:item.displayHeight,crop:structuredClone(item.crop||null)};}
viewport.addEventListener('pointerdown',event=>{
 if(event.button!==0||!event.altKey||event.ctrlKey||event.metaKey||spaceHeld||zHeld||gesture||vaultBusy||vaultDrag||historyBusy||inverseZoomSaving||editingWriting||editingNoteId)return;
 const item=cropImageUnderPointer(),direction=cropDirection(item,event.clientX,event.clientY);if(!direction)return;
 event.preventDefault();event.stopImmediatePropagation();
 cropAltHeld=true;
 gesture={type:'crop',id:item.id,pointer:event.pointerId,direction,startX:event.clientX,startY:event.clientY,before:cropSnapshot(item),original:ApoxiaCrop.sourceBounds(item)};
 viewport.setPointerCapture(event.pointerId);syncCropPreview();
},{capture:true});
window.addEventListener('pointermove',syncCropPreview,{capture:true});
window.addEventListener('keydown',event=>{
 if(event.key==='Alt'&&!editingText(event.target)){
  cropAltHeld=true;syncCropPreview();
  if(cropPreviewId){event.preventDefault();event.stopImmediatePropagation();}
 }
 if(event.key==='Escape'&&gesture?.type==='crop'){
  event.preventDefault();event.stopImmediatePropagation();endGesture({type:'pointercancel',pointerId:gesture.pointer});
 }
},{capture:true});
window.addEventListener('keyup',event=>{if(event.key==='Alt'){cropAltHeld=false;syncCropPreview();}},{capture:true});
window.addEventListener('blur',()=>{cropAltHeld=false;if(gesture?.type==='crop')endGesture({type:'pointercancel',pointerId:gesture.pointer});syncCropPreview();});

function updateShapeGesture(event){
 const g=gesture;if(g?.type!=='shape')return;
 const p=screenToWorld(event.clientX,event.clientY),v=g.vaultId&&vaults.get(g.vaultId);
 if(v){const b=vaultInterior(v),pad=g.width/2;p.x=Math.max(b.x+pad,Math.min(b.x+b.width-pad,p.x));p.y=Math.max(b.y+pad,Math.min(b.y+b.height-pad,p.y));}
 let dx=p.x-g.start.x,dy=p.y-g.start.y;
 if(event.shiftKey){const side=Math.min(Math.abs(dx),Math.abs(dy));dx=Math.sign(dx||1)*side;dy=Math.sign(dy||1)*side;}
 const x=Math.min(g.start.x,g.start.x+dx),y=Math.min(g.start.y,g.start.y+dy),w=Math.abs(dx),h=Math.abs(dy),points=[];
 g.bounds={x,y,width:w,height:h};
 if(g.shape==='ellipse'){for(let i=0;i<=256;i++){const a=i*Math.PI*2/256;points.push([x+w/2+Math.cos(a)*w/2,y+h/2+Math.sin(a)*h/2]);}}
 else{const r=Math.min(w,h)*.06;for(const [cx,cy,start]of [[x+w-r,y+r,-Math.PI/2],[x+w-r,y+h-r,0],[x+r,y+h-r,Math.PI/2],[x+r,y+r,Math.PI]])for(let i=0;i<=32;i++){const a=start+i*Math.PI/64;points.push([cx+Math.cos(a)*r,cy+Math.sin(a)*r]);}points.push(points[0]);}
 g.points=points;preview.replaceChildren();
 const node=document.createElementNS(svgNS,g.shape==='ellipse'?'ellipse':'rect'),a=worldToScreen([x,y]);
 if(g.shape==='ellipse'){node.setAttribute('cx',a[0]+w*camera.scale/2);node.setAttribute('cy',a[1]+h*camera.scale/2);node.setAttribute('rx',w*camera.scale/2);node.setAttribute('ry',h*camera.scale/2);}
 else{for(const [key,value]of Object.entries({x:a[0],y:a[1],width:w*camera.scale,height:h*camera.scale,rx:Math.min(w,h)*camera.scale*.06}))node.setAttribute(key,value);}
 node.setAttribute('fill','none');node.setAttribute('stroke',g.color);node.setAttribute('stroke-width',g.width*camera.scale);preview.append(node);
}
viewport.addEventListener('pointerdown',event=>{
 if(event.button!==0||gesture||spaceHeld||zHeld||event.altKey||vaultBusy||vaultDrag||historyBusy||canvasActions||editingWriting||editingNoteId||event.target.closest('button,a,input,textarea,.vault-head,.vault-form,.vault-resize'))return;
 if(['rectangle','ellipse'].includes(mode)){
  event.preventDefault();event.stopImmediatePropagation();const owner=vaultScopeAtScreen(event.clientX,event.clientY);if(owner&&!vaults.get(owner)?.open)return;
  gesture={type:'shape',shape:mode,pointer:event.pointerId,start:screenToWorld(event.clientX,event.clientY),vaultId:owner,color:penColor.value,width:Number(drawWidthInput.value)/camera.scale};clipVaultPreview(owner);updateShapeGesture(event);viewport.setPointerCapture(event.pointerId);return;
 }
 if(mode!=='move'||!showStrokes||event.target.closest('.text-card,.canvas-writing'))return;
 const p=screenToWorld(event.clientX,event.clientY),point=[p.x,p.y],scope=vaultScopeAtScreen(event.clientX,event.clientY);
 if(showTexts&&(notePick(event.clientX,event.clientY)||[...writings.values()].some(a=>vaultContentVisible('writings',a.id)&&magicTouches('writings',a,point,point,0))))return;
 const hit=[...strokes.values()].reverse().find(a=>a.shape&&!a.locked&&vaultContentVisible('strokes',a.id)&&vaultOwner('strokes',a.id)===scope&&magicTouches('strokes',a,point,point));if(!hit||magicSelection.has(`strokes:${hit.id}`))return;
 event.preventDefault();event.stopImmediatePropagation();clearMagicSelection();magicSelection.set(`strokes:${hit.id}`,{kind:'strokes',id:hit.id});renderMagicLaser();
 if(event.ctrlKey||event.metaKey){startDuplicateDrag(event,[{kind:'strokes',id:hit.id}]);return;}
 const entry={kind:'strokes',id:hit.id,points:hit.points.map(p=>[...p])};gesture={type:'magic-move',pointer:event.pointerId,startX:event.clientX,startY:event.clientY,entries:[entry],movingKeys:new Set([`strokes:${hit.id}`]),dx:0,dy:0};viewport.setPointerCapture(event.pointerId);
},{capture:true});
window.addEventListener('blur',()=>{if(gesture?.type==='shape')endGesture({type:'pointercancel',pointerId:gesture.pointer});});
function gpuInteractive(item,card){return playingVideoId===item.id||gpuHoverId===item.id||cardPinned(card,item)||screenFrozen.has(`items:${item.id}`);}
window.addEventListener('apoxia-svg-error',event=>{const item=items.get(event.detail.id);if(item)toast(`${item.name}: ${event.detail.message}`);});
function gpuReady(item){return ['image','video'].includes(item?.type)&&item?.status==='ready';}
function gpuPick(x,y){if(!showMedia)return null;const p=screenToWorld(x,y);return ownedPhotoGPU.hit(p.x,p.y)||photoGPU.hit(p.x,p.y);}
function setGPUHover(id){if(gpuHoverId===id)return;const previous=gpuHoverId;gpuHoverId=id;for(const key of [previous,id]){const a=items.get(key),card=cards.get(key);if(a&&card){applyCardChrome(card,a);if(key!==id&&a.type==='video')unloadMedia(card);}}}
function syncGPUHover(event){if(noteHoverId){setGPUHover(null);return;}if(gesture||vaultDrag||!showMedia)return;const target=event.target;if(target.closest('button,a,textarea,.resize-handle,.vault-frame,.canvas-writing'))return;const hit=gpuPick(event.clientX,event.clientY);setGPUHover(hit&&!items.get(hit.id)?.locked?hit.id:null);}
viewport.addEventListener('pointermove',syncGPUHover,{capture:true});
viewport.addEventListener('pointerleave',()=>{if(!gesture)setGPUHover(null);});
viewport.addEventListener('pointerdown',event=>{if(rectangleSelectionHit(event)||gpuForwarding||gesture||mode==='draw'||mode==='erase'||mode==='write'||mode==='laser'||spaceHeld||zHeld||event.button!==0||event.target.closest('.video-card,.vault-frame,.canvas-writing,.resize-handle,textarea,button,a'))return;const hit=gpuPick(event.clientX,event.clientY);if(!hit||items.get(hit.id)?.locked)return;setGPUHover(hit.id);const card=cards.get(hit.id);if(!card?.isConnected)return;event.preventDefault();event.stopImmediatePropagation();gpuForwarding=true;try{card.querySelector('.video-frame').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:event.pointerId,pointerType:event.pointerType,button:event.button,buttons:event.buttons,clientX:event.clientX,clientY:event.clientY,isPrimary:event.isPrimary,ctrlKey:event.ctrlKey,metaKey:event.metaKey,shiftKey:event.shiftKey,altKey:event.altKey}));}finally{gpuForwarding=false;}},{capture:true});

function syncSolidPreview(card,item){
 if(!gpuReady(item))return false;
 card.classList.add('gpu-media');
 const proxy=!gpuInteractive(item,card);
 if(proxy){activeMediaCards.delete(item.id);if(!solidProxyCards.has(item.id)){solidProxyCards.add(item.id);observer.unobserve(card);card.remove();cancelImageUpgrade(item.id);parkedImageCache.delete(item.id);waitingPhotos.delete(item.id);const image=card.querySelector('img');image?.removeAttribute('src');}return true;}
 if(solidProxyCards.delete(item.id))cardRenderParent(item).append(card);
 activeMediaCards.add(item.id);
 return false;
}
function renderSolidPreviews(){
 if(gpuRenderFrame){cancelAnimationFrame(gpuRenderFrame);gpuRenderFrame=0;}
 if(gpuSceneDirty||gesture?.frozen?.length||screenFrozen.size||vaultDrag){
 gpuSceneDirty=false;
 const publicRecords=[],ownedRecords=[];
 if(showMedia)for(const [id,item]of items){if(!gpuReady(item)||!vaultContentVisible('items',id))continue;const owner=vaultOwner('items',id),vault=owner?vaults.get(owner):null;let clip=null;if(vault&&!freeVaultObjectPreview('items',item)&&!screenFrozen.has(`items:${id}`)){const box=vaultInterior(vault);clip={x:box.x,y:box.y,w:box.width,h:box.height};}
 const image=item.type==='image',missingThumbnail=item.originalMissing&&item.gpuOriginalOnly,full=missingThumbnail?privateMediaURL(`/media/${id}-thumb.webp`,id):privateMediaURL(image?(item.gpuOriginalOnly&&item.originalAvailable?`/original/${id}`:`/media/${id}.webp`):`/media/${id}.jpg`,id);
 const original=missingThumbnail?full:privateMediaURL(item.originalAvailable?`/original/${id}`:`/media/${id}.webp`,id);
 const browserOriginal=image&&(!item.originalAvailable||/\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(item.originalExt||''));
 const record={id,crop:item.crop||null,cropPreview:cropPreviewId===id,svg:item.type==='image'&&item.originalExt==='.svg'&&!item.originalMissing,type:item.type,x:item.x,y:item.y,w:item.displayWidth||320,h:item.displayHeight||180,rank:gpuRanks.get(id)||0,clip,thumbURL:privateMediaURL(image?`/media/${id}-thumb.webp`:`/media/${id}.jpg`,id),detailURL:full,originalURL:browserOriginal?original:full,originalWidth:browserOriginal?(item.originalWidth||item.width):item.width,originalHeight:browserOriginal?(item.originalHeight||item.height):item.height,originalOnly:Boolean(item.gpuOriginalOnly),originalMissing:Boolean(item.originalMissing)};
 if(gesture?.id===id&&['card','resize'].includes(gesture.type))record.rank=Number.MAX_SAFE_INTEGER;
 (owner?ownedRecords:publicRecords).push(record);
 }
 photoGPU.sync(publicRecords);ownedPhotoGPU.sync(ownedRecords);}
 photoGPU.render(camera);ownedPhotoGPU.render(camera);renderMissingMediaWarnings();syncCropPreview();
}
const missingMediaWarnings=new Map();
function renderMissingMediaWarnings(){
 const visible=new Set(),a=screenToWorld(0,0),b=screenToWorld(innerWidth,innerHeight);
 if(showMedia)for(const record of [...photoGPU.index.query(a.x,a.y,b.x-a.x,b.y-a.y),...ownedPhotoGPU.index.query(a.x,a.y,b.x-a.x,b.y-a.y)]){
  const item=items.get(record.id);if(!item?.originalMissing||!vaultContentVisible('items',item.id)||item.displayWidth*camera.scale<40||item.displayHeight*camera.scale<30)continue;
  if(record.clip&&(item.x<record.clip.x||item.y<record.clip.y))continue;
  const x=camera.x+item.x*camera.scale,y=camera.y+item.y*camera.scale;if(x<0||y<0||x>innerWidth-20||y>innerHeight-20)continue;
  visible.add(item.id);let badge=missingMediaWarnings.get(item.id);
  if(!badge){badge=document.createElement('span');badge.className='missing-media-warning';badge.textContent='⚠';badge.title='Original desaparecido. Se muestra la copia de baja calidad.';badge.setAttribute('aria-label',badge.title);document.body.append(badge);missingMediaWarnings.set(item.id,badge);}
  badge.style.transform=`translate(${x+4}px,${y+4}px)`;
 }
 for(const [id,badge]of missingMediaWarnings)if(!visible.has(id)){badge.remove();missingMediaWarnings.delete(id);}
}
function updateImageSources(){requestGPU();}
function zoomAt(factor, x = innerWidth / 2, y = innerHeight / 2) {
  if (inverseZoomSaving || (gesture?.type === 'pan' && gesture.frozen?.length)) return;
  const before = screenToWorld(x, y);
  camera.scale = Math.min(maxZoom, Math.max(minZoom, camera.scale * factor));
  camera.x = x - before.x * camera.scale;
  camera.y = y - before.y * camera.scale;
  scheduleCameraRender();
}
function fitAll() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (left, top, right, bottom) => {
    minX = Math.min(minX, left); minY = Math.min(minY, top);
    maxX = Math.max(maxX, right); maxY = Math.max(maxY, bottom);
  };
  for (const vault of vaults.values()) include(vault.x, vault.y, vault.x + vault.width, vault.y + vault.height);
  for (const item of items.values()) {
    if (!vaultContentVisible('items', item.id)) continue;
    const width = item.displayWidth || 320;
    const height = item.displayHeight || 180;
    include(item.x, item.y, item.x + width, item.y + height);
  }
  if (showStrokes) for (const [id, stroke] of strokes) {
    if (!vaultContentVisible('strokes', id)) continue;
    const bounds = strokeWorldBounds(id);
    if (bounds) {
      const halfWidth = stroke.width / 2;
      include(bounds.minX - halfWidth, bounds.minY - halfWidth, bounds.maxX + halfWidth, bounds.maxY + halfWidth);
    }
  }
  for (const writing of writings.values()) {
    if (!vaultContentVisible('writings', writing.id)) continue;
    const width = writingWidth(writing) * writing.size / 48;
    const height = writing.text.split('\n').length * writing.size * 1.35;
    include(writing.x, writing.y - writing.size, writing.x + width, writing.y + height);
  }
  if (!Number.isFinite(minX)) return resetView();
  const margin = 72;
  const availableWidth = Math.max(1, innerWidth - margin * 2);
  const availableHeight = Math.max(1, innerHeight - margin * 2 - 72);
  const extentX = Math.max(maxX - minX, 1e-9);
  const extentY = Math.max(maxY - minY, 1e-9);
  camera.scale = Math.min(maxZoom, Math.max(minZoom, Math.min(availableWidth / extentX, availableHeight / extentY)));
  camera.x = innerWidth / 2 - (minX + maxX) / 2 * camera.scale;
  camera.y = innerHeight / 2 - (minY + maxY) / 2 * camera.scale;
  renderCamera();
}
function resetView() {
  camera.scale = 1;
  camera.x = innerWidth / 2;
  camera.y = innerHeight / 2;
  renderCamera();
}
function saveCanvasView(slot) {
  // Store the world point at the center so a resized window keeps the same view.
  const center = screenToWorld(innerWidth / 2, innerHeight / 2);
  savedViews[slot] = { x: center.x, y: center.y, scale: camera.scale };
  try {
    localStorage.setItem('apoxiaSketchBook.views', JSON.stringify(savedViews));
    toast(i18n.t(`Vista ${slot} guardada`));
  } catch { toast(i18n.t(`Vista ${slot} guardada para esta sesión`)); }
}
function restoreCanvasView(slot) {
  const view = savedViews[slot];
  if (!view) return toast(i18n.t(`Vista ${slot} sin guardar · Espacio + ${slot} para guardarla`));
  camera.scale = view.scale;
  camera.x = innerWidth / 2 - view.x * view.scale;
  camera.y = innerHeight / 2 - view.y * view.scale;
  renderCamera();
}
let temporaryDrawLaser=false;
function setMode(next, toggle = true, preserveMagicSelection = false) {
  if (magicSaving || inverseZoomSaving) return;
  mode = toggle && mode === next ? 'move' : next;
  if (mode === 'draw' || mode === 'erase' || mode === 'pan') { hoveredWriting = null; selectedWriting = null; writingControls.hidden = true; }
  if (['draw','erase','rectangle','ellipse'].includes(mode) && !showStrokes) setStrokesVisible(true);
  if (mode !== 'laser' && mode !== 'pan' && !preserveMagicSelection) clearMagicSelection();
  viewport.dataset.mode = mode;
  for (const [id, name] of [['drawButton', 'draw'], ['eraseButton', 'erase'], ['laserButton', 'laser'], ['writeButton', 'write'], ['rectangleButton','rectangle']]) document.getElementById(id).setAttribute('aria-pressed', String(mode === name));
  document.querySelector('#eraserSizeControl').hidden = mode !== 'erase';
  document.querySelector('#drawSizeControl').hidden = !['rectangle','ellipse'].includes(mode);
  eraserCursor.hidden = mode !== 'erase';
  help.textContent = ['rectangle','ellipse'].includes(mode) ? i18n.t('Arrastra para crear una forma · Shift: proporción fija · Esc: cancelar') : mode === 'laser' ? i18n.t('Magic Laser · pinta para seleccionar · arrastra la selección · Esc: soltar') : mode === 'draw' ? i18n.t('Dibuja sobre el fondo · Ctrl+Z: deshacer · Esc: terminar') : mode === 'erase' ? i18n.t('Arrastra la goma · Ctrl+Z: deshacer · Esc: terminar') : mode === 'write' ? i18n.t('Haz clic para escribir · Doble clic: editar · Supr: borrar · Ctrl+Z: deshacer') : i18n.t('Arrastra el fondo: seleccionar · Espacio: mover · E: dibujar · D: borrar · H: encuadrar · Z: zoom · Ctrl+Z: deshacer');
  renderWritings();
  scheduleVideoHover();
  scheduleConnectionRender();
  fileHover=null; renderFileGlow();
}
function activateDrawLaser() {
  if(mode!=='draw' || spaceHeld || zHeld || gesture || magicSaving || inverseZoomSaving) return;
  temporaryDrawLaser=true;
  setMode('laser',false);
}
function releaseDrawLaser() {
  if(!temporaryDrawLaser) return;
  // Keep the laser available for dragging its selection until a background click.
  updateMagicCursor();
}
function releaseSpacePan() {
  spaceHeld = false;
  const previous = modeBeforeSpace;
  modeBeforeSpace = null;
  if (previous !== null && mode === 'pan') setMode(previous, false);
}
function setStrokesVisible(visible) {
  showStrokes = visible;
  drawingLayer.toggleAttribute('hidden', !visible);
  ownedDrawingLayer.hidden = !visible;
  drawingLayer.setAttribute('aria-hidden', String(!visible));
  document.querySelector('#toggleStrokes').setAttribute('aria-pressed', String(visible));
  if (visible) redrawStrokes();
  else if (mode === 'draw' || mode === 'erase') setMode(mode);
}
async function setTextsVisible(visible) {
  if (!visible) {
    await finishWritingEdit(true);
    const active = document.activeElement;
    if (active?.matches('.text-editor')) active.blur();
    selectedWriting = null; hoveredWriting = null;
    writingControls.hidden = true;
    if (mode === 'write') setMode('move', false);
  }
  showTexts = visible;
  textLayer.hidden = !visible;
  ownedTextLayer.hidden = !visible;
  ownedWritingLayer.toggleAttribute('hidden', !visible);
  ownedWritingDetail.hidden = !visible;
  writingLayer.toggleAttribute('hidden', !visible);
  writingDetail.toggleAttribute('hidden', !visible);
  document.querySelector('#toggleTexts').setAttribute('aria-pressed', String(visible));
  refreshVaultVisibility();
}
function setMediaVisible(visible) {
  gpuSceneDirty=true;
  showMedia = visible;
  ownedMediaLayer.hidden = !visible;
  document.querySelector('#toggleMedia').setAttribute('aria-pressed', String(visible));
  if (!visible) for (const [id, card] of cards) {
    if (items.get(id)?.type === 'text') continue;
    unloadMedia(card,true);
    const image = card.querySelector('.video-frame img');
    if (image) { image.dataset.variant = 'hidden'; image.removeAttribute('src'); }
  }
  refreshVaultVisibility();
  if (visible) updateImageSources();
}
function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function formatSize(bytes) { return bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : ''; }
function updateCount() {
  const referenceCount = items.size;
  const strokeCount = strokes.size;
  document.querySelector('#count').textContent = i18n.t(`${referenceCount} referencia${referenceCount === 1 ? '' : 's'}`);
  document.querySelector('#strokeCount').textContent = i18n.t(`${strokeCount} trazo${strokeCount === 1 ? '' : 's'}`);
  clearButton.disabled = referenceCount + strokeCount + writings.size + vaults.size === 0 || clearBusy || document.body.classList.contains('server-outdated');
}
function resetClearSlide() {
  clearSlide = null;
  clearThumb.style.setProperty('--slide-x', '0px');
  clearThumb.setAttribute('aria-valuenow', '0');
  clearTrack.querySelector('span').textContent = clearTargetVaultId ? i18n.t('Desliza para borrar la Vault →') : i18n.t('Desliza para borrar todo →');
}
async function requestDeleteVault(vault) {
  if (vaultBusy || clearBusy || gesture || vaultDrag || canvasActions || vault.closing) return;
  await finishWritingEdit(true);
  document.activeElement?.blur();
  await vaultSyncChain;
  const state = (await apiChange('/api/vaults', 'GET')).find(entry => entry.id === vault.id);
  if (!state || vaultBusy || clearBusy || gesture || vaultDrag) return;
  Object.assign(vault, state);
  clearTargetVaultId = vault.id;
  clearVaultDeleteMode = vault.open ? 'release' : 'discard';
  const occupied = vault.hasContents;
  if (!occupied) { await confirmDeleteVault(vault.id); return; }
  document.querySelector('#clearTitle').textContent = i18n.t('Borrar Vault');
  document.querySelector('#clearDescription').textContent = vault.open ? i18n.t('Se borrará solo la caja. Su contenido permanecerá en el canvas y sus archivos se guardarán sin cifrar.') : i18n.t('Se borrarán esta Vault y todo su contenido, incluidos sus archivos originales.');
  document.querySelector('#clearSummary').textContent = vault.open ? i18n.t('Los elementos dejarán de estar protegidos por la Vault.') : i18n.t('Esta acción es definitiva y no se puede deshacer.');
  clearThumb.setAttribute('aria-label', vault.open ? i18n.t('Desliza hasta el final para borrar solo la caja') : i18n.t('Desliza hasta el final para borrar la Vault y su contenido'));
  resetClearSlide(); clearDialog.showModal();
}
async function confirmDeleteVault(id) {
  if (clearBusy || vaultBusy) return;
  const vault = vaults.get(id);
  if (!vault) { clearDialog.close(); clearTargetVaultId = null; return; }
  clearBusy = true; vaultBusy = true;
  clearThumb.disabled = true; document.querySelector('#cancelClear').disabled = true;
  const action = clearVaultDeleteMode || (vault.open ? 'release' : 'discard');
  clearTrack.querySelector('span').textContent = action === 'release' ? i18n.t('Liberando contenido…') : i18n.t('Borrando…');
  try {
    await vaultSyncChain;
    const result = await apiChange(`/api/vaults/${id}`, 'DELETE', { confirm: 'BORRAR VAULT', action });
    if (!result.preserved) purgeVaultMemory(vault);
    const nodes = vaultNodes.get(id); nodes?.frame.remove(); nodes?.back.remove();
    vaults.delete(id); vaultNodes.delete(id); rebuildVaultOwners();
    if (result.preserved) for (const itemId of vault.members.items) {
      const item = items.get(itemId); if (item) updateCard(item);
    }
    forgetHistory(); refreshVaultVisibility(); updateImageSources(); updateCount();
    if (clearDialog.open) clearDialog.close();
    else { clearTargetVaultId = null; resetClearSlide(); }
    toast(result.cleanupPending ? i18n.t('Vault borrada; limpieza de archivos pendiente') : result.preserved ? i18n.t('Caja borrada; contenido conservado sin cifrar') : i18n.t('Vault y contenido borrados'));
  } catch (error) { resetClearSlide(); toast(error.message); }
  finally {
    clearBusy = false; vaultBusy = false;
    clearThumb.disabled = false; document.querySelector('#cancelClear').disabled = false;
    if (!clearDialog.open) { clearTargetVaultId = null; clearVaultDeleteMode = null; }
    updateCount();
  }
}
function moveClearThumb(x, max) {
  clearThumb.style.setProperty('--slide-x', `${x}px`);
  clearThumb.setAttribute('aria-valuenow', String(max ? Math.round(x / max * 100) : 0));
}
function clearBoardUI() {
  clearStrokeTileCache();
  screenFrozen.clear(); screenFrozenLayer.replaceChildren(); lastSelectedItem=null;
  publicConnectionLayer.replaceChildren(); privateConnectionLayer.replaceChildren(); connectorVisual.replaceChildren();
  inversePinnedTargets=null;
  clearMagicSelection();
  noteHint.hidden = true;
  videoPreviews.clear();
  for (const card of cards.values()) { observer.unobserve(card); card.remove(); }
  for (const timer of textTimers.values()) clearTimeout(timer);
  vaults.clear(); vaultOwners.clear(); vaultNodes.clear(); vaultLayer.replaceChildren(); vaultBackdrop.replaceChildren();
  for (const id of imageUpgradeRequests.keys()) cancelImageUpgrade(id);
  parkedCards.clear(); waitingPhotos.clear(); parkedImageCache.clear();
  pendingDraws.clear();
  noteProxyCards.clear(); noteTextLayouts.clear();activeNoteCards.clear();noteHoverId=null;noteGPU.reset();ownedNoteGPU.reset();noteGPUSceneDirty=true;
  solidProxyCards.clear(); solidProxyColors.clear();
  photoGPU.reset();ownedPhotoGPU.reset();gpuRanks.clear();activeMediaCards.clear();gpuConnectionSources.clear();gpuUIIds.clear();gpuHoverId=null;gpuSceneDirty=true;
  cards.clear(); pendingVaultImports.clear(); items.clear(); strokes.clear(); writings.clear(); writingNodes.clear(); writingLayer.replaceChildren(); ownedWritingLayer.replaceChildren(); writingEditor.hidden = true; writingControls.hidden = true; editingWriting = null; selectedWriting = null; hoveredWriting = null; clearTimeout(writingHoverTimer); strokeBounds.clear(); strokeChunks.clear(); strokeSpaces.clear(); pendingErase.clear(); originalFiles.clear(); originalFetches.clear(); textTimers.clear(); colorWrites.clear();
  preview.replaceChildren();
  undoStack.length = 0; redoStack.length = 0;
  paintedCamera = null;
  setMode('move');
  setStrokesVisible(true);
  resetView(); updateCount();
}
async function confirmClearBoard() {
  if (clearTargetVaultId) return confirmDeleteVault(clearTargetVaultId);
  if (clearBusy) return;
  clearBusy = true;
  clearButton.disabled = true;
  clearThumb.disabled = true;
  document.querySelector('#cancelClear').disabled = true;
  clearTrack.querySelector('span').textContent = i18n.t('Borrando…');
  try {
    const response = await fetch('/api/board', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'BORRAR TODO' }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo borrar el canvas');
    clearBoardUI();
    clearDialog.close();
    toast(i18n.t('Canvas borrado'));
  } catch (error) { resetClearSlide(); toast(error.message); }
  finally {
    clearBusy = false;
    clearThumb.disabled = false;
    document.querySelector('#cancelClear').disabled = false;
    updateCount();
  }
}
async function patchItem(id, changes, keepalive = false) {
  const response = await fetch(`/api/items/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes), keepalive });
  if (!response.ok) throw new Error(i18n.t('No se pudo guardar el cambio'));
}
function remember(action) {
  if (historyBusy) return;
  undoStack.push(action);
  if (undoStack.length > 50) undoStack.shift();
  redoStack.length = 0;
}
function forgetHistory() { historyEpoch++; undoStack.length = 0; redoStack.length = 0; }
async function apiChange(url, method, body) {
  const response = await fetch(url, { method, headers: { 'X-Apoxia-Protocol': '16', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || 'No se pudo cambiar el canvas');
  }
  return response.json();
}
async function applyItemChanges(id, changes) {
  await patchItem(id, changes);
  const item = items.get(id);
  if (item) { Object.assign(item, changes); updateCard(item); }
}
async function restoreObjectMembership(kind, id, ownerId) {
  if (ownerId && !vaults.get(ownerId)?.open) throw new Error(i18n.t('Abre la Vault para recuperar este movimiento'));
  const previous = vaultOwner(kind, id);
  if (previous === ownerId) return;
  for (const vault of vaults.values()) if (vault.open) {
    vault.members[kind] = vault.members[kind].filter(member => member !== id);
    if (vault.id === ownerId) vault.members[kind].push(id);
  }
  rebuildVaultOwners();
  await saveVaultMembership();
  const object = (kind === 'items' ? items : writings).get(id);
  if (kind === 'items' && object) updateCard(object);
  refreshVaultVisibility();
}
function restoreCreatedMembership(kind, snapshot) {
  const vault = snapshot.vaultId && vaults.get(snapshot.vaultId);
  if (vault?.open && !vault.members[kind].includes(snapshot.id)) {
    vault.members[kind].push(snapshot.id); rebuildVaultOwners();
  }
}
function rememberItemChange(id, before, after, label, ownership = null) {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  remember({ label,
    undo: async () => { await applyItemChanges(id, before); if (ownership) await restoreObjectMembership('items', id, ownership.before); },
    redo: async () => { await applyItemChanges(id, after); if (ownership) await restoreObjectMembership('items', id, ownership.after); }
  });
}
async function setNotePresent(snapshot, present) {
  if (present) {
    const item = await apiChange('/api/text/restore', 'POST', snapshot);
    restoreCreatedMembership('items', snapshot);
    items.set(item.id, item); updateCard(item); updateCount();
  } else {
    await apiChange(`/api/items/${snapshot.id}`, 'DELETE');
    removeCard(snapshot.id);
  }
}
async function setMediaPresent(snapshot, present) {
  if (present) {
    const item = await apiChange('/api/items/restore', 'POST', { id: snapshot.id, vaultId: snapshot.vaultId });
    restoreCreatedMembership('items', snapshot);
    items.set(item.id, item); updateCard(item); updateCount();
  } else {
    await apiChange(`/api/items/${snapshot.id}`, 'DELETE');
    removeCard(snapshot.id);
  }
}
async function setStrokePresent(snapshot, present) {
  if (present) {
    const { vaultId, ...data } = snapshot;
    const stroke = await apiChange('/api/strokes/restore', 'POST', { ...data, vaultId });
    if (vaultId && vaults.get(vaultId)?.open && !vaults.get(vaultId).members.strokes.includes(stroke.id)) {
      vaults.get(vaultId).members.strokes.push(stroke.id); rebuildVaultOwners(); await saveVaultMembership();
    }
    addStroke(stroke);
  } else {
    await apiChange(`/api/strokes/${snapshot.id}`, 'DELETE');
    strokes.delete(snapshot.id); strokeBounds.delete(snapshot.id); strokeChunks.delete(snapshot.id);
    redrawStrokes(); updateCount();
  }
}
async function setStrokesPresent(snapshots, present) {
  if (!snapshots.length) return;
  if (present) {
    const restored = await apiChange('/api/strokes/restore-batch', 'POST', { strokes: snapshots });
    for (const snapshot of snapshots) {
      const vault = snapshot.vaultId && vaults.get(snapshot.vaultId);
      if (vault?.open && !vault.members.strokes.includes(snapshot.id)) vault.members.strokes.push(snapshot.id);
    }
    rebuildVaultOwners();
    for (const stroke of restored) addStroke(stroke, true);
  } else {
    await apiChange('/api/strokes/delete-batch', 'POST', { ids: snapshots.map(stroke => stroke.id) });
    for (const { id } of snapshots) {
      strokes.delete(id); strokeBounds.delete(id); strokeChunks.delete(id); strokeSpaces.delete(id);
    }
  }
  redrawStrokes(); updateCount();
}
async function setWritingPresent(snapshot, present) {
  if (present) {
    const writing = await apiChange('/api/writings/restore', 'POST', snapshot);
    restoreCreatedMembership('writings', snapshot);
    writings.set(writing.id, writing); renderWritings(); updateCount();
  } else {
    await apiChange(`/api/writings/${snapshot.id}`, 'DELETE');
    writings.delete(snapshot.id); writingNodes.get(snapshot.id)?.remove(); writingNodes.delete(snapshot.id);
    if (selectedWriting === snapshot.id) selectedWriting = null;
    if (hoveredWriting === snapshot.id) { hoveredWriting = null; writingControls.hidden = true; }
    renderWritings(); updateCount();
  }
}
async function applyWritingChanges(id, changes) {
  await apiChange(`/api/writings/${id}`, 'PATCH', changes);
  const writing = writings.get(id);
  if (writing) { Object.assign(writing, changes); renderWritings(); }
}
function rememberWritingChange(id, before, after, label, ownership = null) {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  remember({ label,
    undo: async () => { await applyWritingChanges(id, before); if (ownership) await restoreObjectMembership('writings', id, ownership.before); },
    redo: async () => { await applyWritingChanges(id, after); if (ownership) await restoreObjectMembership('writings', id, ownership.after); }
  });
}
async function travelHistory(redo = false) {
  if (historyBusy || clearBusy || gesture || clearDialog.open || vaultBusy || vaultDrag || inverseZoomSaving) return;
  const source = redo ? redoStack : undoStack;
  const destination = redo ? undoStack : redoStack;
  const action = source.at(-1);
  if (!action) return toast(redo ? i18n.t('Nada que rehacer') : i18n.t('Nada que deshacer'));
  historyBusy = true;
  try {
    await (redo ? action.redo() : action.undo());
    source.pop(); destination.push(action);
    toast(`${redo ? i18n.t('Rehecho') : i18n.t('Deshecho')}: ${i18n.t(action.label)}`);
  } catch (error) { toast(error.message); }
  finally { historyBusy = false; reconcileVaults().catch(error => toast(error.message)); }
}
function ensureMedia(card) {
  if (!showMedia || !vaultContentVisible('items', card.dataset.id)) return;
  const video = card.querySelector('video');
  if (video && card.dataset.loaded !== 'true') {
    video.src = privateMediaURL(items.get(card.dataset.id)?.nativeVideo?`/original/${card.dataset.id}`:`/media/${card.dataset.id}.mp4`, card.dataset.id);
    card.dataset.loaded = 'true';
  }
}
function unloadMedia(card,force=false) {
  if(!force && playingVideoId===card.dataset.id)return;
  const video = card.querySelector('video');
  if (!video) return;
  video.pause();
  video.removeAttribute('src');
  video.load();
  card.dataset.loaded = 'false';
  card.querySelector('.video-frame')?.classList.remove('playing');
}
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const card = entry.target;
    if (entry.isIntersecting) ensureMedia(card);
    else if (card.dataset.loaded === 'true') unloadMedia(card);
  }
}, { root: viewport, rootMargin: '300px' });
function makeHandles(card, id) {
  const directions=['n','ne','e','se','s','sw','w','nw'];
  for (const direction of directions) {
    const handle = document.createElement('div');
    handle.className = `resize-handle resize-${direction}`;
    handle.dataset.direction = direction;
    handle.title = items.get(id)?.type==='text'?i18n.t('Arrastra para cambiar el tamaño · Alt: escalar toda la nota'):i18n.t('Arrastra para cambiar el tamaño');
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      const item = items.get(id);
      if (!item || item.locked) return;
      gesture = { type: 'resize', id, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: item.x, y: item.y, width: item.displayWidth || 320, height: item.displayHeight || 180, direction, proportional: event.altKey };
      if (item.type === 'text') {
        const base = Number.isFinite(item.chromeScale) && item.chromeScale > 0 ? item.chromeScale : 1;
        gesture.noteStyleBefore = { chromeScale: base, textFontSize: item.textFontSize || 17 * base };
        const unit = noteLayoutUnit(item);
        gesture.noteStyle = { chromeScale: unit, textFontSize: gesture.noteStyleBefore.textFontSize * unit / base };
      }
      viewport.setPointerCapture(event.pointerId);
    });
    card.append(handle);
  }
}
function updateMediaCornerHint(card, x, y) {
  if (card.classList.contains('media-huge') || items.get(card.dataset.id)?.locked) { delete card.dataset.nearCorner; return; }
  const frame = card.querySelector('.video-frame').getBoundingClientRect();
  const margin = card.dataset.nearCorner ? 12 : 0;
  if (frame.width < 60 || frame.height < 40 || x < frame.left - margin || x > frame.right + margin || y < frame.top - margin || y > frame.bottom + margin) {
    delete card.dataset.nearCorner;
    return;
  }
  const horizontal = x < frame.left + frame.width * .25 ? 'w' : x > frame.right - frame.width * .25 ? 'e' : '';
  const vertical = y < frame.top + frame.height * .25 ? 'n' : y > frame.bottom - frame.height * .25 ? 's' : '';
  if (horizontal && vertical) card.dataset.nearCorner = vertical + horizontal;
  else delete card.dataset.nearCorner;
}
// Align text in nearby notes, using the existing spatial indexes rather than the whole board.
function magneticNoteX(item,x,y,state,disabled=false){
 if(item.type!=='text'||disabled){state.noteSnapId=null;return x;}
 const scale=camera.scale,padding=16*noteLayoutUnit(item),left=x+padding,height=item.displayHeight||160;
 const reach=96/scale,acquire=8/scale,release=14/scale,owner=vaultOwner('items',item.id);
 const candidates=[...noteGPU.index.query(left-release,y-reach,release*2,height+reach*2),...ownedNoteGPU.index.query(left-release,y-reach,release*2,height+reach*2)];
 let best=null,bestDistance=Infinity;
 for(const model of candidates){const other=items.get(model.id);if(!other||other.id===item.id||other.type!=='text'||vaultOwner('items',other.id)!==owner||!vaultContentVisible('items',other.id))continue;
  const gap=Math.max(0,other.y-(y+height),y-(other.y+(other.displayHeight||160)));if(gap>reach)continue;
  const aligned=other.x+16*noteLayoutUnit(other)-padding,distance=Math.abs(aligned-x),limit=state.noteSnapId===other.id?release:acquire;
  if(distance<=limit&&distance<bestDistance){best={id:other.id,x:aligned};bestDistance=distance;}
 }
 state.noteSnapId=best?.id||null;return best?best.x:x;
}
let objectClipboard=[],duplicationBusy=false;
function copyTargetUnderPointer(){
 if(!pointerOnPage)return null;
 const node=document.elementFromPoint(pointerPosition.x,pointerPosition.y);
 if(!node||!viewport.contains(node))return null;
 const card=node.closest('.video-card'),writingNode=node.closest('.canvas-writing');
 let hit=card?{kind:'items',id:card.dataset.id}:writingNode?{kind:'writings',id:writingNode.dataset.id}:null;
 if(!hit){
  const point=screenToWorld(pointerPosition.x,pointerPosition.y);
  if(showTexts){const note=ownedNoteGPU.hit(point.x,point.y)||noteGPU.hit(point.x,point.y);if(note)hit={kind:'items',id:note.id};}
  if(!hit){const media=gpuPick(pointerPosition.x,pointerPosition.y);if(media)hit={kind:'items',id:media.id};}
  if(!hit&&showTexts)for(const writing of [...writings.values()].reverse())if(vaultContentVisible('writings',writing.id)&&magicTouches('writings',writing,[point.x,point.y],[point.x,point.y],0)){hit={kind:'writings',id:writing.id};break;}
 }
 return hit&&magicMap(hit.kind).has(hit.id)&&vaultContentVisible(hit.kind,hit.id)?hit:null;
}
function copyableEntries(){
 const selected=[...magicSelection.values()].filter(entry=>['items','writings'].includes(entry.kind)&&magicMap(entry.kind).has(entry.id)&&vaultContentVisible(entry.kind,entry.id));
 const hovered=copyTargetUnderPointer();
 if(hovered){
  if(selected.some(entry=>entry.kind===hovered.kind&&entry.id===hovered.id))return selected;
  return [hovered];
 }
 if(selected.length)return selected;
 if(selectedWriting&&writings.has(selectedWriting)&&vaultContentVisible('writings',selectedWriting))return [{kind:'writings',id:selectedWriting}];
 if(lastSelectedItem&&items.has(lastSelectedItem)&&vaultContentVisible('items',lastSelectedItem))return [{kind:'items',id:lastSelectedItem}];
 return [];
}
async function clipboardImagePNG(item){
 const epoch=privateMemoryEpoch;
 const ensureAccessible=()=>{if(epoch!==privateMemoryEpoch||!items.has(item.id)||!vaultContentVisible('items',item.id))throw Error('La imagen ya no está disponible');};
 ensureAccessible();
 const response=await fetch(privateMediaURL(item.originalAvailable&&!item.originalMissing?`/original/${item.id}`:`/media/${item.id}.webp`,item.id));
 if(!response.ok)throw Error('No se pudo leer la imagen');
 let blob=await response.blob();ensureAccessible();
 if(blob.type==='image/png'&&!item.crop)return blob;
 // Chromium may not decode an original HEIC/TIFF; use its existing preview.
 async function convert(source){
  const url=URL.createObjectURL(source),image=new Image();
  try{
   image.src=url;await image.decode();ensureAccessible();
   const c=item.crop||ApoxiaCrop.full,sx=Math.round(c.x*image.naturalWidth),sy=Math.round(c.y*image.naturalHeight),sw=Math.max(1,Math.round((c.x+c.width)*image.naturalWidth)-sx),sh=Math.max(1,Math.round((c.y+c.height)*image.naturalHeight)-sy);
   const canvas=document.createElement('canvas');canvas.width=sw;canvas.height=sh;
   const context=canvas.getContext('2d');if(!context)throw Error('No se pudo preparar la imagen');context.drawImage(image,sx,sy,sw,sh,0,0,sw,sh);
   const png=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('No se pudo preparar la imagen')),'image/png'));ensureAccessible();return png;
  }finally{image.removeAttribute('src');URL.revokeObjectURL(url);}
 }
 try{return await convert(blob);}catch(error){
  ensureAccessible();
  if(!item.originalAvailable||item.gpuOriginalOnly)throw error;
  const preview=await fetch(privateMediaURL(`/media/${item.id}.webp`,item.id));if(!preview.ok)throw error;
  return await convert(await preview.blob());
 }
}
let systemCopySequence=0, copiedImageSignature=null, systemClipboardWrite=Promise.resolve();
async function imageClipboardSignature(blob){
 const bitmap=await createImageBitmap(await blob);
 try{
  const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
  const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);
  const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',pixels));
  return `${canvas.width}x${canvas.height}:`+[...digest].map(b=>b.toString(16).padStart(2,'0')).join('');
 }finally{bitmap.close();}
}
async function readClipboardImage(){
 if(window.apoxiaDesktop?.readClipboardImage){
  const image=await window.apoxiaDesktop.readClipboardImage();
  return image?new Blob([image.bytes],{type:image.type}):null;
 }
 const entries=await navigator.clipboard.read();
 for(const entry of entries){const type=entry.types.find(t=>t==='image/png')||entry.types.find(t=>t.startsWith('image/'));if(type)return await entry.getType(type);}
 return null;
}
let canvasPasteBusy=false;
async function pasteClipboardOnCanvas(){
 if(canvasPasteBusy||gesture||duplicationBusy||vaultBusy||vaultDrag||historyBusy||canvasActions||canvasTransferBusy||editingText(document.activeElement)||document.querySelector('dialog[open]'))return;
 const target=pointerOnPage&&document.elementFromPoint(pointerPosition.x,pointerPosition.y);
 if(!target||!viewport.contains(target)||target.closest('button,a,input,textarea,select,[contenteditable="true"]'))return;
 const position={...pointerPosition},epoch=privateMemoryEpoch;
 canvasPasteBusy=true;
 try{
  await systemClipboardWrite.catch(()=>{});
  let image=null;
  try{image=await readClipboardImage();}catch(error){if(!objectClipboard.length)throw error;}
  if(epoch!==privateMemoryEpoch)return;
  // Internal copies retain their crop, size and group properties. An image copied
  // elsewhere takes priority over a stale internal object clipboard.
  const internal=image&&copiedImageSignature&&await imageClipboardSignature(image)===await copiedImageSignature;
  if(image&&!internal){
   const ext=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg'})[image.type]||'png';
   await addFiles([new File([image],`clipboard-${Date.now()}.${ext}`,{type:image.type})],position.x,position.y,{copyMedia:true});
  }else if(objectClipboard.length)await pasteCanvasObjects(position);
 }catch(error){toast(error.message);}finally{canvasPasteBusy=false;}
}
async function copyCanvasObjects(entries=copyableEntries()){
 objectClipboard=entries.map(entry=>({...entry,vaultId:vaultOwner(entry.kind,entry.id),snapshot:{...structuredClone(magicMap(entry.kind).get(entry.id)),...(entry.kind==='items'&&items.get(entry.id)?.type==='image'?{crop:structuredClone(items.get(entry.id).crop||null)}:{})}}));
 if(!objectClipboard.length)return;
 copiedImageSignature=null;
 const sequence=++systemCopySequence,copied=objectClipboard;
 try{
  if(copied.every(entry=>entry.kind==='writings'||entry.snapshot.type==='text')){
   systemClipboardWrite=navigator.clipboard.writeText(copied.map(entry=>entry.snapshot.text||'').join('\n\n'));
   await systemClipboardWrite;
   if(sequence===systemCopySequence)toast(i18n.t('Texto copiado al portapapeles'));
  }else if(copied.length===1&&copied[0].snapshot.type==='image'){
   // Start the write during the keyboard gesture; decoding resolves its PNG promise.
   const png=clipboardImagePNG(copied[0].snapshot);png.catch(()=>{});
   copiedImageSignature=imageClipboardSignature(png).catch(()=>null);
   systemClipboardWrite=navigator.clipboard.write([new ClipboardItem({'image/png':png})]);
   await systemClipboardWrite;
   if(sequence===systemCopySequence)toast(i18n.t('Imagen copiada al portapapeles'));
  }else if(sequence===systemCopySequence)toast(copied.length===1?'Objeto copiado':`${copied.length} objetos copiados`);
 }catch(error){if(sequence===systemCopySequence)toast(i18n.t('Copiado dentro del lienzo. No se pudo copiar al portapapeles del sistema.'));}
}

// Electron's Edit menu emits native clipboard events instead of keydown shortcuts.
document.addEventListener('copy',event=>{
 if(event.defaultPrevented||editingText(event.target)||clearDialog.open||noteReader.open)return;
 const entries=copyableEntries();if(!entries.length)return;
 event.preventDefault();copyCanvasObjects(entries);
});
// Only explicit paste commands import or duplicate objects; unsolicited native
// paste events and middle clicks must never modify the canvas.
window.apoxiaDesktop?.onPasteCommand?.(()=>{
 if(editingText(document.activeElement)||clearDialog.open||noteReader.open){
  window.apoxiaDesktop.pasteNative().catch(error=>toast(error.message));return;
 }
 pasteClipboardOnCanvas();
});

async function duplicateCanvasObjects(entries,dx=0,dy=0){
 const result=await apiChange('/api/duplicate','POST',{objects:entries,dx,dy});
 for(const entry of result.objects){restoreCreatedMembership(entry.kind,{id:entry.object.id,vaultId:entry.vaultId});if(entry.kind==='strokes')addStroke(entry.object,true);else magicMap(entry.kind).set(entry.object.id,entry.object);if(entry.kind==='items')updateCard(entry.object);}
 if(result.objects.some(entry=>entry.kind==='strokes'))redrawStrokes();
 clearMagicSelection();rectangleSelection=true;
 for(const entry of result.objects)magicSelection.set(`${entry.kind}:${entry.object.id}`,{kind:entry.kind,id:entry.object.id});
 selectedWriting=null;lastSelectedItem=result.objects.find(entry=>entry.kind==='items')?.object.id||null;
 gpuSceneDirty=true;noteGPUSceneDirty=true;renderCamera();updateCount();
 return result.objects.map(entry=>({kind:entry.kind,id:entry.object.id}));
}
async function setCopyPresent(entry,present){
 if(entry.kind==='strokes')return setStrokePresent(entry.snapshot,present);
 if(entry.kind==='writings')return setWritingPresent(entry.snapshot,present);
 return entry.snapshot.type==='text'?setNotePresent(entry.snapshot,present):setMediaPresent(entry.snapshot,present);
}
function rememberDuplication(entries){
 const copies=entries.map(entry=>({kind:entry.kind,snapshot:{...structuredClone(magicMap(entry.kind).get(entry.id)),vaultId:vaultOwner(entry.kind,entry.id)}}));
 remember({label:'duplicación',undo:async()=>{clearMagicSelection();for(const entry of copies)await setCopyPresent(entry,false);},redo:async()=>{for(const entry of copies)await setCopyPresent(entry,true);}});
}
async function pasteCanvasObjects(position=null){
 if(!objectClipboard.length||duplicationBusy||gesture)return;
 duplicationBusy=true;
 try{
  const pointer=position||(pointerOnPage?pointerPosition:{x:innerWidth/2,y:innerHeight/2}),destination=screenToWorld(pointer.x,pointer.y),targetVault=vaults.get(vaultScopeAtScreen(pointer.x,pointer.y));
  if(targetVault&&!targetVault.open)throw Error(i18n.t('Abre la Vault antes de importar dentro'));
  const bounds=objectClipboard.map(entry=>vaultObjectBounds(entry.kind,entry.snapshot)).filter(Boolean);
  if(!bounds.length)return;
  const left=Math.min(...bounds.map(b=>b.x)),top=Math.min(...bounds.map(b=>b.y)),right=Math.max(...bounds.map(b=>b.x+b.width)),bottom=Math.max(...bounds.map(b=>b.y+b.height));
  const copies=await duplicateCanvasObjects(objectClipboard,destination.x-(left+right)/2,destination.y-(top+bottom)/2);
  await reconcileVaults(copies.map(entry=>({...entry,vaultId:targetVault?.id||null})));
  rememberDuplication(copies);
 }catch(error){toast(error.message);}finally{duplicationBusy=false;}
}
function startDuplicateDrag(event,entries){
 if(duplicationBusy||gesture)return;
 entries=entries.filter(entry=>['items','writings','strokes'].includes(entry.kind));if(!entries.length)return;
 event.preventDefault();event.stopPropagation();
 gesture={type:'duplicate-pending',pointer:event.pointerId,startX:event.clientX,startY:event.clientY,lastX:event.clientX,lastY:event.clientY,objects:entries.map(entry=>({...entry,snapshot:structuredClone(magicMap(entry.kind).get(entry.id))}))};
 viewport.setPointerCapture(event.pointerId);
}
async function beginDuplicateDrag(state){
 state.requested=true;duplicationBusy=true;
 try{
  const copies=await duplicateCanvasObjects(state.objects);
  if(state.cancelled){for(const entry of copies)await setCopyPresent({kind:entry.kind,snapshot:{...structuredClone(magicMap(entry.kind).get(entry.id)),vaultId:vaultOwner(entry.kind,entry.id)}},false);clearMagicSelection();return;}
  const entries=copies.map(entry=>{const object=magicMap(entry.kind).get(entry.id);return {...entry,x:object.x,y:object.y,...(entry.kind==='strokes'?{points:object.points.map(p=>[...p])}:{})};});
  gesture={type:'magic-move',pointer:state.pointer,startX:state.startX,startY:state.startY,entries,movingKeys:new Set(entries.map(entry=>`${entry.kind}:${entry.id}`)),dx:(state.lastX-state.startX)/camera.scale,dy:(state.lastY-state.startY)/camera.scale,duplicates:copies};
  magicApply(entries,gesture.dx,gesture.dy);updateMagicCursor();
  if(state.released)await endGesture({type:'pointerup',pointerId:state.pointer});
 }catch(error){if(gesture===state)gesture=null;toast(error.message);}finally{duplicationBusy=false;}
}
window.addEventListener('pointerdown',event=>{if(duplicationBusy){event.preventDefault();event.stopImmediatePropagation();}},true);
function startCardMove(event, id) {
  event.preventDefault(); event.stopPropagation();
  const current = items.get(id);
  if (!current || current.locked || screenFrozen.has(`items:${id}`)) return;
  lastSelectedItem=id;selectedWriting=null;
  if(event.ctrlKey||event.metaKey){startDuplicateDrag(event,[{kind:'items',id}]);return;}
  if (current.type === 'text' && textEditTap(event, 'note', id)) return;
  gesture = { type: 'card', id, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: current.x, y: current.y };
  viewport.setPointerCapture(event.pointerId);
}
function prepareVideoMove(event, id) {
  if (event.button !== 0 || gesture) return;
  const current = items.get(id);
  if (!current || current.locked) return;
  lastSelectedItem=id;selectedWriting=null;
  if(event.ctrlKey||event.metaKey){startDuplicateDrag(event,[{kind:'items',id}]);return;}
  gesture = { type: 'pending-card', id, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: current.x, y: current.y };
}
function createReferenceLockButton(id, className) {
    const lockButton = document.createElement('button');
    lockButton.type = 'button'; lockButton.className = `reference-lock-button ${className}`;
    lockButton.addEventListener('pointerdown', event => event.stopPropagation());
    lockButton.addEventListener('click', async event => {
      event.stopPropagation();
      const current = items.get(id);
      if (!current || lockButton.disabled) return;
      const previous = Boolean(current.locked), locked = !previous;
      lockButton.disabled = true;
      try {
        await patchItem(id, { locked });
        const latest = items.get(id);
        if (latest) { latest.locked = locked; updateCard(latest); }
        rememberItemChange(id, { locked: previous }, { locked }, 'bloqueo de referencia');
      } catch (error) { toast(error.message); }
      finally { const current = items.get(id); if (current) updateCard(current); }
    });
    return lockButton;
}
function createCard(item) {
  const card = document.createElement('article');
  card.className = `video-card ${item.type}-card`;
  card.dataset.id = item.id;
  if (item.type === 'text') {
    card.tabIndex = -1;
    card.title = ''; 
    card.addEventListener('pointerenter', () => { noteHint.hidden = document.activeElement === card.querySelector('.text-editor'); });
    card.addEventListener('pointerleave', () => { noteHint.hidden = true; });
  }
  card.innerHTML = i18n.html('<div class="card-head"><span class="card-name"></span><a class="export-button" title="Descargar archivo original" aria-label="Descargar archivo original" hidden>↓</a><button class="delete-button" type="button" title="Eliminar" aria-label="Eliminar">×</button></div><div class="video-frame"></div><div class="card-foot"><span class="status"></span><span class="duration"></span></div>');
  if (item.type === 'text') {
    const copyButton = document.createElement('button');
    copyButton.className = 'note-copy-button';
    copyButton.type = 'button';
    copyButton.title = i18n.t('Copiar texto');
    copyButton.setAttribute('aria-label', i18n.t('Copiar texto de la nota'));
    copyButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/></svg>';
    card.querySelector('.card-name').before(copyButton);
    card.querySelector('.delete-button').before(createReferenceLockButton(item.id, 'note-lock-button'));
    copyButton.addEventListener('pointerdown', event => event.stopPropagation());
    copyButton.addEventListener('click', async event => {
      event.stopPropagation();
      const text = card.querySelector('.text-editor')?.value ?? items.get(item.id)?.text ?? '';
      if (!text) return toast(i18n.t('La nota está vacía'));
      try { await navigator.clipboard.writeText(text); toast(i18n.t('Texto copiado al portapapeles')); }
      catch { toast(i18n.t('No se pudo copiar el texto')); }
    });
  } else {
    card.setAttribute('aria-label', item.name);
    card.addEventListener('pointerenter', event => { if (!gesture) updateMediaCornerHint(card, event.clientX, event.clientY); });
    card.addEventListener('pointermove', event => { if (!gesture) updateMediaCornerHint(card, event.clientX, event.clientY); });
    card.addEventListener('pointerleave', () => { if (gesture?.type !== 'resize' || gesture.id !== item.id) delete card.dataset.nearCorner; });
    const actions = document.createElement('div');
    actions.className = 'media-actions';
    const lockButton = createReferenceLockButton(item.id, 'media-lock-button');
    const linkButton = document.createElement('button');
    linkButton.type = 'button'; linkButton.className = 'media-link-button';
    linkButton.title = i18n.t('Copiar ruta del archivo original'); linkButton.setAttribute('aria-label', linkButton.title);
    linkButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" class="ui-icon"><path d="M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7 7l2-2"/></svg>';
    linkButton.addEventListener('pointerdown', event => event.stopPropagation());
    linkButton.addEventListener('click', async event => {
      event.stopPropagation();
      try {
        const response = await fetch(`/api/items/${item.id}/original-path`);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || i18n.t('Original no disponible'));
        await navigator.clipboard.writeText(result.path);
        toast(i18n.t('Ruta del original copiada'));
      } catch (error) { toast(error.message); }
    });
    actions.append(lockButton, linkButton, card.querySelector('.export-button'), card.querySelector('.delete-button'));
    card.append(actions);
  }
  card.querySelector('.delete-button').addEventListener('click', async event => {
    event.stopPropagation();
    const snapshot = { ...structuredClone(items.get(item.id)), vaultId: vaultOwner('items', item.id) };
    try {
      const response = await fetch(`/api/items/${item.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(i18n.t('No se pudo eliminar'));
      removeCard(item.id);
      const restore = item.type === 'text' ? setNotePresent : setMediaPresent;
      remember({ label: i18n.t('elemento borrado'), undo: () => restore(snapshot, true), redo: () => restore(snapshot, false) });
    } catch (error) { toast(error.message); }
  });
  card.querySelector('.card-head').addEventListener('pointerdown', event => {
    if (item.type==='text'||event.button !== 0 || event.target.closest('button,a')) return;
    if (item.type === 'text') card.focus({ preventScroll: true });
    startCardMove(event, item.id);
  });
  if(item.type==='text'){
    card.addEventListener('pointerdown',event=>{if(event.button!==0||event.target.closest('button,a,.resize-handle')||mode!=='move'||spaceHeld||zHeld)return;if(editingNoteId===item.id){if(!event.ctrlKey&&!event.metaKey)textEditTap(event,'note',item.id);return;}startCardMove(event,item.id);});
    card.addEventListener('dblclick',event=>{if(event.target.closest('button,a,.resize-handle')||mode!=='move')return;event.preventDefault();event.stopPropagation();});
  }
  if (item.type !== 'text') card.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('.resize-handle,button,a,.media-actions')) return;
    if (item.type === 'video') prepareVideoMove(event, item.id);
    else startCardMove(event, item.id);
  });
  makeHandles(card, item.id);
  cardRenderParent(item).append(card);
  cards.set(item.id, card);
  updateCard(item);
}
function originalMime(item) {
  return ({ '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.heic': 'image/heic', '.heif': 'image/heif', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.bmp': 'image/bmp', '.svg': 'image/svg+xml' })[item.originalExt?.toLowerCase()] || 'application/octet-stream';
}
function originalName(item) {
  return item.name.replace(/[:\\/]/g, '_');
}
async function cacheOriginal(item) {
  if (!item?.originalAvailable || !item.originalBytes || item.originalBytes > 128 * 1024 * 1024 || originalFiles.has(item.id) || originalFetches.has(item.id)) return;
  originalFetches.add(item.id);
  const epoch = privateMemoryEpoch, controller = new AbortController();
  originalControllers.set(item.id, controller);
  try {
    const response = await fetch(privateMediaURL(`/original/${item.id}`, item.id), { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) return;
    const blob = await response.blob();
    if (blob.size > 128 * 1024 * 1024 || epoch !== privateMemoryEpoch || !vaultContentVisible('items', item.id) || !items.has(item.id)) return;
    originalFiles.set(item.id, new File([blob], originalName(item), { type: originalMime(item) }));
    while ([...originalFiles.values()].reduce((sum, file) => sum + file.size, 0) > 192 * 1024 * 1024) originalFiles.delete(originalFiles.keys().next().value);
  } catch { /* URL and download link remain available. */ }
  finally { if (originalControllers.get(item.id) === controller) { originalControllers.delete(item.id); originalFetches.delete(item.id); } }
}
function setupOriginalDrag(item, exportButton) {
  if (item.type !== 'video' || !item.originalAvailable || exportButton.dataset.originalDrag === 'true') return;
  exportButton.dataset.originalDrag = 'true';
  exportButton.draggable = true;
  exportButton.title = i18n.t('Descarga o arrastra el vídeo original a otra aplicación');
  exportButton.addEventListener('pointerenter', () => cacheOriginal(items.get(item.id)));
  exportButton.addEventListener('pointerdown', () => cacheOriginal(items.get(item.id)));
  exportButton.addEventListener('dragstart', event => {
    if (zHeld || gesture?.type === 'zoom') return event.preventDefault();
    const current = items.get(item.id);
    if (!current?.originalAvailable || !event.dataTransfer) return event.preventDefault();
    exportDragging = true;
    const url = new URL(`/original/${item.id}`, location.href).href;
    const name = originalName(current);
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('text/uri-list', url);
    event.dataTransfer.setData('text/plain', url);
    event.dataTransfer.setData('DownloadURL', `${originalMime(current)}:${name}:${url}`);
    const file = originalFiles.get(item.id);
    if (file) {
      try { event.dataTransfer.items.add(file); } catch { /* Browser may reject File drag data. */ }
    }
  });
  exportButton.addEventListener('dragend', () => { exportDragging = false; dragDepth = 0; dropHint.hidden = true; });
}
async function openVideoOriginal(id){
  const current=items.get(id);
  if(!['video','image'].includes(current?.type)||!vaultContentVisible('items',id))return;
  if(!current.originalAvailable)return toast(i18n.t('El original de este vídeo no está disponible: se importó antes de conservar los archivos originales.'));
  if(window.apoxiaDesktop){
    if(!window.apoxiaDesktop.openOriginal)return toast(i18n.t('Cierra y vuelve a abrir la app para activar la apertura de vídeos.'));
    try{await window.apoxiaDesktop.openOriginal(id);}catch(error){toast(error.message);}
  }else window.open(`/original/${id}`,'_blank','noopener');
}
viewport.addEventListener('dblclick',event=>{
  if(event.button!==0||spaceHeld||zHeld||event.target.closest('button,a,input,textarea,.vault-frame'))return;
  const note=notePick(event.clientX,event.clientY,true);if(note)return;
  const hit=gpuPick(event.clientX,event.clientY),item=hit&&items.get(hit.id);
  if(item?.type!=='video'||!item.locked)return;
  event.preventDefault();event.stopImmediatePropagation();openVideoOriginal(item.id);
},{capture:true});

function stopSpatialAudio() {
  cancelAnimationFrame(spatialAudioFrame);
  spatialAudioFrame = 0;
  if (!spatialAudio) return;
  const {element, source, gain, panner, id} = spatialAudio;
  element.pause();
  element.removeAttribute('src');
  element.load();
  source.disconnect(); gain.disconnect(); panner.disconnect();
  const button = cards.get(id)?.querySelector('.audio-play');
  if (button) { button.textContent = '▶'; button.setAttribute('aria-label', 'Reproducir audio'); }
  cards.get(id)?.classList.remove('audio-playing');
  spatialAudio = null;
}
function updateSpatialAudio() {
  const state = spatialAudio;
  if (!state) return;
  const item = items.get(state.id);
  if (!item || !showMedia || !vaultContentVisible('items', item.id)) { stopSpatialAudio(); return; }
  const diameter = item.displayWidth * camera.scale;
  const x = camera.x + (item.x + item.displayWidth / 2) * camera.scale;
  const y = camera.y + (item.y + item.displayHeight / 2) * camera.scale;
  const outOfRange = diameter < 18 || x + diameter / 2 < 0 || x - diameter / 2 > innerWidth || y + diameter / 2 < 0 || y - diameter / 2 > innerHeight;
  cards.get(state.id)?.classList.toggle('audio-playing', !outOfRange);
  if (outOfRange) {
    state.distancePaused = true;
    state.element.pause();
    return;
  }
  if (state.distancePaused) {
    state.distancePaused = false;
    state.element.play().then(() => {
      if (spatialAudio !== state || state.distancePaused) state.element.pause();
    }).catch(error => {
      if (spatialAudio !== state || state.distancePaused) return;
      stopSpatialAudio();
      toast(error.message);
    });
  }
  const proximity = Math.max(0, Math.min(1, (diameter - 18) / 142));
  const edge = Math.max(0, Math.min(1, (Math.min(x, innerWidth-x, y, innerHeight-y) + diameter/2) / (diameter/2 + 80)));
  state.gain.gain.setTargetAtTime(proximity * proximity * edge, spatialAudioContext.currentTime, .08);
  state.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, (x - innerWidth/2) / (innerWidth/2))), spatialAudioContext.currentTime, .08);
}
function animateSpatialAudio() {
  updateSpatialAudio();
  const state = spatialAudio;
  if (!state) return;
  const time = performance.now() / 1000;
  const paths = cards.get(state.id)?.querySelectorAll('.audio-wave');
  paths?.forEach((path, ring) => {
    const points = [];
    for (let i=0; i<=128; i++) {
      const angle = i * Math.PI * 2 / 128;
      const radius = 43 + Math.sin(angle * (3 + ring) + time * (1.5 + ring * .4)) * 3.5
        + Math.sin(angle * 5 - time * 1.2 + ring) * 1.8;
      points.push(`${i?'L':'M'}${50+Math.cos(angle)*radius} ${50+Math.sin(angle)*radius}`);
    }
    path.setAttribute('d', points.join(' ')+'Z');
  });
  spatialAudioFrame = requestAnimationFrame(animateSpatialAudio);
}
window.addEventListener('pagehide', stopSpatialAudio);
function setupSpatialAudio(card, item, frame) {
  frame.innerHTML = '<svg class="audio-rings" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="43"/><path class="audio-wave"/><path class="audio-wave"/></svg><button class="audio-play" type="button" aria-label="Reproducir audio">▶</button>';
  const button = frame.querySelector('button');
  button.addEventListener('pointerdown', event => event.stopPropagation());
  button.addEventListener('click', async event => {
    event.stopPropagation();
    if (spatialAudio?.id === item.id) { stopSpatialAudio(); return; }
    stopSpatialAudio();
    try {
      spatialAudioContext ||= new AudioContext();
      const element = new Audio(privateMediaURL(`/media/${item.id}.mp4`, item.id));
      element.loop = true;
      const source = spatialAudioContext.createMediaElementSource(element);
      const gain = spatialAudioContext.createGain(); gain.gain.value = 0;
      const panner = spatialAudioContext.createStereoPanner();
      source.connect(gain); gain.connect(panner); panner.connect(spatialAudioContext.destination);
      const state = {id:item.id, element, source, gain, panner, distancePaused:true};
      spatialAudio = state;
      await spatialAudioContext.resume();
      if (spatialAudio !== state) return;
      updateSpatialAudio();
      if (spatialAudio !== state) return;
      button.textContent = 'Ⅱ'; button.setAttribute('aria-label', 'Pausar audio');
      animateSpatialAudio();
    } catch (error) { if (spatialAudio?.id === item.id) stopSpatialAudio(); toast(error.message); }
  });
}

function setupVideo(card, item, frame) {
  const poster = document.createElement('img');
  // The GPU owns the poster; the DOM retains playback and controls.
  poster.alt = '';
  poster.loading = 'lazy';
  const video = document.createElement('video');
  for(const event of ['playing','pause','canplay','seeked','ended'])video.addEventListener(event,requestGPU);
  video.muted = !audioEnabled || !item.hasAudio; video.loop = false; video.playsInline = true; video.preload = 'none';
  const playMark = document.createElement('span');
  playMark.className = 'play-mark'; playMark.textContent = '▶';
  const progress = document.createElement('span');
  progress.className = 'progress';
  const seek=document.createElement('input');seek.type='range';seek.className='video-seek';seek.min='0';seek.max='1000';seek.step='1';seek.value='0';seek.setAttribute('aria-label','Posición del vídeo');
  seek.addEventListener('pointerdown',event=>event.stopPropagation());
  for(const name of ['click','dblclick'])seek.addEventListener(name,event=>event.stopPropagation());
  seek.addEventListener('input',()=>{ensureMedia(card);const fraction=Number(seek.value)/1000;if(Number.isFinite(video.duration))video.currentTime=fraction*video.duration;else frame.dataset.seekFraction=String(fraction);requestGPU();});
  frame.replaceChildren(poster, video, playMark, progress,seek);
  video.addEventListener('timeupdate', () => {const fraction=video.currentTime/(video.duration||1);progress.style.width=`${fraction*100}%`;seek.value=String(Math.round(fraction*1000));seek.style.setProperty('--video-progress',`${fraction*100}%`);});
  video.addEventListener('loadedmetadata', () => {
    if (frame.dataset.seekFraction) {
      video.currentTime = Number(frame.dataset.seekFraction) * video.duration;
      delete frame.dataset.seekFraction;
    }
  });
  function pausePlayback(){video.pause();frame.classList.remove('playing');if(playingVideoId===item.id){playingVideoId=null;videoPlayVersion++;}requestGPU();}
  video.addEventListener('ended',pausePlayback);
  video.addEventListener('pause',()=>{frame.classList.remove('playing');if(playingVideoId===item.id){playingVideoId=null;videoPlayVersion++;}});
  async function playPreview() {
    if(items.get(item.id)?.locked||!vaultContentVisible('items',item.id))return;
    if(playingVideoId===item.id&&!video.paused)return;
    if(playingVideoId&&playingVideoId!==item.id)videoPreviews.get(playingVideoId)?.pause();
    const version=++videoPlayVersion;playingVideoId=item.id;
    applyCardChrome(card,items.get(item.id));
    ensureMedia(card);if(video.ended)video.currentTime=0;
    video.muted=!audioEnabled||!items.get(item.id)?.hasAudio;
    try{await video.play();}
    catch{
      if(version!==videoPlayVersion)return;
      if(!video.muted){video.muted=true;try{await video.play();}catch{pausePlayback();return;}}
      else{pausePlayback();return;}
    }
    if(version!==videoPlayVersion||playingVideoId!==item.id){video.pause();return;}
    frame.classList.add('playing');requestGPU();
  }
  let drawingHover=false;
  videoPreviews.set(item.id,{
    pause:pausePlayback,play:playPreview,
    setDrawingHover(hovered){if(drawingHover===hovered)return;drawingHover=hovered;if(hovered)playPreview();}
  });
  frame.addEventListener('pointerenter',()=>playPreview());
  frame.addEventListener('click',event=>{
    if(card.dataset.suppressClick==='true'){delete card.dataset.suppressClick;return;}
    if(!video.paused||playingVideoId===item.id)pausePlayback();else playPreview();
  });
  frame.addEventListener('dblclick',event=>{event.preventDefault();event.stopPropagation();openVideoOriginal(item.id);});
  observer.observe(card);
}
function renderNoteLinks(card) {
  const editor = card.querySelector('.text-editor');
  const view = card.querySelector('.note-links-view');
  if (!editor || !view) return;
  view.style.fontSize = editor.style.fontSize;
  if (view.noteText === editor.value) return;
  view.noteText = editor.value;
  const text = editor.value;
  const fragments = document.createDocumentFragment();
  let cursor = 0, count = 0;
  for (const match of text.matchAll(/(?:https?:\/\/|www\.)[^\s<>"']+/gi)) {
    let url = match[0].replace(/[.,;:!?]+$/, '');
    while (url.endsWith(')') && (url.match(/\)/g) || []).length > (url.match(/\(/g) || []).length) url = url.slice(0, -1);
    try {
      const parsed = new URL(/^www\./i.test(url) ? `https://${url}` : url);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      fragments.append(document.createTextNode(text.slice(cursor, match.index)));
      const link = document.createElement('a');
      link.href = parsed.href; link.textContent = url;
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.title = i18n.t('Abrir enlace en una pestaña nueva');
      link.addEventListener('pointerdown', event => event.stopPropagation());
      link.addEventListener('click', event => event.stopPropagation());
      fragments.append(link);
      cursor = match.index + url.length;
      count++;
    } catch { /* Keep incomplete URLs as ordinary text. */ }
  }
  fragments.append(document.createTextNode(text.slice(cursor)));
  view.replaceChildren(fragments);
  card.classList.toggle('has-note-links', count > 0);
  view.scrollTop = editor.scrollTop;
}
const noteBackgroundWrites=new Map();
function toggleNoteBackground(id){
 const item=items.get(id);if(item?.type!=='text')return;
 const before=Boolean(item.backgroundHidden),after=!before;item.backgroundHidden=after;updateCard(item);noteGPUSceneDirty=true;scheduleNotePreviewRender();
 const previous=noteBackgroundWrites.get(id)||Promise.resolve();
 const write=previous.catch(()=>{}).then(()=>patchItem(id,{backgroundHidden:after})).then(()=>rememberItemChange(id,{backgroundHidden:before},{backgroundHidden:after},'fondo de nota')).catch(error=>{item.backgroundHidden=before;updateCard(item);toast(error.message);});
 noteBackgroundWrites.set(id,write);write.finally(()=>{if(noteBackgroundWrites.get(id)===write)noteBackgroundWrites.delete(id);});return write;
}
function toggleNoteEditing(id) {
  const card=cards.get(id),editor=card?.querySelector('.text-editor');if(!editor)return;
  if(editingNoteId===id){editor.blur();editor.readOnly=true;card.classList.remove('note-editing');editingNoteId=null;}
  else{if(editingNoteId)cards.get(editingNoteId)?.querySelector('.text-editor')?.blur();editingNoteId=id;editor.readOnly=false;card.classList.add('note-editing');applyCardChrome(card,items.get(id));editor.focus({preventScroll:true});}
  applyCardChrome(card,items.get(id));noteGPUSceneDirty=true;scheduleNotePreviewRender();
}
function setupText(card, item, frame) {
  const textarea = document.createElement('textarea');
  textarea.className = 'text-editor';textarea.readOnly=true;
  textarea.placeholder = '';
  textarea.spellcheck = false;
  textarea.setAttribute('aria-label', i18n.t('Contenido de la caja de texto'));
  textarea.value = item.text || '';
  textarea.style.fontSize = `${item.textFontSize || 17}px`;
  textarea.addEventListener('focus', () => { noteHint.hidden = true; textarea.dataset.editStart = items.get(item.id)?.text || ''; });
  textarea.addEventListener('input', () => {
    const current = items.get(item.id);
    current.text = textarea.value;
    clearTimeout(textTimers.get(item.id));
    textTimers.set(item.id, setTimeout(() => patchItem(item.id, { text: textarea.value }).catch(() => toast(i18n.t('No se pudo guardar el texto'))), 450));
  });
  textarea.addEventListener('blur', () => {
    textarea.readOnly=true;card.classList.remove('note-editing');if(editingNoteId===item.id)editingNoteId=null;
    noteHint.hidden = !card.matches(':hover');
    clearTimeout(textTimers.get(item.id));
    const epoch = historyEpoch;
    const before = textarea.dataset.editStart || '';
    const after = textarea.value;
    patchItem(item.id, { text: after }).then(() => { if (epoch === historyEpoch) rememberItemChange(item.id, { text: before }, { text: after }, i18n.t('edición de nota')); }).catch(() => toast(i18n.t('No se pudo guardar el texto')));
  });
  const linkView = document.createElement('div');
  linkView.className = 'note-links-view';
  linkView.setAttribute('aria-label', i18n.t('Texto de la nota con enlaces'));
  textarea.addEventListener('scroll', () => { linkView.scrollTop = textarea.scrollTop; });
  textarea.addEventListener('input', () => renderNoteLinks(card));
  textarea.addEventListener('blur', () => renderNoteLinks(card));
  frame.replaceChildren(textarea, linkView);
  renderNoteLinks(card);
}
function updateCard(item) {
  if(item.type==='text')noteGPUSceneDirty=true;else gpuSceneDirty=true;
  if(!gpuReady(item))gpuUIIds.add(item.id);else gpuUIIds.delete(item.id);
  if(item.connections?.length)gpuConnectionSources.add(item.id);else gpuConnectionSources.delete(item.id);
  scheduleConnectionRender();
  let card = cards.get(item.id);
  if (!card) return createCard(item);
  if (item.type !== 'text' && item.status === 'ready' && item.width && item.height) {
    item.displayWidth ||= 320;
    item.displayHeight = item.displayWidth / ApoxiaCrop.aspect(item);
  }
  card.style.left = `${item.x}px`;
  card.style.top = `${item.y}px`;
  card.style.width = `${item.displayWidth || 320}px`;
  const stackArea=(item.displayWidth||(item.type==='text'?300:320))*((item.displayHeight||(item.type==='text'?160:180)));
  const stackKey=`${item.type}:${stackArea}:${item.createdAt||0}`;
  if(card.dataset.stackKey!==stackKey){card.dataset.stackKey=stackKey;scheduleStacking();}
  card.querySelector('.card-name').textContent = item.type === 'text' ? '' : item.name;
  card.title=item.originalMissing?'Original desaparecido. Se muestra la copia de baja calidad.':'';
  const exportButton = card.querySelector('.export-button');
    const lockButton = card.querySelector('.reference-lock-button');
    lockButton.disabled = item.status !== 'ready';
    lockButton.setAttribute('aria-pressed', String(Boolean(item.locked)));
    lockButton.title = item.locked ? i18n.t('Desbloquear movimiento y tamaño') : i18n.t('Bloquear movimiento y tamaño');
    lockButton.setAttribute('aria-label', lockButton.title);
    lockButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" class="ui-icon"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="${item.locked ? 'M8 10V6a4 4 0 0 1 8 0v4' : 'M8 10V6a4 4 0 0 1 8 0'}"/></svg>`;
  card.classList.toggle('note-locked', item.type === 'text' && Boolean(item.locked));
  if (item.type !== 'text') {
    card.classList.toggle('media-locked', Boolean(item.locked));
    if (item.locked) delete card.dataset.nearCorner;
    const linkButton = card.querySelector('.media-link-button');
    linkButton.disabled = !item.originalAvailable || Boolean(vaults.get(vaultOwner('items', item.id))?.encrypted);
    linkButton.title = vaults.get(vaultOwner('items', item.id))?.encrypted ? i18n.t('Original privado dentro de la Vault') : item.originalAvailable ? i18n.t('Copiar ruta del archivo original') : i18n.t('Original no disponible');
    linkButton.setAttribute('aria-label', linkButton.title);
  }
  exportButton.hidden = item.type === 'text' || item.status !== 'ready';
  if (!exportButton.hidden) {
    const optimizedExt = item.type === 'image' ? 'webp' : 'mp4';
    exportButton.href = privateMediaURL(item.originalAvailable ? `/original/${item.id}` : `/media/${item.id}.${optimizedExt}`, item.id);
    exportButton.download = item.originalAvailable ? originalName(item) : `${item.name.replace(/\.[^.]+$/, '')}-optimizada.${optimizedExt}`;
    exportButton.title = item.originalAvailable ? i18n.t('Descargar archivo original') : i18n.t('Descargar copia optimizada');
    exportButton.setAttribute('aria-label', exportButton.title);
  }
  card.classList.toggle('processing', item.status === 'processing');
  card.classList.toggle('error', item.status === 'error');
  const frame = card.querySelector('.video-frame');
  frame.style.height = `${item.displayHeight || (item.width && item.height ? Math.round(320 * item.height / item.width) : 180)}px`;
  if (item.type === 'text') {
    setNoteColor(card, item.color);
    card.classList.toggle('note-background-hidden',Boolean(item.backgroundHidden));
    let eye=card.querySelector('.note-eye');
    if(!eye){eye=document.createElement('button');eye.type='button';eye.className='delete-button note-eye';eye.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';eye.addEventListener('pointerdown',event=>event.stopPropagation());eye.addEventListener('click',event=>{event.stopPropagation();toggleNoteBackground(item.id);});card.querySelector('.card-head').insertBefore(eye,card.querySelector('.delete-button'));}
    eye.title=item.backgroundHidden?'Mostrar fondo (V)':'Ocultar fondo (V)';eye.setAttribute('aria-label',eye.title);eye.setAttribute('aria-pressed',String(Boolean(item.backgroundHidden)));
    noteGPUSceneDirty=true;
    if (!frame.querySelector('textarea')) setupText(card, item, frame);
    else if (document.activeElement !== frame.querySelector('textarea') && frame.querySelector('textarea').value !== item.text) frame.querySelector('textarea').value = item.text || '';
    renderNoteLinks(card);
    applyCardChrome(card, item);
    card.querySelector('.card-foot').hidden = true;
    scheduleNotePreviewRender();
    return;
  }
  if (item.status === 'ready' && item.type === 'audio' && !frame.querySelector('.audio-play')) setupSpatialAudio(card, item, frame);
  if (item.status === 'ready' && item.type === 'video' && !frame.querySelector('video')) setupVideo(card, item, frame);
  else if (item.status === 'ready' && item.type === 'image' && !frame.querySelector('img')) {
    const image = document.createElement('img');
    image.alt = item.name;
    image.draggable = false;
    // Viewport culling decides when to request; hidden loading cards must still fetch.
    image.loading = 'eager';
    image.onload = function () {
      const image = this;
      if (!image.complete || !image.naturalWidth || ['proxy','parked','hidden'].includes(image.dataset.variant)) return;
      waitingPhotos.delete(item.id);
      const current = items.get(item.id);
      if (current && !parkedCards.has(item.id)) { applyCardChrome(card, current); renderSolidPreviews(); }
    };
    image.onerror = function () {
      const image = this;
      if (['proxy','parked','hidden'].includes(image.dataset.variant)) return;
      waitingPhotos.delete(item.id);
      if (image.dataset.variant === 'thumb') {
        image.dataset.thumbMissing = 'true'; image.dataset.variant = 'retry';
        updateImageSources([item.id]);
      } else {
        const current = items.get(item.id);
        if (current) applyCardChrome(card, current);
        renderSolidPreviews();
      }
    };
    frame.replaceChildren(image);
  } else if (item.status === 'processing') frame.innerHTML = `<div><div class="spinner"></div>Convirtiendo ${item.type === 'image' ? 'imagen' : 'vídeo'}…</div>`;
  else if (item.status === 'error') frame.textContent = i18n.t('No se pudo convertir');
  card.querySelector('.status').textContent = item.status === 'ready' ? `${item.width} × ${item.height} · ${formatSize(item.bytes)}` : item.status === 'error' ? i18n.t(item.error || 'Error') : i18n.t('Preparando copia ligera');
  card.querySelector('.duration').textContent = item.type === 'video' && item.status === 'ready' ? formatTime(item.duration) : '';
  applyCardChrome(card, item);
  if (item.type === 'image' && item.status === 'ready') updateImageSources([item.id]);
  if (item.status === 'ready' && item.type === 'video' && item.originalAvailable) setupOriginalDrag(item, exportButton);
}
function removeCard(id) {
  if (spatialAudio?.id === id) stopSpatialAudio();
  gpuSceneDirty=true;noteGPUSceneDirty=true;activeNoteCards.delete(id);if(noteHoverId===id)noteHoverId=null;
  activeMediaCards.delete(id);gpuRanks.delete(id);gpuConnectionSources.delete(id);gpuUIIds.delete(id);if(gpuHoverId===id)gpuHoverId=null;
  scheduleConnectionRender();
  noteProxyCards.delete(id); noteTextLayouts.delete(id); scheduleNotePreviewRender();
  cancelImageUpgrade(id);
  parkedCards.delete(id); waitingPhotos.delete(id); parkedImageCache.delete(id);
  solidProxyCards.delete(id); solidProxyColors.delete(id);
  videoPreviews.delete(id);
  noteHint.hidden = true;
  const card = cards.get(id);
  if(card)unloadMedia(card,true);
  if (card) { observer.unobserve(card); card.remove(); cards.delete(id); }
  clearTimeout(textTimers.get(id));
  textTimers.delete(id);
  colorWrites.delete(id);
  items.delete(id);
  renderSolidPreviews();
  scheduleStacking();
  originalFiles.delete(id);
  updateCount();
}
function mergeItems(next) {
  scheduleConnectionRender();
  const seen = new Set();
  for (const item of next) {
    seen.add(item.id);
    const old = items.get(item.id);
    items.set(item.id, item);
    const frozen=screenFrozen.get(`items:${item.id}`);
    if(frozen) { Object.assign(item,frozenGeometry(frozen)); frozen.object=item; }
    if (!old || old.status !== item.status || old.x !== item.x || old.y !== item.y || old.displayWidth !== item.displayWidth || old.displayHeight !== item.displayHeight || old.locked !== item.locked || old.chromeScale !== item.chromeScale || old.textFontSize !== item.textFontSize || old.text !== item.text || old.color !== item.color || old.backgroundHidden !== item.backgroundHidden || old.originalAvailable !== item.originalAvailable || old.originalMissing !== item.originalMissing || JSON.stringify(old.crop)!==JSON.stringify(item.crop)) updateCard(item);
  }
  for (const id of [...items.keys()]) if (!seen.has(id)) removeCard(id);
  updateCount();
}
function boundsVisible(bounds, margin, rects, originX, originY) {
  const left = originX + bounds.minX * camera.scale - margin;
  const right = originX + bounds.maxX * camera.scale + margin;
  const top = originY + bounds.minY * camera.scale - margin;
  const bottom = originY + bounds.maxY * camera.scale + margin;
  return rects.some(([x1, y1, x2, y2]) => right >= x1 && left <= x2 && bottom >= y1 && top <= y2);
}
function makeStrokePath(points, start = 0, end = points.length - 1) {
  const [x, y] = points[start];
  // Keep path coordinates near zero so the canvas renderer retains precision at deep zoom.
  return { path: new Path2D(smoothPath(points, start, end, x, y)), x, y };
}
function pointBounds(points, start, end) {
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (let index = start; index <= end; index++) {
    const [x, y] = points[index];
    bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
  }
  return bounds;
}
function dropPendingDraw(id) {
  pendingDraws.delete(id); strokeBounds.delete(id); strokeChunks.delete(id); strokeSpaces.delete(id);
}
function strokeTransform(id) {
  const basis = strokeSpaces.get(id), vault = basis && vaults.get(basis.id);
  if (!vault) return { scale: 1, x: 0, y: 0, baseX: 0, baseY: 0 };
  const scale = vault.width / basis.width;
  return { scale, x: vault.x, y: vault.y, baseX: basis.x, baseY: basis.y };
}
function transformedStrokeBounds(bounds, transform) {
  if (!bounds || (transform.scale === 1 && transform.x === transform.baseX && transform.y === transform.baseY)) return bounds;
  return { minX: (bounds.minX - transform.baseX) * transform.scale + transform.x, maxX: (bounds.maxX - transform.baseX) * transform.scale + transform.x,
    minY: (bounds.minY - transform.baseY) * transform.scale + transform.y, maxY: (bounds.maxY - transform.baseY) * transform.scale + transform.y };
}
function strokeWorldBounds(id) { return transformedStrokeBounds(strokeBounds.get(id), strokeTransform(id)); }
function* drawableStrokes() {
  yield* strokes;
  for (const [id, pending] of pendingDraws) yield [id, pending.stroke];
}
function paintStrokes(rects, originX, originY, dpr, excludedVault = null, scopeFilter = null, targetContext = drawingContext, candidates = null) {
  const drawingContext = targetContext;
  drawingContext.lineCap = 'round';
  drawingContext.lineJoin = 'round';
  let transform;
  const drawPath = chunk => {
    const scale = camera.scale * transform.scale;
    drawingContext.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (originX + ((chunk.x - transform.baseX) * transform.scale + transform.x) * camera.scale), dpr * (originY + ((chunk.y - transform.baseY) * transform.scale + transform.y) * camera.scale));
    drawingContext.stroke(chunk.path);
  };
  let clipOwner;
  let clipSaved = false;
  for (const [id, stroke] of candidates || drawableStrokes()) {
    if (pendingErase.has(id) || !vaultContentVisible('strokes', id)) continue;
    if (scopeFilter ? !scopeFilter(vaultOwner('strokes', id)) : Boolean(vaultOwner('strokes', id))) continue;
    transform = strokeTransform(id);
    const bounds = transformedStrokeBounds(strokeBounds.get(id), transform);
    const margin = stroke.width * camera.scale / 2;
    if (!bounds || !boundsVisible(bounds, margin, rects, originX, originY)) continue;
    const chunks = strokeChunks.get(id);
    const widthOnScreen = stroke.width * camera.scale;
    const level = widthOnScreen < 0.75 ? 'tiny' : widthOnScreen < 3 ? 'coarse' : 'full';
    const alternate = chunks[level];
    // Consecutive strokes in the same scope share one clip. Keep their original
    // painting order, and restore the caller's dirty-strip clip when changing scope.
    const owner = freeVaultObjectPreview('strokes',stroke) ? null : vaultOwner('strokes', id) || null;
    if (vaults.size && (!clipSaved || owner !== clipOwner)) {
      if (clipSaved) drawingContext.restore();
      drawingContext.save();
      clipSaved = true;
      clipOwner = owner;
      clipVaultCanvas(drawingContext, owner, dpr, originX, originY, excludedVault);
    }
    drawingContext.strokeStyle = stroke.color;
    drawingContext.lineWidth = stroke.width / transform.scale;
    if (level !== 'full' && alternate) drawPath(alternate);
    else for (const chunk of chunks.full) if (boundsVisible(transformedStrokeBounds(chunk.bounds, transform), margin, rects, originX, originY)) drawPath(chunk);
  }
  if (clipSaved) drawingContext.restore();
}
function renderOwnedStrokes() {
  const dpr = devicePixelRatio || 1;
  const width = drawingLayer.width, height = drawingLayer.height;
  if (ownedDrawingLayer.width !== width) ownedDrawingLayer.width = width;
  if (ownedDrawingLayer.height !== height) ownedDrawingLayer.height = height;
  const ctx = ownedDrawingLayer.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width, height);
  if (!showStrokes || ![...vaults.values()].some(v => v.open && !v.closing && (v.members.strokes.length || [...pendingDraws.values()].some(p => p.vaultId === v.id)))) return;
  const rects = [[0, 0, width / dpr, height / dpr]];
  const drag = vaultDrag, vault = drag && vaults.get(drag.id);
  if (!vault?.open || vault.closing) {
    paintStrokes(rects, camera.x, camera.y, dpr, null, owner => Boolean(owner), ctx);
    return;
  }
  paintStrokes(rects, camera.x, camera.y, dpr, null, owner => Boolean(owner) && owner !== vault.id, ctx);
  if (!drag.privateStrokeCache) {
    const box = vaultInterior(vault);
    const left = camera.x + box.x * camera.scale, top = camera.y + box.y * camera.scale;
    if (left >= 0 && top >= 0 && left + box.width * camera.scale <= innerWidth && top + box.height * camera.scale <= innerHeight) {
      const cache = document.createElement('canvas'); cache.width = width; cache.height = height;
      paintStrokes(rects, camera.x, camera.y, dpr, null, owner => owner === vault.id, cache.getContext('2d'));
      drag.privateStrokeCache = cache;
      drag.privateStrokeBasis = { x: vault.x, y: vault.y, width: vault.width };
    }
  }
  if (!drag.privateStrokeCache) {
    paintStrokes(rects, camera.x, camera.y, dpr, null, owner => owner === vault.id, ctx);
    return;
  }
  const basis = drag.privateStrokeBasis, factor = vault.width / basis.width;
  const dx = (vault.x - basis.x) * camera.scale + (camera.x + basis.x * camera.scale) * (1 - factor);
  const dy = (vault.y - basis.y) * camera.scale + (camera.y + basis.y * camera.scale) * (1 - factor);
  ctx.save(); clipVaultCanvas(ctx, vault.id, dpr);
  ctx.setTransform(factor, 0, 0, factor, dx * dpr, dy * dpr);
  ctx.drawImage(drag.privateStrokeCache, 0, 0); ctx.restore();
}
function redrawVaultDragStrokes() {
  const drag = vaultDrag;
  if (!drag) { redrawStrokes(); return; }
  const key = `${camera.x}:${camera.y}:${camera.scale}:${drawingLayer.width}:${drawingLayer.height}`;
  if (!drag.strokeCache || drag.strokeCacheKey !== key) {
    drag.strokeCacheKey = key;
    redrawStrokes();
    const cache = document.createElement('canvas'); cache.width = drawingLayer.width; cache.height = drawingLayer.height;
    cache.getContext('2d').drawImage(drawingLayer, 0, 0); drag.strokeCache = cache;
  }
  // Public objects do not move and no moving hole needs to be recalculated.
  renderOwnedStrokes();
}
function redrawStrokes(allowPanReuse = false) {
  if(!allowPanReuse || !paintedCamera || vaults.size || pendingDraws.size || pendingErase.size || screenFrozen.size) clearStrokeTileCache();
  renderOwnedStrokes();
  const dpr = devicePixelRatio || 1;
  drawingContext.setTransform(1, 0, 0, 1, 0, 0);
  const width = drawingLayer.width, height = drawingLayer.height;
  if(allowPanReuse && showStrokes && strokes.size>=128 && !vaults.size && !pendingDraws.size && !pendingErase.size && !screenFrozen.size && !vaultDrag && renderStrokeTiles(dpr,width,height)){
    paintedCamera={x:camera.x,y:camera.y,scale:camera.scale,width,height};return;
  }
  const reusable = allowPanReuse && !vaultDrag && showStrokes && paintedCamera?.scale === camera.scale && paintedCamera.width === width && paintedCamera.height === height;
  if (reusable) {
    const dx = Math.round((camera.x - paintedCamera.x) * dpr);
    const dy = Math.round((camera.y - paintedCamera.y) * dpr);
    if (!dx && !dy) return;
    if (Math.abs(dx) < width && Math.abs(dy) < height) {
      if (panBuffer.width !== width || panBuffer.height !== height) { panBuffer.width = width; panBuffer.height = height; }
      panContext.clearRect(0, 0, width, height);
      panContext.drawImage(drawingLayer, 0, 0);
      drawingContext.clearRect(0, 0, width, height);
      drawingContext.drawImage(panBuffer, dx, dy);
      const strips = [];
      if (dx > 0) strips.push([0, 0, dx, height]);
      else if (dx < 0) strips.push([width + dx, 0, width, height]);
      if (dy > 0) strips.push([0, 0, width, dy]);
      else if (dy < 0) strips.push([0, height + dy, width, height]);
      drawingContext.save();
      drawingContext.beginPath();
      for (const [x1, y1, x2, y2] of strips) {
        drawingContext.clearRect(x1, y1, x2 - x1, y2 - y1);
        drawingContext.rect(x1, y1, x2 - x1, y2 - y1);
      }
      drawingContext.clip();
      const originX = paintedCamera.x + dx / dpr;
      const originY = paintedCamera.y + dy / dpr;
      paintStrokes(strips.map(([x1, y1, x2, y2]) => [x1 / dpr, y1 / dpr, x2 / dpr, y2 / dpr]), originX, originY, dpr);
      drawingContext.restore();
      paintedCamera = { x: originX, y: originY, scale: camera.scale, width, height };
      return;
    }
  }
  drawingContext.clearRect(0, 0, width, height);
  if (!showStrokes) { paintedCamera = null; return; }
  paintStrokes([[0, 0, width / dpr, height / dpr]], camera.x, camera.y, dpr);
  paintedCamera = { x: camera.x, y: camera.y, scale: camera.scale, width, height };
}
function addStroke(stroke, deferRender = false) {
  if (strokes.has(stroke.id)) return;
  const renderPoints = smoothStrokePoints(stroke.points, stroke.width);
  const chunks = { full: [], coarse: null, tiny: null };
  const chunkSize = 48;
  for (let start = 0; start < renderPoints.length - 1; start += chunkSize) {
    const end = Math.min(start + chunkSize, renderPoints.length - 1);
    const path = makeStrokePath(renderPoints, start, end);
    const bounds = pointBounds(renderPoints, Math.max(0, start - 1), Math.min(renderPoints.length - 1, end + 1));
    chunks.full.push({ ...path, bounds });
  }
  if (renderPoints.length <= 1) {
    const path = makeStrokePath(renderPoints);
    chunks.full.push({ ...path, bounds: pointBounds(renderPoints, 0, 0) });
  }
  if (renderPoints.length > 8) {
    chunks.coarse = makeStrokePath(simplifyPoints(renderPoints, stroke.width * 0.75));
    chunks.tiny = makeStrokePath(simplifyPoints(renderPoints, stroke.width * 3));
  }
  if(stroke.shape){
    const b=pointBounds(stroke.points,0,stroke.points.length-1),w=b.maxX-b.minX,h=b.maxY-b.minY,path=new Path2D();
    if(w>0&&h>0){if(stroke.shape==='ellipse')path.ellipse(w/2,h/2,w/2,h/2,0,0,Math.PI*2);else path.roundRect(0,0,w,h,Math.min(w,h)*.06);}
    const exact={path,x:b.minX,y:b.minY,bounds:b};chunks.full=[exact];chunks.coarse=exact;chunks.tiny=exact;
  }
  strokeChunks.set(stroke.id, chunks);
  strokes.set(stroke.id, stroke);
  const owner = vaults.get(vaultOwner('strokes', stroke.id));
  if (owner) strokeSpaces.set(stroke.id, { id: owner.id, x: owner.x, y: owner.y, width: owner.width });
  else strokeSpaces.delete(stroke.id);
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const [x, y] of stroke.points) { bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x); bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y); }
  strokeBounds.set(stroke.id, bounds);
  if (!deferRender) { redrawStrokes(); updateCount(); }
}
const strokeDeleteQueue = new Map();
let strokeDeleteTimer = 0;
let strokeDeleteBusy = false;
let eraseRenderFrame = 0;
function scheduleEraseRender() {
  if (eraseRenderFrame) return;
  eraseRenderFrame = requestAnimationFrame(() => {
    eraseRenderFrame = 0;
    redrawStrokes(); updateCount();
  });
}
function deleteStroke(id) {
  if (pendingErase.has(id)) return Promise.resolve();
  pendingErase.add(id);
  scheduleEraseRender();
  const operation = new Promise(resolve => strokeDeleteQueue.set(id, resolve));
  if (!strokeDeleteBusy && !strokeDeleteTimer) strokeDeleteTimer = setTimeout(flushStrokeDeletes, 80);
  return operation;
}
async function flushStrokeDeletes() {
  strokeDeleteTimer = 0;
  if (strokeDeleteBusy || !strokeDeleteQueue.size) return;
  strokeDeleteBusy = true;
  const batch = [...strokeDeleteQueue];
  strokeDeleteQueue.clear();
  try {
    const response = await fetch('/api/strokes/delete-batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: batch.map(([id]) => id) })
    });
    if (!response.ok) throw new Error(i18n.t('No se pudieron borrar los trazados'));
    for (const [id] of batch) {
      strokes.delete(id); strokeBounds.delete(id); strokeChunks.delete(id); strokeSpaces.delete(id);
    }
  } catch (error) { toast(error.message); }
  finally {
    for (const [id, resolve] of batch) { pendingErase.delete(id); resolve(); }
    strokeDeleteBusy = false;
    scheduleEraseRender();
    if (strokeDeleteQueue.size) strokeDeleteTimer = setTimeout(flushStrokeDeletes, 0);
  }
}
function pointSegmentDistanceSquared(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
}
function segmentsDistanceSquared(a, b, c, d) {
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const ab1 = cross(a, b, c), ab2 = cross(a, b, d), cd1 = cross(c, d, a), cd2 = cross(c, d, b);
  if (ab1 * ab2 <= 0 && cd1 * cd2 <= 0 && Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <= Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) && Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <= Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]))) return 0;
  return Math.min(pointSegmentDistanceSquared(...a, ...c, ...d), pointSegmentDistanceSquared(...b, ...c, ...d), pointSegmentDistanceSquared(...c, ...a, ...b), pointSegmentDistanceSquared(...d, ...a, ...b));
}
function eraseSweep(ax, ay, bx, by) {
  const radius = Number(eraserRadiusInput.value);
  eraseConnections(ax,ay,bx,by,radius);
  for (const [id, writing] of writings) {
    if (writing.locked || pendingWritingErase.has(id) || !writingSizeInteractive(writing) || !vaultContentVisible('writings', id) || vaultOwner('writings', id) !== (gesture?.vaultId || null)) continue;
    const hit = writingEraserHit(writing, ax, ay, bx, by, radius);
    if (hit && gesture?.type === 'erase') {
      gesture.erasedWritings.push({ ...structuredClone(writing), vaultId: vaultOwner('writings', id) });
      gesture.deletions.push(deleteWriting(id, false));
    }
  }
  for (const [id, stroke] of strokes) {
    if (pendingErase.has(id) || !vaultContentVisible('strokes', id) || vaultOwner('strokes', id) !== (gesture?.vaultId || null)) continue;
    const bounds = strokeWorldBounds(id);
    const reach = radius + stroke.width * camera.scale / 2;
    if (!bounds || camera.x + bounds.maxX * camera.scale < Math.min(ax, bx) - reach || camera.x + bounds.minX * camera.scale > Math.max(ax, bx) + reach || camera.y + bounds.maxY * camera.scale < Math.min(ay, by) - reach || camera.y + bounds.minY * camera.scale > Math.max(ay, by) + reach) continue;
    let previous = worldToScreen(stroke.points[0]);
    for (let index = 1; index < stroke.points.length; index++) {
      const point = stroke.points[index];
      const next = worldToScreen(point);
      if (segmentsDistanceSquared([ax, ay], [bx, by], previous, next) <= reach * reach) {
        // Linked strokes are one drawing: erase and restore them in one batch.
        for(const member of shortcutMembers({kind:'strokes',id})) {
          if(member.kind!=='strokes' || pendingErase.has(member.id)) continue;
          const linkedStroke=strokes.get(member.id);if(!linkedStroke) continue;
          if(gesture?.type==='erase') {
            gesture.erased.push({...structuredClone(linkedStroke),vaultId:vaultOwner('strokes',member.id)});
            gesture.deletions.push(deleteStroke(member.id));
          } else deleteStroke(member.id);
        }
        break;
      }
      previous = next;
    }
  }
}
function vaultEraseSweep(event) {
  if (gesture?.type !== 'erase' || gesture.boundaryStopped) return;
  const a = screenToWorld(gesture.lastX, gesture.lastY), b = screenToWorld(event.clientX, event.clientY);
  const t = vaultSegmentLimit([a.x, a.y], [b.x, b.y], gesture.vaultId);
  const x = gesture.lastX + (event.clientX - gesture.lastX) * t;
  const y = gesture.lastY + (event.clientY - gesture.lastY) * t;
  eraseSweep(gesture.lastX, gesture.lastY, x, y);
  gesture.lastX = x; gesture.lastY = y;
  if (t < 1 || !vaultGestureAllows(event)) gesture.boundaryStopped = true;
}
function positionEraser(x, y) {
  const radius = Number(eraserRadiusInput.value);
  eraserCursor.style.left = `${x}px`;
  eraserCursor.style.top = `${y}px`;
  eraserCursor.style.width = `${radius * 2}px`;
  eraserCursor.style.height = `${radius * 2}px`;
}
const writingMeasure = document.createElement('canvas').getContext('2d');
const writingEraseMask = document.createElement('canvas');
const writingEraseContext = writingEraseMask.getContext('2d', { willReadFrequently: true });
function writingEraserHit(writing, ax, ay, bx, by, radius) {
  // Rasterize only the sweep's visible area, then intersect it with the actual
  // letter ink. Spaces, line gaps and letter counters remain transparent.
  const left = Math.max(0, Math.floor(Math.min(ax, bx) - radius));
  const top = Math.max(0, Math.floor(Math.min(ay, by) - radius));
  const right = Math.min(innerWidth, Math.ceil(Math.max(ax, bx) + radius));
  const bottom = Math.min(innerHeight, Math.ceil(Math.max(ay, by) + radius));
  const width = right - left, height = bottom - top;
  if (width <= 0 || height <= 0) return false;
  writingEraseMask.width = width; writingEraseMask.height = height;
  const ctx = writingEraseContext;
  const scale = writing.size * camera.scale / 48;
  ctx.setTransform(scale, 0, 0, scale, camera.x + writing.x * camera.scale - left, camera.y + writing.y * camera.scale - top);
  ctx.font = scribeCanvasFont(); ctx.fillStyle = '#fff';
  writing.text.split('\n').forEach((line,index)=>{
    if(!scribeOutlines){ctx.fillText(line,0,index*64.8);return;}
    // Match SVG's disabled ligatures and the vector layout exactly.
    const unit=48/scribeOutlines.units;let x=0,previous=null;
    for(const character of line){
      const code=character.codePointAt(0),glyph=scribeOutlines.chars[code]||scribeOutlines.chars[63];
      if(!glyph)continue;
      if(previous!==null)x+=(scribeOutlines.kern[`${previous},${code}`]||0)*unit;
      ctx.fillText(character,x,index*64.8);x+=glyph.a*unit;previous=code;
    }
  });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  if (ax === bx && ay === by) {
    ctx.arc(ax - left, ay - top, radius, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.lineWidth = radius * 2; ctx.lineCap = 'round';
    ctx.moveTo(ax - left, ay - top); ctx.lineTo(bx - left, by - top); ctx.stroke();
  }
  const pixels = ctx.getImageData(0, 0, width, height).data;
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) return true;
  return false;
}
const writingWidthCache = new Map();
const writingDetailThreshold = 4096;
function pointLineDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return Math.abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dy) / (Math.hypot(dx, dy) || 1);
}
function curveOutside(points, width, height) {
  return points.every(p => p[0] < -2) || points.every(p => p[0] > width + 2) || points.every(p => p[1] < -2) || points.every(p => p[1] > height + 2);
}
function flattenCurve(points, output, width, height, depth = 0) {
  const end = points.at(-1);
  if (curveOutside(points, width, height) || depth >= 22 || points.slice(1, -1).every(p => pointLineDistance(p, points[0], end) < .3)) { output.push(end); return; }
  let row = points, left = [row[0]], right = [row.at(-1)];
  while (row.length > 1) {
    row = row.slice(0, -1).map((point, index) => [(point[0] + row[index + 1][0]) / 2, (point[1] + row[index + 1][1]) / 2]);
    left.push(row[0]); right.unshift(row.at(-1));
  }
  flattenCurve(left, output, width, height, depth + 1);
  flattenCurve(right, output, width, height, depth + 1);
}
function clipPolygon(points, width, height) {
  let polygon = points;
  for (const [axis, limit, inside] of [[0, -2, true], [0, width + 2, false], [1, -2, true], [1, height + 2, false]]) {
    if (!polygon.length) break;
    const next = [];
    let previous = polygon.at(-1);
    for (const current of polygon) {
      const a = inside ? previous[axis] >= limit : previous[axis] <= limit;
      const b = inside ? current[axis] >= limit : current[axis] <= limit;
      if (a !== b) {
        const ratio = (limit - previous[axis]) / (current[axis] - previous[axis]);
        next.push([previous[0] + (current[0] - previous[0]) * ratio, previous[1] + (current[1] - previous[1]) * ratio]);
      }
      if (b) next.push(current);
      previous = current;
    }
    polygon = next;
  }
  return polygon;
}
function paintOutline(glyph, x, y, scale, width, height) {
  const path = new Path2D();
  let contour = [], previous = null;
  const finish = () => {
    const clipped = clipPolygon(contour, width, height);
    if (clipped.length >= 3) {
      path.moveTo(...clipped[0]);
      for (let index = 1; index < clipped.length; index++) path.lineTo(...clipped[index]);
      path.closePath();
    }
    contour = []; previous = null;
  };
  const project = (gx, gy) => [x + gx * scale, y + gy * scale];
  for (const command of glyph.c) {
    if (command[0] === 'M') { if (contour.length) finish(); previous = project(command[1], command[2]); contour.push(previous); }
    else if (command[0] === 'L') { previous = project(command[1], command[2]); contour.push(previous); }
    else if (command[0] === 'Q') {
      const control = project(command[1], command[2]), end = project(command[3], command[4]);
      flattenCurve([previous, control, end], contour, width, height); previous = end;
    } else if (command[0] === 'C') {
      const first = project(command[1], command[2]), second = project(command[3], command[4]), end = project(command[5], command[6]);
      flattenCurve([previous, first, second, end], contour, width, height); previous = end;
    } else if (command[0] === 'Z') finish();
  }
  if (contour.length) finish();
  writingDetailContext.fill(path, 'nonzero');
}
// The draft uses the same vector renderer as saved text; the textarea only receives input.
function* visibleWritings() {
  if (!showTexts) return;
  for (const writing of writings.values()) {
    if (writing.id !== editingWriting?.id && vaultContentVisible('writings', writing.id)) yield writing;
  }
  if (editingWriting) yield { ...editingWriting, id: '__writing_draft', text: writingEditor.value };
}
function renderWritingCaret() {
  let caret = ownedWritingLayer.querySelector('.writing-caret');
  if (!editingWriting) { caret?.remove(); return; }
  if (!caret) {
    caret = document.createElementNS(svgNS, 'line');
    caret.classList.add('writing-caret');
    ownedWritingLayer.append(caret);
  }
  const edit = editingWriting;
  const prefix = writingEditor.value.slice(0, writingEditor.selectionEnd);
  const lines = prefix.split('\n');
  writingMeasure.font = scribeCanvasFont();
  const pixels = edit.size * camera.scale;
  const x = camera.x + edit.x * camera.scale + measureScribeLine(lines.at(-1)) * pixels / 48;
  const y = camera.y + edit.y * camera.scale + (lines.length - 1) * pixels * 1.35;
  caret.setAttribute('x1', x); caret.setAttribute('x2', x);
  caret.setAttribute('y1', y - pixels * .85); caret.setAttribute('y2', y + pixels * .15);
  caret.setAttribute('stroke', edit.color);
}
function paintWritingDetails(ownedPass = false) {
  ownedPass = ownedPass === true;
  if (!ownedPass) paintWritingDetails(true);
  const writingDetail = ownedPass ? ownedWritingDetail : document.querySelector('#writingDetail');
  const writingDetailContext = writingDetail.getContext('2d');
  if (ownedPass) { writingDetail.width = drawingLayer.width; writingDetail.height = drawingLayer.height; }
  const dpr = devicePixelRatio || 1;
  const width = writingDetail.width / dpr, height = writingDetail.height / dpr;
  writingDetailContext.setTransform(1, 0, 0, 1, 0, 0);
  writingDetailContext.clearRect(0, 0, writingDetail.width, writingDetail.height);
  if (!scribeOutlines) return;
  writingDetailContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const writing of visibleWritings()) {
    const owner = vaultOwner('writings', writing.id) || (writing.id === '__writing_draft' ? editingWriting?.vaultId : null);
    if (Boolean(owner) !== ownedPass) continue;
    const fontPixels = writing.size * camera.scale;
    if (fontPixels <= writingDetailThreshold) continue;
    const scale = fontPixels / scribeOutlines.units;
    const startX = camera.x + writing.x * camera.scale;
    const startY = camera.y + writing.y * camera.scale;
    const lines = writing.text.split('\n');
    if (startX > width + fontPixels || startX + writingWidth(writing) * fontPixels / 48 < -fontPixels || startY - fontPixels > height || startY + lines.length * fontPixels * 1.35 < 0) continue;
    writingDetailContext.save();
    if (!freeVaultObjectPreview('writings', writing)) clipVaultCanvas(writingDetailContext, vaultOwner('writings', writing.id) || (writing.id === '__writing_draft' ? editingWriting?.vaultId : null), dpr);
    writingDetailContext.fillStyle = writing.color;
    for (const [lineIndex, line] of lines.entries()) {
      let x = startX, previousCode = null;
      const y = startY + lineIndex * fontPixels * 1.35;
      if (y < -fontPixels * 2 || y > height + fontPixels * 2) continue;
      for (const character of line) {
        const code = character.codePointAt(0);
        const glyph = scribeOutlines.chars[code] || scribeOutlines.chars[63];
        if (!glyph) continue;
        if (previousCode !== null) x += (scribeOutlines.kern[`${previousCode},${code}`] || 0) * scale;
        if (x < width + fontPixels && x + glyph.a * scale > -fontPixels) paintOutline(glyph, x, y, scale, width, height);
        x += glyph.a * scale;
        previousCode = code;
        if (x > width + fontPixels && scale > 0) break;
      }
    }
    writingDetailContext.restore();
  }
}
function measureScribeLine(line) {
  if (!scribeOutlines) {
    writingMeasure.font = scribeCanvasFont();
    return writingMeasure.measureText(line).width;
  }
  let units = 0, previous = null;
  for (const character of line) {
    const code = character.codePointAt(0);
    const glyph = scribeOutlines.chars[code] || scribeOutlines.chars[63];
    if (!glyph) continue;
    if (previous !== null) units += scribeOutlines.kern[`${previous},${code}`] || 0;
    units += glyph.a;
    previous = code;
  }
  return units * 48 / scribeOutlines.units;
}
function writingWidth(writing) {
  if (writingWidthCache.has(writing.text)) return writingWidthCache.get(writing.text);
  writingMeasure.font = scribeCanvasFont();
  const width = Math.max(1, ...writing.text.split('\n').map(line => measureScribeLine(line || ' ')));
  writingWidthCache.set(writing.text, width);
  return width;
}
const writingInkCache = new Map();
function writingInkBounds(text) {
  const cached = writingInkCache.get(text);
  if (cached) return cached;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const unit = scribeOutlines ? 48 / scribeOutlines.units : 1;
  for (const [index, line] of text.split('\n').entries()) {
    const baseline = index * 64.8;
    if (!scribeOutlines || !Object.hasOwn(scribeOutlines.chars[63] || {}, 'b')) {
      writingMeasure.font = scribeCanvasFont();
      const metrics = writingMeasure.measureText(line);
      if (!line.trim()) continue;
      left = Math.min(left, -metrics.actualBoundingBoxLeft);
      right = Math.max(right, metrics.actualBoundingBoxRight);
      top = Math.min(top, baseline - metrics.actualBoundingBoxAscent);
      bottom = Math.max(bottom, baseline + metrics.actualBoundingBoxDescent);
      continue;
    }
    let x = 0, previous = null;
    for (const character of line) {
      const code = character.codePointAt(0), glyph = scribeOutlines.chars[code] || scribeOutlines.chars[63];
      if (!glyph) continue;
      if (previous !== null) x += (scribeOutlines.kern[`${previous},${code}`] || 0) * unit;
      if (glyph.b) {
        left = Math.min(left, x + glyph.b[0] * unit);
        right = Math.max(right, x + glyph.b[2] * unit);
        top = Math.min(top, baseline + glyph.b[1] * unit);
        bottom = Math.max(bottom, baseline + glyph.b[3] * unit);
      }
      x += glyph.a * unit; previous = code;
    }
  }
  const bounds = Number.isFinite(left) ? { left, top, right, bottom } : { left: 0, top: 0, right: 0, bottom: 0 };
  if (writingInkCache.size > 1000) writingInkCache.clear();
  writingInkCache.set(text, bounds);
  return bounds;
}
function writingScreenSize(writing) {
  const fontPixels = writing.size * camera.scale;
  return { width: writingWidth(writing) * fontPixels / 48, height: writing.text.split('\n').length * fontPixels * 1.35 };
}
function writingSizeInteractive(writing) {
  const { width, height } = writingScreenSize(writing);
  return width < innerWidth * .88 && height < innerHeight * .85;
}
function writingInteractive(writing) {
  return !writing.locked && mode !== 'draw' && mode !== 'erase' && mode !== 'pan' && writingSizeInteractive(writing);
}
function hideWritingControlsSoon() {
  clearTimeout(writingHoverTimer);
  writingHoverTimer = setTimeout(() => {
    if (gesture?.type === 'writing-resize' || selectedWriting) return;
    if(!writingControls.hidden) {
      const rect=writingControls.getBoundingClientRect(), {x,y}=pointerPosition;
      if(x>=rect.left-24 && x<=rect.right+24 && y>=rect.top-24 && y<=rect.bottom+24) return;
    }
    hoveredWriting = null;
    writingControls.hidden = true;
  }, 140);
}
function positionWritingControls() {
  const activeId = gesture?.type === 'writing-resize' ? gesture.id : selectedWriting || hoveredWriting;
  const writing = activeId && writings.get(activeId);
  const group = activeId && writingNodes.get(activeId);
  if (!writing || !group || group.hasAttribute('hidden') || !writingInteractive(writing)) { writingControls.hidden = true; return; }
  const { width, height } = writingScreenSize(writing);
  if (gesture?.type !== 'writing-resize' && Math.max(width, height) < 150) { writingControls.hidden = true; return; }
  const bounds=vaultObjectBounds('writings',writing);
  const rect={left:camera.x+bounds.x*camera.scale,top:camera.y+bounds.y*camera.scale,width:bounds.width*camera.scale,height:bounds.height*camera.scale};
  if (!rect.width || !rect.height) { writingControls.hidden = true; return; }
  writingControls.hidden = false;
  writingControls.dataset.id = activeId;
  writingControls.classList.toggle('writing-locked',Boolean(writing.locked));
  const lockButton=document.querySelector('#writingLock');
  lockButton.setAttribute('aria-pressed',String(Boolean(writing.locked)));
  lockButton.title=writing.locked?'Desbloquear texto':'Bloquear texto';lockButton.setAttribute('aria-label',lockButton.title);
  lockButton.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true" class="ui-icon"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="${writing.locked?'M8 10V6a4 4 0 0 1 8 0v4':'M8 10V6a4 4 0 0 1 8 0'}"/></svg>`;
  writingControls.style.left = `${rect.left}px`;
  writingControls.style.top = `${rect.top}px`;
  writingControls.style.width = `${rect.width}px`;
  writingControls.style.height = `${rect.height}px`;
}
document.querySelector('#writingLock').addEventListener('pointerdown',event=>event.stopPropagation());
document.querySelector('#writingLock').addEventListener('click',async event=>{
  event.stopPropagation();const button=event.currentTarget,id=writingControls.dataset.id,writing=writings.get(id);
  if(!writing||button.disabled||gesture||historyBusy)return;
  const before=Boolean(writing.locked),after=!before;button.disabled=true;
  try{await applyWritingChanges(id,{locked:after});magicSelection.delete(`writings:${id}`);renderMagicLaser();rememberWritingChange(id,{locked:before},{locked:after},'bloqueo de texto');}
  catch(error){toast(error.message);}finally{button.disabled=false;}
});
writingControls.addEventListener('pointerenter', () => clearTimeout(writingHoverTimer));
writingControls.addEventListener('pointerleave', hideWritingControlsSoon);
viewport.addEventListener('pointermove',()=> {
  if(!hoveredWriting || selectedWriting || writingControls.hidden || gesture) return;
  const rect=writingControls.getBoundingClientRect(), {x,y}=pointerPosition;
  if(x<rect.left-24 || x>rect.right+24 || y<rect.top-24 || y>rect.bottom+24) hideWritingControlsSoon();
  else clearTimeout(writingHoverTimer);
});
for (const handle of writingControls.querySelectorAll('.writing-handle')) {
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || zHeld) return;
    const id = writingControls.dataset.id;
    const writing = writings.get(id);
    if (!writing || writing.locked) return;
    event.preventDefault(); event.stopPropagation();
    clearTimeout(writingHoverTimer);
    const rect = writingControls.getBoundingClientRect();
    const corner = handle.dataset.corner;
    const anchorX = corner.includes('w') ? rect.right : rect.left;
    const anchorY = corner.includes('n') ? rect.bottom : rect.top;
    const cornerX = corner.includes('w') ? rect.left : rect.right;
    const cornerY = corner.includes('n') ? rect.top : rect.bottom;
    const [baseX, baseY] = worldToScreen([writing.x, writing.y]);
    gesture = { type: 'writing-resize', pointer: event.pointerId, id, startX: event.clientX, startY: event.clientY, x: writing.x, y: writing.y, size: writing.size, anchorX, anchorY, cornerX, cornerY, baseX, baseY };
    viewport.setPointerCapture(event.pointerId);
  });
}
function makeWritingNode(writing) {
  const group = document.createElementNS(svgNS, 'g');
  group.classList.add('canvas-writing');
  group.dataset.id = writing.id;
  group.setAttribute('role', 'button');
  group.setAttribute('tabindex', '0');
  group.setAttribute('aria-label', i18n.t(`Texto: ${writing.text.slice(0, 80)}`));
  group.addEventListener('pointerenter', () => { clearTimeout(writingHoverTimer); hoveredWriting = writing.id; positionWritingControls(); });
  group.addEventListener('pointerleave', hideWritingControlsSoon);
  group.addEventListener('pointerdown', event => {
    if (event.button !== 0 || zHeld || editingWriting || mode === 'draw' || mode === 'erase' || mode === 'pan') return;
    event.preventDefault(); event.stopPropagation();
    if(writings.get(writing.id)?.locked){selectWriting(writing.id);return;}
    if(event.ctrlKey||event.metaKey){startDuplicateDrag(event,[{kind:'writings',id:writing.id}]);return;}
    if (textEditTap(event, 'writing', writing.id)) return;
    selectWriting(writing.id);
    const current = writings.get(writing.id);
    gesture = { type: 'writing', pointer: event.pointerId, id: writing.id, startX: event.clientX, startY: event.clientY, x: current.x, y: current.y };
    viewport.setPointerCapture(event.pointerId);
  });
  group.addEventListener('dblclick', event => { event.preventDefault(); event.stopPropagation(); });
  group.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); beginWritingEdit(writing.id); } });
  writingLayer.append(group);
  writingNodes.set(writing.id, group);
  return group;
}
function renderWritings() {
  if (!showTexts) return;
  writingLayer.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
  ownedWritingLayer.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
  for (const [id, node] of writingNodes) if (!vaultContentVisible('writings', id)) node.setAttribute('hidden', '');
  for (const writing of visibleWritings()) {
    const width = writingWidth(writing) * writing.size / 48 * camera.scale;
    const height = writing.text.split('\n').length * writing.size * 1.35 * camera.scale;
    const x = camera.x + writing.x * camera.scale;
    const y = camera.y + writing.y * camera.scale;
    let group = writingNodes.get(writing.id);
    if (x > innerWidth + 100 || x + width < -100 || y - writing.size * camera.scale > innerHeight + 100 || y + height < -100) {
      if (group) group.setAttribute('hidden', '');
      continue;
    }
    const fontPixels = writing.size * camera.scale;
    // At extreme zoom the clipped outline canvas already draws the text.
    // Opacity zero still leaves a gigantic SVG text layout in the browser.
    if (fontPixels > writingDetailThreshold && scribeOutlines) {
      if (group && !group.hasAttribute('hidden')) group.setAttribute('hidden', '');
      if (selectedWriting === writing.id) selectedWriting = null;
      if (hoveredWriting === writing.id) hoveredWriting = null;
      continue;
    }
    if (!group) group = makeWritingNode(writing);
    const writingOwner = vaultOwner('writings', writing.id) || (writing.id === '__writing_draft' ? editingWriting?.vaultId : null);
    const parent = writingOwner || gesture?.id === writing.id ? ownedWritingLayer : writingLayer;
    if (group.parentElement !== parent) parent.append(group);
    group.removeAttribute('hidden');
    group.style.opacity = '';
    const signature = `${writing.text}\u0000${writing.color}`;
    if (group.dataset.signature !== signature) {
      group.replaceChildren();
      writing.text.split('\n').forEach((line, index) => {
        const element = document.createElementNS(svgNS, 'text');
        element.setAttribute('x', '0');
        element.setAttribute('y', String(index * 64.8));
        element.textContent = line || ' ';
        group.append(element);
      });
      group.dataset.signature = signature;
      group.setAttribute('fill', writing.color);
      group.setAttribute('aria-label', i18n.t(`Texto: ${writing.text.slice(0, 80)}`));
    }
    // Glyphs stay at 48 SVG units. Zoom is applied as a camera-relative transform,
    // avoiding huge browser font-size values and loss of precision in world coordinates.
    group.setAttribute('transform', `translate(${x} ${y}) scale(${writing.size * camera.scale / 48})`);
    if(screenFrozen.has(`writings:${writing.id}`)) group.removeAttribute("clip-path");
    else applyVaultWritingClip(group, writing);
    const interactive = !editingWriting && writingInteractive(writing);
    if (!interactive && selectedWriting === writing.id) selectedWriting = null;
    if (!interactive && hoveredWriting === writing.id) hoveredWriting = null;
    group.style.pointerEvents = interactive ? 'visiblePainted' : 'none';
    group.classList.toggle('selected', selectedWriting === writing.id);
    group.classList.toggle('writing-locked',Boolean(writing.locked));
    group.style.setProperty('--selection-width', fontPixels > 256 ? '0' : String(48 / fontPixels));
  }
  positionWritingControls();
  scheduleConnectionRender();
  paintWritingDetails();
  renderWritingCaret();
}
function selectWriting(id) { selectedWriting = id; renderWritings(); }
function beginWritingEdit(id, x, y) {
  if(id && writings.get(id)?.locked)return;
  if (!showTexts) setTextsVisible(true);
  if (editingWriting) finishWritingEdit(true);
  const writing = id ? writings.get(id) : null;
  editingWriting = { vaultId: id ? vaultOwner('writings', id) : vaultScopeAtScreen(x, y), id, x: writing?.x ?? screenToWorld(x, y).x, y: writing?.y ?? screenToWorld(x, y).y, size: writing?.size ?? 48 / camera.scale, color: writing?.color ?? document.querySelector('#penColor').value, original: writing?.text ?? '' };
  writingEditor.value = writing?.text ?? '';
  writingEditor.hidden = false;
  selectedWriting = null;
  hoveredWriting = null;
  writingEditor.focus({ preventScroll: true });
  writingEditor.setSelectionRange(writingEditor.value.length, writingEditor.value.length);
  const originalNode = id && writingNodes.get(id);
  if (originalNode) originalNode.style.display = 'none';
  renderWritings();
}
async function finishWritingEdit(save) {
  canvasActions++;
  try { return await finishWritingEditImpl(save); }
  finally { canvasActions--; }
}
async function finishWritingEditImpl(save) {
  const edit = editingWriting;
  if (!edit) return;
  editingWriting = null;
  const value = writingEditor.value;
  writingEditor.hidden = true;
  writingNodes.get('__writing_draft')?.remove();
  writingNodes.delete('__writing_draft');
  if (edit.id && writingNodes.has(edit.id)) writingNodes.get(edit.id).style.display = '';
  if (save && mode !== 'draw') setMode('draw');
  renderWritings();
  if (!save || !value.trim()) return;
  const destination = [...vaults.values()].find(v => v.id === edit.vaultId && v.open && vaultFits(vaultInterior(v), vaultObjectBounds('writings', { ...edit, text: value })));
  try {
    const response = await fetch(edit.id ? `/api/writings/${edit.id}` : '/api/writings', { method: edit.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(edit.id ? { text: value } : { text: value, x: edit.x, y: edit.y, size: edit.size, color: edit.color, vaultId: destination?.id }) });
    const writing = await response.json();
    if (!response.ok) throw new Error(writing.error || i18n.t('No se pudo guardar el texto'));
    if (!edit.id && destination) { destination.members.writings.push(writing.id); rebuildVaultOwners(); }
    writings.set(writing.id, writing);
    if (!edit.id && destination) await saveVaultMembership();
    await reconcileVaults();
    selectedWriting = null;
    renderWritings(); updateCount();
    if (!edit.id) {
      const snapshot = { ...structuredClone(writing), vaultId: vaultOwner('writings', writing.id) };
      remember({ label: i18n.t('texto creado'), undo: () => setWritingPresent(snapshot, false), redo: () => setWritingPresent(snapshot, true) });
    } else rememberWritingChange(edit.id, { text: edit.original }, { text: value }, 'edición de texto');
  } catch (error) { toast(error.message); if (vaultBusy) throw error; }
}
writingEditor.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finishWritingEdit(true); }
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); finishWritingEdit(true); }
});
writingEditor.addEventListener('input', renderWritings);
writingEditor.addEventListener('select', renderWritingCaret);
writingEditor.addEventListener('keyup', renderWritingCaret);
writingEditor.addEventListener('blur', () => finishWritingEdit(true));
async function deleteWriting(id, recordHistory = true) {
  if (pendingWritingErase.has(id)) return;
  const writing = writings.get(id);
  if (!writing) return;
  const snapshot = { ...structuredClone(writing), vaultId: vaultOwner('writings', writing.id) };
  pendingWritingErase.add(id);
  try {
    const response = await fetch(`/api/writings/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(i18n.t('No se pudo borrar el texto'));
    writings.delete(id); writingNodes.get(id)?.remove(); writingNodes.delete(id);
    if (selectedWriting === id) selectedWriting = null;
    if (hoveredWriting === id) { hoveredWriting = null; writingControls.hidden = true; }
    renderWritings(); updateCount();
    if (recordHistory) remember({ label: i18n.t('texto borrado'), undo: () => setWritingPresent(snapshot, true), redo: () => setWritingPresent(snapshot, false) });
  } catch (error) { toast(error.message); }
  finally { pendingWritingErase.delete(id); }
}
async function loadBoard() {
  if(playingVideoId)videoPreviews.get(playingVideoId)?.pause();
  gpuSceneDirty=true;
  photoGPU.reset();ownedPhotoGPU.reset();noteGPU.reset();ownedNoteGPU.reset();noteGPUSceneDirty=true;
  try {
    const versionResponseFirst = await fetch('/api/version');
    if (!versionResponseFirst.ok || (await versionResponseFirst.json()).version < 16) {
      document.body.classList.add('server-outdated');
      help.textContent = i18n.t('Reinicia el servidor (npm start) para activar el cifrado real de Vaults.');
      for (const button of document.querySelectorAll('.toolbar button')) button.disabled = true;
      return;
    }
    await apiChange('/api/vaults/lock-all', 'POST');
    const vaultResponse = await fetch('/api/vaults');
    if (vaultResponse.ok) for (const vault of await vaultResponse.json()) { vaults.set(vault.id, vault); createVaultNode(vault); }
    rebuildVaultOwners(); renderVaults();
    const [itemResponse, strokeResponse, writingResponse, versionResponse] = await Promise.all([fetch('/api/items'), fetch('/api/strokes'), fetch('/api/writings'), fetch('/api/version')]);
    if (!itemResponse.ok) throw new Error(i18n.t('No se pudo cargar el canvas'));
    mergeItems(await itemResponse.json());
    updateStacking();
    photoGPU.beginPackedPreviews([...items.values()].filter(a=>a.type==='image'&&a.status==='ready'&&!vaultOwner('items',a.id)).sort((a,b)=>(gpuRanks.get(a.id)||0)-(gpuRanks.get(b.id)||0)));
    if (strokeResponse.ok) {
      for (const stroke of await strokeResponse.json()) addStroke(stroke, true);
      redrawStrokes();
      updateCount();
    }
    if (writingResponse.ok) for (const writing of await writingResponse.json()) writings.set(writing.id, writing);
    renderWritings(); updateCount();
    if (!versionResponse.ok || (await versionResponse.json()).version < 16) {
      document.body.classList.add('server-outdated');
      help.textContent = i18n.t('Reinicia el servidor (npm start) para activar las Vaults.');
      for (const id of ['drawButton', 'laserButton', 'eraseButton', 'toggleStrokes', 'toggleTexts', 'toggleMedia', 'textButton', 'writeButton', 'audioButton', 'addButton', 'clearButton', 'vaultButton']) document.getElementById(id).disabled = true;
      return;
    }
    if (!strokeResponse.ok || !writingResponse.ok) throw new Error(i18n.t('No se pudieron cargar los dibujos o textos'));
  } catch (error) { toast(error.message); }
}
async function refreshItems() {
  try {
    const response = await fetch('/api/items');
    if (response.ok && !vaultDrag && !vaultBusy) {
      mergeItems(await response.json());
      if (!gesture) for (const [id, vaultId] of pendingVaultImports) {
        if (items.get(id)?.status === 'processing') continue;
        await reconcileVaults({ kind: 'items', id, vaultId });
        pendingVaultImports.delete(id);
      }
      await reconcileVaults();
    }
  } catch { /* Next poll retries. */ }
}
async function browserVideoCompatible(file,linked=false){
 if(!linked&&file.size>=40*1024*1024)return false;
 const video=document.createElement('video'),url=URL.createObjectURL(file);video.muted=true;video.preload='auto';
 try{return await new Promise(resolve=>{const timer=setTimeout(()=>finish(false),8000);const finish=value=>{clearTimeout(timer);resolve(value);};video.onloadeddata=()=>finish(video.videoWidth>0&&video.videoHeight>0);video.onerror=()=>finish(false);video.src=url;});}
 finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}
async function addFiles(files, x, y, options={}) {
  canvasActions++;
  try { return await addFilesImpl(files, x, y, options); }
  finally { canvasActions--; }
}
function isMediaFile(file) {
  return /^(video|image|audio)\//.test(file.type) || /\.(mp3|wav|ogg|oga|opus|flac|m4a|aac|aiff|mp4|mov|mkv|webm|avi|m4v|jpg|jpeg|png|gif|webp|heic|heif|tif|tiff|bmp|avif|svg)$/i.test(file.name);
}
async function createFileClip(file,x,y) {
  if(!window.apoxiaDesktop?.linkPickedFile) throw new Error(i18n.t('Los accesos a archivos locales requieren la app de escritorio'));
  const targetVault=vaults.get(vaultScopeAtScreen(x,y));
  if(targetVault && !targetVault.open) throw new Error(i18n.t('Abre la Vault antes de añadir contenido'));
  const fileLink=await window.apoxiaDesktop.linkPickedFile(file);
  const points=[[18,12],[18,30]];
  const arc=(cx,cy,r,start,end)=> {
    for(let i=1;i<=24;i++) {const angle=start+(end-start)*i/24;points.push([cx+r*Math.cos(angle),cy+r*Math.sin(angle)]);}
  };
  arc(10,30,8,0,Math.PI);points.push([2,9]);
  arc(8,9,6,Math.PI,2*Math.PI);points.push([14,29]);
  arc(10,29,4,0,Math.PI);points.push([6,12]);
  // Draw a single smooth vector stroke, rotated like the toolbar's paperclip.
  const origin=screenToWorld(x,y),scale=3/camera.scale,angle=Math.PI/4;
  const worldPoints=points.map(([px,py])=> {
    px-=10;py-=21.5;
    return [origin.x+(px*Math.cos(angle)+py*Math.sin(angle))*scale,origin.y+(-px*Math.sin(angle)+py*Math.cos(angle))*scale];
  });
  const b=pointBounds(worldPoints,0,worldPoints.length-1),width=3/camera.scale;
  const owner=targetVault && vaultFits(vaultInterior(targetVault),{x:b.minX-width/2,y:b.minY-width/2,width:b.maxX-b.minX+width,height:b.maxY-b.minY+width})?targetVault.id:null;
  const stroke=await apiChange('/api/strokes','POST',{points:worldPoints,color:penColor.value,width,vaultId:owner});
  if(owner) {if(!vaults.get(owner).members.strokes.includes(stroke.id)) vaults.get(owner).members.strokes.push(stroke.id);rebuildVaultOwners();}
  addStroke(stroke);
  try {
    await updateObjectLinks([{kind:'strokes',id:stroke.id,fileLink}]);
    if(owner) await saveVaultMembership();
  } catch(error) {await setStrokePresent({...stroke,vaultId:owner},false);throw error;}
  const snapshot={...structuredClone(strokes.get(stroke.id)),vaultId:owner};
  remember({label:i18n.t('acceso directo creado'),undo:()=>setStrokePresent(snapshot,false),redo:()=>setStrokePresent(snapshot,true)});
}
const imagePrepareQueue=[],imagePrepareWorkers=[];
function prepareNativeImage(file){if(file.type==='image/svg+xml'||/\.svg$/i.test(file.name))return window.ApoxiaSVG.prepare(file);return new Promise((resolve,reject)=>{imagePrepareQueue.push({file,resolve,reject});pumpPrepare();});}
function pumpPrepare(){while(imagePrepareWorkers.length<2){const state={worker:new Worker('/gpu-worker.js'),busy:false};state.worker.onmessage=async({data})=>{const task=state.task;state.busy=false;state.task=null;data.bitmap?.close();if(data.error)task.reject(Error(data.error));else{const bytes=new Uint8Array(await data.blob.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);task.resolve({width:data.width,height:data.height,thumbnail:btoa(binary)});}pumpPrepare();};state.worker.onerror=()=>{state.task?.reject(Error('No se pudo preparar la imagen'));state.busy=false;state.task=null;pumpPrepare();};imagePrepareWorkers.push(state);}for(const state of imagePrepareWorkers){if(state.busy)continue;const task=imagePrepareQueue.shift();if(!task)continue;state.busy=true;state.task=task;state.worker.postMessage({file:task.file,size:64,prepare:true});}}
async function addFilesImpl(files, x, y, options={}) {
  const supported = [...files].filter(isMediaFile);
  if (!supported.length) return toast(i18n.t('Suelta vídeos, imágenes o audio'));
  const targetVault = vaults.get(vaultScopeAtScreen(x, y));
  if (targetVault && !targetVault.open) return toast(i18n.t('Abre la Vault antes de importar dentro'));
  const base = screenToWorld(x, y);
  const scale = camera.scale;
  const displayWidth = Math.min(1e12, Math.max(1e-9, 320 / scale));
  const preparedImages=new Map(),preparedIndices=new Set();
  const prepareAhead=index=>{for(let i=index;i<Math.min(index+4,supported.length);i++){const file=supported[i];if(!preparedIndices.has(i)&&(file.type.startsWith('image/')||/\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i.test(file.name))){preparedIndices.add(i);preparedImages.set(i,prepareNativeImage(file).catch(error=>(file.type==='image/svg+xml'||/\.svg$/i.test(file.name))?{error}:null));}}};
  prepareAhead(0);
  const importBatch = crypto.randomUUID();
  const columns=supported.length>100?Math.ceil(Math.sqrt(supported.length)):4;
  let cursor=0,complete=0,errors=0;
  window.__gpuImportProgress={total:supported.length,complete:0,errors:0,active:true};
  const importOne=async(index)=>{
    const file = supported[index],svgFile=file.type==='image/svg+xml'||/\.svg$/i.test(file.name);let vectorGeometry=null;
    const type = (file.type.startsWith('audio/') || /\.(mp3|wav|ogg|oga|opus|flac|m4a|aac|aiff)$/i.test(file.name)) ? 'audio' : file.type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|heic|heif|tif|tiff|bmp|avif|svg)$/i.test(file.name) ? 'image' : 'video';
    const query = new URLSearchParams({ name: svgFile&&!/\.svg$/i.test(file.name)?file.name+'.svg':file.name, type, displayWidth: String(type === 'audio' ? displayWidth / 2 : displayWidth), chromeScale: String(1 / scale), x: String(base.x + (index % columns) * 340 / scale), y: String(base.y + Math.floor(index / columns) * 200 / scale), importBatch, batchIndex: String(index), batchX: String(base.x), batchY: String(base.y),batchColumns:String(columns) });
    try {
      const headers={'Content-Type':'application/octet-stream'};
      if(type==='image'){try{prepareAhead(index);const prepared=await (preparedImages.get(index)||prepareNativeImage(file));preparedImages.delete(index);prepareAhead(index+1);if(prepared?.error)throw prepared.error;if(svgFile&&!prepared)throw new Error('No se pudo leer el SVG. Usa contornos de segmentos rectos, sin rellenos ni efectos.');vectorGeometry=prepared?.vector;if(prepared&&prepared.thumbnail.length<12000){query.set('native','1');query.set('originalWidth',prepared.width);query.set('originalHeight',prepared.height);headers['X-Apoxia-Thumbnail']=prepared.thumbnail;}}catch(error){if(svgFile)throw error;/* Other unsupported formats use the conversion pipeline. */}}
      const linked=!options.copyMedia&&!!window.apoxiaDesktop?.importLinkedMedia&&localStorage.getItem('apoxia.copyMediaOnImport')==='false';
      if(type==='video'){const compatible=await browserVideoCompatible(file,linked);if(linked&&!compatible)throw new Error('Este vídeo necesita conversión. Activa Copiar media al importar.');if(compatible)query.set('nativeVideo','1');}
      let item;
      if(linked)item=await window.apoxiaDesktop.importLinkedMedia(file,query.toString(),headers);
      else{const response=await fetch(`/api/items?${query}`,{method:'POST',body:file,headers});item=await response.json();if(!response.ok)throw new Error(item.error||'No se pudo importar');}
      if (targetVault) pendingVaultImports.set(item.id, targetVault.id);
      items.set(item.id, item);if(vectorGeometry){try{photoGPU.svgVectors.seed(item.id,vectorGeometry);}catch(error){photoGPU.svgVectors.failed.set(item.id,error.message);toast(error.message);}}updateCard(item);updateCount();
      await reconcileVaults();
      forgetHistory();
    } catch(error){errors++;toast(`${file.name}: ${error.message}`);}
    complete++;window.__gpuImportProgress={total:supported.length,complete,errors,active:true};
    if(complete%50===0)toast(`Importando ${complete.toLocaleString()} / ${supported.length.toLocaleString()}…`);
  };
  const run=async()=>{while(cursor<supported.length){const index=cursor++;await importOne(index);}};
  await Promise.all([run(),run()]);
  await refreshItems();
  window.__gpuImportProgress={total:supported.length,complete,errors,active:false};
  toast(`${complete-errors} archivos importados${errors?` · ${errors} errores`:''}`);
}
async function addText(x, y) {
  canvasActions++;
  try { return await addTextImpl(x, y); }
  finally { canvasActions--; }
}
async function addTextImpl(x = innerWidth / 2 - 150, y = innerHeight / 2 - 80) {
  if (!showTexts) await setTextsVisible(true);
  const targetVault = vaults.get(vaultScopeAtScreen(x, y));
  if (targetVault && !targetVault.open) return toast(i18n.t('Abre la Vault antes de crear una nota dentro'));
  const point = screenToWorld(x, y);
  const size = { displayWidth: 300 / camera.scale, displayHeight: 160 / camera.scale, textFontSize: 17 / camera.scale, chromeScale: 1 / camera.scale };
  try {
    const response = await fetch('/api/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...point, ...size, color: notePalette()[0], vaultId: targetVault && vaultFits(vaultInterior(targetVault), { x: point.x, y: point.y, width: size.displayWidth, height: size.displayHeight }) ? targetVault.id : null }) });
    const item = await response.json();
    if (!response.ok) throw new Error(item.error || 'No se pudo crear el texto');
    if (targetVault?.open && vaultFits(vaultInterior(targetVault), vaultObjectBounds('items', item))) {
      targetVault.members.items.push(item.id); rebuildVaultOwners();
    }
    items.set(item.id, item); updateCard(item); updateCount();
    if (vaultOwner('items', item.id)) await saveVaultMembership();
    await reconcileVaults();
    const snapshot = { ...structuredClone(item), vaultId: vaultOwner('items', item.id) };
    remember({ label: i18n.t('nota creada'), undo: () => setNotePresent(snapshot, false), redo: () => setNotePresent(snapshot, true) });
    cards.get(item.id).querySelector('textarea').focus();
  } catch (error) { toast(error.message); }
}
function drawPreview(points, color, width) {
  preview.replaceChildren();
  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute('d', smoothPath(smoothStrokePoints(points, width)));
  path.setAttribute('fill', 'none'); path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', width); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
  preview.append(path);
}
function scheduleDrawPreview() {
  if (previewFrame) return;
  previewFrame = requestAnimationFrame(() => {
    previewFrame = 0;
    if (gesture?.type === 'draw') drawPreview(gesture.screenPoints, gesture.color, gesture.width * camera.scale);
  });
}
function updateZoomCursor() {
  viewport.classList.toggle('zooming', zHeld || gesture?.type === 'zoom');
  viewport.classList.toggle('inverse-zooming', inverseZoomHeld || Boolean(gesture?.frozen?.length));
}
const magicSelection = new Map();
let rectangleSelection=false;
function rectangleSelectionHit(event){
 if(mode!=='move'||!rectangleSelection||event.button!==0||spaceHeld||zHeld)return false;
 const point=screenToWorld(event.clientX,event.clientY),p=[point.x,point.y];
 return [...magicSelection.values()].some(entry=>{const object=magicMap(entry.kind).get(entry.id);return object&&magicTouches(entry.kind,object,p,p);});
}
const selectionRectangle=document.createElement('div');selectionRectangle.id='selectionRectangle';selectionRectangle.hidden=true;viewport.append(selectionRectangle);
const selectionRectangleSVG=document.createElementNS(svgNS,'svg'),selectionRectangleOutline=document.createElementNS(svgNS,'rect');
selectionRectangleOutline.classList.add('magic-neon','magic-selected');selectionRectangleOutline.setAttribute('x','1');selectionRectangleOutline.setAttribute('y','1');
selectionRectangleSVG.append(selectionRectangleOutline);selectionRectangle.append(selectionRectangleSVG);
function updateSelectionRectangle(event){
 const g=gesture;if(g?.type!=='rectangle-select')return;
 g.endX=event.clientX;g.endY=event.clientY;
 selectionRectangleOutline.setAttribute('width',Math.max(0,Math.abs(g.endX-g.startX)-2));selectionRectangleOutline.setAttribute('height',Math.max(0,Math.abs(g.endY-g.startY)-2));
 Object.assign(selectionRectangle.style,{left:`${Math.min(g.startX,g.endX)}px`,top:`${Math.min(g.startY,g.endY)}px`,width:`${Math.abs(g.endX-g.startX)}px`,height:`${Math.abs(g.endY-g.startY)}px`});
}
function selectRectangle(g){
 if(Math.hypot(g.endX-g.startX,g.endY-g.startY)<4)return;
 const a=screenToWorld(Math.min(g.startX,g.endX),Math.min(g.startY,g.endY)),b=screenToWorld(Math.max(g.startX,g.endX),Math.max(g.startY,g.endY));
 const records=[...photoGPU.index.query(a.x,a.y,b.x-a.x,b.y-a.y),...ownedPhotoGPU.index.query(a.x,a.y,b.x-a.x,b.y-a.y),...noteGPU.index.query(a.x,a.y,b.x-a.x,b.y-a.y),...ownedNoteGPU.index.query(a.x,a.y,b.x-a.x,b.y-a.y)];
 const candidates=new Map(records.map(model=>[`items:${model.id}`,{kind:'items',id:model.id}]));
 for(const object of items.values())if(object.type==='audio')candidates.set(`items:${object.id}`,{kind:'items',id:object.id});
 for(const object of writings.values())candidates.set(`writings:${object.id}`,{kind:'writings',id:object.id});
 if(showStrokes)for(const object of strokes.values())if(object.shape)candidates.set(`strokes:${object.id}`,{kind:'strokes',id:object.id});
 for(const [key,entry] of candidates){const object=magicMap(entry.kind).get(entry.id);if(!object||object.locked||!vaultContentVisible(entry.kind,entry.id)||vaultOwner(entry.kind,entry.id)!==g.scope)continue;
  if(entry.kind==='items'&&(!noteInteractionAllowed(object)||(object.type==='text'?!showTexts:!showMedia)))continue;
  const box=magicBounds(entry.kind,object);if(box&&box.x<=b.x&&box.x+box.width>=a.x&&box.y<=b.y&&box.y+box.height>=a.y)magicSelection.set(key,entry);
 }
 rectangleSelection=true;renderMagicLaser();
}
let magicScope = null, magicTrail = [], magicRenderFrame = 0, magicSaving = false;
const magicLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
magicLayer.id = 'magicLaser'; magicLayer.setAttribute('aria-hidden', 'true'); viewport.append(magicLayer);
// One shared paint server produces color waves without per-object blur/noise filters.
const magicDefs=document.createElementNS(svgNS,'defs');
const magicGradient=document.createElementNS(svgNS,'linearGradient');
magicGradient.id='magicColorWaves'; magicGradient.setAttribute('gradientUnits','userSpaceOnUse');
magicGradient.setAttribute('x1','0'); magicGradient.setAttribute('y1','0'); magicGradient.setAttribute('x2','420'); magicGradient.setAttribute('y2','0');
magicGradient.setAttribute('spreadMethod','repeat'); magicGradient.setAttribute('gradientTransform','rotate(24)');
const magicReducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
const waveStops=[[0,'#ff55c8'],[.17,'#ad72ff'],[.35,'#32ead5'],[.53,'#ff55c8'],[.72,'#32ead5'],[.86,'#ad72ff'],[1,'#ff55c8']];
for(const [index,[offset,color]] of waveStops.entries()) {
  const stop=document.createElementNS(svgNS,'stop'); stop.setAttribute('offset',offset); stop.setAttribute('stop-color',color);
  if(index>0 && index<waveStops.length-1) {
    const wave=document.createElementNS(svgNS,'animate'); wave.setAttribute('attributeName','offset');
    wave.setAttribute('values',`${offset};${offset+.045};${offset-.035};${offset}`);
    wave.setAttribute('dur',`${(4.5+index*.7)/3}s`); wave.setAttribute('repeatCount','indefinite');
    wave.setAttribute('calcMode','spline'); wave.setAttribute('keyTimes','0;.33;.66;1');
    wave.setAttribute('keySplines','.42 0 .58 1;.42 0 .58 1;.42 0 .58 1'); stop.append(wave);
  }
  magicGradient.append(stop);
}
const magicColorFlow=document.createElementNS(svgNS,'animateTransform');
magicColorFlow.setAttribute('attributeName','gradientTransform'); magicColorFlow.setAttribute('type','translate');
magicColorFlow.setAttribute('from','0 0'); magicColorFlow.setAttribute('to','420 0'); magicColorFlow.setAttribute('additive','sum');
magicColorFlow.setAttribute('dur','3s'); magicColorFlow.setAttribute('repeatCount','indefinite'); magicGradient.append(magicColorFlow);
magicDefs.append(magicGradient);
const attachmentButton=document.querySelector('#addButton');
const attachmentIcon=attachmentButton.querySelector('svg');
const attachmentDefs=document.createElementNS(svgNS,'defs');
const attachmentGradient=magicGradient.cloneNode(true);
attachmentGradient.id='attachmentColorWaves';
attachmentGradient.setAttribute('x2','24');
attachmentGradient.querySelector('animateTransform').setAttribute('to','24 0');
attachmentDefs.append(attachmentGradient);attachmentIcon.prepend(attachmentDefs);
attachmentIcon.pauseAnimations();
const magicSelectionVisual=document.createElementNS(svgNS,'g'), magicTrailVisual=document.createElementNS(svgNS,'g');
magicLayer.append(magicDefs,magicSelectionVisual,magicTrailVisual);
function syncMagicAnimation() {
  if(magicReducedMotion.matches || (!magicSelection.size && !magicTrail.length && gesture?.type!=='rectangle-select')) magicLayer.pauseAnimations();
  else magicLayer.unpauseAnimations();
  const canLink=magicSelection.size>0;
  attachmentButton.classList.toggle('attachment-selection',canLink);
  const attachmentLabel=i18n.t(canLink?'Vincular archivo a la selección':'Añadir archivos');
  attachmentButton.title=attachmentLabel;attachmentButton.setAttribute('aria-label',attachmentLabel);
  if(canLink && !magicReducedMotion.matches) attachmentIcon.unpauseAnimations();
  else attachmentIcon.pauseAnimations();
}
magicReducedMotion.addEventListener('change',syncMagicAnimation);
magicLayer.pauseAnimations();

function clearMagicSelection() { rectangleSelection=false; magicSelection.clear(); magicTrail = []; magicSelectionVisual.replaceChildren(); magicTrailVisual.replaceChildren(); syncMagicAnimation(); viewport.classList.remove("magic-hover", "magic-dragging"); }
function magicMap(kind) { return kind === 'items' ? items : kind === 'writings' ? writings : strokes; }
function shortcutMembers(entry) {
  if(entry.kind==='vaults') return [entry];
  const object=magicMap(entry.kind).get(entry.id),linkId=object?.fileLink?.id;
  if(!linkId) return [entry];
  return [...fileLinkedTargets.values()].filter(({kind,id})=>
    magicMap(kind).get(id)?.fileLink?.id===linkId && vaultContentVisible(kind,id));
}
function expandShortcutGroups(entries) {
  const expanded=new Map();
  for(const entry of entries) for(const member of shortcutMembers(entry)) expanded.set(`${member.kind}:${member.id}`,member);
  return [...expanded.values()];
}
function selectShortcutGroup(kind,id) {
  const members=shortcutMembers({kind,id});
  if(members.some(entry=>magicMap(entry.kind).get(entry.id)?.locked)) return;
  for(const entry of members) magicSelection.set(`${entry.kind}:${entry.id}`,entry);
}
function magicBounds(kind, object) {
  if (kind !== 'strokes') return vaultObjectBounds(kind, object);
  const b = strokeWorldBounds(object.id);
  return b && { x:b.minX, y:b.minY, width:b.maxX-b.minX, height:b.maxY-b.minY };
}
function magicTouches(kind, object, a, b, radius = 7 / camera.scale) {
  if(kind==='items'&&!noteInteractionAllowed(object))return false;
  const box = magicBounds(kind, object);
  if (!box || Math.max(a[0],b[0])+radius < box.x || Math.min(a[0],b[0])-radius > box.x+box.width || Math.max(a[1],b[1])+radius < box.y || Math.min(a[1],b[1])-radius > box.y+box.height) return false;
  if (kind === 'strokes') {
    const reach = radius + object.width / 2;
    for (let i=1; i<object.points.length; i++) if (segmentsDistanceSquared(a,b,object.points[i-1],object.points[i]) <= reach*reach) return true;
    return false;
  }
  if (containsVaultPoint(box,...a) || containsVaultPoint(box,...b)) return true;
  const corners = [[box.x,box.y],[box.x+box.width,box.y],[box.x+box.width,box.y+box.height],[box.x,box.y+box.height]];
  return corners.some((c,i) => segmentsDistanceSquared(a,b,c,corners[(i+1)%4]) <= radius*radius);
}
let magicHoverFrame = 0;
function updateMagicCursor() {
  const dragging = ['laser','move'].includes(mode) && gesture?.type === 'magic-move';
  let hovered = false;
  if (['laser','move'].includes(mode) && !gesture && !spaceHeld && !zHeld && !magicSaving && !vaultBusy && !vaultDrag) {
    const point=screenToWorld(pointerPosition.x,pointerPosition.y), p=[point.x,point.y];
    hovered=[...magicSelection.values()].some(entry => {
      const object=magicMap(entry.kind).get(entry.id);
      return object && !object.locked && vaultContentVisible(entry.kind,entry.id) && magicTouches(entry.kind,object,p,p);
    });
  }
  viewport.classList.toggle('magic-hover',hovered);
  viewport.classList.toggle('magic-dragging',dragging);
}
viewport.addEventListener('pointermove', () => {
  if (!['laser','move'].includes(mode) || magicHoverFrame) return;
  magicHoverFrame=requestAnimationFrame(() => { magicHoverFrame=0; updateMagicCursor(); });
});
viewport.addEventListener('pointerleave', () => { viewport.classList.remove('magic-hover'); });
function scheduleMagicRender() {
  if (!magicRenderFrame) magicRenderFrame = requestAnimationFrame(() => { magicRenderFrame=0; renderMagicLaser(); });
}
// Cache only selected strokes; match drawing smoothing and its distant LOD.
const magicStrokeGeometry = new WeakMap();
function magicStrokeRenderPoints(stroke) {
  const points=stroke.points;
  let cached=magicStrokeGeometry.get(stroke);
  if(!cached || cached.source!==points || cached.width!==stroke.width) {
    cached={source:points,width:stroke.width,full:smoothStrokePoints(points,stroke.width)};
    magicStrokeGeometry.set(stroke,cached);
  }
  const pixels=stroke.width*camera.scale;
  const level=cached.full.length>8 ? (pixels<.75?'tiny':pixels<3?'coarse':'full') : 'full';
  if(!cached[level]) cached[level]=simplifyPoints(cached.full,stroke.width*(level==='tiny'?3:.75));
  return cached[level];
}
function renderMagicLaser() {
  magicLayer.setAttribute('viewBox',`0 0 ${innerWidth} ${innerHeight}`);
  const nodes=[];
  for (const [key,entry] of magicSelection) {
    const object=magicMap(entry.kind).get(entry.id);
    if (!object || !vaultContentVisible(entry.kind,entry.id)) { magicSelection.delete(key); continue; }
    let node;
    if (entry.kind === 'strokes') {
      node=document.createElementNS(svgNS,'path');
      node.setAttribute('d',smoothPath(magicStrokeRenderPoints(object).map(worldToScreen)));
      const screenThickness=object.width*camera.scale;
      node.setAttribute('stroke-width',Math.max(2,screenThickness+2));
      // Thin distant strokes retain the colors without allocating blur surfaces.
      if(screenThickness>=3) node.classList.add('magic-selection-glow');
    } else {
      const box=magicBounds(entry.kind,object); node=document.createElementNS(svgNS,'rect');
      node.setAttribute('x',camera.x+box.x*camera.scale); node.setAttribute('y',camera.y+box.y*camera.scale);
      node.setAttribute('width',Math.max(1,box.width*camera.scale)); node.setAttribute('height',Math.max(1,box.height*camera.scale)); node.setAttribute('rx',Math.min(3,Math.min(box.width,box.height)*camera.scale*.04));
      node.classList.add('magic-selected');
    }
    node.classList.add('magic-neon'); nodes.push(node);
  }
  magicSelectionVisual.replaceChildren(...nodes);
  if (magicTrail.length) {
    const path=document.createElementNS(svgNS,'path'); path.classList.add('magic-neon','magic-trail');
    // Smooth in screen pixels so the laser feels the same at every zoom level.
    const trailPoints=smoothStrokePoints(magicTrail.map(worldToScreen),4);
    path.setAttribute('d',smoothPath(trailPoints)); magicTrailVisual.replaceChildren(path);
  } else magicTrailVisual.replaceChildren();
  syncMagicAnimation();
  updateMagicCursor();
}
function addMagicPoint(event) {
  const point=screenToWorld(event.clientX,event.clientY), b=[point.x,point.y], a=magicTrail.at(-1)||b;
  if (magicTrail.length && Math.hypot(b[0]-a[0],b[1]-a[1])*camera.scale < 2) return;
  if (vaultScopeAtScreen(event.clientX,event.clientY) !== magicScope) { gesture.boundaryStopped=true; return; }
  magicTrail.push(b);
  for (const kind of ['items','writings','strokes']) {
    if (kind==='strokes' && !showStrokes) continue;
    for (const [id,object] of magicMap(kind)) {
      const key=`${kind}:${id}`;
      if (magicSelection.has(key) || object.locked || !vaultContentVisible(kind,id) || (!screenFrozen.has(`${kind}:${id}`) && vaultOwner(kind,id)!==magicScope)) continue;
      if (magicTouches(kind,object,a,b)) selectShortcutGroup(kind,id);
    }
  }
  scheduleMagicRender();
}
// Evaluate enclosure once on release, using screen-relative coordinates so
// closing tolerance stays constant even at very large canvas zoom levels.
function selectMagicEnclosure() {
  if (magicTrail.length < 4 || gesture?.boundaryStopped) return;
  const origin = magicTrail[0];
  const trail = magicTrail.map(([x,y]) => [(x-origin[0])*camera.scale,(y-origin[1])*camera.scale]);
  const regions=[];
  function addRegion(polygon) {
    let perimeter=0,twiceArea=0;
    for(let i=0;i<polygon.length;i++) {
      const a=polygon[i],b=polygon[(i+1)%polygon.length];
      perimeter+=Math.hypot(b[0]-a[0],b[1]-a[1]);
      twiceArea+=a[0]*b[1]-b[0]*a[1];
    }
    if(perimeter>=60 && Math.abs(twiceArea)>=200)
      regions.push({polygon,bounds:pointBounds(polygon,0,polygon.length-1)});
  }
  // A crossing closes the intervening loop; loose tails are not part of it.
  // Work only on release and reject disjoint segment bounds before intersecting.
  for(let i=0;i<trail.length-1;i++) {
    const a=trail[i],b=trail[i+1],rx=b[0]-a[0],ry=b[1]-a[1];
    for(let j=i+2;j<trail.length-1;j++) {
      const c=trail[j],d=trail[j+1];
      if(Math.max(a[0],b[0])<Math.min(c[0],d[0]) || Math.max(c[0],d[0])<Math.min(a[0],b[0]) ||
         Math.max(a[1],b[1])<Math.min(c[1],d[1]) || Math.max(c[1],d[1])<Math.min(a[1],b[1])) continue;
      const sx=d[0]-c[0],sy=d[1]-c[1],cross=rx*sy-ry*sx;
      if(Math.abs(cross)<1e-8) continue;
      const qx=c[0]-a[0],qy=c[1]-a[1];
      const t=(qx*sy-qy*sx)/cross,u=(qx*ry-qy*rx)/cross;
      if(t<0 || t>1 || u<0 || u>1) continue;
      addRegion([[a[0]+t*rx,a[1]+t*ry],...trail.slice(i+1,j+1)]);
    }
  }
  if(Math.hypot(...trail.at(-1))<=60) addRegion(trail);
  if(!regions.length) return;
  function inside(x,y) {
    x=(x-origin[0])*camera.scale; y=(y-origin[1])*camera.scale;
    return regions.some(({polygon,bounds})=> {
      if(x<bounds.minX || x>bounds.maxX || y<bounds.minY || y>bounds.maxY) return false;
      let enclosed=false;
      for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
        const a=polygon[i],b=polygon[j];
        if((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) enclosed=!enclosed;
      }
      return enclosed;
    });
  }
  for (const kind of ['items','writings','strokes']) {
    if (kind==='strokes' && !showStrokes) continue;
    for (const [id,object] of magicMap(kind)) {
      const key=`${kind}:${id}`;
      if (magicSelection.has(key) || object.locked || !vaultContentVisible(kind,id) || (!screenFrozen.has(`${kind}:${id}`) && vaultOwner(kind,id)!==magicScope)) continue;
      const box=magicBounds(kind,object);
      if (!box) continue;
      // Objects crossing the outline have already been selected by touch.
      // An interior representative catches the objects wholly enclosed by it.
      const point=kind==='strokes' ? object.points[0] : [box.x+box.width/2,box.y+box.height/2];
      if (point && inside(...point)) selectShortcutGroup(kind,id);
    }
  }
}
function magicApply(entries, dx, dy) {
  for (const entry of entries) {
    const object=magicMap(entry.kind).get(entry.id); if (!object) continue;
    if (entry.kind==='strokes') {
      object.points=entry.points.map(([x,y])=>[x+dx,y+dy]);
      strokes.delete(entry.id); addStroke(object,true);
    } else { object.x=entry.x+dx; object.y=entry.y+dy; if(entry.kind==='items') { const card=cards.get(entry.id); if(card) applyCardChrome(card,object); } }
  }
  gpuSceneDirty=true;noteGPUSceneDirty=true;renderNotePreviews(); renderSolidPreviews(); renderWritings(); redrawStrokes(); renderMagicLaser(); renderConnections();
}
async function magicTranslate(entries, dx, dy) {
  await apiChange('/api/group-move','POST',{objects:entries.map(({kind,id})=>({kind,id})),dx,dy});
  const current=entries.map(entry=> { const object=magicMap(entry.kind).get(entry.id); return {...entry,x:object.x,y:object.y,points:entry.kind==='strokes'?object.points.map(p=>[...p]):undefined}; });
  magicApply(current,dx,dy);
  await reconcileVaults(entries.map(({kind,id})=>({kind,id})));
}
const fileGlowLayer=document.createElementNS(svgNS,'svg');fileGlowLayer.id='fileLinkGlow';fileGlowLayer.setAttribute('aria-hidden','true');viewport.append(fileGlowLayer);
const fileGlowDefs=document.createElementNS(svgNS,'defs'),fileGlowGradient=magicGradient.cloneNode(true);fileGlowGradient.id='fileLinkWaves';
const fileGlowColors=['#ff713a','#ffc64b','#fff098','#ed5144','#ffb248','#ff7b3c','#ff713a'];
[...fileGlowGradient.querySelectorAll('stop')].forEach((stop,index)=>stop.setAttribute('stop-color',fileGlowColors[index]));
fileGlowDefs.append(fileGlowGradient);const fileGlowVisual=document.createElementNS(svgNS,'g');fileGlowLayer.append(fileGlowDefs,fileGlowVisual);fileGlowLayer.pauseAnimations();
const fileLinkedTargets=new Map();
for(const [kind,map] of [['items',items],['writings',writings],['strokes',strokes]]) {
  const put=map.set.bind(map),remove=map.delete.bind(map),empty=map.clear.bind(map);
  map.set=(id,object)=> {const result=put(id,object),key=`${kind}:${id}`;if(object.fileLink) fileLinkedTargets.set(key,{kind,id});else fileLinkedTargets.delete(key);return result;};
  map.delete=id=> {fileLinkedTargets.delete(`${kind}:${id}`);return remove(id);};
  map.clear=()=> {for(const [key,entry] of fileLinkedTargets) if(entry.kind===kind) fileLinkedTargets.delete(key);return empty();};
}
let fileHover=null,fileLinkTap=null,fileGlowFrame=0;
function linkedObjectAt(x,y,target) {
  if(!window.apoxiaDesktop || ['draw','erase','write','laser','pan','rectangle','ellipse'].includes(mode) || spaceHeld || zHeld) return null;
  const p=screenToWorld(x,y),point=[p.x,p.y],candidates=[];
  const card=target?.closest('.video-card'),writing=target?.closest('.canvas-writing');
  const direct=card?{kind:'items',id:card.dataset.id}:writing?{kind:'writings',id:writing.dataset.id}:null;
  if(direct) {const object=magicMap(direct.kind).get(direct.id);if(object?.fileLink && vaultContentVisible(direct.kind,direct.id)) return direct;}
  const scope=vaultScopeAtScreen(x,y);
  for(const {kind,id} of fileLinkedTargets.values()) {
    const object=magicMap(kind).get(id);
    if(!object?.fileLink || !vaultContentVisible(kind,id) || kind==='strokes' && !showStrokes || vaultOwner(kind,id)!==scope && !screenFrozen.has(`${kind}:${id}`) || !magicTouches(kind,object,point,point)) continue;
    const b=magicBounds(kind,object);candidates.push({kind,id,area:b.width*b.height,priority:kind==='items'&&object.type==='text'?3:kind==='writings'?2:kind==='strokes'?1:0});
  }
  candidates.sort((a,b)=>b.priority-a.priority || a.area-b.area);return candidates[0] || null;
}
function renderFileGlow() {
  fileGlowLayer.setAttribute('viewBox',`0 0 ${innerWidth} ${innerHeight}`);
  const object=fileHover && magicMap(fileHover.kind).get(fileHover.id);
  viewport.classList.toggle('file-link-hover',Boolean(object));
  if(!object || !vaultContentVisible(fileHover.kind,fileHover.id)) {fileGlowVisual.replaceChildren();fileGlowLayer.pauseAnimations();return;}
  const nodes=[];
  // Every member receives the same link ID when the laser selection is linked.
  // Paint its whole visible drawing, even when the pointer touches only one stroke.
  for(const {kind,id} of fileLinkedTargets.values()) {
    const member=magicMap(kind).get(id);
    if(member?.fileLink?.id!==object.fileLink?.id || !vaultContentVisible(kind,id) || kind==='strokes' && !showStrokes) continue;
    const b=magicBounds(kind,member);
    if(!b || camera.x+(b.x+b.width)*camera.scale < -24 || camera.y+(b.y+b.height)*camera.scale < -24 ||
       camera.x+b.x*camera.scale > innerWidth+24 || camera.y+b.y*camera.scale > innerHeight+24) continue;
    let node;
    if(kind==='strokes') {node=document.createElementNS(svgNS,'path');node.setAttribute('d',smoothPath(magicStrokeRenderPoints(member).map(worldToScreen)));node.setAttribute('stroke-width',String(Math.max(2,member.width*camera.scale+2)));}
    else {node=document.createElementNS(svgNS,'rect');node.setAttribute('x',camera.x+b.x*camera.scale);node.setAttribute('y',camera.y+b.y*camera.scale);node.setAttribute('width',b.width*camera.scale);node.setAttribute('height',b.height*camera.scale);node.setAttribute('rx','7');node.setAttribute('stroke-width','2');}
    node.style.stroke='url(#fileLinkWaves)';nodes.push(node);
  }
  fileGlowVisual.replaceChildren(...nodes);
  if(magicReducedMotion.matches) fileGlowLayer.pauseAnimations();else fileGlowLayer.unpauseAnimations();
}
viewport.addEventListener('pointermove',event=> {
  if(fileLinkTap && Math.hypot(event.clientX-fileLinkTap.x,event.clientY-fileLinkTap.y)>5) fileLinkTap=null;
  if(!window.apoxiaDesktop || gesture || touchNavigation) return;
  if(!fileGlowFrame) fileGlowFrame=requestAnimationFrame(()=>{fileGlowFrame=0;fileHover=linkedObjectAt(pointerPosition.x,pointerPosition.y,document.elementFromPoint(pointerPosition.x,pointerPosition.y));renderFileGlow();});
});
viewport.addEventListener('pointerleave',()=>{fileHover=null;renderFileGlow();});
viewport.addEventListener('pointerdown',event=> {
  fileLinkTap=null;if(event.button!==0 || event.target.closest('button,input,textarea,a,.resize-handle,.writing-handle,[data-connector-item]')) return;
  const target=linkedObjectAt(event.clientX,event.clientY,event.target);
  if(target) fileLinkTap={...target,x:event.clientX,y:event.clientY,pointer:event.pointerId};
},{capture:true});
viewport.addEventListener('pointerup',event=> {
  const tap=fileLinkTap;fileLinkTap=null;
  if(!tap || tap.pointer!==event.pointerId || Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>5 || ['draw','erase','write','laser','pan','rectangle','ellipse'].includes(mode)) return;
  const link=magicMap(tap.kind).get(tap.id)?.fileLink;
  if(link) window.apoxiaDesktop.openFile(link.id).catch(error=>toast(error.message));
},{capture:true});
viewport.addEventListener('pointercancel',()=>{fileLinkTap=null;});
async function updateObjectLinks(objects) {
  await apiChange('/api/object-links','PUT',{objects});
  for(const entry of objects) {const object=magicMap(entry.kind).get(entry.id);if(object) {if(entry.fileLink) {object.fileLink=entry.fileLink;fileLinkedTargets.set(`${entry.kind}:${entry.id}`,{kind:entry.kind,id:entry.id});}else {delete object.fileLink;fileLinkedTargets.delete(`${entry.kind}:${entry.id}`);}}}
  renderFileGlow();
}
// Delay a single touch until it moves, so placing a second finger never draws
// an accidental dot or starts an eraser sweep. Pens and mice use their usual path.
const canvasTouches=new Map();
let touchNavigation=null, pendingCanvasTouch=null, replayingCanvasTouch=false, suppressTouchClickUntil=0;
function replayCanvasTouch(point) {
  pendingCanvasTouch=null;
  replayingCanvasTouch=true;
  try { point.target.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,composed:true,pointerId:point.id,pointerType:'touch',isPrimary:true,button:0,buttons:1,clientX:point.x,clientY:point.y,pressure:.5})); }
  finally { replayingCanvasTouch=false; }
}
function touchPair() {
  const [a,b]=[...canvasTouches.values()];
  if(!a || !b) return null;
  return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y))};
}
function beginTouchNavigation() {
  const pair=touchPair();
  if(!pair) return;
  const anchor=screenToWorld(pair.x,pair.y);
  touchNavigation={...pair,scale:camera.scale,worldX:anchor.x,worldY:anchor.y};
}
window.addEventListener('pointerdown',event=> {
  if(replayingCanvasTouch || event.pointerType!=='touch' || !viewport.contains(event.target)) return;
  const point={id:event.pointerId,x:event.clientX,y:event.clientY,target:event.target,startX:event.clientX,startY:event.clientY};
  canvasTouches.set(event.pointerId,point);
  if(canvasTouches.size===1) {
    if(event.target.closest('input,textarea,[contenteditable],button:not(.writing-handle),.vault-form,.empty-state')) return;
    event.preventDefault();event.stopImmediatePropagation();pendingCanvasTouch=point;
    viewport.setPointerCapture(event.pointerId);
    return;
  }
  event.preventDefault();event.stopImmediatePropagation();pendingCanvasTouch=null;
  if(inverseZoomSaving || magicSaving || vaultBusy || historyBusy || vaultDrag) return;
  if(gesture) endGesture({type:'pointercancel',pointerId:gesture.pointer}).catch(error=>toast(error.message));
  document.activeElement?.blur();
  for(const id of canvasTouches.keys()) viewport.setPointerCapture(id);
  beginTouchNavigation();suppressTouchClickUntil=performance.now()+600;
},{capture:true,passive:false});
window.addEventListener('pointermove',event=> {
  if(event.pointerType!=='touch' || !canvasTouches.has(event.pointerId)) return;
  const point=canvasTouches.get(event.pointerId);point.x=event.clientX;point.y=event.clientY;
  if(touchNavigation) {
    event.preventDefault();event.stopImmediatePropagation();
    const pair=touchPair();
    if(pair && !inverseZoomSaving) {
      camera.scale=Math.max(minZoom,Math.min(maxZoom,touchNavigation.scale*pair.distance/touchNavigation.distance));
      camera.x=pair.x-touchNavigation.worldX*camera.scale;
      camera.y=pair.y-touchNavigation.worldY*camera.scale;
      scheduleCameraRender();
    }
    return;
  }
  if(pendingCanvasTouch) {
    // The stored start stays fixed even though the live touch position changes.
    const start=pendingCanvasTouch;
    if(Math.hypot(event.clientX-start.startX,event.clientY-start.startY)<8) { event.preventDefault();event.stopImmediatePropagation();return; }
    replayCanvasTouch({...start,x:start.startX,y:start.startY});
  }
},{capture:true,passive:false});
function finishCanvasTouch(event) {
  if(event.pointerType!=='touch' || !canvasTouches.has(event.pointerId)) return;
  const pending=pendingCanvasTouch, navigating=Boolean(touchNavigation);
  canvasTouches.delete(event.pointerId);
  if(navigating) {
    event.preventDefault();event.stopImmediatePropagation();
    suppressTouchClickUntil=performance.now()+500;
    if(canvasTouches.size>=2) beginTouchNavigation();
    else if(!canvasTouches.size) {touchNavigation=null;renderCamera();}
  } else if(pending && pending.id===event.pointerId) {
    pendingCanvasTouch=null;
    if(event.type!=='pointercancel') replayCanvasTouch({...pending,x:pending.startX,y:pending.startY});
  }
  if(navigating && viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
}
window.addEventListener('pointerup',finishCanvasTouch,{capture:true,passive:false});
window.addEventListener('pointercancel',finishCanvasTouch,{capture:true,passive:false});
window.addEventListener('click',event=> { if(performance.now()<suppressTouchClickUntil && viewport.contains(event.target)) {event.preventDefault();event.stopImmediatePropagation();} },true);
window.addEventListener('blur',()=> {canvasTouches.clear();pendingCanvasTouch=null;touchNavigation=null;});
// Connections are stored on their source item, so private ones travel inside
// the same encrypted Vault payload as the note/photo/video they belong to.
let connectionFrame=0, connectionGeometryDirty=false, connectorPointerInside=restoredCanvasPointer;
const pendingConnectionErase=new Set();
const connectionSides=['n','e','s','w'];
const connectionNormals={n:[0,-1],e:[1,0],s:[0,1],w:[-1,0]};
function connectionSurface(className,parent) {
  const svg=document.createElementNS(svgNS,'svg'); svg.classList.add(className); svg.setAttribute('aria-hidden','true'); parent.append(svg); return svg;
}
const publicConnectionLayer=connectionSurface('connection-lines',viewport);
const privateConnectionLayer=connectionSurface('owned-connection-lines',vaultOwnedLayer);
const connectorLayer=connectionSurface('connection-controls',viewport);
const connectorVisual=document.createElementNS(svgNS,'g'); connectorLayer.append(connectorVisual);
function* connectionObjects() { yield* items.values(); yield* writings.values(); }
function connectionObject(id) { return items.get(id) || writings.get(id); }
function connectionKind(object) { return writings.has(object.id)?'writings':'items'; }
function connectionOwner(object) { return vaultOwner(connectionKind(object),object.id); }
function connectionItemVisible(item) {
  if(item && connectionKind(item)==='writings') return vaultContentVisible('writings',item.id);
  return item && ['text','image','video'].includes(item.type) && (item.type==='text' || item.status==='ready') && vaultContentVisible('items',item.id);
}
function connectionBox(item) {
  if(connectionKind(item)==='writings') {
    const b=vaultObjectBounds('writings',item);
    return {x:camera.x+b.x*camera.scale,y:camera.y+b.y*camera.scale,width:b.width*camera.scale,height:b.height*camera.scale};
  }
  const unit=item.type==='text'?noteLayoutUnit(item):0;
  return {x:camera.x+item.x*camera.scale,y:camera.y+item.y*camera.scale,width:(item.displayWidth || (item.type==='text'?300:320))*camera.scale,height:((item.displayHeight || (item.type==='text'?160:180)))*camera.scale};
}
function connectorReady(item) {
  if(item?.locked||!connectionItemVisible(item)||!noteInteractionAllowed(item)) return false;
  const b=connectionBox(item);
  if(b.width>innerWidth*1.25 || b.height>innerHeight*1.25) return false;
  if(connectionKind(item)==='writings') return writingSizeInteractive(item) && Math.max(b.width,b.height)>=150;
  return item.type==='video'?b.width>=320 && b.height>=180:item.type==='image'?b.width>=150 && b.height>=80:b.width>=100 && b.height>=70;
}
function connectorUnit(item) {
  const b=connectionBox(item);
  return Math.min(b.width,b.height)/180;
}
function connectorPoint(item,side,gap=8*connectorUnit(item)) {
  const b=connectionBox(item),normal=connectionNormals[side];
  const playbackClearance=item.type==='video'&&side==='s'&&!item.locked&&!cards.get(item.id)?.classList.contains('playback-small')?24+16*connectorUnit(item):0;
  return {x:b.x+(side==='e'?b.width:side==='w'?0:b.width/2)+normal[0]*gap,y:b.y+(side==='s'?b.height:side==='n'?0:b.height/2)+normal[1]*gap+playbackClearance};
}
function connectorExposed(item,point) {
  if(point.x < -16 || point.y < -16 || point.x > innerWidth+16 || point.y > innerHeight+16) return false;
  const scope=vaultScopeAtScreen(point.x,point.y), owner=connectionOwner(item);
  if(scope && scope!==owner) return false;
  const vault=owner && vaults.get(owner);
  if(vault) {
    const box=vaultInterior(vault), world=screenToWorld(point.x,point.y);
    if(!containsVaultPoint(box,world.x,world.y)) return false;
  }
  return true;
}
function closestConnector(sourceId,x,y) {
  let target=null, nearest=42;
  for(const item of connectionObjects()) {
    if(item.id===sourceId || !connectorReady(item)) continue;
    const box=connectionBox(item);
    if(x<box.x-50 || y<box.y-50 || x>box.x+box.width+50 || y>box.y+box.height+50) continue;
    for(const side of connectionSides) {
      const point=connectorPoint(item,side); if(!connectorExposed(item,point)) continue;
      const distance=Math.hypot(point.x-x,point.y-y);
      if(distance<nearest) { nearest=distance; target={id:item.id,side,point,distance}; }
    }
  }
  return target;
}
function hoveredConnectorItem() {
  if(!connectorPointerInside || spaceHeld || zHeld || ['draw','erase','write','rectangle','ellipse'].includes(mode)) return null;
  const {x,y}=pointerPosition, scope=vaultScopeAtScreen(x,y); let chosen=null, area=Infinity;
  const p=screenToWorld(x,y),margin=64/camera.scale;
  const media=[...photoGPU.index.query(p.x-margin,p.y-margin,margin*2,margin*2),...ownedPhotoGPU.index.query(p.x-margin,p.y-margin,margin*2,margin*2)].map(a=>items.get(a.id));
  const notes=[...noteGPU.index.query(p.x-margin,p.y-margin,margin*2,margin*2),...ownedNoteGPU.index.query(p.x-margin,p.y-margin,margin*2,margin*2)].map(a=>items.get(a.id));const candidates=[...media,...notes,...writings.values()];
  for(const item of candidates) {
    if(!connectorReady(item) || connectionOwner(item)!==scope) continue;
    const b=connectionBox(item);
    // Include the full enlarged port hit area beyond the object's edge.
    const margin=30*connectorUnit(item),bottomMargin=item.type==='video'?Math.max(margin,24+40*connectorUnit(item)):margin;
    if(x>=b.x-margin && y>=b.y-margin && x<=b.x+b.width+margin && y<=b.y+b.height+bottomMargin && b.width*b.height<area) { chosen=item; area=b.width*b.height; }
  }
  return chosen;
}
function connectionScale(link,source) {
  // Legacy arrows inherit a useful world size from the source; new ones store it.
  return (link.unit || (source.displayWidth || 320)/320)*camera.scale;
}
function connectionControls(a,sourceSide,b,targetSide,scale=1) {
  const distance=Math.hypot(b.x-a.x,b.y-a.y), reach=Math.max(28*scale,Math.min(220*scale,distance*.4));
  const n=connectionNormals[sourceSide], m=targetSide?connectionNormals[targetSide]:distance?[(a.x-b.x)/distance,(a.y-b.y)/distance]:[-n[0],-n[1]];
  return {a,b,c:{x:a.x+n[0]*reach,y:a.y+n[1]*reach},d:{x:b.x+m[0]*reach,y:b.y+m[1]*reach},m};
}
function connectionGeometry(source,target,link) {
  const scale=connectionScale(link,source), a=connectorPoint(source,link.sourceSide,8*scale), b=connectorPoint(target,link.targetSide,8*scale);
  return {...connectionControls(a,link.sourceSide,b,link.targetSide,scale),scale};
}
function connectionHead(b,m,scale) {
  const length=8*scale, half=4*scale;
  return [{x:b.x+m[0]*length-m[1]*half,y:b.y+m[1]*length+m[0]*half},b,{x:b.x+m[0]*length+m[1]*half,y:b.y+m[1]*length-m[0]*half}];
}
function connectorPath(a,sourceSide,b,targetSide,className='connection-arrow',color='#c67bea',scale=1) {
  const {c,d,m}=connectionControls(a,sourceSide,b,targetSide,scale),head=connectionHead(b,m,scale);
  const path=document.createElementNS(svgNS,'path'); path.classList.add(className);
  path.setAttribute('d',`M${a.x} ${a.y} C${c.x} ${c.y} ${d.x} ${d.y} ${b.x} ${b.y} M${head[0].x} ${head[0].y} L${b.x} ${b.y} L${head[2].x} ${head[2].y}`);
  path.style.stroke=color; path.style.strokeWidth=String(3*scale); return path;
}
// Subdivide only curve portions near the eraser; no fixed sampling distance or
// zoom-dependent sweep through every point on a very large arrow.
function connectionEraserHit(geometry,ax,ay,bx,by,radius) {
  const reach=radius+1.5*geometry.scale, sweepA=[ax,ay],sweepB=[bx,by],stack=[{...geometry,depth:0}];
  const near=points=>Math.max(...points.map(p=>p.x))>=Math.min(ax,bx)-reach && Math.min(...points.map(p=>p.x))<=Math.max(ax,bx)+reach && Math.max(...points.map(p=>p.y))>=Math.min(ay,by)-reach && Math.min(...points.map(p=>p.y))<=Math.max(ay,by)+reach;
  const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2}), tolerance=Math.max(1,reach*.05);
  while(stack.length) {
    const {a,b,c,d,depth}=stack.pop(); if(!near([a,b,c,d])) continue;
    if(pointSegmentDistanceSquared(a.x,a.y,ax,ay,bx,by)<=reach*reach || pointSegmentDistanceSquared(b.x,b.y,ax,ay,bx,by)<=reach*reach) return true;
    const flat=pointSegmentDistanceSquared(c.x,c.y,a.x,a.y,b.x,b.y)<=tolerance*tolerance && pointSegmentDistanceSquared(d.x,d.y,a.x,a.y,b.x,b.y)<=tolerance*tolerance;
    if(flat || depth>=20) {
      if(segmentsDistanceSquared(sweepA,sweepB,[a.x,a.y],[b.x,b.y])<=reach*reach) return true;
      continue;
    }
    const ac=mid(a,c),cd=mid(c,d),db=mid(d,b),left=mid(ac,cd),right=mid(cd,db),center=mid(left,right);
    stack.push({a:center,c:right,d:db,b,depth:depth+1},{a,c:ac,d:left,b:center,depth:depth+1});
  }
  const head=connectionHead(geometry.b,geometry.m,geometry.scale);
  return near(head) && [0,1].some(i=>segmentsDistanceSquared(sweepA,sweepB,[head[i].x,head[i].y],[head[i+1].x,head[i+1].y])<=reach*reach);
}
function eraseConnections(ax,ay,bx,by,radius) {
  if(gesture?.type!=='erase') return;
  for(const source of connectionObjects()) {
    if(!connectionItemVisible(source) || connectionOwner(source)!==gesture.vaultId) continue;
    for(const link of [...(source.connections || [])]) {
      if(pendingConnectionErase.has(link.id)) continue;
      const target=connectionObject(link.targetId); if(!connectionItemVisible(target)) continue;
      if(!connectionEraserHit(connectionGeometry(source,target,link),ax,ay,bx,by,radius)) continue;
      const snapshot={...link,sourceId:source.id,unit:link.unit || (source.displayWidth || 320)/320,color:link.color || '#c67bea'};
      pendingConnectionErase.add(link.id); source.connections=source.connections.filter(edge=>edge.id!==link.id);
      gesture.erasedConnections.push(snapshot); scheduleConnectionRender();
      const deletion=removeConnection(snapshot).catch(error=> {
        snapshot.eraseFailed=true;
        const current=connectionObject(source.id);
        if(current) { current.connections=(current.connections || []).filter(edge=>edge.id!==snapshot.id); current.connections.push(snapshot); }
        scheduleConnectionRender(); toast(error.message);
      }).finally(()=>pendingConnectionErase.delete(link.id));
      gesture.deletions.push(deletion);
    }
  }
}
function scheduleConnectionRender(lines=true) {
  connectionGeometryDirty ||= lines;
  if(!connectionFrame) connectionFrame=requestAnimationFrame(()=> { connectionFrame=0; renderConnections(connectionGeometryDirty); });
}
function renderConnections(lines=true) {
  lines ||= connectionGeometryDirty; connectionGeometryDirty=false;
  if(connectionFrame) { cancelAnimationFrame(connectionFrame); connectionFrame=0; }
  for(const layer of [publicConnectionLayer,privateConnectionLayer,connectorLayer]) layer.setAttribute('viewBox',`0 0 ${innerWidth} ${innerHeight}`);
  if(lines) {
  const publicPaths=[], privatePaths=[];
  for(const source of [...[...gpuConnectionSources].map(connectionObject).filter(Boolean),...[...writings.values()].filter(a=>a.connections?.length)]) {
    if(!connectionItemVisible(source)) continue;
    for(const link of source.connections || []) {
      const target=connectionObject(link.targetId);
      if(pendingConnectionErase.has(link.id) || !connectionItemVisible(target) || !connectionSides.includes(link.sourceSide) || !connectionSides.includes(link.targetSide)) continue;
      const {a,b,scale}=connectionGeometry(source,target,link);
      if(Math.max(a.x,b.x)<-250 || Math.min(a.x,b.x)>innerWidth+250 || Math.max(a.y,b.y)<-250 || Math.min(a.y,b.y)>innerHeight+250) continue;
      const path=connectorPath(a,link.sourceSide,b,link.targetSide,'connection-arrow',link.color || '#c67bea',scale);
      (connectionOwner(source) || connectionOwner(target)?privatePaths:publicPaths).push(path);
    }
  }
  publicConnectionLayer.replaceChildren(...publicPaths); privateConnectionLayer.replaceChildren(...privatePaths);
  }
  const active=gesture?.type==='connector'?gesture:null, nodes=[], visibleItems=new Map();
  if(active) {
    const source=connectionObject(active.sourceId);
    if(connectionItemVisible(source)) {
      visibleItems.set(source.id,source);
      const a=connectorPoint(source,active.sourceSide), target=active.target;
      const b={x:active.clientX,y:active.clientY};
      nodes.push(connectorPath(a,active.sourceSide,b,null,'connection-preview',active.color));
      if(target) visibleItems.set(target.id,connectionObject(target.id));
    }
  } else if(!gesture && !vaultDrag && !vaultBusy) {
    const hover=hoveredConnectorItem(); if(hover) visibleItems.set(hover.id,hover);
  }
  for(const item of visibleItems.values()) for(const side of connectionSides) {
    if(!connectorReady(item)) continue;
    const unit=connectorUnit(item);
    const point=connectorPoint(item,side); if(!connectorExposed(item,point)) continue;
    const group=document.createElementNS(svgNS,'g'); group.classList.add('connection-port'); group.dataset.connectorItem=item.id; group.dataset.connectorSide=side;
    group.setAttribute('transform',`translate(${point.x} ${point.y}) scale(${unit*1.3})`);
    const hit=document.createElementNS(svgNS,'circle'); hit.setAttribute('r','11'); hit.setAttribute('fill','transparent');
    const circle=document.createElementNS(svgNS,'circle'); circle.classList.add('connection-port-dot'); circle.setAttribute('r','3.5');
    if(active?.target?.id===item.id && active.target.side===side) {
      const strength=Math.max(0,1-active.target.distance/42);
      group.classList.add('connection-port-target'); group.style.setProperty('--connector-glow',`${8+strength*18}px`); group.style.setProperty('--connector-glow-outer',`${12+strength*30}px`);
      group.style.opacity=String(.8+strength*.2); circle.setAttribute('r',String(4+strength*2));
    }
    const title=document.createElementNS(svgNS,'title'); title.textContent=i18n.t('Arrastra para conectar');
    group.append(title,hit,circle); nodes.push(group);
  }
  connectorVisual.replaceChildren(...nodes);
  syncMagicAnimation();
}
function updateConnectorGesture(event) {
  if(gesture?.type!=='connector') return;
  gesture.clientX=event.clientX; gesture.clientY=event.clientY;
  gesture.target=closestConnector(gesture.sourceId,event.clientX,event.clientY); scheduleConnectionRender(false);
}
async function putConnection(snapshot) {
  const result=await apiChange('/api/connections','POST',snapshot), connection=result.connection, source=connectionObject(connection.sourceId);
  if(source) { source.connections=(source.connections || []).filter(link=>link.id!==connection.id); source.connections.push(connection); if(items.has(source.id))gpuConnectionSources.add(source.id); }
  renderConnections(); return result;
}
async function removeConnection(snapshot) {
  await apiChange(`/api/connections/${snapshot.id}`,'DELETE');
  const source=connectionObject(snapshot.sourceId); if(source) {source.connections=(source.connections || []).filter(link=>link.id!==snapshot.id);if(!source.connections.length)gpuConnectionSources.delete(source.id);}
  renderConnections();
}
viewport.addEventListener('pointerenter',event=> { pointerPosition={x:event.clientX,y:event.clientY};connectorPointerInside=true; scheduleConnectionRender(false); });
viewport.addEventListener('pointerleave',()=> { connectorPointerInside=false; scheduleConnectionRender(false); });
window.addEventListener('pointermove',event=> {
  connectorPointerInside=viewport.contains(event.target);
  if(!gesture || gesture.type==='connector') scheduleConnectionRender(false);
},{capture:true});
viewport.addEventListener('pointerdown',event=> {
  let port=event.target.closest('[data-connector-item]');
  // A visible connection port wins over an overlapping note resize strip.
  const handle=event.target.closest('.text-card .resize-handle');
  if(!port&&handle){const id=handle.closest('.text-card').dataset.id,item=items.get(id);
    if(item&&connectorReady(item))for(const candidate of connectorVisual.querySelectorAll('[data-connector-item]')){
      if(candidate.dataset.connectorItem!==id)continue;
      const point=connectorPoint(item,candidate.dataset.connectorSide);
      if(Math.hypot(event.clientX-point.x,event.clientY-point.y)<=11*1.3*connectorUnit(item)){port=candidate;break;}
    }
  }
  if(!port || event.button!==0 || spaceHeld || zHeld || gesture || inverseZoomSaving || magicSaving || vaultBusy || vaultDrag || historyBusy || document.activeElement?.matches('.text-editor') || editingWriting) return;
  const source=connectionObject(port.dataset.connectorItem); if(!connectorReady(source)) return;
  event.preventDefault(); event.stopImmediatePropagation();
  gesture={type:'connector',pointer:event.pointerId,sourceId:source.id,sourceSide:port.dataset.connectorSide,clientX:event.clientX,clientY:event.clientY,target:null,color:penColor.value,unit:1/camera.scale};
  viewport.setPointerCapture(event.pointerId); renderConnections();
},{capture:true});
viewport.addEventListener('pointerdown',event=> {
  if (inverseZoomSaving) { event.preventDefault(); event.stopImmediatePropagation(); }
},{capture:true});
viewport.addEventListener('pointerdown',event=> {
  if(temporaryDrawLaser && mode!=='laser' && mode!=='pan') temporaryDrawLaser=false;
  if(temporaryDrawLaser && mode==='laser' && !event.altKey && event.button===0 && !spaceHeld && !zHeld && !gesture &&
     !event.target.closest('button,input,textarea,a,.vault-head,.vault-form,.vault-resize,.empty-state')) {
    const point=screenToWorld(event.clientX,event.clientY),p=[point.x,point.y];
    const hit=[...magicSelection.values()].some(({kind,id})=> {
      const object=magicMap(kind).get(id);
      return object && vaultContentVisible(kind,id) && magicTouches(kind,object,p,p);
    });
    if(!hit) { temporaryDrawLaser=false; setMode('draw',false); }
  }
  if(event.button===0 && event.altKey && !editingText(event.target)) activateDrawLaser();
  if (!['laser','move'].includes(mode) || event.button!==0 || spaceHeld || zHeld || gesture || vaultBusy || vaultDrag || magicSaving) return;
  if (event.target.closest('button,a,input,.resize-handle,.writing-handle,.vault-head,.vault-form,.vault-resize,.empty-state')) return;
  const editor=document.activeElement;
  if (editor?.matches('.text-editor') || editingWriting) return;
  const point=screenToWorld(event.clientX,event.clientY), p=[point.x,point.y];
  const hit=[...magicSelection.values()].some(entry=> { const object=magicMap(entry.kind).get(entry.id); return object && magicTouches(entry.kind,object,p,p); });
  if(mode==='move'&&!hit){if(rectangleSelection&&!event.altKey)clearMagicSelection();return;}
  event.preventDefault();event.stopImmediatePropagation();
  if(hit) {
    const entries=[...magicSelection.values()].filter(entry=> !screenFrozen.has(`${entry.kind}:${entry.id}`) && !magicMap(entry.kind).get(entry.id)?.locked).map(entry=> {
      const object=magicMap(entry.kind).get(entry.id); return {...entry,x:object.x,y:object.y,points:entry.kind==='strokes'?object.points.map(p=>[...p]):undefined};
    });
    if(!entries.length) return;
    if(event.ctrlKey||event.metaKey){startDuplicateDrag(event,entries);return;}
    gesture={type:'magic-move',pointer:event.pointerId,startX:event.clientX,startY:event.clientY,entries,movingKeys:new Set(entries.map(({kind,id})=>`${kind}:${id}`)),dx:0,dy:0};
    updateMagicCursor();
  } else {
    clearMagicSelection(); magicScope=vaultScopeAtScreen(event.clientX,event.clientY);
    if(magicScope && !vaults.get(magicScope)?.open) return;
    gesture={type:'magic-select',pointer:event.pointerId}; addMagicPoint(event);
  }
  viewport.setPointerCapture(event.pointerId);
},{capture:true});
function inverseGeometry(kind, object) {
  if (kind==='vaults') return {x:object.x,y:object.y,width:object.width,height:object.height};
  if (kind==='strokes') return {points:object.points.map(point=>[...point]),width:object.width};
  if (kind==='writings') return {x:object.x,y:object.y,size:object.size};
  return {x:object.x,y:object.y,displayWidth:object.displayWidth || (object.type==='text'?300:320),displayHeight:object.displayHeight || (object.type==='text'?160:180),
    ...(object.type==='text'?{chromeScale:object.chromeScale || 1,textFontSize:object.textFontSize || 17*(object.chromeScale || 1)}:{})};
}
function inverseMap(kind) { return kind==='vaults'?vaults:magicMap(kind); }
function inverseTargets(event) {
  if (inversePinnedTargets !== null) {
    const targets=[];
    for (const {kind,id} of inversePinnedTargets) {
      const object=inverseMap(kind).get(id);
      // A deleted, locked or encrypted target cannot silently become another object.
      if (!object || screenFrozen.has(`${kind}:${id}`) || object.locked || (kind==='vaults' ? object.closing : !vaultContentVisible(kind,id) || (kind==='strokes' && !showStrokes))) return [];
      targets.push({kind,id,before:inverseGeometry(kind,object)});
    }
    return targets;
  }
  const worldPoint=screenToWorld(event.clientX,event.clientY), p=[worldPoint.x,worldPoint.y];
  const eligible=entry=> { const object=magicMap(entry.kind).get(entry.id); return object && !screenFrozen.has(`${entry.kind}:${entry.id}`) && !object.locked && vaultContentVisible(entry.kind,entry.id) && (entry.kind!=='strokes' || showStrokes); };
  const selection=[...magicSelection.values()].filter(eligible);
  let targets=[];
  if (selection.some(entry=>magicTouches(entry.kind,magicMap(entry.kind).get(entry.id),p,p))) targets=selection;
  else {
    const card=event.target.closest('.video-card');
    if (card && items.has(card.dataset.id) && eligible({kind:'items',id:card.dataset.id})) targets=[{kind:'items',id:card.dataset.id}];
    else {
      const scope=vaultScopeAtScreen(event.clientX,event.clientY), candidates=[];
      for (const kind of ['items','writings','strokes']) for (const [id,object] of magicMap(kind)) {
        if (!eligible({kind,id}) || vaultOwner(kind,id)!==scope || !magicTouches(kind,object,p,p)) continue;
        const box=magicBounds(kind,object);
        candidates.push({kind,id,area:box.width*box.height,priority:kind==='strokes'?1:kind==='writings'||object.type==='text'?2:0});
      }
      candidates.sort((a,b)=>b.priority-a.priority || a.area-b.area);
      if(candidates.length) targets=[candidates[0]];
      else {
        const vault=[...vaults.values()].find(v=> !v.locked && !v.closing && containsVaultPoint(v,...p));
        if(vault) targets=[{kind:'vaults',id:vault.id}];
      }
    }
  }
  targets=expandShortcutGroups(targets);
  if(targets.some(entry=>entry.kind!=='vaults' && !eligible(entry))) return [];
  if (targets.length) inversePinnedTargets=targets.map(({kind,id})=>({kind,id}));
  return targets.map(({kind,id})=>({kind,id,before:inverseGeometry(kind,inverseMap(kind).get(id))}));
}
function inverseRatioLimits(entries, x, y) {
  let min=0,max=Infinity;
  for(const entry of entries) {
    const object=inverseMap(entry.kind).get(entry.id);
    for(const [field,value] of Object.entries(entry.before)) {
      if(field==='x'||field==='y'||field==='points'||!(value>0)) continue;
      const low=field.startsWith('display')?1e-9:1e-12, high=field==='size'?1e16:1e12;
      min=Math.max(min,low/value); max=Math.min(max,high/value);
    }
    const owner=entry.kind==='vaults'?null:vaults.get(vaultOwner(entry.kind,entry.id));
    if(!owner) continue;
    const box=vaultInterior(owner), bounds=magicBounds(entry.kind,object);
    // Keep owned content inside its container while the surrounding canvas zooms.
    for(const [value,pivot,low,high] of [[bounds.x,x,box.x,box.x+box.width],[bounds.x+bounds.width,x,box.x,box.x+box.width],[bounds.y,y,box.y,box.y+box.height],[bounds.y+bounds.height,y,box.y,box.y+box.height]]) {
      const delta=value-pivot;
      if(delta>0) max=Math.min(max,(high-pivot)/delta);
      else if(delta<0) max=Math.min(max,(low-pivot)/delta);
    }
  }
  return {min:Math.min(1,min),max:Math.max(1,max)};
}
function applyInverseSnapshot(entries, factor, x, y) {
  for(const entry of entries) {
    const object=inverseMap(entry.kind).get(entry.id); if(!object) continue;
    const values={};
    for(const [field,value] of Object.entries(entry.before)) {
      if(field==='points') values.points=value.map(([px,py])=>[x+(px-x)*factor,y+(py-y)*factor]);
      else values[field]=field==='x'?x+(value-x)*factor:field==='y'?y+(value-y)*factor:value*factor;
    }
    Object.assign(object,values);
    if(entry.kind==='strokes') { strokes.delete(entry.id); addStroke(object,true); }
  }
}
async function persistInverseZoom(entries, factor, x, y) {
  if(entries[0].kind==='vaults') {
    const entry=entries[0], geometry=inverseGeometry('vaults',vaults.get(entry.id));
    await apiChange(`/api/vaults/${entry.id}`,'PATCH',geometry);
  } else await apiChange('/api/group-scale','POST',{objects:entries.map(({kind,id})=>({kind,id})),factor,x,y});
}
async function replayInverseZoom(entries, factor, x, y, view) {
  const current=entries.map(({kind,id})=> {
    const object=inverseMap(kind).get(id);
    if(!object || (kind!=='vaults' && !vaultContentVisible(kind,id))) throw new Error(i18n.t('Abre la Vault antes de recuperar esta transformación'));
    return {kind,id,before:inverseGeometry(kind,object)};
  });
  if(entries[0].kind==='vaults') {
    applyInverseSnapshot(current,factor,x,y);
    try { await persistInverseZoom(current,factor,x,y); }
    catch(error) { applyInverseSnapshot(current,1,x,y); renderCamera(); throw error; }
  } else {
    await persistInverseZoom(current,factor,x,y);
    applyInverseSnapshot(current,factor,x,y);
  }
  Object.assign(camera,view); renderCamera();
}
function inversePanLimits(entries) {
  const limits={minX:-Infinity,maxX:Infinity,minY:-Infinity,maxY:Infinity};
  for(const entry of entries) {
    if(entry.kind==='vaults') continue;
    const object=inverseMap(entry.kind).get(entry.id), owner=vaults.get(vaultOwner(entry.kind,entry.id));
    if(!owner) continue;
    const box=vaultInterior(owner), bounds=magicBounds(entry.kind,object);
    limits.minX=Math.max(limits.minX,box.x-bounds.x);
    limits.maxX=Math.min(limits.maxX,box.x+box.width-bounds.x-bounds.width);
    limits.minY=Math.max(limits.minY,box.y-bounds.y);
    limits.maxY=Math.min(limits.maxY,box.y+box.height-bounds.y-bounds.height);
  }
  // Tiny floating-point errors on a boundary must not move the initial view.
  limits.minX=Math.min(0,limits.minX); limits.maxX=Math.max(0,limits.maxX);
  limits.minY=Math.min(0,limits.minY); limits.maxY=Math.max(0,limits.maxY);
  return limits;
}
function applyInversePanSnapshot(entries, dx, dy) {
  for(const entry of entries) {
    const object=inverseMap(entry.kind).get(entry.id); if(!object) continue;
    if(entry.kind==='strokes') {
      object.points=entry.before.points.map(([x,y])=>[x+dx,y+dy]);
      strokes.delete(entry.id); addStroke(object,true);
      // A translated raster cache would also move the stroke we are pinning.
      if (!vaultOwner('strokes',entry.id)) paintedCamera=null;
    } else { object.x=entry.before.x+dx; object.y=entry.before.y+dy; }
  }
}
async function persistInversePan(entries, dx, dy) {
  if(entries[0].kind==='vaults') {
    const entry=entries[0];
    await apiChange(`/api/vaults/${entry.id}`,'PATCH',{x:entry.before.x+dx,y:entry.before.y+dy});
  } else await apiChange('/api/group-move','POST',{objects:entries.map(({kind,id})=>({kind,id})),dx,dy});
}
async function replayInversePan(entries, dx, dy, view) {
  const current=entries.map(({kind,id})=> {
    const object=inverseMap(kind).get(id);
    if(!object || (kind!=='vaults' && !vaultContentVisible(kind,id))) throw new Error(i18n.t('Abre la Vault antes de recuperar este movimiento'));
    return {kind,id,before:inverseGeometry(kind,object)};
  });
  await persistInversePan(current,dx,dy);
  applyInversePanSnapshot(current,dx,dy);
  Object.assign(camera,view); renderCamera();
}
const screenFrozenLayer=document.createElementNS(svgNS,'svg');
screenFrozenLayer.id='screenFrozenLayer'; screenFrozenLayer.setAttribute('aria-hidden','true'); viewport.append(screenFrozenLayer);
function frozenAffine(entry) {
  return {factor:entry.view.scale/camera.scale,dx:(entry.view.x-camera.x)/camera.scale,dy:(entry.view.y-camera.y)/camera.scale};
}
function frozenGeometry(entry) {
  const {factor,dx,dy}=frozenAffine(entry), result={};
  for(const [field,value] of Object.entries(entry.before)) {
    if(field==='points') result.points=value.map(([x,y])=>[x*factor+dx,y*factor+dy]);
    else result[field]=field==='x'?value*factor+dx:field==='y'?value*factor+dy:value*factor;
  }
  return result;
}
function updateScreenFrozen() {
  screenFrozenLayer.setAttribute('viewBox',`0 0 ${innerWidth} ${innerHeight}`);
  const cameraKey=`${camera.x}:${camera.y}:${camera.scale}`;
  for(const [key,entry] of screenFrozen) {
    const object=magicMap(entry.kind).get(entry.id);
    if(!object) { entry.visual.remove(); screenFrozen.delete(key); continue; }
    if(entry.cameraKey!==cameraKey || entry.object!==object) {
      Object.assign(object,frozenGeometry(entry)); entry.cameraKey=cameraKey; entry.object=object;
      if(entry.kind==='strokes') { strokes.delete(entry.id); addStroke(object,true); paintedCamera=null; }
    }
    entry.visual.toggleAttribute('hidden',!vaultContentVisible(entry.kind,entry.id) || entry.kind==='strokes' && !showStrokes);
  }
}
function screenFrozenVisual(entry,object) {
  const group=document.createElementNS(svgNS,'g'); let node;
  if(entry.kind==='strokes') {
    node=document.createElementNS(svgNS,'path'); node.setAttribute('d',smoothPath(magicStrokeRenderPoints(object).map(worldToScreen)));
  } else {
    const b=magicBounds(entry.kind,object); node=document.createElementNS(svgNS,'rect');
    node.setAttribute('x',camera.x+b.x*camera.scale); node.setAttribute('y',camera.y+b.y*camera.scale);
    node.setAttribute('width',b.width*camera.scale); node.setAttribute('height',b.height*camera.scale); node.setAttribute('rx','8');
  }
  const thickness=entry.kind==='strokes'?object.width*camera.scale:0, halo=node.cloneNode(true);
  halo.setAttribute('stroke-width',String(thickness+7)); halo.setAttribute('opacity','.15');
  node.setAttribute('stroke-width',String(thickness+2)); node.setAttribute('opacity','.65');
  group.append(halo,node); screenFrozenLayer.append(group); return group;
}
function hoveredFrozenTarget() {
  if(!pointerOnPage) return null;
  const {x,y}=pointerPosition, node=document.elementFromPoint(x,y);
  if(!node || !viewport.contains(node) || node.closest('.toolbar,.settings-panel')) return null;
  const eligible=({kind,id})=> {
    const object=magicMap(kind).get(id);
    return object && (!object.locked || screenFrozen.has(`${kind}:${id}`)) && vaultContentVisible(kind,id) && (kind!=='strokes' || showStrokes);
  };
  const card=node.closest('.video-card'), writing=node.closest('.canvas-writing');
  const direct=card?{kind:'items',id:card.dataset.id}:writing?{kind:'writings',id:writing.dataset.id}:null;
  if(direct && eligible(direct)) return direct;
  const point=screenToWorld(x,y), p=[point.x,point.y], scope=vaultScopeAtScreen(x,y), candidates=[];
  for(const kind of ['items','writings','strokes']) for(const [id,object] of magicMap(kind)) {
    const key=`${kind}:${id}`, owner=vaultOwner(kind,id);
    if(!eligible({kind,id}) || (!screenFrozen.has(key) && owner!==scope) || !magicTouches(kind,object,p,p,kind==='strokes'?7/camera.scale:0)) continue;
    const box=magicBounds(kind,object);
    candidates.push({kind,id,area:box.width*box.height,layer:(owner?10:0)+(kind==='strokes'?1:kind==='writings'?3:object.type==='text'?4:0)});
  }
  candidates.sort((a,b)=>b.layer-a.layer || a.area-b.area);
  return candidates[0] || null;
}
async function toggleScreenFrozen() {
  // Release has priority, independently of hover, selection and layer visibility.
  const release=screenFrozen.size>0;
  let targets;
  if(release) targets=[...screenFrozen.values()];
  else {
    const hovered=hoveredFrozenTarget();
    targets=magicSelection.size && (!hovered || magicSelection.has(`${hovered.kind}:${hovered.id}`))
      ? [...magicSelection.values()] : hovered?[hovered]:[];
  }
  if(!release) targets=expandShortcutGroups(targets);
  if(!release && targets.some(({kind,id})=>magicMap(kind).get(id)?.locked)) return;
  targets=targets.filter(({kind,id})=> { const object=magicMap(kind).get(id); return object && (release || !object.locked && vaultContentVisible(kind,id)); });
  if(!targets.length) return toast(i18n.t('Pon el ratón sobre un elemento o selecciona un grupo con Magic Laser y pulsa F'));
  if(release) {
    const entries=targets.map(({kind,id})=>screenFrozen.get(`${kind}:${id}`));
    inverseZoomSaving=true;
    try {
      await apiChange('/api/frozen-release','POST',{objects:entries.map(entry=>({kind:entry.kind,id:entry.id,...frozenAffine(entry)}))});
      for(const entry of entries) { entry.visual.remove(); screenFrozen.delete(`${entry.kind}:${entry.id}`); }
      await reconcileVaults(); renderCamera(); toast(entries.length===1?i18n.t('Elemento liberado'):i18n.t('Selección liberada'));
    } catch(error) { toast(error.message); }
    finally { inverseZoomSaving=false; }
  } else {
    screenFrozenLayer.setAttribute('viewBox',`0 0 ${innerWidth} ${innerHeight}`);
    const group=Symbol('frozen-group');
    for(const {kind,id} of targets) {
      const key=`${kind}:${id}`; if(screenFrozen.has(key)) continue;
      const object=magicMap(kind).get(id),entry={kind,id,group,before:inverseGeometry(kind,object),view:{...camera},owner:vaultOwner(kind,id),cameraKey:`${camera.x}:${camera.y}:${camera.scale}`};
      entry.visual=screenFrozenVisual(entry,object); screenFrozen.set(key,entry);
    }
    inversePinnedTargets=null; renderCamera(); toast(targets.length===1?i18n.t('Elemento fijado · F para liberar'):i18n.t('Selección fijada · F para liberar'));
  }
}
// Frozen objects can be selected with the laser, while their geometry controls
// stay inactive until F releases them. Canvas navigation still works normally.
viewport.addEventListener('pointerdown',event=> {
  if(event.button!==0 || spaceHeld || zHeld || mode==='pan' || mode==='laser' || mode==='erase') return;
  const card=event.target.closest('.video-card');
  if(card) lastSelectedItem=card.dataset.id;
  const writing=event.target.closest('.canvas-writing');
  const id=card?.dataset.id || writing?.dataset.id || (event.target.closest('#writingControls') ? writingControls.dataset.id : null);
  const kind=card?'items':'writings';
  if(id && screenFrozen.has(`${kind}:${id}`)) { event.preventDefault(); event.stopImmediatePropagation(); }
},{capture:true});
// The first click outside a note only ends editing; canvas gestures start
// on the next click so leaving the editor cannot create an accidental stroke.
viewport.addEventListener('pointerdown', event => {
  const editor = document.activeElement;
  if (!editor?.matches('.text-editor') || event.target === editor) return;
  if (event.button === 0) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  editor.blur();
}, { capture: true });
viewport.addEventListener('pointerdown', event => {
  if (!editingWriting || event.button !== 0 || event.target === writingEditor) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  finishWritingEdit(true);
}, { capture: true });
viewport.addEventListener('pointerdown', event => {
  if (event.button !== 1 && !(event.button === 0 && (zHeld || spaceHeld || (mode === 'pan' && !event.target.closest('.empty-state')))) && !(event.button === 2 && event.altKey)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (gesture || inverseZoomSaving || magicSaving || vaultBusy || vaultDrag || historyBusy) return;
  if (event.button === 1 || (event.button === 0 && (spaceHeld || mode === 'pan') && !zHeld)) {
    const inversePan=event.altKey && event.button!==1;
    const frozen=inversePan ? inverseTargets(event) : [];
    gesture = { type: 'pan', pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: camera.x, y: camera.y,
      frozen, viewBefore:{...camera}, inverseDx:0, inverseDy:0, inversePanBounds:frozen.length?inversePanLimits(frozen):null };
    if(inversePan && !frozen.length) toast(i18n.t('Pon el puntero sobre un elemento desbloqueado para fijarlo'));
    document.activeElement?.blur();
    window.getSelection()?.removeAllRanges();
    viewport.classList.add('panning');
  } else {
    const worldPoint = screenToWorld(event.clientX, event.clientY);
    const frozen = inverseZoomHeld ? inverseTargets(event) : [];
    gesture = { type: 'zoom', pointer: event.pointerId, startX: event.clientX, anchorX: event.clientX, anchorY: event.clientY, worldX: worldPoint.x, worldY: worldPoint.y, scale: camera.scale, frozen, viewBefore: {...camera}, inverseLimits: frozen.length ? inverseRatioLimits(frozen,worldPoint.x,worldPoint.y) : null };
    if (inverseZoomHeld && !frozen.length) toast(i18n.t('Pon el puntero sobre un elemento desbloqueado para fijarlo'));
    updateZoomCursor();
  }
  viewport.setPointerCapture(event.pointerId);
}, { capture: true });
viewport.addEventListener('dragstart', event => {
  if (mode === 'pan' || spaceHeld || gesture?.type === 'pan' || gesture?.type === 'zoom') { event.preventDefault(); event.stopImmediatePropagation(); }
}, { capture: true });
viewport.addEventListener('selectstart', event => { if (mode === 'pan' || spaceHeld || gesture?.type === 'pan') event.preventDefault(); });
viewport.addEventListener('contextmenu', event => { if (event.altKey || gesture?.type === 'zoom') event.preventDefault(); });
viewport.addEventListener('auxclick', event => { if (event.button === 1) event.preventDefault(); });
viewport.addEventListener('pointerdown', event => {
  if (event.button !== 0 || gesture || event.target.closest('.video-card,.canvas-writing,.empty-state,.vault-frame,button,a,input,textarea') || vaultBusy || vaultDrag) return;
  const vaultId = vaultScopeAtScreen(event.clientX, event.clientY);
  if (vaultId && !vaults.get(vaultId)?.open) return;
  if (mode === 'write') {
    event.preventDefault();
    beginWritingEdit(null, event.clientX, event.clientY);
    return;
  }
  if (selectedWriting) selectWriting(null);
  if(mode==='move'&&!spaceHeld&&!zHeld){
    event.preventDefault();window.getSelection()?.removeAllRanges();if(!event.altKey)clearMagicSelection();
    gesture={type:'rectangle-select',pointer:event.pointerId,startX:event.clientX,startY:event.clientY,endX:event.clientX,endY:event.clientY,scope:vaultId};
    selectionRectangle.hidden=false;syncMagicAnimation();updateSelectionRectangle(event);viewport.setPointerCapture(event.pointerId);return;
  }
  if (mode === 'erase') {
    event.preventDefault();
    positionEraser(event.clientX, event.clientY);
    gesture = { type: 'erase', vaultId, pointer: event.pointerId, lastX: event.clientX, lastY: event.clientY, erased: [], erasedWritings: [], erasedConnections: [], deletions: [] };
    eraseSweep(event.clientX, event.clientY, event.clientX, event.clientY);
    viewport.setPointerCapture(event.pointerId);
    return;
  }
  if (mode === 'draw') {
    event.preventDefault();
    gesture = { type: 'draw', vaultId, pointer: event.pointerId, points: [], screenPoints: [], lastTimestamp: -Infinity, color: document.querySelector('#penColor').value, width: Number(drawWidthInput.value) / camera.scale };
    clipVaultPreview(vaultId);
    addDrawPoint(event);
  } else {
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    gesture = { type: 'pan', pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: camera.x, y: camera.y };
    viewport.classList.add('panning');
  }
  viewport.setPointerCapture(event.pointerId);
});
function addDrawPoint(event) {
  if (!gesture || gesture.type !== 'draw' || gesture.boundaryStopped) return;
  if (event.timeStamp < gesture.lastTimestamp) return;
  const point = screenToWorld(event.clientX, event.clientY);
  const screen = [event.clientX, event.clientY];
  gesture.straight ||= event.shiftKey;
  const previous = gesture.screenPoints.at(-1);
  if (previous) {
    const a = gesture.straight ? gesture.points[0] : gesture.points.at(-1), b = [point.x, point.y];
    const t = vaultSegmentLimit(a, b, gesture.vaultId);
    if (t < 1 || !vaultGestureAllows(event)) {
      point.x = a[0] + (b[0] - a[0]) * t; point.y = a[1] + (b[1] - a[1]) * t;
      screen[0] = camera.x + point.x * camera.scale; screen[1] = camera.y + point.y * camera.scale;
      gesture.boundaryStopped = true;
    }
  }
  if (previous && Math.hypot(screen[0] - previous[0], screen[1] - previous[1]) < 1.5) return;
  gesture.lastTimestamp = event.timeStamp;
  if (gesture.straight && gesture.points.length) {
    gesture.points = [gesture.points[0], [point.x, point.y]];
    gesture.screenPoints = [gesture.screenPoints[0], screen];
  } else {
    gesture.points.push([point.x, point.y]);
    gesture.screenPoints.push(screen);
  }
  scheduleDrawPreview();
}
viewport.addEventListener('pointermove', event => {
  if (mode === 'erase') positionEraser(event.clientX, event.clientY);
  if (!gesture || gesture.pointer !== event.pointerId) return;
  if(gesture.type==='crop'){const item=items.get(gesture.id);if(item){Object.assign(item,ApoxiaCrop.drag(gesture.original,gesture.before,gesture.direction,(event.clientX-gesture.startX)/camera.scale,(event.clientY-gesture.startY)/camera.scale,Math.min(8/camera.scale,gesture.before.displayWidth/2,gesture.before.displayHeight/2),1/camera.scale));updateCard(item);renderCamera();}return;}
  if(gesture.type==='duplicate-pending'){const state=gesture;state.lastX=event.clientX;state.lastY=event.clientY;if(!state.requested&&Math.hypot(state.lastX-state.startX,state.lastY-state.startY)>=4)beginDuplicateDrag(state);return;}
  if(gesture.type==='shape'){updateShapeGesture(event);return;}
  if (gesture.type === 'rectangle-select') {updateSelectionRectangle(event);return;}
  if (gesture.type === 'connector') { updateConnectorGesture(event); return; }
  if (gesture.type === 'magic-select') { addMagicPoint(event); return; }
  if (gesture.type === 'magic-move') {
    let dx=(event.clientX-gesture.startX)/camera.scale, dy=(event.clientY-gesture.startY)/camera.scale;
    // Selected objects may cross the Vault boundary; membership changes on drop.
    gesture.dx=dx; gesture.dy=dy;
    if (!magicRenderFrame) magicRenderFrame=requestAnimationFrame(()=> { magicRenderFrame=0; if(gesture?.type==='magic-move') magicApply(gesture.entries,gesture.dx,gesture.dy); });
    return;
  }
  if (gesture.type === 'pending-card') {
    if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < 4) return;
    gesture.type = 'card';
    cards.get(gesture.id).dataset.suppressClick = 'true';
    viewport.setPointerCapture(event.pointerId);
  }
  if (gesture.type === 'erase') {
    vaultEraseSweep(event);
    return;
  }
  if (gesture.type === 'draw') {
    const samples = event.getCoalescedEvents?.();
    for (const sample of samples?.length ? samples : [event]) addDrawPoint(sample);
    return;
  }
  if (gesture.type === 'writing') {
    if (!gesture.dragStarted) {
      if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) <= textDragDistance) return;
      gesture.dragStarted = true;
      lastTextTap = null;
    }
    const writing = writings.get(gesture.id);
    if (writing) {
      writing.x = gesture.x + (event.clientX - gesture.startX) / camera.scale;
      writing.y = gesture.y + (event.clientY - gesture.startY) / camera.scale;
      renderWritings();
    }
    return;
  }
  if (gesture.type === 'writing-resize') {
    const writing = writings.get(gesture.id);
    if (!writing) return;
    const vx = gesture.cornerX - gesture.anchorX, vy = gesture.cornerY - gesture.anchorY;
    const dx = event.clientX - gesture.startX, dy = event.clientY - gesture.startY;
    const factor = Math.max(.02, Math.min(50, ((vx + dx) * vx + (vy + dy) * vy) / (vx * vx + vy * vy || 1)));
    writing.size = Math.max(1e-12, Math.min(1e16, gesture.size * factor));
    const applied = writing.size / gesture.size;
    const origin = screenToWorld(gesture.anchorX + (gesture.baseX - gesture.anchorX) * applied, gesture.anchorY + (gesture.baseY - gesture.anchorY) * applied);
    writing.x = origin.x; writing.y = origin.y;
    renderWritings();
    return;
  }
  if (gesture.type === 'zoom') {
    const factor = Math.exp((event.clientX - gesture.startX) * Math.LN2 / 80);
    camera.scale = Math.min(maxZoom, Math.max(minZoom, gesture.scale * factor));
    if (gesture.inverseLimits) {
      const {min,max}=gesture.inverseLimits;
      camera.scale=Math.max(gesture.scale/max,Math.min(gesture.scale/(min || Number.MIN_VALUE),camera.scale));
    }
    camera.x = gesture.anchorX - gesture.worldX * camera.scale;
    camera.y = gesture.anchorY - gesture.worldY * camera.scale;
    scheduleCameraRender();
    return;
  }
  const dx = (event.clientX - gesture.startX) / camera.scale;
  const dy = (event.clientY - gesture.startY) / camera.scale;
  if (gesture.type === 'pan') {
    if(gesture.frozen?.length) {
      const scale=gesture.viewBefore.scale, limits=gesture.inversePanBounds;
      gesture.inverseDx=Math.max(limits.minX,Math.min(limits.maxX,-(event.clientX-gesture.startX)/scale));
      gesture.inverseDy=Math.max(limits.minY,Math.min(limits.maxY,-(event.clientY-gesture.startY)/scale));
      camera.x=gesture.x-gesture.inverseDx*scale;
      camera.y=gesture.y-gesture.inverseDy*scale;
    } else {
      camera.x = gesture.x + dx * camera.scale;
      camera.y = gesture.y + dy * camera.scale;
    }
    scheduleCameraRender();
    return;
  }
  const item = items.get(gesture.id);
  if (!item) return;
  if (gesture.type === 'card') {
    if (item.type === 'text' && !gesture.dragStarted) {
      if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) <= textDragDistance) return;
      gesture.dragStarted = true;
      lastTextTap = null;
    }
    item.y = gesture.y + dy; item.x = magneticNoteX(item,gesture.x+dx,item.y,gesture,event.shiftKey);
  } else if (gesture.type === 'resize') {
    const dir = gesture.direction;
    if (item.type !== 'text' && item.width && item.height) {
      const start = { x: gesture.x, y: gesture.y, width: gesture.width, height: gesture.height };
      const minWidth = Math.max(1e-9, Math.min(gesture.width, 80 / camera.scale));
      const result = resizeAspect(start, dx, dy, dir, ApoxiaCrop.aspect(item), minWidth);
      item.x = result.x; item.y = result.y;
      item.displayWidth = result.width; item.displayHeight = result.height;
    } else if (item.type === 'text') {
      if(gesture.proportional || event.altKey) {
        const totalHeight=gesture.height;
        const start={x:gesture.x,y:gesture.y,width:gesture.width,height:totalHeight};
        const result=resizeAspect(start,dx,dy,dir,gesture.width/totalHeight,Math.max(1e-9,1e-9*gesture.width/gesture.height));
        const factor=result.width/gesture.width;
        Object.assign(item,{x:result.x,y:result.y,displayWidth:result.width,displayHeight:gesture.height*factor,
          chromeScale:gesture.noteStyleBefore.chromeScale*factor,textFontSize:gesture.noteStyleBefore.textFontSize*factor});
      } else {
        // Reflow normally; Alt scales the entire original note instead.
        Object.assign(item, gesture.noteStyle);
        const base = gesture.noteStyle.chromeScale;
        Object.assign(item, resizeNote({ x: gesture.x, y: gesture.y, width: gesture.width, height: gesture.height }, dx, dy, dir, base));
      }
    } else {
      let left = gesture.x, top = gesture.y;
      let right = gesture.x + gesture.width, bottom = gesture.y + gesture.height;
      const minWidth = Math.max(1e-9, Math.min(gesture.width, 80 / camera.scale));
      const minHeight = Math.max(1e-9, Math.min(gesture.height, 60 / camera.scale));
      if (dir.includes('w')) left = Math.min(right - minWidth, gesture.x + dx);
      if (dir.includes('e')) right = Math.max(left + minWidth, gesture.x + gesture.width + dx);
      if (dir.includes('n')) top = Math.min(bottom - minHeight, gesture.y + dy);
      if (dir.includes('s')) bottom = Math.max(top + minHeight, gesture.y + gesture.height + dy);
      item.x = left; item.y = top;
      item.displayWidth = right - left; item.displayHeight = bottom - top;
    }
  }
  updateCard(item);
});
async function endGesture(event) {
  canvasActions++;
  try { return await endGestureImpl(event); }
  finally { canvasActions--; }
}
async function endGestureImpl(event) {
  if (!gesture || gesture.pointer !== event.pointerId) return;
  if (gesture.type === 'connector' && event.type === 'pointerup') updateConnectorGesture(event);
  if (gesture.type === 'erase' && event.type === 'pointerup') vaultEraseSweep(event);
  if(gesture.type==='shape'&&event.type==='pointerup')updateShapeGesture(event);
  if (gesture.type === 'draw' && event.type === 'pointerup') addDrawPoint(event);
  if (gesture.type === 'magic-select' && event.type === 'pointerup') { addMagicPoint(event); selectMagicEnclosure(); }
  if(gesture.type==='rectangle-select'&&event.type==='pointerup')updateSelectionRectangle(event);
  if(gesture.type==='duplicate-pending'&&event.type==='pointerup'){gesture.lastX=event.clientX;gesture.lastY=event.clientY;}
  const done = gesture;
  done.ownerBefore = done.id ? vaultOwner(done.type.startsWith('writing') ? 'writings' : 'items', done.id) : null;
  gesture = null;
  if (done.type === 'resize') {
    const card = cards.get(done.id);
    if (card && items.get(done.id)?.type !== 'text') updateMediaCornerHint(card, event.clientX, event.clientY);
  }
  viewport.classList.remove('panning');
  updateZoomCursor();
  if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  if(done.type==='crop'){
    const item=items.get(done.id);if(!item){syncCropPreview();return;}
    if(event.type==='pointercancel'){Object.assign(item,done.before);updateCard(item);renderCamera();syncCropPreview();return;}
    const after=cropSnapshot(item);
    try{await patchItem(item.id,after);await reconcileVaults();rememberItemChange(item.id,done.before,after,'recorte de imagen',{before:done.ownerBefore,after:vaultOwner('items',item.id)});}
    catch(error){Object.assign(item,done.before);updateCard(item);toast(error.message);}
    renderCamera();syncCropPreview();return;
  }
  if(done.type==='duplicate-pending'){done.released=true;done.cancelled=event.type==='pointercancel';return;}
  if(done.type==='rectangle-select'){selectionRectangle.hidden=true;if(event.type==='pointerup')selectRectangle(done);else clearMagicSelection();syncMagicAnimation();return;}
  if(done.type==='connector') {
    renderConnections();
    if(event.type==='pointercancel' || !done.target) return;
    try {
      const result=await putConnection({sourceId:done.sourceId,sourceSide:done.sourceSide,targetId:done.target.id,targetSide:done.target.side,color:done.color,unit:done.unit});
      if(result.created) {
        const snapshot=result.connection;
        remember({label:i18n.t('conexión'),undo:()=>removeConnection(snapshot),redo:()=>putConnection(snapshot)});
      }
    } catch(error) { toast(error.message); }
    return;
  }
  if (done.type === 'pan' && done.frozen?.length) {
    if(event.type==='pointercancel') {
      applyInversePanSnapshot(done.frozen,0,0); Object.assign(camera,done.viewBefore); renderCamera(); return;
    }
    const dx=done.inverseDx, dy=done.inverseDy;
    applyInversePanSnapshot(done.frozen,dx,dy); renderCamera();
    if(!dx && !dy) return;
    inverseZoomSaving=true;
    const viewAfter={...camera};
    try {
      await persistInversePan(done.frozen,dx,dy);
      remember({label:i18n.t('movimiento inverso'),undo:()=>replayInversePan(done.frozen,-dx,-dy,done.viewBefore),redo:()=>replayInversePan(done.frozen,dx,dy,viewAfter)});
    } catch(error) {
      applyInversePanSnapshot(done.frozen,0,0); Object.assign(camera,done.viewBefore); renderCamera(); toast(error.message);
    } finally { inverseZoomSaving=false; }
    return;
  }
  if (done.type === 'zoom' && done.frozen?.length) {
    const factor=done.scale/camera.scale;
    if(event.type==='pointercancel') {
      applyInverseSnapshot(done.frozen,1,done.worldX,done.worldY); Object.assign(camera,done.viewBefore); renderCamera(); return;
    }
    applyInverseSnapshot(done.frozen,factor,done.worldX,done.worldY); renderCamera();
    if(factor===1) return;
    inverseZoomSaving=true;
    const viewAfter={...camera};
    try {
      await persistInverseZoom(done.frozen,factor,done.worldX,done.worldY);
      remember({label:i18n.t('zoom inverso'),undo:()=>replayInverseZoom(done.frozen,1/factor,done.worldX,done.worldY,done.viewBefore),redo:()=>replayInverseZoom(done.frozen,factor,done.worldX,done.worldY,viewAfter)});
    } catch(error) {
      applyInverseSnapshot(done.frozen,1,done.worldX,done.worldY); Object.assign(camera,done.viewBefore); renderCamera(); toast(error.message);
    } finally { inverseZoomSaving=false; }
    return;
  }
  if (done.type === 'magic-select') {
    if(event.type==='pointercancel') clearMagicSelection();
    else { magicTrail=[]; renderMagicLaser(); }
    return;
  }
  if (done.type === 'magic-move') {
    if (magicRenderFrame) { cancelAnimationFrame(magicRenderFrame); magicRenderFrame=0; }
    if(event.type==='pointercancel') {magicApply(done.entries,0,0);if(done.duplicates){clearMagicSelection();for(const entry of done.duplicates)await setCopyPresent({kind:entry.kind,snapshot:{...structuredClone(magicMap(entry.kind).get(entry.id)),vaultId:vaultOwner(entry.kind,entry.id)}},false);}return;}
    magicApply(done.entries,done.dx,done.dy);
    if(!done.dx && !done.dy){if(done.duplicates)rememberDuplication(done.duplicates);return;}
    magicSaving=true;
    try {
      await apiChange('/api/group-move','POST',{objects:done.entries.map(({kind,id})=>({kind,id})),dx:done.dx,dy:done.dy});
      await reconcileVaults(done.entries.map(({kind,id})=>({kind,id})));
      if(done.duplicates)rememberDuplication(done.duplicates);else remember({label:i18n.t('movimiento Magic Laser'),undo:()=>magicTranslate(done.entries,-done.dx,-done.dy),redo:()=>magicTranslate(done.entries,done.dx,done.dy)});
    } catch(error) { magicApply(done.entries,0,0); toast(error.message); }
    finally { magicSaving=false; updateMagicCursor(); }
    return;
  }
  if (done.type === 'erase') {
    await Promise.allSettled(done.deletions);
    const erased = done.erased.filter(stroke => !strokes.has(stroke.id));
    const erasedWritings = done.erasedWritings.filter(writing => !writings.has(writing.id));
    const erasedConnections=done.erasedConnections.filter(connection=>!connection.eraseFailed);
    if (erased.length || erasedWritings.length || erasedConnections.length) remember({ label: i18n.t('goma de borrar'),
      undo: async () => { await setStrokesPresent(erased, true); for (const writing of erasedWritings) await setWritingPresent(writing, true); for(const connection of erasedConnections) await putConnection(connection); },
      redo: async () => { await setStrokesPresent(erased, false); for (const writing of erasedWritings) await setWritingPresent(writing, false); for(const connection of erasedConnections) await removeConnection(connection); }
    });
    return;
  }
  if(done.type==='shape'){
    preview.replaceChildren();
    if(event.type==='pointercancel'||!done.points||done.bounds.width*camera.scale<3||done.bounds.height*camera.scale<3)return;
    done.type='draw';
  }
  if (done.type === 'draw') {
    if (previewFrame) { cancelAnimationFrame(previewFrame); previewFrame = 0; }
    if (done.points.length === 1) done.points.push([done.points[0][0] + 0.01 / camera.scale, done.points[0][1]]);
    if (done.points.length < 2 || event.type === 'pointercancel') { preview.replaceChildren(); return; }
    const pendingId = crypto.randomUUID();
    const provisional = { id: pendingId, points: done.points, color: done.color, width: done.width,...(done.shape?{shape:done.shape}:{}) };
    pendingDraws.set(pendingId, { stroke: provisional, vaultId: done.vaultId });
    addStroke(provisional, true);
    strokes.delete(pendingId);
    redrawStrokes();
    preview.replaceChildren();
    try {
      const response = await fetch('/api/strokes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ points: done.points, color: done.color, width: done.width, vaultId: done.vaultId,...(done.shape?{shape:done.shape}:{}) }) });
      const stroke = await response.json();
      if (!response.ok) throw new Error(stroke.error || i18n.t('No se pudo guardar el trazo'));
      if (done.vaultId && !vaults.get(done.vaultId)?.open) return;
      dropPendingDraw(pendingId);
      if (done.vaultId) { if (!vaults.get(done.vaultId).members.strokes.includes(stroke.id)) vaults.get(done.vaultId).members.strokes.push(stroke.id); rebuildVaultOwners(); }
      addStroke(stroke);
      if (done.vaultId) await saveVaultMembership();
      const snapshot = { ...structuredClone(stroke), vaultId: done.vaultId };
      remember({ label: i18n.t(done.shape?'forma':'trazo'), undo: () => setStrokePresent(snapshot, false), redo: () => setStrokePresent(snapshot, true) });
      if(done.shape)setMode('move',false);
    } catch (error) { toast(error.message); }
    finally { dropPendingDraw(pendingId); redrawStrokes(); }
    return;
  }
  if (done.type === 'writing') {
    const writing = writings.get(done.id);
    if (event.type === 'pointercancel') {
      if (writing) { writing.x = done.x; writing.y = done.y; renderWritings(); }
      return;
    }
    if (writing && (writing.x !== done.x || writing.y !== done.y)) {
      try {
        const response = await fetch(`/api/writings/${done.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: writing.x, y: writing.y }) });
        if (!response.ok) throw new Error(i18n.t('No se pudo mover el texto'));
        await reconcileVaults({ kind: 'writings', id: done.id });
        rememberWritingChange(done.id, { x: done.x, y: done.y }, { x: writing.x, y: writing.y }, 'movimiento de texto', { before: done.ownerBefore, after: vaultOwner('writings', done.id) });
      } catch (error) { writing.x = done.x; writing.y = done.y; renderWritings(); toast(error.message); }
    }
    return;
  }
  if (done.type === 'writing-resize') {
    const writing = writings.get(done.id);
    if (!writing) return;
    if (event.type === 'pointercancel') {
      Object.assign(writing, { x: done.x, y: done.y, size: done.size });
      renderWritings();
      return;
    }
    if (writing.x !== done.x || writing.y !== done.y || writing.size !== done.size) {
      try {
        const response = await fetch(`/api/writings/${done.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: writing.x, y: writing.y, size: writing.size }) });
        if (!response.ok) throw new Error(i18n.t('No se pudo cambiar el tamaño del texto'));
        await reconcileVaults();
        rememberWritingChange(done.id, { x: done.x, y: done.y, size: done.size }, { x: writing.x, y: writing.y, size: writing.size }, 'tamaño de texto', { before: done.ownerBefore, after: vaultOwner('writings', done.id) });
      } catch (error) {
        Object.assign(writing, { x: done.x, y: done.y, size: done.size });
        renderWritings(); toast(error.message);
      }
    }
    positionWritingControls();
    if (!writingControls.matches(':hover') && !writingNodes.get(done.id)?.matches(':hover')) hideWritingControlsSoon();
    return;
  }
  if (done.type === 'card' || done.type === 'resize') {
    const item = items.get(done.id);
    if (!item) return;
    if (event.type === 'pointercancel') {
      Object.assign(item, { x: done.x, y: done.y });
      if (done.type === 'resize') Object.assign(item, { displayWidth: done.width, displayHeight: done.height }, done.noteStyleBefore || {});
      updateCard(item); return;
    }
    if (done.type === 'card' && item.type === 'video') setTimeout(() => { const card = cards.get(item.id); if (card) delete card.dataset.suppressClick; }, 0);
    const changes = done.type === 'card' ? { x: item.x, y: item.y } : { x: item.x, y: item.y, displayWidth: item.displayWidth, displayHeight: item.displayHeight };
    const before = done.type === 'card' ? { x: done.x, y: done.y } : { x: done.x, y: done.y, displayWidth: done.width, displayHeight: done.height };
    if (done.type === 'resize' && item.type === 'text') {
      Object.assign(changes, { chromeScale: item.chromeScale, textFontSize: item.textFontSize });
      Object.assign(before, done.noteStyleBefore);
    }
    try { await patchItem(item.id, changes);
      if (done.type === 'card' && (item.x !== done.x || item.y !== done.y)) await reconcileVaults({ kind: 'items', id: item.id });
      await reconcileVaults();
      updateCard(item);
      rememberItemChange(item.id, before, changes, done.type === 'card' ? 'movimiento' : 'tamaño', { before: done.ownerBefore, after: vaultOwner('items', item.id) }); }
    catch (error) { Object.assign(item, before); updateCard(item); toast(error.message); }
  }
}
viewport.addEventListener('pointerup', event => endGesture(event).then(() => reconcileVaults()).catch(error => toast(error.message)));
viewport.addEventListener('pointercancel', endGesture);
viewport.addEventListener('lostpointercapture', event => {
  if(gesture?.pointer!==event.pointerId) return;
  if(gesture.type==='connector'||gesture.type==='crop') endGesture({type:'pointercancel',pointerId:event.pointerId});
  else if(gesture.type==='pan' || gesture.type==='zoom') endGesture(event);
});
let wheelNavigation=localStorage.getItem('apoxia-wheel-navigation') || 'auto';
let trackpadWheelUntil=0;
const wheelNavigationChoice=document.querySelector('#wheelNavigation');
wheelNavigationChoice.value=wheelNavigation;
wheelNavigationChoice.addEventListener('change',()=> {wheelNavigation=wheelNavigationChoice.value;localStorage.setItem('apoxia-wheel-navigation',wheelNavigation);});
viewport.addEventListener('wheel',event=> {
  const note=event.target.closest('.text-card');
  const editor=note?.querySelector('.text-editor');
  if(editor && !event.ctrlKey && !event.metaKey && !zHeld && !spaceHeld && !gesture && editor.scrollHeight>editor.clientHeight+1){
    event.preventDefault();
    const unit=event.deltaMode===1?16:event.deltaMode===2?editor.clientHeight:1;
    editor.scrollTop+=event.deltaY*unit;
    const links=note.querySelector('.note-links-view');if(links)links.scrollTop=editor.scrollTop;
    return;
  }
  event.preventDefault();
  if(inverseZoomSaving || magicSaving || vaultBusy || vaultDrag || historyBusy || gesture || touchNavigation) return;
  const unit=event.deltaMode===1?16:event.deltaMode===2?innerHeight:1;
  const dx=event.deltaX*unit,dy=event.deltaY*unit;
  if(event.ctrlKey || event.metaKey) {
    // Browsers expose trackpad pinch as wheel events with Ctrl pressed.
    zoomAt(Math.exp(Math.max(-1,Math.min(1,-dy*.024))),event.clientX,event.clientY);
    return;
  }
  if(event.deltaMode===0 && (Math.abs(dx)>0 || Math.abs(dy)<60 || !Number.isInteger(dy))) trackpadWheelUntil=performance.now()+700;
  const trackpad=wheelNavigation==='trackpad' || wheelNavigation==='auto' && performance.now()<trackpadWheelUntil;
  if(trackpad && !zHeld) {camera.x-=dx;camera.y-=dy;scheduleCameraRender();}
  else zoomAt(Math.exp(Math.max(-1,Math.min(1,-dy*(trackpad ? .006 : .0015)))),event.clientX,event.clientY);
},{passive:false});
document.querySelector('#zoomIn').addEventListener('click', () => zoomAt(1.5));
document.querySelector('#zoomOut').addEventListener('click', () => zoomAt(1 / 1.5));
document.querySelector('#resetView').addEventListener('click', resetView);
document.querySelector('#fitView').addEventListener('click', fitAll);
document.querySelector('#rectangleButton').addEventListener('click',()=>setMode('rectangle'));
document.querySelector('#laserButton').addEventListener('click', () => setMode('laser'));
document.querySelector('#drawButton').addEventListener('click', () => {
  if (magicSaving || inverseZoomSaving) return;
  setMode('draw', false);
  document.querySelector('#drawSizeControl').hidden = false;
});
document.querySelector('#eraseButton').addEventListener('click', () => setMode('erase'));
document.querySelector('#writeButton').addEventListener('click', () => setMode('write'));
document.querySelector('#toggleStrokes').addEventListener('click', () => setStrokesVisible(!showStrokes));
document.querySelector('#toggleTexts').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true;
  try { await setTextsVisible(!showTexts); } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
document.querySelector('#toggleMedia').addEventListener('click', () => setMediaVisible(!showMedia));
clearButton.addEventListener('click', () => {
  if (clearButton.disabled) return;
  clearTargetVaultId = null;
  clearVaultDeleteMode = null;
  document.querySelector('#clearTitle').textContent = i18n.t('Borrar todo el canvas');
  document.querySelector('#clearDescription').textContent = i18n.t('Se eliminarán todas las referencias, dibujos, textos vectoriales y Vaults, junto con las copias y los archivos originales guardados en esta app. No se puede deshacer.');
  clearThumb.setAttribute('aria-label', i18n.t('Desliza hasta el final para borrar todo'));
  document.querySelector('#clearSummary').textContent = i18n.t(`${items.size} referencia${items.size === 1 ? '' : 's'}, ${strokes.size} trazo${strokes.size === 1 ? '' : 's'} y ${writings.size} texto${writings.size === 1 ? '' : 's'} vectorial${writings.size === 1 ? '' : 'es'}`);
  resetClearSlide();
  clearDialog.showModal();
});
document.querySelector('#cancelClear').addEventListener('click', () => clearDialog.close());
clearDialog.addEventListener('cancel', event => { if (clearBusy) event.preventDefault(); });
clearDialog.addEventListener('close', () => { clearTargetVaultId = null; clearVaultDeleteMode = null; resetClearSlide(); });
clearThumb.addEventListener('pointerdown', event => {
  if (event.button !== 0 || clearBusy) return;
  event.preventDefault();
  const max = Math.max(0, clearTrack.clientWidth - clearThumb.offsetWidth - 8);
  clearSlide = { pointer: event.pointerId, startX: event.clientX, max, x: 0 };
  clearThumb.setPointerCapture(event.pointerId);
});
clearThumb.addEventListener('pointermove', event => {
  if (!clearSlide || clearSlide.pointer !== event.pointerId) return;
  clearSlide.x = Math.max(0, Math.min(clearSlide.max, event.clientX - clearSlide.startX));
  moveClearThumb(clearSlide.x, clearSlide.max);
});
function endClearSlide(event) {
  if (!clearSlide || clearSlide.pointer !== event.pointerId) return;
  if (event.type === 'pointerup') clearSlide.x = Math.max(0, Math.min(clearSlide.max, event.clientX - clearSlide.startX));
  const complete = event.type === 'pointerup' && clearSlide.max > 0 && clearSlide.x >= clearSlide.max - 8;
  if (complete) { const max = clearSlide.max; clearSlide = null; moveClearThumb(max, max); confirmClearBoard(); }
  else resetClearSlide();
}
clearThumb.addEventListener('pointerup', endClearSlide);
clearThumb.addEventListener('pointercancel', endClearSlide);
clearThumb.addEventListener('keydown', event => {
  if (clearBusy) return;
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    const max = Math.max(0, clearTrack.clientWidth - clearThumb.offsetWidth - 8);
    const current = Number.parseFloat(clearThumb.style.getPropertyValue('--slide-x')) || 0;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? max : Math.max(0, Math.min(max, current + (event.key === 'ArrowRight' ? 24 : -24)));
    moveClearThumb(next, max);
  } else if ((event.key === 'Enter' || event.key === ' ') && Number.parseFloat(clearThumb.style.getPropertyValue('--slide-x')) >= clearTrack.clientWidth - clearThumb.offsetWidth - 16) {
    event.preventDefault(); confirmClearBoard();
  }
});
eraserRadiusInput.addEventListener('input', () => {
  document.querySelector('#eraserRadiusValue').textContent = `${eraserRadiusInput.value} px`;
  positionEraser(parseFloat(eraserCursor.style.left) || innerWidth / 2, parseFloat(eraserCursor.style.top) || innerHeight / 2);
});
document.querySelector('#textButton').addEventListener('click', () => addText());
document.querySelector('#audioButton').addEventListener('click', () => {
  audioEnabled = !audioEnabled;
  const button = document.querySelector('#audioButton');
  button.setAttribute('aria-pressed', String(audioEnabled));
  button.title = audioEnabled ? i18n.t('Desactivar sonido') : i18n.t('Activar sonido al reproducir');
  for (const card of cards.values()) {
    const video = card.querySelector('video');
    if (video) video.muted = !audioEnabled || !items.get(card.dataset.id)?.hasAudio;
  }
  toast(audioEnabled ? i18n.t('Sonido activado para los vídeos nuevos con audio') : i18n.t('Sonido desactivado'));
});
document.querySelector('#addButton').addEventListener('click', async () => {
  if(!window.apoxiaDesktop || !magicSelection.size) return fileInput.click();
  const selected=[...magicSelection.values()].filter(({kind,id})=>magicMap(kind).has(id) && vaultContentVisible(kind,id));
  if(!selected.length) return fileInput.click();
  const before=selected.map(({kind,id})=>({kind,id,fileLink:magicMap(kind).get(id).fileLink || null}));
  try {
    const fileLink=await window.apoxiaDesktop.chooseFile();if(!fileLink) return;
    const after=selected.map(({kind,id})=>({kind,id,fileLink}));
    await updateObjectLinks(after);clearMagicSelection();setMode('move',false);
    remember({label:i18n.t('enlazar archivo'),undo:()=>updateObjectLinks(before),redo:()=>updateObjectLinks(after)});
    toast(`Selección enlazada a ${fileLink.name}`);
  } catch(error) {toast(error.message);}
});
fileInput.addEventListener('change', async () => {
  const files=[...fileInput.files];fileInput.value='';
  const media=files.filter(isMediaFile),attachments=files.filter(file=>!isMediaFile(file));
  canvasActions++;
  try {
    if(media.length) await addFiles(media,innerWidth/2-160,innerHeight/2-90);
    if(attachments.length && !showStrokes) setStrokesVisible(true);
    for(const [index,file] of attachments.entries()) {
      try {await createFileClip(file,innerWidth/2+(index%4)*120,innerHeight/2+Math.floor(index/4)*140+(media.length?240:0));}
      catch(error) {toast(`${file.name}: ${i18n.t(error.message)}`);}
    }
    if(attachments.length) setMode('move',false);
  } finally {canvasActions--;}
});
const canvasFind=document.querySelector('#canvasFind'),canvasFindInput=document.querySelector('#canvasFindInput'),canvasFindCount=document.querySelector('#canvasFindCount'),canvasFindHighlight=document.querySelector('#canvasFindHighlight');
let canvasFindResults=[],canvasFindIndex=-1,canvasFindTarget=null;
window.__canvasFindReady=true;
function collectCanvasMatches(query){
  if(!query)return [];
  const needle=query.toLocaleLowerCase(),results=[];
  for(const [kind,map] of [['items',items],['writings',writings]])for(const object of map.values()){
    if(kind==='items'&&object.type!=='text'||!vaultContentVisible(kind,object.id))continue;
    const text=(object.text||'').toLocaleLowerCase();let offset=0;
    while((offset=text.indexOf(needle,offset))!==-1){results.push({kind,id:object.id,offset,length:query.length});offset+=Math.max(1,needle.length);}
  }
  return results;
}
function updateCanvasFindCount(){
  canvasFindCount.textContent=canvasFindInput.value?`${canvasFindIndex+1} / ${canvasFindResults.length}`:'';
  canvasFind.classList.toggle('no-results',Boolean(canvasFindInput.value)&&!canvasFindResults.length);
  for(const id of ['canvasFindPrevious','canvasFindNext'])document.getElementById(id).disabled=!canvasFindResults.length;
}
function renderCanvasFindHighlight(){
  const target=canvasFindTarget;
  if(canvasFind.hidden||!target||!vaultContentVisible(target.kind,target.id)||!magicMap(target.kind).has(target.id)){canvasFindHighlight.hidden=true;return;}
  canvasFindHighlight.hidden=false;
  Object.assign(canvasFindHighlight.style,{left:`${camera.x+target.x*camera.scale}px`,top:`${camera.y+target.y*camera.scale}px`,width:`${Math.max(2,target.width*camera.scale)}px`,height:`${Math.max(2,target.height*camera.scale)}px`});
}
function canvasMatchBounds(match,object){
  if(match.kind==='writings'){
    const prefix=object.text.slice(0,match.offset).split('\n'),unit=object.size/48;
    return {x:object.x+measureScribeLine(prefix.at(-1))*unit,y:object.y+(prefix.length-1)*64.8*unit-object.size*.85,width:Math.max(1,measureScribeLine(object.text.slice(match.offset,match.offset+match.length))*unit),height:object.size*1.35};
  }
  const unit=noteLayoutUnit(object),base=object.chromeScale||1,font=(object.textFontSize||17*base)/base;
  const mirror=document.createElement('div');
  Object.assign(mirror.style,{position:'fixed',left:'-100000px',top:'0',visibility:'hidden',width:`${object.displayWidth/unit}px`,padding:'16px',boxSizing:'border-box',font:`400 ${font}px/1.5 "Paper Mono",monospace`,whiteSpace:'pre-wrap',overflowWrap:'break-word'});
  mirror.append(document.createTextNode(object.text.slice(0,match.offset)));const mark=document.createElement('span');mark.textContent=object.text.slice(match.offset,match.offset+match.length);mirror.append(mark);document.body.append(mirror);
  const rect=mark.getClientRects()[0]||mark.getBoundingClientRect(),outer=mirror.getBoundingClientRect();
  const local={x:rect.x-outer.x,y:rect.y-outer.y,width:Math.max(1,rect.width),height:Math.max(font*1.5,rect.height)};mirror.remove();
  const card=cards.get(object.id),editor=card?.querySelector('.text-editor');
  const height=object.displayHeight/unit;
  const scroll=Math.max(0,Math.min(Math.max(0,(editor?.scrollHeight||height)-height),local.y+local.height/2-height/2));
  if(editor){editor.scrollTop=scroll;const links=card.querySelector('.note-links-view');if(links)links.scrollTop=scroll;}
  return {x:object.x+local.x*unit,y:object.y+(local.y-scroll)*unit,width:local.width*unit,height:local.height*unit};
}
function jumpCanvasFind(index){
  if(!canvasFindResults.length){canvasFindIndex=-1;canvasFindTarget=null;updateCanvasFindCount();renderCanvasFindHighlight();return;}
  canvasFindIndex=(index+canvasFindResults.length)%canvasFindResults.length;
  const match=canvasFindResults[canvasFindIndex],object=magicMap(match.kind).get(match.id);
  if(!object||!vaultContentVisible(match.kind,match.id)){refreshCanvasFind();return;}
  const font=match.kind==='writings'?object.size:(object.textFontSize||17*(object.chromeScale||1))/(object.chromeScale||1)*noteLayoutUnit(object);
  camera.scale=Math.min(maxZoom,Math.max(minZoom,Math.min(22/font,(innerWidth-120)/Math.max(font,match.length*font*.65))));
  // Attach and lay out the note before measuring or scrolling a distant match.
  if(match.kind==='items'){camera.x=innerWidth/2-(object.x+object.displayWidth/2)*camera.scale;camera.y=innerHeight/2-(object.y+object.displayHeight/2)*camera.scale;setNoteHover(match.id);applyCardChrome(cards.get(match.id),object);}
  const bounds=canvasMatchBounds(match,object);
  canvasFindTarget={...match,...bounds};
  camera.x=innerWidth/2-(bounds.x+bounds.width/2)*camera.scale;
  camera.y=innerHeight/2-(bounds.y+bounds.height/2)*camera.scale;
  renderCamera();updateCanvasFindCount();renderCanvasFindHighlight();
}
function refreshCanvasFind(){canvasFindResults=collectCanvasMatches(canvasFindInput.value);jumpCanvasFind(0);}
function closeCanvasFind(){canvasFind.hidden=true;canvasFindTarget=null;canvasFindResults=[];canvasFindIndex=-1;canvasFindInput.value='';canvasFindHighlight.hidden=true;canvasFindInput.blur();}
canvasFindInput.addEventListener('input',refreshCanvasFind);
canvasFindInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();canvasFindResults=collectCanvasMatches(canvasFindInput.value);jumpCanvasFind(canvasFindIndex+(event.shiftKey?-1:1));}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeCanvasFind();}});
document.querySelector('#canvasFindPrevious').addEventListener('click',()=>{canvasFindResults=collectCanvasMatches(canvasFindInput.value);jumpCanvasFind(canvasFindIndex-1);});
document.querySelector('#canvasFindNext').addEventListener('click',()=>{canvasFindResults=collectCanvasMatches(canvasFindInput.value);jumpCanvasFind(canvasFindIndex+1);});
document.querySelector('#canvasFindClose').addEventListener('click',closeCanvasFind);
window.addEventListener('keydown',event=>{
  if(noteReader.open)return;
  if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==='f'){
    event.preventDefault();event.stopImmediatePropagation();if(clearDialog.open||gesture||canvasTransferBusy)return;
    if(!showTexts)setTextsVisible(true);
    canvasFind.hidden=false;canvasFindInput.focus();canvasFindInput.select();refreshCanvasFind();
  }else if(!canvasFind.hidden&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeCanvasFind();}
},{capture:true});
let canvasLockBusy=false;
async function toggleCanvasLock(){
  if(canvasLockBusy||gesture||vaultDrag||vaultBusy||historyBusy||canvasActions)return;
  const hitElement=document.elementFromPoint(pointerPosition.x,pointerPosition.y);
  const card=hitElement?.closest('.video-card'),node=hitElement?.closest('.canvas-writing');
  let hit=card?{kind:'items',id:card.dataset.id}:node?{kind:'writings',id:node.dataset.id}:null;
  if(!hit&&pointerOnPage){const point=screenToWorld(pointerPosition.x,pointerPosition.y);for(const writing of [...writings.values()].reverse())if(vaultContentVisible('writings',writing.id)&&magicTouches('writings',writing,[point.x,point.y],[point.x,point.y],0)){hit={kind:'writings',id:writing.id};break;}}
  if(!hit&&pointerOnPage){const object=notePick(pointerPosition.x,pointerPosition.y,true)||gpuPick(pointerPosition.x,pointerPosition.y);if(object)hit={kind:'items',id:object.id};}
  if(!hit&&hoveredWriting)hit={kind:'writings',id:hoveredWriting};
  let targets=hit?[hit]:[...magicSelection.values()].filter(e=>['items','writings'].includes(e.kind));
  if(!targets.length&&selectedWriting)targets=[{kind:'writings',id:selectedWriting}];
  if(!targets.length&&lastSelectedItem)targets=[{kind:'items',id:lastSelectedItem}];
  targets=targets.filter(e=>magicMap(e.kind).has(e.id)&&vaultContentVisible(e.kind,e.id));if(!targets.length)return;
  const after=!targets.every(e=>Boolean(magicMap(e.kind).get(e.id).locked));
  const changes=targets.map(e=>({...e,before:Boolean(magicMap(e.kind).get(e.id).locked)}));
  const apply=async(redo)=>{for(const e of changes){const locked=redo?after:e.before;if(e.kind==='items')await applyItemChanges(e.id,{locked});else await applyWritingChanges(e.id,{locked});}renderMagicLaser();scheduleConnectionRender();};
  canvasLockBusy=true;canvasActions++;
  try{await apply(true);remember({label:'bloqueo',undo:()=>apply(false),redo:()=>apply(true)});}
  catch(error){try{await apply(false);}catch(rollbackError){console.error(rollbackError);}toast(error.message);}finally{canvasLockBusy=false;canvasActions--;}
}
const videoReader=document.createElement('dialog');videoReader.className='image-reader video-reader';
videoReader.innerHTML='<button type="button" aria-label="Cerrar vídeo">Cerrar · Esc</button><video controls playsinline preload="metadata"></video>';
document.body.append(videoReader);
const readerVideo=videoReader.querySelector('video');
function closeVideoReader(){readerVideo.pause();if(videoReader.open)videoReader.close();readerVideo.removeAttribute('src');readerVideo.load();}
videoReader.querySelector('button').addEventListener('click',closeVideoReader);
videoReader.addEventListener('cancel',event=>{event.preventDefault();closeVideoReader();});
window.addEventListener('keydown',event=>{if(!videoReader.open)return;event.stopImmediatePropagation();if(event.key==='Escape'){event.preventDefault();closeVideoReader();}else if(event.code==='Space'){event.preventDefault();if(!event.repeat){if(readerVideo.paused)readerVideo.play().catch(()=>{});else readerVideo.pause();}}},{capture:true});
function openVideoReader(item){
 for(const video of videoPreviews.values())video.pause();
 readerVideo.muted=!audioEnabled||!item.hasAudio;
 readerVideo.src=privateMediaURL(item.nativeVideo&&item.originalAvailable?`/original/${item.id}`:`/media/${item.id}.mp4`,item.id);
 videoReader.showModal();readerVideo.focus();readerVideo.play().catch(()=>{});
}
const imageReader=document.createElement('dialog');imageReader.className='image-reader';
imageReader.innerHTML='<button type="button" aria-label="Cerrar imagen">Cerrar · Esc</button><img alt="">';
document.body.append(imageReader);
function closeImageReader(){if(imageReader.open)imageReader.close();imageReader.querySelector('img').removeAttribute('src');}
imageReader.querySelector('button').addEventListener('click',closeImageReader);
imageReader.addEventListener('cancel',event=>{event.preventDefault();closeImageReader();});
window.addEventListener('keydown',event=>{if(!imageReader.open)return;event.stopImmediatePropagation();if(event.key==='Escape'||event.code==='Space'){event.preventDefault();if(!event.repeat)closeImageReader();}},{capture:true});
function openImageReader(item){
 const source=item.originalAvailable?`/original/${encodeURIComponent(item.id)}`:cards.get(item.id)?.querySelector('img')?.src;
 if(!source)return;
 imageReader.querySelector('img').src=source;
 imageReader.showModal();imageReader.querySelector('button').focus();
}
const noteReader=document.createElement('dialog');noteReader.className='note-reader';
noteReader.innerHTML='<header><span>Lectura de nota</span><output>0%</output><button type="button" aria-label="Cerrar lectura">Cerrar · Esc</button></header><div class="note-reader-scroll" tabindex="0"><textarea aria-label="Texto de la nota" spellcheck="false"></textarea></div>';
document.body.append(noteReader);
const noteReaderScroll=noteReader.querySelector('.note-reader-scroll'),noteReaderText=noteReader.querySelector('textarea'),noteReaderPercent=noteReader.querySelector('output');
let noteReaderId=null,noteReaderSaveTimer,noteReaderEditTimer,noteReaderBefore='',noteReaderDirty=false,noteReaderWrite=Promise.resolve();const privateReadingPositions=new Map();
function readerPosition(){const max=noteReaderScroll.scrollHeight-noteReaderScroll.clientHeight;return max>0?noteReaderScroll.scrollTop/max:0;}
function saveReaderPosition(){clearTimeout(noteReaderSaveTimer);if(!noteReaderId)return;const value=readerPosition();if(vaultOwner('items',noteReaderId))privateReadingPositions.set(noteReaderId,value);else try{localStorage.setItem('apoxia.reading.'+noteReaderId,String(value));}catch{}}
function resizeReaderEditor(){const top=noteReaderScroll.scrollTop;noteReaderText.style.height='0px';noteReaderText.style.height=noteReaderText.scrollHeight+'px';noteReaderScroll.scrollTop=top;}
function flushReaderEdit(){clearTimeout(noteReaderEditTimer);if(!noteReaderDirty||!noteReaderId)return noteReaderWrite;const id=noteReaderId,text=noteReaderText.value;noteReaderDirty=false;noteReaderWrite=noteReaderWrite.then(()=>patchItem(id,{text})).catch(()=>toast('No se pudo guardar el texto de la nota'));return noteReaderWrite;}
noteReaderText.addEventListener('input',()=>{const item=items.get(noteReaderId);if(!item||noteReaderText.readOnly)return;item.text=noteReaderText.value;const editor=cards.get(item.id)?.querySelector('textarea');if(editor)editor.value=item.text;noteReaderDirty=true;resizeReaderEditor();noteReaderPercent.textContent=Math.round(readerPosition()*100)+'%';noteGPUSceneDirty=true;noteTextLayouts.delete(item.id);scheduleNotePreviewRender();clearTimeout(noteReaderEditTimer);noteReaderEditTimer=setTimeout(flushReaderEdit,450);});
window.addEventListener('resize',()=>{if(noteReader.open)resizeReaderEditor();});
function closeNoteReader(){if(!noteReader.open)return;saveReaderPosition();flushReaderEdit();const id=noteReaderId,before=noteReaderBefore,after=noteReaderText.value;if(before!==after)remember({label:'texto de nota',undo:()=>applyItemChanges(id,{text:before}),redo:()=>applyItemChanges(id,{text:after})});noteReader.close();noteReaderText.value='';noteReaderId=null;}

noteReader.querySelector('button').addEventListener('click',closeNoteReader);
noteReader.addEventListener('cancel',event=>{event.preventDefault();closeNoteReader();});
noteReaderScroll.addEventListener('scroll',()=>{noteReaderPercent.textContent=Math.round(readerPosition()*100)+'%';clearTimeout(noteReaderSaveTimer);noteReaderSaveTimer=setTimeout(saveReaderPosition,200);},{passive:true});
window.addEventListener('pagehide',saveReaderPosition);
function previewUnderPointer(){
 const p=screenToWorld(pointerPosition.x,pointerPosition.y);
 const hit=(showTexts&&(ownedNoteGPU.hit(p.x,p.y)||noteGPU.hit(p.x,p.y)))||gpuPick(pointerPosition.x,pointerPosition.y),item=hit&&items.get(hit.id);
 if(!item||!vaultContentVisible('items',item.id))return;
 if(item.type==='image'){openImageReader(item);return;}
 if(item.type==='video'){openVideoReader(item);return;}
 if(item.type!=='text')return;
 if(!canvasFind.hidden)closeCanvasFind();
 noteReaderId=item.id;noteReader.dataset.id=item.id;setNoteColor(noteReader,item.color);noteReader.classList.toggle('reader-hidden-background',Boolean(item.backgroundHidden));noteReaderText.value=cards.get(item.id)?.querySelector('textarea')?.value??item.text??'';noteReaderBefore=noteReaderText.value;noteReaderDirty=false;noteReaderText.readOnly=Boolean(item.locked);
 let position=0;if(vaultOwner('items',item.id))position=privateReadingPositions.get(item.id)||0;else try{position=Number(localStorage.getItem('apoxia.reading.'+item.id))||0;}catch{}
 noteReader.showModal();resizeReaderEditor();noteReaderScroll.scrollTop=Math.min(1,Math.max(0,position))*Math.max(0,noteReaderScroll.scrollHeight-noteReaderScroll.clientHeight);noteReaderPercent.textContent=Math.round(readerPosition()*100)+'%';noteReaderScroll.focus();
}
window.addEventListener('keydown',event=>{
 if(!noteReader.open)return;
 event.stopImmediatePropagation();if(event.key==='Escape'||(event.code==='Space'&&event.target!==noteReaderText)){event.preventDefault();if(!event.repeat)closeNoteReader();}
},{capture:true});
function editingText(target) { return target instanceof Element && Boolean(target.closest('input,textarea,[contenteditable="true"]')); }
let hoverDeleteBusy=false;
async function setSelectionPresent(entries, present) {
  const completed=[];
  try {
    const strokeEntries=entries.filter(entry=>entry.kind==='strokes');
    if(strokeEntries.length){await setStrokesPresent(strokeEntries.map(entry=>entry.snapshot),present);completed.push(...strokeEntries);}
    for(const entry of entries.filter(entry=>entry.kind!=='strokes')){await setCopyPresent(entry,present);completed.push(entry);}
  } catch(error) {
    for(const entry of completed.reverse()) {
      try {if(entry.kind==='strokes')await setStrokePresent(entry.snapshot,!present);else await setCopyPresent(entry,!present);}
      catch(rollbackError){console.error(rollbackError);}
    }
    throw error;
  }
  gpuSceneDirty=true;noteGPUSceneDirty=true;renderCamera();scheduleConnectionRender();
}
async function deleteCanvasSelection() {
  if(hoverDeleteBusy || duplicationBusy || gesture || vaultDrag || vaultBusy || historyBusy || magicSaving || inverseZoomSaving || canvasActions) return;
  const entries=[...magicSelection.values()].filter(entry=>magicMap(entry.kind).has(entry.id)&&vaultContentVisible(entry.kind,entry.id))
    .map(entry=>({kind:entry.kind,snapshot:{...structuredClone(magicMap(entry.kind).get(entry.id)),vaultId:vaultOwner(entry.kind,entry.id)}}));
  if(!entries.length)return;
  hoverDeleteBusy=true;canvasActions++;
  try {
    await setSelectionPresent(entries,false);
    clearMagicSelection();selectedWriting=null;lastSelectedItem=null;fileHover=null;renderFileGlow();
    remember({label:'selección borrada',undo:()=>setSelectionPresent(entries,true),redo:()=>{clearMagicSelection();return setSelectionPresent(entries,false);}});
  } catch(error){toast(error.message);}
  finally{canvasActions--;hoverDeleteBusy=false;}
}
async function deleteObjectUnderPointer() {
  if(hoverDeleteBusy || gesture || vaultDrag || vaultBusy || historyBusy || magicSaving || inverseZoomSaving || canvasActions || !pointerOnPage) return;
  const {x,y}=pointerPosition,world=screenToWorld(x,y),p=[world.x,world.y],scope=vaultScopeAtScreen(x,y);
  const available=(kind,id)=>vaultContentVisible(kind,id) && (vaultOwner(kind,id)===scope || screenFrozen.has(`${kind}:${id}`));
  // These are the same stacking contexts used by the drawing surfaces:
  // photos (0), strokes (1), arrows (2), Scribe (3), notes (4), with Vault content above public content (6).
  if(stackingScheduled)updateStacking();
  const candidates=[];
  const add=(kind,object,layer,rank)=>{
    if(!available(kind,object.id))return;
    candidates.push({kind,object,context:vaultOwner(kind,object.id)?6:0,layer,rank});
  };
  let order=0;
  if(showStrokes)for(const [id,object]of strokes){
    if(!pendingErase.has(id)&&magicTouches('strokes',object,p,p,5/camera.scale))add('strokes',object,1,order);
    order++;
  }
  order=0;
  if(showTexts)for(const [id,object]of writings){
    if(writingSizeInteractive(object)&&magicTouches('writings',object,p,p,0))add('writings',object,3,order);
    order++;
  }
  for(const object of items.values()){
    if((object.type==='text'?showTexts:showMedia)&&containsVaultPoint(vaultObjectBounds('items',object),...p))add('items',object,object.type==='text'?4:0,gpuRanks.get(object.id)||0);
  }
  order=0;
  // Follow the same source/link order and stacking contexts as renderConnections.
  for(const source of [...[...gpuConnectionSources].map(connectionObject).filter(Boolean),...[...writings.values()].filter(a=>a.connections?.length)]){
    if(!connectionItemVisible(source))continue;
    for(const link of source.connections||[]){
      const rank=order++,target=connectionObject(link.targetId);
      if(pendingConnectionErase.has(link.id)||!connectionItemVisible(target)||!connectionSides.includes(link.sourceSide)||!connectionSides.includes(link.targetSide))continue;
      const owner=connectionOwner(source)||connectionOwner(target);
      if(owner!==scope||!connectionEraserHit(connectionGeometry(source,target,link),x,y,x,y,5))continue;
      const object={...structuredClone(link),sourceId:source.id,unit:link.unit||(source.displayWidth||320)/320,color:link.color||'#c67bea'};
      candidates.push({kind:'connections',object,context:owner?6:0,layer:2,rank});
    }
  }
  candidates.sort((a,b)=>b.context-a.context||b.layer-a.layer||b.rank-a.rank);
  const target=candidates[0];
  if(!target) return;
  hoverDeleteBusy=true;
  const {kind,object}=target;
  try {
    if(kind==='connections'){
      await removeConnection(object);
      remember({label:i18n.t('conexión borrada'),undo:()=>putConnection(object),redo:()=>removeConnection(object)});
      return;
    }
    if(object.fileLink) {
      const linkId=object.fileLink.id;
      const before=[...fileLinkedTargets.values()].filter(entry=> {
        const member=magicMap(entry.kind).get(entry.id);
        return member?.fileLink?.id===linkId && vaultContentVisible(entry.kind,entry.id);
      }).map(entry=>({...entry,fileLink:structuredClone(magicMap(entry.kind).get(entry.id).fileLink)}));
      const after=before.map(({kind,id})=>({kind,id,fileLink:null}));
      await updateObjectLinks(after);
      remember({label:i18n.t('acceso directo eliminado'),undo:()=>updateObjectLinks(before),redo:()=>updateObjectLinks(after)});
      fileLinkTap=null;fileHover=null;renderFileGlow();
      toast(i18n.t('Acceso directo eliminado · X otra vez para borrar el elemento'));
      return;
    }
    if(kind==='writings') await deleteWriting(object.id);
    else {
      const snapshot={...structuredClone(object),vaultId:vaultOwner(kind,object.id)};
      const present=kind==='strokes'?setStrokePresent:object.type==='text'?setNotePresent:setMediaPresent;
      await present(snapshot,false);
      remember({label:i18n.t('elemento borrado'),undo:()=>present(snapshot,true),redo:()=>present(snapshot,false)});
    }
    magicSelection.delete(`${kind}:${object.id}`);renderMagicLaser();fileHover=null;renderFileGlow();scheduleConnectionRender();
  } catch(error) {toast(error.message);}
  finally {hoverDeleteBusy=false;}
}
window.addEventListener('keydown', event => {
  if(event.key==='Alt' && !editingText(event.target) && !clearDialog.open) activateDrawLaser();
  if (inverseZoomSaving) { event.preventDefault(); return; }
  if((event.ctrlKey||event.metaKey)&&!event.altKey&&!editingText(event.target)&&!clearDialog.open){
    const key=event.key.toLowerCase();if(key==='c'){const entries=copyableEntries();if(entries.length){event.preventDefault();if(!event.repeat)copyCanvasObjects(entries);}return;}
    if(key==='v'&&pointerOnPage){event.preventDefault();if(!event.repeat)pasteClipboardOnCanvas();return;}
  }
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'z') {
    if (editingText(event.target)) return;
    event.preventDefault();
    if (!event.repeat) travelHistory(event.shiftKey);
    return;
  }
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'y') {
    if (editingText(event.target)) return;
    event.preventDefault();
    if (!event.repeat) travelHistory(true);
    return;
  }
  if (!event.altKey && !event.ctrlKey && !event.metaKey && !editingText(event.target) && !clearDialog.open && magicSelection.size && ['Delete','Backspace'].includes(event.key)) {
    event.preventDefault();if(!event.repeat)deleteCanvasSelection();return;
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedWriting && !editingText(event.target) && !clearDialog.open) { event.preventDefault(); deleteWriting(selectedWriting); return; }
  if (event.key === 'Escape') {
    if(gesture?.type==='shape'){endGesture({type:'pointercancel',pointerId:gesture.pointer});event.preventDefault();return;}
    if(gesture?.type==='rectangle-select'){endGesture({type:'pointercancel',pointerId:gesture.pointer});event.preventDefault();return;}
    if(gesture?.type==='connector') { endGesture({type:'pointercancel',pointerId:gesture.pointer}); event.preventDefault(); return; }
    clearMagicSelection(); setMode(mode); scheduleConnectionRender(); return;
  }
  if (event.key.toLowerCase()==='z' && !event.ctrlKey && !event.metaKey && !editingText(event.target) && !clearDialog.open) {
    event.preventDefault(); zHeld=true; inverseZoomHeld=event.altKey; updateZoomCursor(); return;
  }
  if (event.key==='Alt' && zHeld) { inverseZoomHeld=true; updateZoomCursor(); }
  if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !editingText(event.target) && !clearDialog.open) {
    event.preventDefault();
    if(!event.repeat&&!gesture)previewUnderPointer();
    return;
  }
  if (event.key.toLowerCase()==='f' && !event.altKey && !event.ctrlKey && !event.metaKey && !editingText(event.target) && !clearDialog.open) {
    event.preventDefault(); if(!event.repeat && !gesture && !vaultBusy && !vaultDrag && !historyBusy && !canvasActions) toggleScreenFrozen(); return;
  }
  if (event.altKey || event.ctrlKey || event.metaKey || editingText(event.target) || clearDialog.open) return;
  if(event.key.toLowerCase()==='r'){event.preventDefault();if(!event.repeat&&!gesture)setMode('rectangle');return;}
  if(['l','q'].includes(event.key.toLowerCase())){event.preventDefault();if(!event.repeat)toggleCanvasLock();return;}
  if(event.key.toLowerCase()==='v'){event.preventDefault();if(!event.repeat){const card=document.querySelector('.text-card:hover'),hit=card?items.get(card.dataset.id):notePick(pointerPosition.x,pointerPosition.y);if(hit?.type==='text'||hit?.type==='note')toggleNoteBackground(hit.id);}return;}
  if(event.key.toLowerCase()==='x') {event.preventDefault();if(!event.repeat) deleteObjectUnderPointer();return;}
  if (/^[1-5]$/.test(event.key)) {
    event.preventDefault();
    if (!event.repeat && !gesture) {
      if (spaceHeld) saveCanvasView(event.key);
      else restoreCanvasView(event.key);
    }
    return;
  }
  if (event.key.toLowerCase() === 'c' && !event.repeat) {
    const hoveredCard = document.querySelector('.text-card:hover');
    const item = hoveredCard ? items.get(hoveredCard.dataset.id) : notePick(pointerPosition.x,pointerPosition.y);
    if (item?.type === 'text') {
      event.preventDefault();
      const previousColor = item.color;
      const noteColors=[...notePalette(),magicNoteColor];
      const color = noteColors[(noteColorIndex(item.color) + 1) % noteColors.length];
      item.color = color;
      setNoteColor(cards.get(item.id), color);
      const previousWrite = colorWrites.get(item.id) || Promise.resolve();
      const nextWrite = previousWrite.catch(() => {}).then(() => patchItem(item.id, { color }, true));
      colorWrites.set(item.id, nextWrite);
      nextWrite.then(() => rememberItemChange(item.id, { color: previousColor }, { color }, i18n.t('color de nota'))).catch(error => toast(error.message)).finally(() => {
        if (colorWrites.get(item.id) === nextWrite) colorWrites.delete(item.id);
      });
    } else if (pointerOnPage && !magicSelection.size && !selectedWriting && !gesture && !vaultDrag && !vaultBusy && !canvasActions && !document.querySelector('dialog[open]')) {
      const target = document.elementFromPoint(pointerPosition.x, pointerPosition.y);
      if (target && viewport.contains(target) && !target.closest('button,a,input,textarea,select,[contenteditable="true"]')) {
        event.preventDefault();
        applyTheme(themes[(themes.indexOf(activeTheme) + 1) % themes.length]);
        renderGridBackground();
      }
    }
  }
  if (event.key.toLowerCase() === 's') { event.preventDefault(); if (!gesture && mode !== 'write') setMode('write'); return; }
  if (event.key.toLowerCase() === 't') { event.preventDefault(); if (!event.repeat && !gesture) addText(pointerPosition.x, pointerPosition.y); return; }
  if (event.key.toLowerCase() === 'd') { event.preventDefault(); if (!gesture && mode !== 'erase') setMode('erase'); return; }
  if (event.key.toLowerCase() === 'w') { event.preventDefault(); if (!gesture) setMode('laser'); return; }
  if (event.key.toLowerCase() === 'e') { event.preventDefault(); if (!gesture) setMode('draw', false); return; }
  if (event.key.toLowerCase() === 'h') { event.preventDefault(); if (!event.repeat && !gesture) fitAll(); }
  if (event.key.toLowerCase() === 'z') { event.preventDefault(); zHeld = true; updateZoomCursor(); }
});
window.addEventListener('keyup', event => {
  if (event.code === 'Space') releaseSpacePan();
  if (event.key==='Alt') { releaseDrawLaser(); inverseZoomHeld=false; inversePinnedTargets=null; updateZoomCursor(); }
  if (event.key.toLowerCase() === 'z') { zHeld = false; inverseZoomHeld=false; updateZoomCursor(); }
});
window.addEventListener('blur', () => { zHeld = false; inverseZoomHeld=false; inversePinnedTargets=null; releaseDrawLaser(); releaseSpacePan(); updateZoomCursor(); pointerOnPage = false; scheduleVideoHover(); });
window.addEventListener('dragenter', event => { if (!exportDragging && [...event.dataTransfer?.types || []].some(type=>['Files','text/uri-list','text/html'].includes(type))) { dragDepth++; dropHint.hidden = false; } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropHint.hidden = true; });
window.addEventListener('dragover', event => { event.preventDefault(); });
function pinterestDropTarget(transfer) {
  const candidates=[],html=transfer.getData('text/html');let expectVideo=false;
  if(html){
    const document=new DOMParser().parseFromString(html,'text/html');
    expectVideo=Boolean(document.querySelector('video,source[type^="video/"]'));
    for(const media of document.querySelectorAll('video,video source,source[type^="video/"]'))candidates.push(media.getAttribute('src'));
    for(const anchor of document.querySelectorAll('a[href]'))candidates.push(anchor.getAttribute('href'));
    for(const image of document.querySelectorAll('img'))candidates.push(image.getAttribute('src'),image.getAttribute('data-src'));
  }
  candidates.push(...transfer.getData('text/uri-list').split(/\r?\n/).filter(line=>!line.startsWith('#')),transfer.getData('text/plain'));
  const found={video:null,stream:null,pin:null,image:null};
  for(const value of candidates){
    try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port)continue;
      const cdn=url.hostname==='pinimg.com'||url.hostname.endsWith('.pinimg.com');
      const pin=url.hostname==='pin.it'||/^([a-z0-9-]+\.)?pinterest\.(com|es|co\.uk|fr|de|it|pt|ca|com\.au|jp|ch|at|nl|se|dk|no|fi|ie|co\.kr|com\.mx|com\.br)$/.test(url.hostname)&&/^\/pin\/(?:[^/]+--)?\d+\/?$/i.test(url.pathname);
      if(cdn&&/\.(mp4|webm)$/i.test(url.pathname))found.video||=url.href;
      else if(cdn&&/\.(m3u8|mpd)$/i.test(url.pathname))found.stream||=url.href;
      else if(pin)found.pin||=url.href;
      else if(cdn)found.image||=url.href;
    }catch{}
  }
  return {url:found.video||found.pin||found.stream||found.image,expectVideo:expectVideo||Boolean(found.video||found.stream),pin:Boolean(found.pin),video:Boolean(found.video||found.stream)};
}
window.addEventListener('drop', async event => {
  event.preventDefault(); dragDepth=0; dropHint.hidden=true;
  if(exportDragging) return;
  const {clientX:x,clientY:y,dataTransfer:transfer}=event,target=pinterestDropTarget(transfer);
  if(transfer.files.length&&(!target.pin&&!target.video||[...transfer.files].some(file=>file.type.startsWith('video/'))))return addFiles(transfer.files,x,y);
  if(!target.url)return toast(i18n.t('Arrastra una imagen, vídeo o enlace de un pin de Pinterest'));
  const point=screenToWorld(x,y);toast(i18n.t('Descargando contenido de Pinterest…'));
  try {
    let response=await fetch('/api/pinterest-media',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:target.url,expectVideo:target.expectVideo})});
    if(!response.ok){const error=await response.json();throw Error(i18n.t(error.error || 'No se pudo descargar el contenido de Pinterest'));}
    if((response.headers.get('content-type')||'').includes('application/json')){
      const result=await response.json();response=await fetch('/api/pinterest-image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:result.url})});
      if(!response.ok){const error=await response.json();throw Error(i18n.t(error.error || 'No se pudo descargar la imagen'));}
    }
    const blob=await response.blob(),extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/avif':'avif','video/mp4':'mp4','video/webm':'webm'};
    if(!extensions[blob.type])throw Error(i18n.t('Formato de Pinterest no compatible'));
    const name=`Pinterest-${crypto.randomUUID()}.${extensions[blob.type]}`;
    // Imported data has no local file path even when media linking is enabled.
    await addFiles([new File([blob],name,{type:blob.type})],camera.x+point.x*camera.scale,camera.y+point.y*camera.scale,{copyMedia:true});
  }catch(error){toast(error.message);}
});

function resizeDrawingLayer() {
  const dpr = devicePixelRatio || 1;
  drawingLayer.width = Math.max(1, Math.round(innerWidth * dpr));
  drawingLayer.height = Math.max(1, Math.round(innerHeight * dpr));
  writingDetail.width = drawingLayer.width;
  writingDetail.height = drawingLayer.height;
}
window.addEventListener('resize', () => { preview.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`); resizeDrawingLayer(); renderCamera(); });
preview.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
resizeDrawingLayer();
renderCamera();
const initialScribeReady=loadScribeFont(activeScribeFont.id,false).then(ok=>ok||loadScribeFont('patrick-hand',false));
const initialBoardReady=Promise.all([document.fonts.load('17px "Paper Mono"'),initialScribeReady]).then(() => loadBoard());
window.addEventListener('pagehide', () => {
  persistLastCanvasView();
  if ([...vaults.values()].some(v => v.open)) navigator.sendBeacon('/api/vaults/lock-all');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) persistLastCanvasView();
});
setInterval(async () => {
  if (vaultBusy || ![...vaults.values()].some(v => v.open)) return;
  try {
    const states = await apiChange('/api/vaults/heartbeat', 'POST');
    for (const state of states) {
      const vault = vaults.get(state.id);
      if (vault?.open && !state.open) { Object.assign(vault, state, { open: false }); purgeVaultMemory(vault); refreshVaultVisibility(); toast(i18n.t('La sesión de la Vault se ha cerrado')); }
    }
  } catch { /* Server locks abandoned sessions when heartbeats stop. */ }
}, 30000);
setInterval(() => { if ([...items.values()].some(item => item.status === 'processing')) refreshItems(); }, 1500);

// Approximate browser frame cadence; update the badge twice per second so it
// adds minimal layout work and does not touch the canvas render loop.
const fpsBadge = document.createElement('div');
fpsBadge.className = 'fps-trial-counter';
fpsBadge.setAttribute('aria-label', i18n.t('Contador aproximado de FPS del navegador'));
fpsBadge.textContent = 'FPS —';
document.body.append(fpsBadge);
let fpsFrame = 0, fpsLast = 0, fpsElapsed = 0, fpsSamples = 0, fpsPeak = 0;
function updateFpsCounter(now) {
  fpsFrame = 0;
  if (document.hidden) return;
  if (fpsLast) {
    const interval = now - fpsLast;
    fpsElapsed += interval;
    fpsSamples++;
    fpsPeak = Math.max(fpsPeak, interval);
    if (fpsElapsed >= 500) {
      const average = fpsElapsed / fpsSamples;
      fpsBadge.textContent = i18n.t(`${Math.round(1000 / average)} FPS · ${average.toFixed(1)} ms · ${i18n.t('pico')} ${Math.round(fpsPeak)} ms`);
      fpsElapsed = 0; fpsSamples = 0; fpsPeak = 0;
    }
  }
  fpsLast = now;
  fpsFrame = requestAnimationFrame(updateFpsCounter);
}
function resetFpsCounter() {
  if (fpsFrame) cancelAnimationFrame(fpsFrame);
  fpsFrame = 0; fpsLast = 0; fpsElapsed = 0; fpsSamples = 0; fpsPeak = 0;
  fpsBadge.textContent = 'FPS —';
  if (!document.hidden) fpsFrame = requestAnimationFrame(updateFpsCounter);
}
document.addEventListener('visibilitychange', resetFpsCounter);
resetFpsCounter();

window.apoxiaPrepareQuit=async () => {
  if(!window.apoxiaDesktop) return;
  document.body.style.pointerEvents='none';
  if(noteReader.open){saveReaderPosition();await flushReaderEdit();}
  if(gesture) await endGesture({type:'pointercancel',pointerId:gesture.pointer});
  await finishWritingEdit(true);
  for(const [id,timer] of textTimers) {
    clearTimeout(timer);const item=items.get(id);
    if(item?.type==='text' && vaultContentVisible('items',id)) await patchItem(id,{text:cards.get(id)?.querySelector('textarea')?.value ?? item.text});
  }
  textTimers.clear();
  const deadline=performance.now()+45000;
  while(vaultBusy || magicSaving || inverseZoomSaving || canvasActions) {if(performance.now()>deadline) throw new Error(i18n.t('Espera a que termine la operación actual antes de cerrar.'));await new Promise(resolve=>setTimeout(resolve,100));}
  if(screenFrozen.size) await toggleScreenFrozen();
  persistLastCanvasView();
  const values=Object.fromEntries(Object.keys(localStorage).filter(key=>/^(apoxia|referencias\.)/.test(key)).map(key=>[key,localStorage.getItem(key)]));
  await window.apoxiaDesktop.savePreferences(values);
};

window.addEventListener('apoxia-language-change',()=> {
  updateCount();
  i18n.apply();
  renderVaults();
  document.querySelector('#zoomValue').textContent=(camera.scale*100).toLocaleString(i18n.locale,{maximumFractionDigits:2})+'%';
});

const transferOverlay=document.querySelector('#transferOverlay');
const transferStatus=document.querySelector('#transferStatus');
const transferDetail=document.querySelector('#transferDetail');
const transferLabels={copy:'Copiando…',export:'Exportando…',import:'Importando…',prepare:'Preparando…'};
function updateTransferProgress(value) {
  transferStatus.textContent=i18n.t(transferLabels[value.phase] || transferLabels.prepare);
  transferDetail.textContent=value.total>0?`${Math.min(100,Math.round(value.completed/value.total*100))}% · ${(value.completed/1048576).toFixed(1)} / ${(value.total/1048576).toFixed(1)} MB`:'';
}
window.apoxiaDesktop?.onTransferProgress(updateTransferProgress);
async function runCanvasTransfer(action) {
  if(canvasTransferBusy)return;
  if(gesture || vaultBusy || magicSaving || inverseZoomSaving || canvasActions || historyBusy)return toast(i18n.t('Termina la acción actual antes de crear un backup'));
  canvasTransferBusy=true;transferOverlay.hidden=false;updateTransferProgress({phase:'prepare'});
  try {
    await window.apoxiaPrepareQuit();
    const result=await window.apoxiaDesktop.transfer(action);
    if(!result?.cancelled)toast(i18n.t(action==='copy-media'?'Media copiada a DATA':action==='copy'?'Archivos vinculados copiados a DATA':action==='export'?'Backup ZIP guardado':'Canvas importado'));
  } catch(error){toast(i18n.t(error.message.replace(/^Error invoking remote method '[^']+': Error: /,'')));}
  finally {canvasTransferBusy=false;transferOverlay.hidden=true;document.body.style.pointerEvents='';}
}
for(const [id,action] of [['copyMediaButton','copy-media'],['copyLinkedButton','copy'],['exportCanvasButton','export'],['importCanvasButton','import']]) {
  const button=document.querySelector('#'+id);button.disabled=!window.apoxiaDesktop?.transfer;
  if(button.disabled)button.title=i18n.t('Disponible en la app de escritorio');
  button.addEventListener('click',()=>{document.querySelector('#canvasSettings').hidePopover();runCanvasTransfer(action);});
}

// LAN synchronization checks a small revision marker; geometry is fetched only
// after a saved change, and never replaces an object during an active edit.
let sharedSyncBusy=false,sharedRevision=null,sharedLastInteraction=0;
for(const event of ['pointerdown','keydown'])window.addEventListener(event,()=>{sharedLastInteraction=performance.now();},{capture:true,passive:true});
function sharedEditInProgress() {
  return performance.now()-sharedLastInteraction<1500 || gesture || vaultDrag || vaultBusy || magicSaving || inverseZoomSaving || canvasActions || historyBusy || canvasTransferBusy || editingWriting || pendingDraws.size || textTimers.size || colorWrites.size || screenFrozen.size || document.activeElement?.matches('.text-editor,.vault-password,.vault-confirm');
}
function applySharedSnapshot(snapshot) {
  let changed=false,vaultChanged=false;
  const vaultIds=new Set(snapshot.vaults.map(v=>v.id));
  for(const [id,vault] of vaults) if(!vaultIds.has(id)) {
    purgeVaultMemory(vault);const nodes=vaultNodes.get(id);nodes?.frame.remove();nodes?.back.remove();vaultNodes.delete(id);vaults.delete(id);changed=true;vaultChanged=true;
  }
  for(const state of snapshot.vaults) {
    const old=vaults.get(state.id);
    if(!old) {vaults.set(state.id,state);createVaultNode(state);changed=true;vaultChanged=true;}
    else if(JSON.stringify(old)!==JSON.stringify({...old,...state})) {if(old.open && !state.open)purgeVaultMemory(old);Object.assign(old,state);changed=true;vaultChanged=true;}
  }
  rebuildVaultOwners();
  const changedItemIds=new Set(snapshot.items.filter(item=>JSON.stringify(items.get(item.id))!==JSON.stringify(item)).map(item=>item.id));
  const itemChanged=snapshot.items.length!==items.size || changedItemIds.size;
  if(itemChanged){mergeItems(snapshot.items);changed=true;}
  const strokeIds=new Set(snapshot.strokes.map(stroke=>stroke.id));
  for(const id of strokes.keys()) if(!strokeIds.has(id)){strokes.delete(id);strokeBounds.delete(id);strokeChunks.delete(id);strokeSpaces.delete(id);changed=true;}
  for(const stroke of snapshot.strokes) if(JSON.stringify(strokes.get(stroke.id))!==JSON.stringify(stroke)) {
    strokes.delete(stroke.id);strokeBounds.delete(stroke.id);strokeChunks.delete(stroke.id);addStroke(stroke,true);changed=true;
  }
  const writingIds=new Set(snapshot.writings.map(writing=>writing.id));
  for(const id of writings.keys()) if(!writingIds.has(id)){writings.delete(id);writingNodes.get(id)?.remove();writingNodes.delete(id);changed=true;}
  for(const writing of snapshot.writings) if(JSON.stringify(writings.get(writing.id))!==JSON.stringify(writing)){writings.set(writing.id,writing);changed=true;}
  if(changed) {
    if(snapshot.foreign){clearMagicSelection();forgetHistory();}rebuildVaultOwners();
    for(const item of items.values())if(changedItemIds.has(item.id) || vaultChanged && vaultOwner('items',item.id))updateCard(item);
    paintedCamera=null;refreshVaultVisibility();renderCamera();updateCount();
  }
}
async function refreshSharedCanvas() {
  if(sharedSyncBusy || document.hidden || sharedEditInProgress())return;
  sharedSyncBusy=true;
  try {
    await initialBoardReady;
    const revisionResponse=await fetch('/api/shared-revision',{cache:'no-store'});
    if(!revisionResponse.ok)return;
    const marker=await revisionResponse.json();if(!marker.enabled)return;
    const key=`${marker.instance}:${marker.revision}`;if(key===sharedRevision)return;
    const since=sharedRevision?Number(sharedRevision.split(':').at(-1)):-1;
    const response=await fetch(`/api/shared-snapshot?since=${since}`,{cache:'no-store'});if(!response.ok)return;
    const snapshot=await response.json();
    if(sharedEditInProgress())return;
    applySharedSnapshot(snapshot);sharedRevision=`${snapshot.instance}:${snapshot.revision}`;
  } catch { /* Keep the local view; reconnect on the next poll. */ }
  finally {sharedSyncBusy=false;}
}
setInterval(refreshSharedCanvas,2000);

window.__sketchGPU={items,cards,camera,photoGPU,ownedPhotoGPU,noteGPU,ownedNoteGPU,render:renderCamera,fit:()=>document.querySelector('#fitView').click(),history:travelHistory,stats:()=>({public:photoGPU.stats,owned:ownedPhotoGPU.stats,domMedia:document.querySelectorAll('.gpu-media').length,total:items.size}),importFiles:addFiles,strokes,writings,vaults};

const copyMediaToggle=document.querySelector('#copyMediaOnImport');
copyMediaToggle.checked=localStorage.getItem('apoxia.copyMediaOnImport')!=='false';
copyMediaToggle.disabled=!window.apoxiaDesktop?.importLinkedMedia;
copyMediaToggle.addEventListener('change',()=>localStorage.setItem('apoxia.copyMediaOnImport',String(copyMediaToggle.checked)));
