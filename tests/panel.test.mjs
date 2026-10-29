import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import geometry from '../plugin/geometry.js';

const source = await readFile(new URL('../plugin/panel.js', import.meta.url), 'utf8');
async function panelHarness() {
  const elements = new Map(), calls = [], doc = { id: 12, name: '原图.psd', width: 100, height: 80, path: '', colorProfileName: 'sRGB IEC61966-2.1', mode: 'RGB', bitsPerChannel: 'eight', artboards: [], layers: [], selection: { bounds: { left: 10, top: 20, right: 12, bottom: 22 } } };
  let layerId = 30, failWrite = false, failAck = false, closed = false;
  const app = { get documents() { return closed ? [] : [doc]; }, get activeDocument() { return closed ? null : doc; } };
  const elementsFor = id => {
    if (!elements.has(id)) elements.set(id, { style: {}, value: '', textContent: '', className: '', disabled: false, placeholder: '', innerHTML: '', addEventListener() {}, appendChild() {} });
    return elements.get(id);
  };
  const context = vm.createContext({
    console, Uint8Array, ArrayBuffer, setInterval: () => 1, clearInterval() {},
    navigator: { clipboard: { async setContent(content) { calls.push(['clipboard', content]); } } },
    document: { getElementById: elementsFor, querySelectorAll: () => [], createElement: () => ({ addEventListener() {}, appendChild() {} }) },
    fetch: async (url, options) => {
      const route = url.replace('http://127.0.0.1:17321', ''); calls.push(['http', route]);
      if (route.endsWith('/pixels')) return { ok: true, arrayBuffer: async () => new Uint8Array(16).fill(255).buffer };
      if (route.endsWith('/desktop')) return { ok: true, json: async () => ({ desktopLink: 'codex://threads/12345678-1234-1234-1234-123456789012', prompt: '读取任务并修改图片', existing: true }) };
      if (route.endsWith('/complete') && failAck) throw new Error('network lost');
      return { ok: true, json: async () => ({ jobs: [] }) };
    },
    require: name => {
      if (name === './geometry.js') return geometry;
      if (name === 'uxp') return { entrypoints: { setup() {} }, storage: { secureStorage: { async getItem() { throw new Error('first run'); }, async setItem() {} } }, shell: { async openExternal(link) { calls.push(['open', link]); return ''; } } };
      if (name === 'photoshop') return {
        app, constants: { DocumentMode: { RGB: 'RGB' }, BitsPerChannelType: { THIRTYTWO: '32' }, ElementPlacement: { PLACEBEFORE: 'before' } },
        action: { async addNotificationListener(events, callback) { context.notify = callback; }, async batchPlay() { calls.push(['select-document']); } },
        core: { async executeAsModal(fn) { return fn({ hostControl: {
          async suspendHistory() { calls.push(['suspend']); return 'history'; },
          async resumeHistory(_, commit) { calls.push(['resume', commit]); if (!commit) doc.layers = []; }
        } }); } },
        imaging: {
          async getPixels() { return { sourceBounds: { left: 11, top: 21 }, imageData: { width: 1, height: 1, components: 3, async getData() { return new Uint8Array([12, 34, 56]); }, dispose() { calls.push(['dispose-capture']); } } }; },
          async getSelection() { return { sourceBounds: { left: 10, top: 20 }, imageData: { width: 2, height: 2, components: 1, async getData() { return new Uint8Array([255, 128, 0, 255]); }, dispose() { calls.push(['dispose-mask']); } } }; },
          async createImageDataFromBuffer(pixels, options) { calls.push(['image', options]); return { dispose() { calls.push(['dispose-result']); } }; },
          async putPixels(options) { calls.push(['put', options.targetBounds]); if (failWrite) throw new Error('write failed'); }
        }
      };
      throw new Error(name);
    }
  });
  doc.createLayer = async ({ name }) => { const layer = { id: layerId++, name }; doc.layers.unshift(layer); calls.push(['layer', name]); return layer; };
  vm.runInContext(source + '\nglobalThis.harness = { takeCapture, applyJob, openDesktop, base64, getSession: () => sessionId, getCapture: () => capture, setToken: value => { token = value; }, bind: id => { const b = { valid: true, documentId: 12 }; bindings.set(id, b); allBindings.add(b); } };', context);
  await new Promise(resolve => setImmediate(resolve));
  const h = context.harness; h.setToken('test-token');
  const job = { id: '12345678-1234-1234-1234-123456789012', state: 'applying', lease: 'lease', revision: 1, sessionId: h.getSession(), document: { id: 12, name: doc.name, width: 100, height: 80 }, bounds: { left: 10, top: 20, right: 12, bottom: 22 }, width: 2, height: 2 };
  h.bind(job.id);
  return { h, doc, job, calls, notify: () => context.notify(), close: () => { closed = true; }, failWrite: () => { failWrite = true; }, failAck: value => { failAck = value; } };
}
test('existing chat copies the task with the UXP navigator clipboard before opening', async () => {
  const { h, calls } = await panelHarness();
  assert.equal(await h.openDesktop('job'), true);
  const copy = calls.findIndex(c => c[0] === 'clipboard');
  const open = calls.findIndex(c => c[0] === 'open');
  assert.equal(calls[copy][1]['text/plain'], '读取任务并修改图片');
  assert.ok(copy >= 0 && open > copy);
});
test('panel capture pads trimmed content and keeps the original selection mask', async () => {
  const { h } = await panelHarness(); await h.takeCapture('selection');
  const capture = h.getCapture();
  assert.deepEqual(Array.from(capture.pixels), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12, 34, 56, 255]);
  assert.deepEqual(Array.from(capture.mask), [255, 128, 0, 255]);
  assert.equal(h.base64(Uint8Array.from([255, 128, 0, 255])), '/4AA/w==');
});
test('panel writes the new layer at the saved coordinates in one committed history transaction', async () => {
  const { h, job, calls } = await panelHarness(); await h.applyJob(job);
  assert.equal(calls.filter(c => c[0] === 'layer').length, 1);
  const put = calls.find(c => c[0] === 'put'); assert.equal(put[1].left, 10); assert.equal(put[1].top, 20);
  assert.deepEqual(calls.find(c => c[0] === 'resume'), ['resume', true]);
  assert.ok(calls.some(c => c[1]?.endsWith?.('/complete')));
});
test('pixel write failure rolls back the new layer and reports retryable failure', async () => {
  const { h, doc, job, calls, failWrite } = await panelHarness(); failWrite();
  await assert.rejects(h.applyJob(job), /write failed/);
  assert.equal(doc.layers.length, 0);
  assert.deepEqual(calls.find(c => c[0] === 'resume'), ['resume', false]);
  assert.ok(calls.some(c => c[1]?.endsWith?.('/fail')));
});
test('acknowledgement retry does not write a duplicate layer', async () => {
  const { h, job, calls, failAck } = await panelHarness(); failAck(true);
  await assert.rejects(h.applyJob(job), /无法连接/); failAck(false); await h.applyJob(job);
  assert.equal(calls.filter(c => c[0] === 'layer').length, 1);
  assert.equal(calls.filter(c => c[0] === 'put').length, 1);
  assert.equal(calls.filter(c => c[1]?.endsWith?.('/fail')).length, 0);
});
test('document geometry event prevents every write until recapture', async () => {
  const { h, job, calls, notify } = await panelHarness(); notify();
  await assert.rejects(h.applyJob(job), /失效/); assert.equal(calls.filter(c => ['put', 'layer', 'suspend'].includes(c[0])).length, 0);
  assert.ok(calls.some(c => c[1]?.endsWith?.('/fail')));
});
