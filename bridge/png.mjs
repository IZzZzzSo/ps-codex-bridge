// Small, bounded PNG codec. No runtime packages; decoding supports all PNG color
// types, 1/2/4/8/16 bit samples and Adam7. Color conversion is done by macOS sips.
import { deflateSync, inflateSync } from 'node:zlib';
export const MAX_PIXELS = 16_000_000;
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const table = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc(bytes) {
  let n = 0xffffffff;
  for (const b of bytes) n = table[(n ^ b) & 255] ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); body.copy(result, 4);
  result.writeUInt32BE(crc(body), result.length - 4);
  return result;
}
export function dimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS)
    throw new Error('图像大小无效，第一版单次最多支持 1600 万像素，请缩小选区。');
}
export function encodePNG(width, height, rgba) {
  dimensions(width, height);
  if (rgba.length !== width * height * 4) throw new Error('RGBA 像素长度不匹配。');
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([signature, chunk('IHDR', header), chunk('sRGB', Buffer.from([0])), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
function paeth(a, b, c) {
  const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c);
  return x <= y && x <= z ? a : y <= z ? b : c;
}
export function decodePNG(buffer) {
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error('不是有效 PNG 图像。');
  let width, height, depth, type, interlace, palette, transparency, ended = false;
  const data = [];
  for (let pos = 8; pos < buffer.length;) {
    if (pos + 12 > buffer.length) throw new Error('PNG 文件不完整。');
    const length = buffer.readUInt32BE(pos), end = pos + 12 + length;
    if (end > buffer.length) throw new Error('PNG 数据块越界。');
    const name = buffer.toString('ascii', pos + 4, pos + 8), body = buffer.subarray(pos + 8, end - 4);
    if (crc(buffer.subarray(pos + 4, end - 4)) !== buffer.readUInt32BE(end - 4)) throw new Error('PNG 校验失败。');
    if (name === 'IHDR') {
      if (width !== undefined || length !== 13 || pos !== 8) throw new Error('PNG 文件头无效。');
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); dimensions(width, height);
      depth = body[8]; type = body[9]; interlace = body[12];
      if (body[10] || body[11] || interlace > 1) throw new Error('不支持的 PNG 编码。');
    } else if (name === 'IDAT') data.push(body);
    else if (name === 'PLTE') palette = body;
    else if (name === 'tRNS') transparency = body;
    else if (name === 'IEND') { ended = true; break; }
    pos = end;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  const validDepths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!ended || !data.length || !channels || !validDepths[type].includes(depth)) throw new Error('PNG 格式不完整或位深无效。');
  if (type === 3 && (!palette || palette.length % 3)) throw new Error('PNG 缺少调色板。');
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  const passInfo = passes.map(([x, y, dx, dy]) => ({ x, y, dx, dy, w: Math.max(0, Math.ceil((width - x) / dx)), h: Math.max(0, Math.ceil((height - y) / dy)) }));
  const expected = passInfo.reduce((sum, p) => sum + (p.w && p.h ? (Math.ceil(p.w * channels * depth / 8) + 1) * p.h : 0), 0);
  const raw = inflateSync(Buffer.concat(data), { maxOutputLength: expected });
  if (raw.length !== expected) throw new Error('PNG 像素长度无效。');
  const rgba = Buffer.alloc(width * height * 4), max = 2 ** depth - 1;
  let offset = 0;
  for (const p of passInfo) {
    if (!p.w || !p.h) continue;
    const rowBytes = Math.ceil(p.w * channels * depth / 8), bpp = Math.max(1, Math.ceil(channels * depth / 8));
    let previous = Buffer.alloc(rowBytes);
    for (let y = 0; y < p.h; y++) {
      const filter = raw[offset++], row = Buffer.from(raw.subarray(offset, offset + rowBytes)); offset += rowBytes;
      if (filter > 4) throw new Error('PNG 滤波器无效。');
      for (let i = 0; i < row.length; i++) {
        const a = i >= bpp ? row[i - bpp] : 0, b = previous[i], c = i >= bpp ? previous[i - bpp] : 0;
        row[i] = (row[i] + (filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c))) & 255;
      }
      const sample = i => depth === 16 ? row.readUInt16BE(i * 2) : depth === 8 ? row[i] : (row[Math.floor(i * depth / 8)] >> (8 - depth - i * depth % 8)) & max;
      const scaled = i => Math.round(sample(i) * 255 / max);
      for (let x = 0; x < p.w; x++) {
        const dst = ((p.y + y * p.dy) * width + p.x + x * p.dx) * 4, src = x * channels;
        let r, g, b, a = 255;
        if (type === 0 || type === 4) {
          r = g = b = scaled(src);
          if (type === 4) a = scaled(src + 1);
          else if (transparency && sample(src) === transparency.readUInt16BE(0)) a = 0;
        } else if (type === 3) {
          const n = sample(src);
          if (n * 3 + 2 >= palette.length) throw new Error('PNG 调色板索引越界。');
          [r, g, b] = palette.subarray(n * 3, n * 3 + 3); a = transparency?.[n] ?? 255;
        } else {
          r = scaled(src); g = scaled(src + 1); b = scaled(src + 2);
          if (type === 6) a = scaled(src + 3);
          else if (transparency && sample(src) === transparency.readUInt16BE(0) && sample(src + 1) === transparency.readUInt16BE(2) && sample(src + 2) === transparency.readUInt16BE(4)) a = 0;
        }
        rgba[dst] = r; rgba[dst + 1] = g; rgba[dst + 2] = b; rgba[dst + 3] = a;
      }
      previous = row;
    }
  }
  return { width, height, rgba };
}
