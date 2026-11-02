// Génère build/icon.png (512×512) : le logo de la barre du haut sur un carré arrondi.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;
const SS = 4; // suréchantillonnage pour adoucir les bords
const BG = [22, 25, 32];
const FG = [245, 184, 61];

// Logo dans un repère 32×32 : x, y, largeur, hauteur, rayon
const BARS = [[3, 12, 3, 8], [9, 7, 3, 18], [15, 3, 3, 26], [21, 9, 3, 14], [27, 13, 3, 6]];

function inRoundRect(x, y, rx, ry, w, h, r) {
  if (x < rx || y < ry || x > rx + w || y > ry + h) return false;
  const cx = Math.max(rx + r, Math.min(x, rx + w - r));
  const cy = Math.max(ry + r, Math.min(y, ry + h - r));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function sample(px, py) {
  const u = px / SIZE;
  const v = py / SIZE;
  if (!inRoundRect(u, v, 0.02, 0.02, 0.96, 0.96, 0.2)) return null;
  // logo centré sur 64 % du carré
  const lx = ((u - 0.18) / 0.64) * 32;
  const ly = ((v - 0.18) / 0.64) * 32;
  for (const [x, y, w, h] of BARS) if (inRoundRect(lx, ly, x, y, w, h, 1.5)) return FG;
  return BG;
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
      }
    }
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    if (a) { raw[o] = r / a; raw[o + 1] = g / a; raw[o + 2] = b / a; }
    raw[o + 3] = Math.round((a / (SS * SS)) * 255);
  }
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.writeFileSync(out, png);
console.log('Icône écrite : ' + out);
