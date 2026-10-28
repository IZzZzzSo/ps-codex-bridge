import test from 'node:test';
import assert from 'node:assert/strict';
import geometry from '../plugin/geometry.js';
const { boundsFor, padPixels, validateTarget } = geometry;
test('canvas and selection bounds use document pixels, clip and round outwards', () => {
  const doc = { width: 100, height: 80 };
  assert.deepEqual(boundsFor('canvas', doc), { left: 0, top: 0, right: 100, bottom: 80 });
  assert.deepEqual(boundsFor('selection', doc, { left: -2, top: 4.2, right: 101, bottom: 9.1 }), { left: 0, top: 4, right: 100, bottom: 10 });
  assert.throws(() => boundsFor('selection', doc, null), /选区/);
  assert.throws(() => boundsFor('canvas', { width: 5000, height: 5000 }), /1600/);
});
test('trimmed transparent border is padded without moving the captured rectangle', () => {
  const result = padPixels({ width: 1, height: 1 }, { left: 11, top: 21 }, { left: 10, top: 20, right: 13, bottom: 22 }, Uint8Array.from([17, 33, 44]), 3, 4);
  assert.equal(result.length, 24);
  assert.deepEqual(Array.from(result.slice(16, 20)), [17, 33, 44, 255]);
  assert.equal(result[3], 0); assert.equal(result[23], 0);
});
test('selection mask padding preserves feather values', () => {
  assert.deepEqual(Array.from(padPixels({ width: 2, height: 1 }, { left: 1, top: 0 }, { left: 0, top: 0, right: 4, bottom: 1 }, Uint8Array.from([128, 255]), 1, 1)), [0, 128, 255, 0]);
});
test('return guards reject stale sessions, closed documents and canvas changes', () => {
  const document = { id: 3, name: '原图.psd', width: 400, height: 200 };
  const job = { sessionId: 'session', document };
  assert.doesNotThrow(() => validateTarget(job, document, 'session', true));
  assert.throws(() => validateTarget(job, document, 'other', true), /失效/);
  assert.throws(() => validateTarget(job, null, 'session', true), /关闭/);
  assert.throws(() => validateTarget(job, { ...document, width: 399 }, 'session', true), /尺寸/);
  assert.throws(() => validateTarget(job, document, 'session', false), /失效/);
});
