// The ESN MESA event description template, ported from the Apps Script bot
// (esn-event-description-bot: src/Description.gs, src/Config.gs, src/Esn.gs).
// Pure functions: fields, normalisation, validation and rendering. The house
// template, emojis, headings, TBA time and price and the 4,096-character
// limit are unchanged; tests/unit/description.test.ts pins them.

export const CONFIG = {
  BULLET: "•",
  DEFAULT_IMPORTANT_HEADING: "IMPORTANT INFORMATION",
  WEATHER_NOTE:
    "🌧️ Depending on the weather conditions, we might have to cancel the event! " +
    "Make sure to check Telegram and Instagram for updates on this trip!",
  SIGNATURE: ["With lots of love,", "Team ESN MESA", "#MESAlovesYOU 🥨🩷💜"],
  // Hard limit for a whole description (Google Chat and Telegram messages allow 4,096 characters).
  MAX_CHARS: 4096,
  // Soft rules (shown as warnings, they don't block submitting).
  INTRO_SENTENCES: { min: 2, max: 4 },
  MAX_BULLETS: 6,
  VENUE_SUGGESTIONS: ["LMU Main Building", "TUM Main Campus", "Marienplatz", "Englischer Garten"],
} as const;

export const STEP_IDS = ["basics", "intro", "program", "extras"] as const;
export type StepId = (typeof STEP_IDS)[number];

export const STEP_FIELDS: Record<StepId, Array<keyof DescriptionFields>> = {
  basics: ["title", "dateIso", "time", "venue", "price", "priceNote"],
  intro: ["hook", "intro"],
  program: ["program", "bring"],
  extras: ["importantHeading", "important", "weather", "closing", "esnType", "esnObjectives"],
};

export interface DescriptionFields {
  title: string;
  /** yyyy-MM-dd */
  dateIso: string;
  time: string;
  venue: string;
  price: string;
  priceNote: string;
  hook: string;
  intro: string;
  program: string;
  bring: string;
  importantHeading: string;
  important: string;
  weather: boolean;
  closing: string;
  /** ESN Activities classification: saved, not part of the published text. */
  esnType: string;
  esnObjectives: string;
}

export const TEXT_FIELDS = [
  "title",
  "dateIso",
  "time",
  "venue",
  "price",
  "priceNote",
  "hook",
  "intro",
  "program",
  "bring",
  "importantHeading",
  "important",
  "closing",
  "esnType",
  "esnObjectives",
] as const;

/** Fields that make up the published text (the ESN classification is not part of it). */
export const CONTENT_FIELDS: Array<keyof DescriptionFields> = [...STEP_FIELDS.basics, ...STEP_FIELDS.intro, ...STEP_FIELDS.program, "importantHeading", "important", "weather", "closing"];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function emptyFields(title = ""): DescriptionFields {
  return {
    title,
    dateIso: "",
    time: "",
    venue: "",
    price: "",
    priceNote: "",
    hook: "",
    intro: "",
    program: "",
    bring: "",
    importantHeading: "",
    important: "",
    weather: false,
    closing: "",
    esnType: "",
    esnObjectives: "",
  };
}

/** Any stored object → complete fields (unknown keys dropped, wrong types emptied). */
export function coerceFields(raw: unknown): DescriptionFields {
  const out = emptyFields();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const k of TEXT_FIELDS) if (typeof r[k] === "string") out[k] = r[k] as string;
  out.weather = r.weather === true || r.weather === "true";
  return out;
}

export function isDraftEmpty(d: DescriptionFields): boolean {
  return (["dateIso", "time", "venue", "price", "hook", "intro", "program", "bring", "closing"] as const).every((k) => !oneLine(d[k]));
}

/** True if two drafts differ in any field of the published text. */
export function draftsDiffer(a: DescriptionFields | null, b: DescriptionFields | null): boolean {
  if (!a || !b) return true;
  return CONTENT_FIELDS.some((f) => String(a[f] ?? "") !== String(b[f] ?? ""));
}

// ── Text helpers ────────────────────────────────────────────────────────────

export function oneLine(s: unknown): string {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Joins wrapped lines into one paragraph; keeps blank-line paragraph breaks. */
export function paragraph(s: unknown): string {
  return String(s ?? "")
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" ")
    )
    .filter(Boolean)
    .join("\n\n");
}

/** One bullet per line; strips bullets/numbering people type themselves. */
export function bullets(s: unknown): string[] {
  return String(s ?? "")
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/^\s*(?:[-*•·–—]|\d+[.)])\s*/, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);
}

export function hasEmoji(s: string): boolean {
  return /\p{Extended_Pictographic}/u.test(s);
}

export function countSentences(s: string): number {
  return paragraph(s)
    .split(/(?<=[.!?])\s+/)
    .filter((x) => x.trim()).length;
}

const pad2 = (n: number) => (n < 10 ? "0" : "") + n;

export function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Dates ───────────────────────────────────────────────────────────────────

export function formatLongDate(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return null;
  const [y, m, day] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${DAY_NAMES[dt.getUTCDay()]}, ${day} ${MONTH_NAMES[m - 1]} ${y}`;
}

// ── Field normalisers ───────────────────────────────────────────────────────

export type Normalised = { value: string; error?: undefined } | { error: string; value?: undefined };

/** Accepts 19:30, 19.30, 1930, 19h30, 7:30pm, 19 Uhr, ranges like 19:30-22:00; TBA. */
export function normalizeTime(raw: string): Normalised {
  const s = oneLine(raw);
  if (!s) return { error: "Please enter a time, e.g. 19:30." };
  if (/^(tba|tbd|tbc|to be announced)$/i.test(s)) return { value: "TBA" };
  const parts = s.split(/\s*(?:–|—|-|\bto\b|\bbis\b|\buntil\b)\s*/i).filter(Boolean);
  const times = parts.length <= 2 ? parts.map(parseClock) : [null];
  if (times.some((t) => !t)) {
    return { error: `"${s}" is not a valid time – use the 24-hour clock, e.g. 19:30 (or 19:30–22:00).` };
  }
  return { value: times.join(" – ") };
}

function parseClock(p: string): string | null {
  let s = p
    .trim()
    .toLowerCase()
    .replace(/\s*(uhr|h|o'?clock)$/, "");
  let ampm: string | null = null;
  const ap = s.match(/\s*([ap])\.?\s*m\.?$/);
  if (ap) {
    ampm = ap[1];
    s = s.slice(0, ap.index);
  }
  const m = s.match(/^(\d{1,2})(?:[:.h]?(\d{2}))?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (ampm) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ampm === "p" ? 12 : 0);
  }
  if (h > 23 || min > 59) return null;
  return `${pad2(h)}:${pad2(min)}`;
}

export function isTbaPrice(raw: string): boolean {
  return /^(tba|tbd|tbc|to be announced|\?+)$/i.test(oneLine(raw));
}

/** 9,5 / €9.50 / 9.50 EUR → "€ 9.50"; 0 / free → "FREE"; tba → "TBA"; optional note in brackets. */
export function formatPrice(raw: string, note: string): Normalised {
  const s = oneLine(raw);
  if (!s) return { error: "Please enter a price, e.g. 9.50 – or FREE (or TBA if it is not fixed yet)." };
  let value: string;
  if (isTbaPrice(s)) {
    value = "TBA";
  } else if (/^(for )?(free|gratis|kostenlos)$/i.test(s)) {
    value = "FREE";
  } else {
    const num = s
      .replace(/€|\beur(os?)?\b/gi, "")
      .replace(/\s+/g, "")
      .replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(num)) {
      return { error: `"${s}" is not a valid price. Enter just the amount (e.g. 9.50), FREE or TBA – put extra details into the price note.` };
    }
    const n = Number(num);
    value = n === 0 ? "FREE" : `€ ${n.toFixed(2)}`;
  }
  const extra = oneLine(note).replace(/^\((.*)\)$/, "$1");
  return { value: extra ? `${value} (${extra})` : value };
}

/** "Are you ready for a night at the museum?! 🎉" → "a night at the museum" */
export function normalizeHook(s: string): string {
  return oneLine(s)
    .replace(/^are you ready for\s+/i, "")
    .replace(/[\s?!.🎉]+$/u, "");
}

/** "We can't wait to see you there! ✨" → "see you there!" */
export function normalizeClosing(s: string): string {
  return oneLine(s)
    .replace(/^we can[’']?t wait to\s+/i, "")
    .replace(/[\s.✨]+$/u, "");
}

export function importantHeading(d: DescriptionFields): string {
  return (
    oneLine(d.importantHeading)
      .replace(/^⚠️?\s*/u, "")
      .toUpperCase() || CONFIG.DEFAULT_IMPORTANT_HEADING
  );
}

// ── ESN Activities classification (src/Esn.gs) ──────────────────────────────

export const ESN_TYPES = [
  { id: "10", label: "Game or social activity", objectives: ["413", "426"] },
  { id: "442", label: "Party (responsible party)", objectives: ["413", "418"] },
  { id: "441", label: "International dinner", objectives: ["413", "407"] },
  { id: "31", label: "Sport & outdoor", objectives: ["422", "413"] },
  { id: "438", label: "Tour or visit (city tour, museum …)", objectives: ["424", "426"] },
  { id: "9", label: "Trip or excursion (outside the city)", objectives: ["424", "425", "428"] },
  { id: "13", label: "Workshop / capacity building", objectives: ["412", "423"] },
  { id: "11", label: "Seminar, debate or panel", objectives: ["412", "411"] },
  { id: "439", label: "Volunteering", objectives: ["410", "426"] },
  { id: "12", label: "Mobility fair / info day", objectives: ["420", "411"] },
  { id: "440", label: "Career / job fair", objectives: ["409", "423"] },
  { id: "14", label: "Mapping of university facilities", objectives: ["417", "408"] },
] as const;

export const ESN_OBJECTIVES: ReadonlyArray<readonly [string, string]> = [
  ["413", "Foster Intercultural Dialogue"],
  ["426", "Social and Cultural Integration in Local Community"],
  ["407", "Counter Stereotypes & Embrace Cultural Differences"],
  ["424", "Showcase Cultural Heritage"],
  ["425", "Showcase Natural Heritage"],
  ["422", "Physical Health & Well-Being"],
  ["418", "Mental Health & Well-Being"],
  ["427", "Support Language Learning"],
  ["412", "Foster Experiential Learning (NFE)"],
  ["423", "Recognition of Skills"],
  ["428", "Slow and Sustainable Tourism"],
  ["411", "Foster Europe and European Citizenship"],
  ["410", "Foster Active Citizenship & Volunteering"],
  ["420", "Promotion of Participation in Student Mobility"],
  ["409", "Entrepreneurship & Career Development"],
  ["408", "Diversity and Inclusion of Minority Groups"],
  ["417", "Inclusive Education"],
  ["416", "Gender Equality"],
  ["414", "Foster LGBTQ+ Rights"],
  ["429", "Youth Rights and Democratic Participation"],
  ["421", "Post-Mobility Reintegration"],
  ["1024", "Fostering Responsible Consumption"],
  ["1025", "Fostering Circular Economy"],
  ["1026", "Encouraging Energy Efficiency"],
  ["1027", "Fighting Climate Crisis"],
  ["1028", "Boosting Urban Nature"],
  ["1029", "Encouraging Wildlife Protection"],
  ["1030", "Encouraging Slow Food"],
  ["415", "Reducing Waste and Promoting Recycling"],
  ["419", "Protecting Nature and Promoting Biodiversity"],
];

export function esnType(id: string) {
  return ESN_TYPES.find((t) => t.id === String(id || "")) ?? null;
}

export function esnObjectiveIds(d: Pick<DescriptionFields, "esnObjectives">): string[] {
  return String(d.esnObjectives || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** After the type changed: objectives that are empty or still the old type's defaults follow the new type. */
export function applyEsnDefaults(d: DescriptionFields, previousType: string): DescriptionFields {
  const type = esnType(d.esnType);
  if (!type) return d;
  const prev = esnType(previousType);
  const current = esnObjectiveIds(d).join(",");
  if (!current || (prev && current === prev.objectives.join(","))) return { ...d, esnObjectives: type.objectives.join(",") };
  return d;
}

export function validateEsn(d: DescriptionFields): string[] {
  const errors: string[] = [];
  if (!esnType(d.esnType)) errors.push("Pick the ESN activity type (needed for ESN Activities).");
  if (!esnObjectiveIds(d).length) errors.push("Pick at least one ESN objective.");
  return errors;
}

// ── Validation ──────────────────────────────────────────────────────────────

export interface StepValidation {
  errors: string[];
  warnings: string[];
}

/** Errors block submitting; warnings are only shown. */
export function validateStep(d: DescriptionFields, step: StepId, todayIso?: string): StepValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const required = (v: string, msg: string) => {
    if (!oneLine(v)) errors.push(msg);
  };

  switch (step) {
    case "basics": {
      required(d.title, "The event name is missing.");
      if (!formatLongDate(d.dateIso)) errors.push("Pick the event date.");
      else if (todayIso && d.dateIso < todayIso) warnings.push("The event date is in the past.");
      const time = normalizeTime(d.time);
      if (time.error) errors.push(time.error);
      else if (time.value === "TBA") warnings.push('The time is still "TBA" – update it once it is fixed.');
      required(d.venue, "The venue is missing.");
      const price = formatPrice(d.price, d.priceNote);
      if (price.error) errors.push(price.error);
      else if (isTbaPrice(d.price)) warnings.push('The price is still "TBA" – add it with a later edit.');
      break;
    }
    case "intro": {
      required(d.hook, 'Add a short hook ("Are you ready for …?").');
      if (normalizeHook(d.hook).length > 90) warnings.push("The hook is quite long – keep it short and catchy.");
      if (!paragraph(d.intro)) {
        errors.push("Describe the event in 2–4 sentences.");
      } else {
        const n = countSentences(d.intro);
        const { min, max } = CONFIG.INTRO_SENTENCES;
        if (n < min || n > max) warnings.push(`The intro has ${n} sentence(s) – the template asks for ${min}–${max}.`);
      }
      break;
    }
    case "program": {
      const program = bullets(d.program);
      const bring = bullets(d.bring);
      if (!program.length) errors.push('Add at least one point to "What does the event look like?".');
      if (!bring.length) errors.push('Add at least one item to "What should I bring?" (e.g. "Good mood 😄").');
      if (program.length > CONFIG.MAX_BULLETS || bring.length > CONFIG.MAX_BULLETS) {
        warnings.push(`Try to keep lists at ${CONFIG.MAX_BULLETS} bullet points or fewer.`);
      }
      if (bring.some((i) => !hasEmoji(i))) warnings.push('Tip: end every "What should I bring?" item with a fitting emoji, e.g. "Water 💧".');
      break;
    }
    case "extras": {
      required(d.closing, "Finish the closing sentence “We can’t wait to …”.");
      errors.push(...validateEsn(d));
      if (oneLine(d.importantHeading) && !bullets(d.important).length) {
        warnings.push("The important-info heading has no bullet points, so that section is left out.");
      }
      break;
    }
  }
  // Hard limit for the whole description, checked on every text step.
  if (step === "intro" || step === "program" || step === "extras") {
    const tooLong = lengthError(d);
    if (tooLong) errors.push(tooLong);
  }
  return { errors, warnings };
}

export interface FullValidation {
  ok: boolean;
  errors: Record<StepId, string[]>;
  warnings: string[];
  firstInvalid: StepId | null;
}

export function validateAll(d: DescriptionFields, todayIso?: string): FullValidation {
  const errors = {} as Record<StepId, string[]>;
  const warnings: string[] = [];
  for (const s of STEP_IDS) {
    const v = validateStep(d, s, todayIso);
    errors[s] = v.errors;
    warnings.push(...v.warnings);
  }
  const firstInvalid = STEP_IDS.find((s) => errors[s].length) ?? null;
  return { ok: !firstInvalid, errors, warnings, firstInvalid };
}

// ── Rendering ───────────────────────────────────────────────────────────────

export interface Line {
  text: string;
  bold: boolean;
}

export interface Rendered {
  /** Plain text */
  plain: string;
  /** [start, end) ranges of bold text in `plain` */
  bold: Array<[number, number]>;
  /** Google Chat markup (*bold*) – what gets posted, and what the limit counts */
  chat: string;
  /** For the live preview */
  html: string;
  /** Telegram Bot API HTML */
  telegram: string;
  /** pretix Markdown */
  markdown: string;
}

/** Renders the template. Missing parts become [PLACEHOLDERS] so the preview always works. */
export function renderDescription(d: DescriptionFields): Rendered {
  const lines: Line[] = [];
  const add = (text: string, bold = false) => lines.push({ text, bold });
  const gap = () => add("");
  const list = (items: string[], placeholder?: string) => (items.length ? items : placeholder ? [placeholder] : []).forEach((i) => add(`${CONFIG.BULLET} ${i}`));

  add(`🗓️ ${formatLongDate(d.dateIso) || "[DAY], [DATE] [MONTH] [YEAR]"}`);
  add(`⏰ ${normalizeTime(d.time).value || "[TIME]"}`);
  add(`📍 ${oneLine(d.venue) || "[VENUE]"}`);
  add(`💸 ${formatPrice(d.price, d.priceNote).value || "[PRICE]"}`);
  gap();
  add("Dear Internationals,", true);
  gap();
  add(`Are you ready for ${normalizeHook(d.hook) || "[EXCITING HOOK]"}? 🎉`);
  gap();
  add(paragraph(d.intro) || "[2–4 SENTENCES DESCRIBING THE EVENT]");
  gap();
  add("🤔 WHAT DOES THE EVENT LOOK LIKE?", true);
  gap();
  list(bullets(d.program), "[WHAT WILL HAPPEN?]");
  gap();
  add("🎒 WHAT SHOULD I BRING?", true);
  gap();
  list(bullets(d.bring), "[ITEM]");

  const important = bullets(d.important);
  if (important.length) {
    gap();
    add(`⚠️ ${importantHeading(d)}`, true);
    gap();
    list(important);
  }
  if (d.weather === true) {
    gap();
    add(CONFIG.WEATHER_NOTE);
  }
  gap();
  add(`We can’t wait to ${normalizeClosing(d.closing) || "[FUN EVENT-SPECIFIC SENTENCE]"} ✨`);
  gap();
  CONFIG.SIGNATURE.forEach((s) => add(s));

  return renderLines(lines);
}

export function renderLines(lines: Line[]): Rendered {
  let plain = "";
  let markdown = "";
  const bold: Array<[number, number]> = [];
  const chat: string[] = [];
  const html: string[] = [];
  lines.forEach((l, i) => {
    const b = l.bold && l.text;
    if (i) plain += "\n";
    if (b) bold.push([plain.length, plain.length + l.text.length]);
    plain += l.text;
    chat.push(b ? `*${l.text}*` : l.text);
    html.push(b ? `<b>${escapeHtml(l.text)}</b>` : escapeHtml(l.text));
    const md = l.text.replace(/([\\`*_[\]#<>|])/g, "\\$1");
    if (i) markdown += l.text && lines[i - 1].text ? "  \n" : "\n";
    markdown += b ? `**${md}**` : md;
  });
  return {
    plain,
    bold,
    chat: chat.join("\n"),
    html: html.join("<br>").replace(/\n/g, "<br>"),
    telegram: html.join("\n"),
    markdown,
  };
}

/** What counts against CONFIG.MAX_CHARS: the Chat message as posted (incl. *bold* markers). */
export function descriptionLength(d: DescriptionFields): number {
  return renderDescription(d).chat.length;
}

export function formatCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function lengthError(d: DescriptionFields): string | null {
  const n = descriptionLength(d);
  return n > CONFIG.MAX_CHARS
    ? `The description is ${formatCount(n)} characters long – the maximum is ${formatCount(CONFIG.MAX_CHARS)}. ` +
        `Please shorten it by ${formatCount(n - CONFIG.MAX_CHARS)} characters.`
    : null;
}

/** "€ 9.50 (ESNcard € 7.50)" → { price, priceNote }. */
export function splitPriceText(text: string): { price: string; priceNote: string } {
  const s = oneLine(text);
  const m = s.match(/^(.*?)\s*\((.*)\)$/);
  return m ? { price: m[1], priceNote: m[2] } : { price: s, priceNote: "" };
}

/** A template from an earlier event: everything but the date (as the bot's "Use"). */
export function fromTemplate(template: DescriptionFields, current: DescriptionFields): DescriptionFields {
  return { ...template, dateIso: current.dateIso, title: current.title || template.title };
}
