// 生成 1024x1024 应用图标(知识图谱 + 书本),纯 Node,无需第三方依赖
// 用法:node scripts/gen-icon.mjs  → 输出 app-icon.png(位于工程根目录)
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const N = 1024;
const BG = [52, 98, 235];
const SOFT = [200, 220, 255];
const outer = [[290, 320], [734, 320], [290, 704], [734, 704]];
const center = [512, 512];
const lines = [...outer.map((o) => [center, o]), [outer[0], outer[1]], [outer[2], outer[3]]];

const cl = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = cl(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

const buf = Buffer.alloc((N * 4 + 1) * N);
let o = 0;
for (let y = 0; y < N; y++) {
  buf[o++] = 0; // filter: none
  const py = y + 0.5;
  for (let x = 0; x < N; x++) {
    const px = x + 0.5;
    // 圆角方形背景
    const qx = Math.abs(px - 512) - 258, qy = Math.abs(py - 512) - 258;
    const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 190;
    const a = cl(0.5 - d);
    if (a === 0) { o += 4; continue; }
    let [r, g, b] = BG;
    const mix = (c, k) => { r += (c[0] - r) * k; g += (c[1] - g) * k; b += (c[2] - b) * k; };
    if (px > 200 && px < 830 && py > 200 && py < 830) {
      for (const [p, q] of lines) {
        const cv = cl(0.5 - (segDist(px, py, p, q) - 11));
        if (cv) mix([255, 255, 255], 0.55 * cv);
      }
      for (const p of outer) {
        const cv = cl(0.5 - (Math.hypot(px - p[0], py - p[1]) - 58));
        if (cv) mix(SOFT, cv);
      }
      const cc = cl(0.5 - (Math.hypot(px - 512, py - 512) - 100));
      if (cc) mix([255, 255, 255], cc);
      // 中心书本:左右两页
      for (const sx of [-1, 1]) {
        const ux = Math.abs(px - (512 + sx * 30)) - 24, uy = Math.abs(py - 512) - 46;
        const dd = Math.hypot(Math.max(ux, 0), Math.max(uy, 0)) + Math.min(Math.max(ux, uy), 0) - 6;
        const cv = cl(0.5 - dd);
        if (cv) mix(BG, cv);
      }
    }
    buf[o++] = Math.round(r); buf[o++] = Math.round(g); buf[o++] = Math.round(b); buf[o++] = Math.round(a * 255);
  }
}

// CRC32(兼容 Node 18,避免依赖 zlib.crc32)
const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(buf, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]);
const out = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'app-icon.png');
writeFileSync(out, png);
console.log('written', out, png.length, 'bytes');
