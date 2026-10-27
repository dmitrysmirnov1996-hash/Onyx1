/* Генератор PWA-иконок Onyx (кристалл + орбита) — чистый PNG writer */
const fs = require('fs');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* рисование */
function makeCanvas(size, bg) {
  const px = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) px[i * 4] = bg[0], px[i * 4 + 1] = bg[1], px[i * 4 + 2] = bg[2], px[i * 4 + 3] = bg[3];
  const blend = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= size || y >= size || a <= 0) return;
    const i = (y * size + x) * 4, na = a / 255;
    const da = px[i + 3] / 255;
    const oa = na + da * (1 - na);
    if (oa <= 0) return;
    px[i] = Math.round((r * na + px[i] * da * (1 - na)) / oa);
    px[i + 1] = Math.round((g * na + px[i + 1] * da * (1 - na)) / oa);
    px[i + 2] = Math.round((b * na + px[i + 2] * da * (1 - na)) / oa);
    px[i + 3] = Math.round(oa * 255);
  };
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const u = size / 100;
  const disc = (cx, cy, r, color, alpha) => {
    cx *= u; cy *= u; r *= u;
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r) blend(x, y, color[0], color[1], color[2], alpha);
      }
  };
  const radial = (cx, cy, r, c0, c1, aMax) => {
    cx *= u; cy *= u; r *= u;
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const t = Math.min(1, Math.hypot(x - cx, y - cy) / r);
        const w = 1 - t * t;
        blend(x, y,
          Math.round(c0[0] + (c1[0] - c0[0]) * t),
          Math.round(c0[1] + (c1[1] - c0[1]) * t),
          Math.round(c0[2] + (c1[2] - c0[2]) * t),
          Math.max(0, Math.round(aMax * w)));
      }
  };
  const line = (x1, y1, x2, y2, w, color, alpha) => {
    x1 *= u; y1 *= u; x2 *= u; y2 *= u; const hw = w * u / 2;
    const minX = Math.floor(Math.min(x1, x2) - hw), maxX = Math.ceil(Math.max(x1, x2) + hw);
    const minY = Math.floor(Math.min(y1, y2) - hw), maxY = Math.ceil(Math.max(y1, y2) + hw);
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy || 1;
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        let t = ((x - x1) * dx + (y - y1) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(x - (x1 + dx * t), y - (y1 + dy * t));
        if (d <= hw) blend(x, y, color[0], color[1], color[2], alpha);
      }
  };
  const fillPoly = (pts, color, alpha) => {
    const P = pts.map(p => [p[0] * u, p[1] * u]);
    let minY = Infinity, maxY = -Infinity;
    for (const p of P) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs = [];
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      xs.sort((m, n) => m - n);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) blend(x, y, color[0], color[1], color[2], alpha);
    }
  };
  return { px, blend, hex, disc, radial, line, fillPoly, u };
}

function drawOnyx(size, { transparentBg }) {
  const bg = transparentBg ? [0, 0, 0, 0] : [11, 13, 18, 255];
  const c = makeCanvas(size, bg);
  const A = '8b5cf6'.match(/../g).map(x => parseInt(x, 16));
  const L = 'c4b5fd'.match(/../g).map(x => parseInt(x, 16));
  const D = '#252b38'.slice(1).match(/../g).map(x => parseInt(x, 16));
  const W = 'f1eaff'.match(/../g).map(x => parseInt(x, 16));

  // орбита: полная — потом нижняя дуга поверх кристалла
  const ell = (cb) => {
    const tilt = -14 * Math.PI / 180, rx = 37, ry = 11, cx = 50, cy = 52;
    for (let t = 0; t < Math.PI * 2; t += 0.002) {
      const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
      cb(cx + ex * Math.cos(tilt) - ey * Math.sin(tilt), cy + ex * Math.sin(tilt) + ey * Math.cos(tilt));
    }
  };
  ell((x, y) => c.disc(x, y, 0.75, L, 130));
  // кристалл
  const H = [[50, 14], [75, 36], [75, 60], [50, 84], [25, 60], [25, 36]];
  c.fillPoly([[50, 12], [77, 35], [77, 61], [50, 88], [23, 61], [23, 35]], D, 255);
  // грани: линии
  const faces = [[50, 12, 33, 40], [50, 12, 67, 40], [77, 35, 67, 40], [23, 35, 33, 40], [50, 88, 33, 60], [50, 88, 67, 60]];
  for (const f of faces) c.line(f[0], f[1], f[2], f[3], .8, [255, 255, 255], 26);
  c.line(33, 40, 67, 40, .8, [255, 255, 255], 26);
  c.line(33, 60, 67, 60, .8, [255, 255, 255], 26);
  c.line(33, 40, 33, 60, .8, [255, 255, 255], 26);
  c.line(67, 40, 67, 60, .8, [255, 255, 255], 26);
  c.line(50, 16, 50, 86, .6, L, 70);
  // ядро
  c.radial(50, 50, 11, W, A, 235);
  // контур кристалла
  const O = [[50, 12], [77, 35], [77, 61], [50, 88], [23, 61], [23, 35]];
  for (let i = 0; i < O.length; i++) {
    const a = O[i], b = O[(i + 1) % O.length];
    c.line(a[0], a[1], b[0], b[1], 1.7, L, 235);
  }
  // нижняя (ближняя) дуга орбиты поверх
  ell((x, y, t) => { });
  const tilt2 = -14 * Math.PI / 180, rx2 = 37, ry2 = 11, cx2 = 50, cy2 = 52;
  for (let t = 0; t < Math.PI; t += 0.003) {
    const ex = rx2 * Math.cos(t), ey = ry2 * Math.sin(t);
    c.disc(cx2 + ex * Math.cos(tilt2) - ey * Math.sin(tilt2), cy2 + ex * Math.sin(tilt2) + ey * Math.cos(tilt2), 0.85, L, 190);
  }
  // спутник на нижней дуге (t≈37°)
  {
    const t = 0.65;
    const ex = rx2 * Math.cos(t), ey = ry2 * Math.sin(t);
    const sx = cx2 + ex * Math.cos(tilt2) - ey * Math.sin(tilt2), sy = cy2 + ex * Math.sin(tilt2) + ey * Math.cos(tilt2);
    c.disc(sx, sy, 3.2, A, 70);
    c.disc(sx, sy, 1.7, W, 245);
  }
  return c.px;
}

fs.writeFileSync('public/apple-touch-icon.png', png(180, drawOnyx(180, { transparentBg: false })));
fs.writeFileSync('public/icon-192.png', png(192, drawOnyx(192, { transparentBg: false })));
fs.writeFileSync('public/icon-512.png', png(512, drawOnyx(512, { transparentBg: false })));
console.log('icons written:', fs.statSync('public/apple-touch-icon.png').size, fs.statSync('public/icon-192.png').size, fs.statSync('public/icon-512.png').size);
