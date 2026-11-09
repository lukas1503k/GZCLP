#!/usr/bin/env node
// Zero-dependency icon generator. Writes:
//   assets/icon.svg              (vector source, same geometry)
//   assets/icon-192.png          (purpose "any": rounded dark tile)
//   assets/icon-512.png          (purpose "any")
//   assets/icon-maskable-512.png (purpose "maskable": full-bleed, motif scaled into the 80% safe zone)
//
// PNGs are rasterized procedurally (rounded rectangles, 4x4 supersampled for
// anti-aliasing) and encoded by hand: IHDR/IDAT/IEND chunks + CRC32, deflated with node:zlib.
//
// Usage: node tools/make-icons.mjs

import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(ROOT, "assets");

export const COLORS = {
  bg: "#0d0f12",
  bar: "#e6e8eb",
  plate: "#ffb020",
  plateSmall: "#e08a00",
  collar: "#9aa3ad",
};

// Design in a 512x512 space. [x, y, w, h, rx, color]
export const MOTIF = [
  // bar (sleeve to sleeve)
  [60, 244, 392, 24, 12, COLORS.bar],
  // left plates + collar
  [120, 136, 40, 240, 10, COLORS.plate],
  [168, 176, 28, 160, 8, COLORS.plateSmall],
  [202, 228, 12, 56, 4, COLORS.collar],
  // right plates + collar (mirrored)
  [352, 136, 40, 240, 10, COLORS.plate],
  [316, 176, 28, 160, 8, COLORS.plateSmall],
  [298, 228, 12, 56, 4, COLORS.collar],
];

const TILE_RX = 112;

function shapes({ maskable }) {
  const out = [];
  if (maskable) out.push([0, 0, 512, 512, 0, COLORS.bg]);
  else out.push([0, 0, 512, 512, TILE_RX, COLORS.bg]);
  // Maskable: shrink motif about the centre so it sits well inside the 80% safe circle.
  const k = maskable ? 0.8 : 1;
  for (const [x, y, w, h, rx, c] of MOTIF) {
    out.push([256 + (x - 256) * k, 256 + (y - 256) * k, w * k, h * k, rx * k, c]);
  }
  return out;
}

export function buildSvg() {
  const rect = ([x, y, w, h, rx, c]) =>
    `  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${c}"/>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">`,
    `  <title>GZCLP</title>`,
    ...shapes({ maskable: false }).map(rect),
    `</svg>`,
    ``,
  ].join("\n");
}

// ---------- rasterizer ----------

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  r = Math.min(r, w / 2, h / 2);
  const cx = px < x + r ? x + r : px > x + w - r ? x + w - r : px;
  const cy = py < y + r ? y + r : py > y + h - r ? y + h - r : py;
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

export function rasterize(size, { maskable = false } = {}) {
  const SS = 4; // 4x4 samples per pixel
  const scale = 512 / size;
  const list = shapes({ maskable }).map(([x, y, w, h, r, c]) => ({ x, y, w, h, r, rgb: hex(c) }));
  const px = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      // Composite per pixel in premultiplied space: each shape's coverage over what's below.
      let r = 0, g = 0, b = 0, a = 0;
      for (const s of list) {
        // quick reject on pixel bounds
        const x0 = i * scale, y0 = j * scale;
        if (x0 + scale < s.x || y0 + scale < s.y || x0 > s.x + s.w || y0 > s.y + s.h) continue;
        let hits = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const X = (i + (sx + 0.5) / SS) * scale;
            const Y = (j + (sy + 0.5) / SS) * scale;
            if (inRoundRect(X, Y, s.x, s.y, s.w, s.h, s.r)) hits++;
          }
        }
        if (!hits) continue;
        const cov = hits / (SS * SS);
        r = s.rgb[0] * cov + r * (1 - cov);
        g = s.rgb[1] * cov + g * (1 - cov);
        b = s.rgb[2] * cov + b * (1 - cov);
        a = cov + a * (1 - cov);
      }
      const o = (j * size + i) * 4;
      // un-premultiply
      px[o] = a ? Math.round(r / a) : 0;
      px[o + 1] = a ? Math.round(g / a) : 0;
      px[o + 2] = a ? Math.round(b / a) : 0;
      px[o + 3] = Math.round(a * 255);
    }
  }
  return px;
}

// ---------- PNG encoder ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function main() {
  mkdirSync(ASSETS, { recursive: true });
  writeFileSync(join(ASSETS, "icon.svg"), buildSvg());
  const jobs = [
    ["icon-192.png", 192, false],
    ["icon-512.png", 512, false],
    ["icon-maskable-512.png", 512, true],
  ];
  for (const [name, size, maskable] of jobs) {
    writeFileSync(join(ASSETS, name), encodePng(size, size, rasterize(size, { maskable })));
    console.log(`wrote assets/${name}`);
  }
  console.log("wrote assets/icon.svg");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
