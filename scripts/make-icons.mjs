// Renders the app icon: a diagonal gradient dithered with an 8×8 Bayer matrix.
// Writes SVG and PNG variants into apps/web/public. Run: node scripts/make-icons.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../apps/web/public/", import.meta.url));
const BG = [0x15, 0x19, 0x1e];
const FG = [0x4c, 0xc2, 0xe6];
const CELLS = 8;

const bayer = (() => {
  let m = [[0]];
  while (m.length < CELLS) {
    const s = m.length;
    const next = Array.from({ length: s * 2 }, () => Array(s * 2).fill(0));
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const v = 4 * m[y][x];
        next[y][x] = v;
        next[y][x + s] = v + 2;
        next[y + s][x] = v + 3;
        next[y + s][x + s] = v + 1;
      }
    m = next;
  }
  return m;
})();

// Lit cells: brightness rises from bottom-left to top-right.
const lit = (x, y) => (x + (CELLS - 1 - y)) / (2 * (CELLS - 1)) > (bayer[y][x] + 0.5) / (CELLS * CELLS);

/** `inset` is the empty margin on each side as a fraction of the icon. */
function svg(inset) {
  const size = 64;
  const cell = (size * (1 - 2 * inset)) / CELLS;
  const o = size * inset;
  let rects = "";
  for (let y = 0; y < CELLS; y++)
    for (let x = 0; x < CELLS; x++)
      if (lit(x, y)) rects += `<rect x="${(o + x * cell).toFixed(2)}" y="${(o + y * cell).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="12" fill="#15191e"/><g fill="#4cc2e6" shape-rendering="crispEdges">${rects}</g></svg>\n`;
}

function png(px, inset) {
  const rows = [];
  const start = px * inset;
  const cell = (px * (1 - 2 * inset)) / CELLS;
  for (let y = 0; y < px; y++) {
    const row = Buffer.alloc(1 + px * 3); // filter byte 0, then RGB
    for (let x = 0; x < px; x++) {
      const cx = Math.floor((x - start) / cell);
      const cy = Math.floor((y - start) / cell);
      const inside = cx >= 0 && cy >= 0 && cx < CELLS && cy < CELLS;
      row.set(inside && lit(cx, cy) ? FG : BG, 1 + x * 3);
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(px, 0);
  ihdr.writeUInt32BE(px, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

writeFileSync(OUT + "icon.svg", svg(0.125));
writeFileSync(OUT + "icon-192.png", png(192, 0.125));
writeFileSync(OUT + "icon-512.png", png(512, 0.125));
// Maskable: launchers may crop to a circle covering 80% of the icon, so keep the art inside it.
writeFileSync(OUT + "icon-maskable-512.png", png(512, 0.22));
console.log("Icons written to", OUT);
