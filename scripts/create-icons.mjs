import { mkdir, writeFile } from 'node:fs/promises';
import { encodePNG } from '../bridge/png.mjs';
const dir = new URL('../plugin/icons/', import.meta.url); await mkdir(dir, { recursive: true });
for (const scale of [1, 2]) {
  const size = 23 * scale, pixels = Buffer.alloc(size * size * 4);
  function rect(x, y, w, h, color) {
    for (let py = y * scale; py < (y + h) * scale; py++) for (let px = x * scale; px < (x + w) * scale; px++) {
      if (px < 0 || py < 0 || px >= size || py >= size) continue;
      pixels.set(color, (py * size + px) * 4);
    }
  }
  const color = [210, 224, 178, 255];
  rect(1, 3, 8, 2, color); rect(1, 3, 2, 13, color); rect(1, 14, 8, 2, color);
  rect(14, 7, 8, 2, color); rect(20, 7, 2, 13, color); rect(14, 18, 8, 2, color);
  rect(7, 8, 9, 2, color); rect(14, 6, 2, 2, color); rect(14, 10, 2, 2, color);
  rect(7, 13, 9, 2, color); rect(7, 11, 2, 2, color); rect(7, 15, 2, 2, color);
  await writeFile(new URL(scale === 1 ? 'bridge.png' : 'bridge@2x.png', dir), encodePNG(size, size, pixels));
  if (scale === 1) await writeFile(new URL('bridge@1x.png', dir), encodePNG(size, size, pixels));
}
