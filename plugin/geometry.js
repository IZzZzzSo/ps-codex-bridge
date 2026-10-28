// Shared pure functions; used by UXP and the Node verification suite.
function boundsFor(mode, document, selection) {
  const width = Number(document.width), height = Number(document.height);
  if (![width, height].every(Number.isInteger) || width < 1 || height < 1) throw new Error('无法读取画布尺寸。');
  if (mode !== 'canvas' && mode !== 'selection') throw new Error('无效的截取模式。');
  if (mode === 'selection' && !selection) throw new Error('请先在 PS 画布上建立选区。');
  const b = mode === 'canvas' ? { left: 0, top: 0, right: width, bottom: height } : {
    left: Math.max(0, Math.floor(selection.left)), top: Math.max(0, Math.floor(selection.top)),
    right: Math.min(width, Math.ceil(selection.right)), bottom: Math.min(height, Math.ceil(selection.bottom))
  };
  if (!Object.values(b).every(Number.isInteger) || b.right <= b.left || b.bottom <= b.top) throw new Error('选区没有覆盖有效画布。');
  if ((b.right - b.left) * (b.bottom - b.top) > 16000000) throw new Error('第一版单次最多支持 1600 万像素，请缩小选区。');
  return b;
}
function padPixels(image, sourceBounds, bounds, data, components, destinationComponents) {
  const width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
  const result = new Uint8Array(width * height * destinationComponents);
  const left = Math.round(sourceBounds.left), top = Math.round(sourceBounds.top);
  if (![1, 3, 4].includes(components) || data.length !== image.width * image.height * components) throw new Error('PS 返回了不支持的像素格式。');
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const dx = left + x - bounds.left, dy = top + y - bounds.top;
    if (dx < 0 || dy < 0 || dx >= width || dy >= height) continue;
    const src = (y * image.width + x) * components, dst = (dy * width + dx) * destinationComponents;
    if (destinationComponents === 1) result[dst] = data[src];
    else {
      result[dst] = data[src]; result[dst + 1] = data[src + (components === 1 ? 0 : 1)];
      result[dst + 2] = data[src + (components === 1 ? 0 : 2)]; result[dst + 3] = components === 4 ? data[src + 3] : 255;
    }
  }
  return result;
}
function validateTarget(job, document, sessionId, bindingValid) {
  if (!bindingValid || job.sessionId !== sessionId) throw new Error('原文档绑定已失效（插件重载、文档关闭或几何变化）。请重新截取。');
  if (!document || document.id !== job.document.id) throw new Error('原文档已关闭，请重新打开后重新截取。');
  if (Number(document.width) !== job.document.width || Number(document.height) !== job.document.height) throw new Error('画布尺寸已改变，请重新截取以保证定位准确。');
  if (document.name !== job.document.name) throw new Error('文档名称已改变，请重新截取。');
}
module.exports = { boundsFor, padPixels, validateTarget };
