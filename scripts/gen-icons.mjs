// `npm run gen:icons` – the tab and home-screen icons from the pretzel logo
// (public/pretzel.svg, an optimised copy of design/pretzel-color.svg):
//   app/icon.svg        square, the gaps between the tiles closed (below)
//   app/favicon.ico     16, 32 and 48 px PNGs in one .ico
//   app/apple-icon.png  180 px on white (iOS wants no transparency), with padding
// sharp comes with Next.js (image optimisation), no extra dependency.
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const pretzel = readFileSync("public/pretzel.svg", "utf8");
const [, , , W, H] = pretzel.match(/viewBox="(\S+) (\S+) (\S+) (\S+)"/).map(Number);

// At tab size the thin white gaps between the mosaic tiles only blur the
// colours into grey mush. Stroking each tile in its own colour closes them,
// so the icon reads as one solid pretzel with three clear holes.
const GAP = 32;
const side = W + GAP * 2;
const icon = pretzel
  .replace(/viewBox="[^"]+"/, `viewBox="${-GAP} ${(H - side) / 2} ${side} ${side}"`)
  .replace(/<path fill="(#[0-9a-f]+)"/g, `<path fill="$1" stroke="$1" stroke-width="${GAP}" stroke-linejoin="round"`);
writeFileSync("app/icon.svg", icon);

// Render big, then scale down: sharp's resvg rasterises at the SVG's size.
const png = (svg, px) => sharp(Buffer.from(svg), { density: 72 * (px * 4) / side }).resize(px, px).png().toBuffer();

// .ico with PNG entries (every browser and Windows since Vista read them).
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((px) => png(icon, px)));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // 1 = icon
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((px, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(px, e); // width
  header.writeUInt8(px, e + 1); // height
  header.writeUInt8(0, e + 2); // no palette
  header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4); // colour planes
  header.writeUInt16LE(32, e + 6); // bits per pixel
  header.writeUInt32LE(images[i].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});
writeFileSync("app/favicon.ico", Buffer.concat([header, ...images]));

// Apple: 180 px, opaque, the pretzel (with its gaps: big enough to see the
// mosaic) about 80 % wide so the rounded corners iOS cuts never touch it.
const APPLE = 180;
const inner = 144;
const logo = await sharp(Buffer.from(pretzel), { density: (72 * inner * 4) / W }).resize(inner).png().toBuffer();
const { height: logoH } = await sharp(logo).metadata();
await sharp({ create: { width: APPLE, height: APPLE, channels: 3, background: "#ffffff" } })
  .composite([{ input: logo, left: (APPLE - inner) / 2, top: Math.round((APPLE - logoH) / 2) }])
  .flatten({ background: "#ffffff" })
  .png()
  .toFile("app/apple-icon.png");

console.log(`app/icon.svg ${icon.length} B, app/favicon.ico ${sizes.join("/")} px, app/apple-icon.png ${APPLE} px`);
