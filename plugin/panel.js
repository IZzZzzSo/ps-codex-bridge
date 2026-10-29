const { app, imaging, core, action, constants } = require('photoshop');
const { entrypoints, storage, shell } = require('uxp');
const { boundsFor, padPixels, validateTarget } = require('./geometry.js');
const BASE = 'http://localhost:17321';
const sessionId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2);
const bindings = new Map();
const allBindings = new Set();
let token = '', capture = null, busy = false, polling = false, timer = null, connected = false, visible = true, notificationsReady = false;
const $ = id => document.getElementById(id);
const status = (message, error = false) => { $('status').textContent = message; $('status').className = error ? 'error' : ''; };
function base64(bytes) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const chunks = []; let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = bytes[i] * 65536 + (bytes[i + 1] || 0) * 256 + (bytes[i + 2] || 0);
    out += abc[(n >>> 18) & 63] + abc[(n >>> 12) & 63] + (i + 1 < bytes.length ? abc[(n >>> 6) & 63] : '=') + (i + 2 < bytes.length ? abc[n & 63] : '=');
    if (out.length >= 16384) { chunks.push(out); out = ''; }
  }
  chunks.push(out); return chunks.join('');
}
async function api(route, method = 'GET', body) {
  if (!token) throw new Error('请先粘贴配对码并连接。');
  const options = { method, headers: { Authorization: 'Bearer ' + token } };
  if (body !== undefined) {
    if (body instanceof ArrayBuffer) { options.body = body; options.headers['Content-Type'] = 'application/octet-stream'; }
    else { options.body = JSON.stringify(body); options.headers['Content-Type'] = 'application/json'; }
  }
  let response;
  try { response = await fetch(BASE + route, options); }
  catch (e) { throw new Error('无法连接本地桥接程序：' + (e.message || String(e))); }
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || '桥接请求失败。');
  return value;
}
function setBusy(value) {
  busy = value;
  for (const id of ['captureSelection', 'captureCanvas', 'connect']) $(id).disabled = value;
  $('captureSelection').disabled = value || !notificationsReady;
  $('captureCanvas').disabled = value || !notificationsReady;
  $('send').disabled = value || !capture || !connected;
  for (const button of document.querySelectorAll('#jobs button')) button.disabled = value;
}
async function task(fn) {
  if (busy) return;
  setBusy(true);
  try { await fn(); } catch (e) { status(e.message || String(e), true); }
  finally { setBusy(false); }
}
function documentInfo(doc) {
  let docPath = ''; try { docPath = doc.path || ''; } catch (_) { /* unsaved documents have no path */ }
  return { id: doc.id, name: doc.name, width: Number(doc.width), height: Number(doc.height), path: docPath, colorProfile: doc.colorProfileName || '' };
}
function currentDocument(id) { return Array.from(app.documents).find(doc => doc.id === id); }
async function readPadded(method, options, bounds, components) {
  const result = await imaging[method](options);
  try {
    if (result.level && result.level !== 0) throw new Error('PS 返回了缩略图而非原始像素，请重试。');
    const data = await result.imageData.getData({ chunky: true });
    return padPixels(result.imageData, result.sourceBounds, bounds, data, result.imageData.components, components);
  } finally { result.imageData.dispose(); }
}
async function takeCapture(mode) {
  let next;
  await core.executeAsModal(async () => {
    const doc = app.activeDocument;
    if (!doc) throw new Error('请先在 Photoshop 打开文档。');
    if (doc.mode !== constants.DocumentMode.RGB) throw new Error('第一版支持 RGB 文档。请先复制文档并转换为 RGB。');
    if (doc.bitsPerChannel === constants.BitsPerChannelType.THIRTYTWO) throw new Error('第一版支持 8/16 位 RGB 文档，请先复制并转换位深。');
    if (doc.artboards && doc.artboards.length) throw new Error('第一版暂不支持画板文档，请先在普通画布中使用。');
    if (doc.quickMaskMode) throw new Error('请先退出快速蒙版模式。');
    const info = documentInfo(doc), bounds = boundsFor(mode, info, mode === 'selection' ? doc.selection.bounds : null);
    const binding = { documentId: doc.id, valid: true };
    allBindings.add(binding);
    try {
      const pixels = await readPadded('getPixels', { documentID: doc.id, sourceBounds: bounds, colorSpace: 'RGB', colorProfile: 'sRGB IEC61966-2.1', componentSize: 8, applyAlpha: false }, bounds, 4);
      const mask = mode === 'selection' ? await readPadded('getSelection', { documentID: doc.id, sourceBounds: bounds }, bounds, 1) : null;
      next = { mode, document: info, bounds, pixels, mask, binding };
    } catch (e) { allBindings.delete(binding); throw e; }
  }, { commandName: '截取画面发送到 Codex' });
  if (capture && !Array.from(bindings.values()).includes(capture.binding)) allBindings.delete(capture.binding);
  capture = next;
  const b = next.bounds;
  $('captureInfo').textContent = next.document.name + '\n' + (mode === 'selection' ? '局部选区' : '整个画布') + ' · ' + (b.right - b.left) + ' × ' + (b.bottom - b.top) + ' px\n位置：' + b.left + ', ' + b.top;
  $('captureInfo').className = 'info captured';
  status('画面已截取，输入需求后发送。');
}
async function openDesktop(id) {
  const { desktopLink, prompt, existing } = await api('/v1/jobs/' + id + '/desktop');
  if (existing) {
    try { await navigator.clipboard.setContent({ 'text/plain': prompt }); }
    catch (e) { throw new Error('任务已保存，但复制需求失败：' + (e.message || String(e)) + '。可点击“重新打开 Codex”重试。'); }
  }
  const error = await shell.openExternal(desktopLink);
  if (error) throw new Error('打开 Codex 失败：' + error + '。任务已保存，可点击“重新打开 Codex”。');
  return existing;
}
async function sendCapture() {
  if (!capture) throw new Error('请先截取画面。');
  const prompt = String($('prompt').value || '').trim(); if (!prompt) throw new Error('请输入修改需求。');
  validateTarget({ sessionId, document: capture.document }, currentDocument(capture.document.id), sessionId, capture.binding.valid);
  status('正在保存截图和位置记录…');
  const input = { mode: capture.mode, sessionId, document: capture.document, bounds: capture.bounds, prompt, pixels: base64(capture.pixels) };
  input.destination = { mode: $('destinationMode').value, projectPath: $('projectPath').value, thread: $('threadLink').value };
  if (capture.mask) input.selectionMask = base64(capture.mask);
  const { job } = await api('/v1/jobs', 'POST', input);
  try { await storage.secureStorage.setItem('destination-settings', JSON.stringify(input.destination)); } catch (_) { /* job remains usable if preference storage fails */ }
  bindings.set(job.id, capture.binding);
  capture = null; $('captureInfo').textContent = '已发送。继续修改时，请重新截取画面。'; $('captureInfo').className = 'info';
  await refresh();
  const existing = await openDesktop(job.id);
  status(existing ? '已打开指定对话，任务需求已复制。请在该对话按 ⌘V 粘贴并发送。' : '已打开新对话并预填需求。请点击发送，完成后回传 PS。');
}
function findLayer(layers, name) {
  for (const layer of layers) {
    if (layer.name === name) return layer;
    if (layer.layers && layer.layers.length) { const found = findLayer(layer.layers, name); if (found) return found; }
  }
  return null;
}
async function applyJob(original) {
  const binding = bindings.get(original.id);
  try { validateTarget(original, currentDocument(original.document.id), sessionId, binding && binding.valid); }
  catch (e) {
    await api('/v1/jobs/' + original.id + '/fail', 'POST', { revision: original.revision, sessionId, lease: original.lease, error: e.message });
    throw e;
  }
  let job = original;
  if (job.state === 'queued') ({ job } = await api('/v1/jobs/' + job.id + '/claim', 'POST', { sessionId, revision: job.revision }));
  if (job.state !== 'applying') throw new Error('回传状态已改变，请刷新。');
  let committed = false, layerId;
  try {
    const response = await fetch(BASE + '/v1/jobs/' + job.id + '/pixels', { headers: { Authorization: 'Bearer ' + token } });
    if (!response.ok) throw new Error('读取结果像素失败，请检查桥接程序。');
    const pixels = new Uint8Array(await response.arrayBuffer());
    if (pixels.length !== job.width * job.height * 4) throw new Error('结果像素长度无效。');
    await core.executeAsModal(async context => {
      const doc = currentDocument(job.document.id);
      validateTarget(job, doc, sessionId, binding.valid);
      if (doc.mode !== constants.DocumentMode.RGB || doc.quickMaskMode) throw new Error('请保持原文档为 RGB 并退出快速蒙版。');
      const marker = 'Codex · ' + job.id + ' · v' + job.revision;
      const existing = findLayer(doc.layers, marker);
      if (existing) { layerId = existing.id; committed = true; return; }
      const suspension = await context.hostControl.suspendHistory({ documentID: doc.id, name: 'Codex 结果回传原位' });
      let imageData;
      try {
        await action.batchPlay([{ _obj: 'select', _target: [{ _ref: 'document', _id: doc.id }] }], {});
        const layer = await doc.createLayer({ name: marker });
        // Move out of any selected group, to the document's top level.
        const top = doc.layers[0];
        if (top && top.id !== layer.id) await layer.move(top, constants.ElementPlacement.PLACEBEFORE);
        imageData = await imaging.createImageDataFromBuffer(pixels, { width: job.width, height: job.height, components: 4, chunky: true, colorSpace: 'RGB', colorProfile: 'sRGB IEC61966-2.1' });
        await imaging.putPixels({ documentID: doc.id, layerID: layer.id, imageData, replace: true, targetBounds: { left: job.bounds.left, top: job.bounds.top }, commandName: 'Codex 结果回传原位' });
        if (context.isCancelled) throw new Error('已取消回传。');
        await context.hostControl.resumeHistory(suspension, true);
        layerId = layer.id; committed = true;
      } catch (e) { await context.hostControl.resumeHistory(suspension, false); throw e; }
      finally { if (imageData) imageData.dispose(); }
    }, { commandName: 'Codex 结果回传原位', timeOut: 1000 });
    await api('/v1/jobs/' + job.id + '/complete', 'POST', { revision: job.revision, lease: job.lease, layerId });
    status('回传完成：已在“' + job.document.name + '”中新建图层，并定位到原截取位置。');
  } catch (e) {
    // If pixels committed but the acknowledgement failed, leave state=applying.
    // Next poll finds the layer marker and only retries the acknowledgement.
    if (!committed) {
      try { await api('/v1/jobs/' + job.id + '/fail', 'POST', { revision: job.revision, lease: job.lease, error: e.message }); } catch (_) { /* recovered by next poll */ }
    }
    throw e;
  }
}
function addButton(parent, text, fn) {
  const button = document.createElement('button'); button.textContent = text; button.disabled = busy;
  button.addEventListener('click', () => task(fn)); parent.appendChild(button);
  return button;
}
function render(jobs) {
  const container = $('jobs'); container.innerHTML = '';
  const own = jobs.filter(job => job.sessionId === sessionId);
  $('jobCount').textContent = String(own.length);
  if (!own.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = '完成修改后，在这里选择结果并回传。'; container.appendChild(p); }
  const labels = { captured: '等待 Codex 修改', ready: '结果已就绪', queued: '等待写入 PS', applying: '正在回传', applied: '已回传' };
  for (const job of own) {
    const box = document.createElement('div'); box.className = 'job';
    const title = document.createElement('div'); title.className = 'job-title'; title.textContent = job.document.name; box.appendChild(title);
    const info = document.createElement('p'); info.className = 'hint'; info.textContent = job.id.slice(0, 8) + ' · ' + job.width + ' × ' + job.height + ' · ' + labels[job.state]; box.appendChild(info);
    const prompt = document.createElement('p'); prompt.textContent = job.prompt.slice(0, 100); box.appendChild(prompt);
    if (job.error) { const error = document.createElement('p'); error.className = 'hint'; error.textContent = job.error; box.appendChild(error); }
    addButton(box, '重新打开 Codex', () => openDesktop(job.id));
    if (!['queued', 'applying'].includes(job.state)) addButton(box, '选择结果文件', async () => {
      const file = await storage.localFileSystem.getFileForOpening({ types: ['png', 'jpg', 'jpeg'] });
      if (!file) return;
      const bytes = await file.read({ format: storage.formats.binary });
      if (bytes.byteLength > 32 * 1024 * 1024) throw new Error('结果文件不能超过 32 MB。');
      await api('/v1/jobs/' + job.id + '/result', 'POST', bytes);
      status('结果已登记，点击“回传 PS”放回原位。'); await refresh();
    });
    if (job.state === 'ready') addButton(box, '回传 PS', async () => {
      const binding = bindings.get(job.id);
      validateTarget(job, currentDocument(job.document.id), sessionId, binding && binding.valid);
      await api('/v1/jobs/' + job.id + '/queue', 'POST', { revision: job.revision });
      const { job: queued } = await api('/v1/jobs/' + job.id); await applyJob(queued); await refresh();
    }).className = 'return-action';
    container.appendChild(box);
  }
}
async function refresh() {
  const { jobs } = await api('/v1/jobs');
  connected = true; $('connectionState').textContent = '已连接'; render(jobs); return jobs;
}
async function poll() {
  if (!visible || !connected || busy || polling) return;
  polling = true;
  try {
    for (const binding of allBindings) if (!currentDocument(binding.documentId)) binding.valid = false;
    const jobs = await refresh();
    const queued = jobs.find(job => job.sessionId === sessionId && ['queued', 'applying'].includes(job.state) && bindings.has(job.id));
    if (queued) await task(() => applyJob(queued));
  } catch (e) { connected = false; $('connectionState').textContent = '连接中断'; status(e.message, true); }
  finally { polling = false; }
}
async function connect() {
  $('connectionState').textContent = '正在连接…';
  status('正在连接本机图像桥…');
  const candidate = String($('pairToken').value || '').trim(); if (candidate) token = candidate;
  try { await refresh(); }
  catch (e) { connected = false; $('connectionState').textContent = '连接失败：' + e.message; throw e; }
  await storage.secureStorage.setItem('pair-token', token);
  $('pairToken').value = ''; $('pairToken').placeholder = '已保存配对码，重新连接可直接点击';
  $('connection').style.display = 'none';
  status('已连接。可以截取局部选区或整个画布。');
}
// A conservative guard: closing any document or changing canvas geometry
// invalidates pending bindings. This avoids document-ID reuse and stale coordinates.
const geometryEvents = ['close', 'crop', 'imageSize', 'canvasSize', 'rotate', 'flip', 'revert'];
async function initialize() {
  const toggle = id => { $(id).style.display = $(id).style.display === 'none' ? 'block' : 'none'; };
  $('toggleConnection').addEventListener('click', () => toggle('connection'));
  $('toggleDestination').addEventListener('click', () => toggle('destinationSettings'));
  $('doneDestination').addEventListener('click', () => { $('destinationSettings').style.display = 'none'; });
  const updateDestination = () => {
    const existing = $('destinationMode').value === 'existing';
    $('projectPath').style.display = existing ? 'none' : 'block';
    $('threadLink').style.display = existing ? 'block' : 'none';
    $('targetNew').textContent = existing ? '新对话' : '✓ 新对话';
    $('targetExisting').textContent = existing ? '✓ 已有对话' : '已有对话';
    $('targetNew').className = existing ? 'grow' : 'grow selected';
    $('targetExisting').className = existing ? 'grow selected' : 'grow';
    const thread = String($('threadLink').value || '').trim().replace(/^codex:\/\/threads\//, '');
    const project = String($('projectPath').value || '').trim().split('/').filter(Boolean).pop();
    $('destinationSummary').textContent = existing ? (thread ? '已有对话 · ' + thread.slice(0, 8) : '已有对话 · 待设置') : (project ? '新对话 · ' + project : '新对话');
    $('sendHint').textContent = existing ? '打开目标对话后，按 ⌘V 粘贴并发送' : '打开新对话后，确认需求并发送';
    $('destinationHint').textContent = existing ? '在目标 Codex 对话按 ⌘⌥L 复制本地对话链接。此模式会覆盖剪贴板为任务需求，打开对话后请 ⌘V 粘贴发送。' : '填写项目工作目录；不保证自动加入侧边栏项目。读取任务文件时可能需要目录访问确认。';
  };
  $('destinationMode').value = 'new';
  $('threadLink').addEventListener('input', updateDestination);
  $('projectPath').addEventListener('input', updateDestination);
  $('targetNew').addEventListener('click', () => { $('destinationMode').value = 'new'; updateDestination(); });
  $('targetExisting').addEventListener('click', () => { $('destinationMode').value = 'existing'; updateDestination(); });
  try {
    const bytes = await storage.secureStorage.getItem('destination-settings');
    const saved = JSON.parse(new TextDecoder().decode(bytes));
    $('destinationMode').value = saved.mode === 'existing' ? 'existing' : 'new';
    $('projectPath').value = saved.projectPath || ''; $('threadLink').value = saved.thread || '';
  } catch (_) { /* default destination */ }
  updateDestination();
  $('connect').addEventListener('click', () => task(connect));
  $('captureSelection').addEventListener('click', () => task(() => takeCapture('selection')));
  $('captureCanvas').addEventListener('click', () => task(() => takeCapture('canvas')));
  $('send').addEventListener('click', () => task(sendCapture));
  $('refresh').addEventListener('click', () => task(refresh));
  try {
    await action.addNotificationListener(geometryEvents, () => {
      for (const binding of allBindings) binding.valid = false;
      if (capture) status('文档关闭或画布几何发生变化，请重新截取。', true);
    });
    notificationsReady = true;
  } catch (e) {
    status('无法启用文档变化保护，暂不允许截取：' + e.message, true);
    $('captureSelection').disabled = true; $('captureCanvas').disabled = true; return;
  }
  try {
    const stored = await storage.secureStorage.getItem('pair-token');
    token = String.fromCharCode.apply(null, stored); await connect();
  } catch (_) { /* first run or bridge offline; user can connect explicitly */ }
  timer = setInterval(poll, 2000);
}
entrypoints.setup({ panels: { bridgePanel: {
  show() { visible = true; }, hide() { visible = false; },
  destroy() { if (timer) clearInterval(timer); }
} } });
initialize().catch(e => status(e.message, true));
