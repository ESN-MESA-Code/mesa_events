// Mock default pictures for the demo data (round 2026-11-10): the Pictures
// tab and the Telegram previews had nothing to show on staging. The seed
// makes a labelled placeholder – a coloured card that says what it stands
// for ("PUB QUIZ", "DAY TRIP") – for every event type, every category and
// every second format, so the fallbacks can be seen too: an event takes its
// format's picture, else its category's, else its type's. A format left
// without one shows the "Choose a picture" state and falls back.
//
// The pictures are drawn here (a PNG written by hand: no image library, so
// it also runs from "Reset demo data" on the server) and stored like the
// ones Comms uploads: "library:<path>" in the private advertising-pictures
// bucket. Slots that already have a picture are left alone; the mock ones
// are recognised by their file name and go with `--remove`.
import { deflateSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { EVENT_TYPES, EVENT_TYPE_LABELS } from "@/lib/labels";
import { LIBRARY_PREFIX } from "@/lib/telegram/picture";

type Db = SupabaseClient<Database>;

const BUCKET = "advertising-pictures";
/** The file name of every mock picture – how a later run finds them again. */
export const MOCK_FILE = "staging-mock.png";

// ── A 5×7 pixel font (capitals, digits, a few signs) ────────────────────────
const GLYPHS: Record<string, string> = {
  A: "01110 10001 10001 11111 10001 10001 10001",
  B: "11110 10001 10001 11110 10001 10001 11110",
  C: "01110 10001 10000 10000 10000 10001 01110",
  D: "11110 10001 10001 10001 10001 10001 11110",
  E: "11111 10000 10000 11110 10000 10000 11111",
  F: "11111 10000 10000 11110 10000 10000 10000",
  G: "01110 10001 10000 10111 10001 10001 01111",
  H: "10001 10001 10001 11111 10001 10001 10001",
  I: "01110 00100 00100 00100 00100 00100 01110",
  J: "00111 00010 00010 00010 00010 10010 01100",
  K: "10001 10010 10100 11000 10100 10010 10001",
  L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10101 10001 10001 10001",
  N: "10001 11001 10101 10011 10001 10001 10001",
  O: "01110 10001 10001 10001 10001 10001 01110",
  P: "11110 10001 10001 11110 10000 10000 10000",
  Q: "01110 10001 10001 10001 10101 10010 01101",
  R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 10000 01110 00001 00001 11110",
  T: "11111 00100 00100 00100 00100 00100 00100",
  U: "10001 10001 10001 10001 10001 10001 01110",
  V: "10001 10001 10001 10001 10001 01010 00100",
  W: "10001 10001 10001 10101 10101 11011 10001",
  X: "10001 10001 01010 00100 01010 10001 10001",
  Y: "10001 10001 01010 00100 00100 00100 00100",
  Z: "11111 00001 00010 00100 01000 10000 11111",
  "0": "01110 10001 10011 10101 11001 10001 01110",
  "1": "00100 01100 00100 00100 00100 00100 01110",
  "2": "01110 10001 00001 00010 00100 01000 11111",
  "3": "11110 00001 00001 01110 00001 00001 11110",
  "4": "00010 00110 01010 10010 11111 00010 00010",
  "5": "11111 10000 11110 00001 00001 10001 01110",
  "6": "00110 01000 10000 11110 10001 10001 01110",
  "7": "11111 00001 00010 00100 01000 01000 01000",
  "8": "01110 10001 10001 01110 10001 10001 01110",
  "9": "01110 10001 10001 01111 00001 00010 01100",
  "-": "00000 00000 00000 11111 00000 00000 00000",
  "&": "01100 10010 10100 01000 10101 10010 01101",
  ".": "00000 00000 00000 00000 00000 01100 01100",
  "'": "00100 00100 01000 00000 00000 00000 00000",
  "/": "00001 00001 00010 00100 01000 10000 10000",
  "+": "00000 00100 00100 11111 00100 00100 00000",
  "!": "00100 00100 00100 00100 00100 00000 00100",
};
const GLYPH_W = 5;
const GLYPH_H = 7;

/** "Café-Crawl (new)" → "CAFE-CRAWL NEW": what the font can write. */
export function mockLabel(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toUpperCase()
    .replace(/[’`´]/g, "'")
    .replace(/[–—]/g, "-")
    .split("")
    .map((ch) => (ch === " " || GLYPHS[ch] ? ch : " "))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** The label in lines of at most `max` characters, broken at spaces (a longer word is cut). */
export function wrapLabel(label: string, max: number): string[] {
  const lines: string[] = [];
  for (const word of label.split(" ").flatMap((w) => w.match(new RegExp(`.{1,${max}}`, "g")) ?? [])) {
    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + word.length <= max) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

// ── The PNG ──────────────────────────────────────────────────────────────────
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set([...type].map((ch) => ch.charCodeAt(0)), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

type Rgb = [number, number, number];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as Rgb;

/** Top and bottom colour of a card; picked by the slot's name, so a slot keeps its colours. */
const PALETTES: Array<[Rgb, Rgb]> = [
  [[46, 49, 146], [0, 174, 239]], // ESN blue → cyan
  [[236, 0, 140], [244, 121, 32]], // magenta → orange
  [[0, 122, 94], [122, 193, 67]], // green
  [[91, 33, 182], [236, 72, 153]], // violet → pink
  [[180, 83, 9], [250, 204, 21]], // amber
  [[15, 76, 129], [56, 189, 248]], // navy → sky
  [[136, 19, 55], [251, 113, 133]], // wine → rose
  [[17, 94, 89], [45, 212, 191]], // teal
];

export const MOCK_WIDTH = 800;
export const MOCK_HEIGHT = 600;

/**
 * A placeholder picture as a PNG (800 × 600): a colour gradient, the label
 * in big pixel letters and a line below saying what kind of default it is.
 * The same input gives the same bytes.
 */
export function mockPicture(label: string, caption: string): Uint8Array {
  const w = MOCK_WIDTH;
  const h = MOCK_HEIGHT;
  const text = mockLabel(label) || "EVENT";
  const [top, bottom] = PALETTES[[...text].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7) % PALETTES.length];
  const px = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const c = mix(top, bottom, y / (h - 1));
    for (let x = 0; x < w; x++) px.set(c, (y * w + x) * 3);
  }
  const blend = (x: number, y: number, c: Rgb, alpha: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 3;
    for (let k = 0; k < 3; k++) px[i + k] = Math.round(px[i + k] + (c[k] - px[i + k]) * alpha);
  };
  const disc = (cx: number, cy: number, r: number, alpha: number) => {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) blend(x, y, [255, 255, 255], alpha);
  };
  // Two soft circles, so it does not look like an error page.
  disc(w - 90, 80, 190, 0.1);
  disc(70, h - 40, 150, 0.08);

  const write = (line: string, scale: number, y0: number, color: Rgb, alpha = 1) => {
    const advance = (GLYPH_W + 1) * scale;
    const x0 = Math.round((w - (line.length * advance - scale)) / 2);
    [...line].forEach((ch, n) => {
      const rows = GLYPHS[ch]?.split(" ");
      if (!rows) return;
      for (let gy = 0; gy < GLYPH_H; gy++)
        for (let gx = 0; gx < GLYPH_W; gx++)
          if (rows[gy][gx] === "1") for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) blend(x0 + n * advance + gx * scale + dx, y0 + gy * scale + dy, color, alpha);
    });
  };
  // The label: as big as its longest line allows, at most three lines.
  let scale = 12;
  let lines = wrapLabel(text, 10);
  for (const [s, max] of [[12, 10], [10, 12], [8, 15], [6, 20]] as const) {
    scale = s;
    lines = wrapLabel(text, max);
    if (lines.length <= 3) break;
  }
  lines = lines.slice(0, 3);
  const lineH = (GLYPH_H + 3) * scale;
  const blockTop = Math.round((h - lines.length * lineH) / 2) - 20;
  lines.forEach((line, i) => {
    write(line, scale, blockTop + i * lineH + Math.round(scale / 3), [0, 0, 0], 0.18);
    write(line, scale, blockTop + i * lineH, [255, 255, 255]);
  });
  // What it stands for, and that it is not a real picture.
  for (let y = h - 78; y < h; y++) for (let x = 0; x < w; x++) blend(x, y, [0, 0, 0], 0.28);
  write(mockLabel(caption), 4, h - 62, [255, 255, 255]);
  write("MOCK PICTURE - STAGING DEMO", 2, h - 24, [255, 255, 255], 0.8);

  // Rows without a filter: the gradient is one colour per row, so it packs small.
  const raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) raw.set(px.subarray(y * w * 3, (y + 1) * w * 3), y * (1 + w * 3) + 1);
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, w);
  hv.setUint32(4, h);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ── Into the database ────────────────────────────────────────────────────────
function check<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as NonNullable<T>;
}

const isMock = (picture: string) => picture.endsWith(`/${MOCK_FILE}`);

/** Takes the mock pictures out again (the rows and the files); pictures Comms chose stay. */
export async function removeMockPictures(db: Db): Promise<number> {
  const rows = check(await db.from("advertising_pictures").select("id, picture"), "default pictures").filter((r) => isMock(r.picture));
  if (!rows.length) return 0;
  check(await db.from("advertising_pictures").delete().in("id", rows.map((r) => r.id)), "old mock pictures");
  // The files: best effort – a file left behind is overwritten by the next run.
  await db.storage.from(BUCKET).remove(rows.map((r) => r.picture.slice(LIBRARY_PREFIX.length)));
  return rows.length;
}

/**
 * A mock default picture for every event type, every category in use and
 * every second format (by name) – only where none is set. Returns how many
 * it added.
 */
export async function seedMockPictures(db: Db): Promise<{ types: number; categories: number; formats: number }> {
  const [categories, formats, existing] = [
    check(await db.from("event_categories").select("id, name").eq("active", true).order("sort"), "categories"),
    check(await db.from("event_formats").select("id, name").eq("active", true).order("name"), "formats"),
    check(await db.from("advertising_pictures").select("format_id, category_id, event_type"), "default pictures"),
  ];
  const taken = new Set(existing.map((r) => r.format_id ?? r.category_id ?? r.event_type));
  const slots = [
    ...EVENT_TYPES.map((t) => ({ kind: "types" as const, id: t as string, folder: `type/${t}`, label: EVENT_TYPE_LABELS[t], caption: "Event type", row: { event_type: t } })),
    ...categories.map((c) => ({ kind: "categories" as const, id: c.id, folder: `category/${c.id}`, label: c.name, caption: "Category", row: { category_id: c.id } })),
    // Every second one: the others show the empty slot and fall back to their category's picture.
    ...formats.filter((_, i) => i % 2 === 0).map((f) => ({ kind: "formats" as const, id: f.id, folder: `format/${f.id}`, label: f.name, caption: "Format", row: { format_id: f.id } })),
  ].filter((s) => !taken.has(s.id));
  const made = { types: 0, categories: 0, formats: 0 };
  for (const s of slots) {
    const path = `${s.folder}/${MOCK_FILE}`;
    const up = await db.storage.from(BUCKET).upload(path, mockPicture(s.label, s.caption), { contentType: "image/png", upsert: true });
    if (up.error) throw new Error(`mock picture for ${s.label}: ${up.error.message}`);
    check(await db.from("advertising_pictures").insert({ ...s.row, picture: `${LIBRARY_PREFIX}${path}` }).select("id"), `default picture for ${s.label}`);
    made[s.kind]++;
  }
  return made;
}
