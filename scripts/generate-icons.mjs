// Regenerates the raster icons (favicon, apple-touch-icon, PWA icons) from lucide's calendar-check
// glyph, drawn in white on the accent colour.
// Run: npm run icons
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const BG = "#3b6fd6"; // --accent (light)
const FG = "#ffffff";
// lucide calendar-check (24x24 viewBox, stroke-based).
const GLYPH = `<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="m9 15 2 2 4-4"/>`;

/**
 * SVG for a square icon. `glyphShare` is the glyph's share of the tile; maskable icons keep it
 * inside the central safe zone. `rounded` cuts transparent corners; maskable and Apple icons are
 * full-bleed because the platform applies its own mask.
 */
function svg(size, { glyphShare = 0.62, rounded = true } = {}) {
  const scale = (size * glyphShare) / 24;
  const offset = (size - 24 * scale) / 2;
  const radius = rounded ? size * 0.22 : 0;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<rect width="${size}" height="${size}" rx="${radius}" fill="${BG}"/>` +
      `<g transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="${FG}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${GLYPH}</g>` +
      `</svg>`,
  );
}

function png(size, options) {
  return sharp(svg(size, options)).ensureAlpha().png().toBuffer();
}

/** A .ico embedding PNG images (32-bit RGBA). */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

await writeFile(join(PUBLIC, "pwa-192.png"), await png(192));
await writeFile(join(PUBLIC, "pwa-512.png"), await png(512));
await writeFile(join(PUBLIC, "pwa-maskable-512.png"), await png(512, { glyphShare: 0.5, rounded: false }));
await writeFile(join(PUBLIC, "apple-touch-icon.png"), await png(180, { rounded: false }));
const ico = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(size) })));
await writeFile(join(PUBLIC, "favicon.ico"), buildIco(ico));
console.log("Generated pwa-192, pwa-512, pwa-maskable-512, apple-touch-icon, favicon.ico");
