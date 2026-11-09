// The staging demo data (`npm run seed:staging`, `npm run staging:reset`,
// Admin → "Reset demo data"): about 40 fictional members and 35 events over
// fifteen planning cycles relative to today – twelve done months (nine of
// them short archive months, so every month of the year has one), the current
// month (events today, hand-ins open), next month (form closed, roster being
// adjusted) and the month after (volunteer form open) – with every status
// the workflow knows. Deterministic: a fixed random seed and fixed ids, only
// the dates move with today. docs/STAGING.md describes what is where.
//
// seedStaging() replaces its own earlier data (and the local demo seed's,
// whose months it takes over); resetStagingData() wipes the whole database
// first (public.staging_wipe(), demo databases only). Both need the
// database to be marked as a demo database (migration
// 20261029005000_staging_demo.sql); the callers check the app's staging
// gates (lib/staging.ts) or that the target is the local stack.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { CHAT_SPACE_ROLES, type AppRole } from "@/lib/roles";
import { addMonths, berlinDate, berlinInputToIso, monthOf } from "@/lib/dates";
import { renderDescription, emptyFields, type DescriptionFields } from "@/lib/description/template";
import { suggestAmount, type ClaimStatus, type ExpenseKind, type Rule } from "@/lib/reimbursement";
import { allocate, type AllocationChoice, type Rank } from "@/lib/allocation";
import {
  esnUploadedMessage,
  eventStatusMessage,
  photoStartMessage,
  photoUploadMessage,
  publishedPost,
  remindOcMessage,
  rosterMessage,
  spaceDescription,
  spaceDisplayName,
  spaceGuidelines,
  welcomeMessage,
  type SpacePerson,
} from "@/lib/chatMessages";
import { chatMessageId } from "@/lib/google/chat";
import { FAKE_DRIVE_ROOT } from "@/lib/google/fakes";
import { driveFolderUrl, photoFolderPath } from "@/lib/photos";
import { NOTICE_VERSION, TERMS_VERSION } from "@/lib/legal";
import { DEMO_PEOPLE, demoEmail, person, type DemoPerson } from "@/lib/staging/people";
import { demoPassword } from "@/lib/staging/password";
import { importArchive } from "@/scripts/bot-archive.mjs";
import { applySuggestedSorting } from "@/lib/formatsApply";
import { eventMessage } from "@/lib/telegram/messages";
import { regularPosts } from "@/lib/publishing";
import { EVENTS, FIRST_NAMES, LAST_NAMES, NATIONALITIES, PROGRAMS, UNIVERSITIES, type EventKey, type EventType } from "@/lib/staging/content";
import { removeInternalStaging, seedInternalStaging, type InternalSummary } from "@/lib/staging/internal";

type Db = SupabaseClient<Database>;
type EventStatus = Database["public"]["Enums"]["event_status"];
type DescriptionStage = "none" | "draft" | "changes_requested" | "submitted" | "approved" | "published";

export interface SeedOptions {
  serviceRoleKey: string;
  /** Links in Chat messages (APP_BASE_URL). */
  baseUrl: string;
  domain?: string;
  now?: Date;
  /** The configured role groups (GROUP_*): the fake directory gets the demo teams. */
  groups?: Partial<Record<AppRole, string>>;
  /** The photo drive's root folder (DRIVE_PHOTOS_FOLDER_ID, else the fake's root). */
  driveRoot?: string;
  log?: (line: string) => void;
}

export interface SeedSummary {
  people: number;
  cycles: Record<string, string>;
  events: number;
  /** Imported bot-archive events ("Get inspired"). */
  history: number;
  eventStatuses: Record<string, number>;
  descriptionStages: Record<string, number>;
  claimStatuses: Record<string, number>;
  ideaStatuses: Record<string, number>;
  /** Internal events, cash reports and the ledger (lib/staging/internal.ts). */
  internal: InternalSummary;
  removed: number;
}

/** created_by of the seed's cycles and events – how a re-run finds its own data. */
export const stagingTag = (domain: string) => `staging-seed.demo@${domain}`;
/** The tag of the former small local demo seed (removed 2026-11-01): what it left in a local database goes. */
const DEMO_SEED_TAG = "demo@esnmesa.org";

// ── Deterministic randomness ────────────────────────────────────────────────
class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    // mulberry32
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length)]!;
  }
  hex(n: number): string {
    let s = "";
    while (s.length < n) s += Math.floor(this.next() * 16).toString(16);
    return s;
  }
  uuid(): string {
    const h = this.hex(32);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${"89ab"[parseInt(h[16]!, 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }
}

const SEED = 20261029;
/** The seed's event folders in the fake photo drive (semester folders are shared and stay). */
const EVENT_FOLDER_PREFIX = "fakefolder-demoev-";
/** The fake Telegram channel (lib/telegram, without TELEGRAM_CHAT_ID) and the seed's message ids in it. */
const TELEGRAM_CHAT = "@mesa_fake_channel";
const TELEGRAM_IDS = [90_000, 90_999] as const;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The data of a successful request (selects return rows; writes without a select return nothing). */
function check<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`Staging seed – ${what}: ${res.error.message}`);
  return res.data as NonNullable<T>;
}
const json = (v: unknown) => v as NonNullable<Json>;

const iso = (ms: number) => new Date(ms).toISOString();
const daysIn = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
};
/** Berlin wall clock → ISO. */
const at = (month: string, day: number, time: string) => berlinInputToIso(`${month.slice(0, 8)}${String(day).padStart(2, "0")}T${time}`);
/** "yyyy-MM-dd" + n days. */
const plusDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

// ── The plan ────────────────────────────────────────────────────────────────
interface Dropout {
  who: string;
  role: "oc" | "helper";
  reason: string;
  /** Days before the start. */
  before: number;
  replacedBy?: string;
}

interface ClaimSpec {
  who: string;
  kind: ExpenseKind;
  vendor: string;
  amount: number;
  status: ClaimStatus;
  days?: number;
  payout?: "bank" | "paypal";
  /** Paid at once instead of in the monthly batch. */
  early?: boolean;
  reject?: string;
  /** Finance's amount when it differs from the suggestion. */
  approved?: number;
  note?: string;
  description?: string;
}

interface Spec {
  key: string;
  plan: EventKey;
  /** Months from the current one (-12 … -4: the archive months, ARCHIVE). */
  cycle: number;
  /** Day of the cycle's month … */
  day?: number;
  /** … or days from today (current month; kept inside it where possible). */
  offset?: number;
  /** Started this many minutes ago (happening now). */
  startedMinutesAgo?: number;
  time?: string;
  status?: EventStatus;
  oc?: string;
  helpers?: string[];
  dropouts?: Dropout[];
  decision?: boolean;
  cancel?: { reason: string; before: number; noted?: boolean };
  description?: DescriptionStage;
  review?: string;
  attendance?: { count: number; signedOff?: boolean; kiosk?: number };
  photos?: number;
  report?: boolean;
  esn?: "script" | "manual";
  claims?: ClaimSpec[];
  idea?: { proposer: string; wantsOc?: boolean };
  remindedOc?: boolean;
}

// Past cycles: everything done – published, signed off, photos, report, on ESN
// Activities, claims paid (one rejected).
const PAST: Spec[] = [
  {
    key: "beerGarden", plan: "beerGarden", cycle: -3, day: 4, oc: "tomasz", helpers: ["aisha", "hamza"], description: "published",
    attendance: { count: 46, signedOff: true, kiosk: 6 }, photos: 38, report: true, esn: "script",
    claims: [{ who: "tomasz", kind: "ancillary", vendor: "Edeka Schwabing (pretzels)", amount: 2340, status: "paid", payout: "paypal" }],
  },
  {
    key: "neuschwanstein", plan: "neuschwanstein", cycle: -3, day: 11, oc: "diego", helpers: ["chloe", "oskar"], description: "published",
    attendance: { count: 41, signedOff: true }, photos: 112, report: true, esn: "script",
    claims: [
      { who: "diego", kind: "food_allowance", vendor: "Schlossrestaurant Neuschwanstein", amount: 1890, status: "paid", payout: "bank" },
      { who: "chloe", kind: "food_allowance", vendor: "Bäckerei Füssen", amount: 1240, status: "paid", payout: "paypal" },
      { who: "oskar", kind: "food_allowance", vendor: "Kiosk Marienbrücke", amount: 950, status: "rejected", payout: "bank", reject: "No valid Beleg: a card slip without the vendor's name and VAT number." },
    ],
  },
  {
    key: "constance", plan: "constance", cycle: -3, day: 18, oc: "chloe", helpers: ["diego", "zeynep"], description: "published",
    attendance: { count: 28, signedOff: true }, photos: 164, report: true, esn: "manual", idea: { proposer: "chloe", wantsOc: true },
    claims: [
      { who: "chloe", kind: "travel_accommodation", vendor: "DB Fernverkehr + Hostel Lindau", amount: 18450, status: "paid", payout: "bank", early: true },
      { who: "zeynep", kind: "travel_accommodation", vendor: "DB Fernverkehr", amount: 16200, status: "paid", payout: "bank" },
      { who: "chloe", kind: "further_expenses", vendor: "Zeppelin Museum (group ticket)", amount: 9600, status: "paid", payout: "bank", description: "Museum tickets for the team, pre-approved" },
      { who: "diego", kind: "social_ancillary", vendor: "Pizzeria Lindau (welcome dinner)", amount: 4500, status: "paid", payout: "paypal" },
      { who: "zeynep", kind: "food_allowance", vendor: "Several (3 days)", amount: 3100, days: 3, status: "paid", payout: "bank" },
    ],
  },
  {
    key: "potluck", plan: "potluck", cycle: -3, day: 25, oc: "ingrid", helpers: ["lea", "rafael"], description: "published",
    attendance: { count: 52, signedOff: true, kiosk: 12 }, photos: 47, report: true, esn: "script",
    claims: [{ who: "ingrid", kind: "ancillary", vendor: "Metro Cash & Carry (plates, drinks)", amount: 4670, status: "paid", payout: "bank" }],
  },
  {
    key: "sunsetPicnic", plan: "sunsetPicnic", cycle: -2, day: 6, oc: "hamza", helpers: ["mei", "hannah"], description: "published",
    attendance: { count: 33, signedOff: true }, photos: 29, report: true, esn: "script",
  },
  {
    key: "salzburg", plan: "salzburg", cycle: -2, day: 13, oc: "tomasz", helpers: ["anna", "yusuf", "camila"], description: "published",
    attendance: { count: 47, signedOff: true }, photos: 96, report: true, esn: "script",
    claims: [
      { who: "tomasz", kind: "food_allowance", vendor: "Café Tomaselli", amount: 1450, status: "paid", payout: "paypal" },
      { who: "anna", kind: "food_allowance", vendor: "Nordsee Salzburg", amount: 1020, status: "paid", payout: "bank" },
      { who: "camila", kind: "food_allowance", vendor: "Spar Getreidegasse", amount: 640, status: "paid", payout: "paypal" },
    ],
  },
  {
    key: "museumNight", plan: "museumNight", cycle: -2, day: 20, oc: "felix", helpers: ["ana"], description: "published",
    attendance: { count: 34, signedOff: true }, photos: 21, report: true, esn: "manual",
    claims: [
      { who: "felix", kind: "ticket", vendor: "Deutsches Museum", amount: 1400, status: "paid", payout: "bank" },
      { who: "ana", kind: "ticket", vendor: "Deutsches Museum", amount: 1400, status: "paid", payout: "bank" },
    ],
  },
  // Nobody signed up: dropped at the roster confirmation.
  { key: "cookingClass", plan: "cookingClass", cycle: -2, day: 27, status: "dropped", description: "none" },
  {
    key: "welcomeBrunch", plan: "welcomeBrunch", cycle: -1, day: 5, oc: "chloe", helpers: ["liam", "sara"], description: "published",
    attendance: { count: 39, signedOff: true, kiosk: 9 }, photos: 44, report: true, esn: "script",
    claims: [{ who: "chloe", kind: "ticket", vendor: "Café Kosmos", amount: 800, status: "paid", payout: "bank" }],
  },
  {
    key: "kampenwand", plan: "kampenwand", cycle: -1, day: 13, oc: "oskar", helpers: ["emil", "fatima"], description: "published",
    attendance: { count: 27, signedOff: true }, photos: 58, report: true, esn: "script",
    claims: [{ who: "oskar", kind: "food_allowance", vendor: "Steinlingalm", amount: 1680, status: "paid", payout: "bank" }],
  },
  // Cancelled for the weather; Comms handled the published post.
  {
    key: "rafting", plan: "rafting", cycle: -1, day: 16, oc: "diego", helpers: ["nikos", "pedro"], description: "published", status: "cancelled",
    cancel: { reason: "Storm warning for the Isar valley – the rafting company called it off.", before: 1, noted: true },
  },
  {
    key: "oktoberfest", plan: "oktoberfest", cycle: -1, day: 22, oc: "diego", helpers: ["arjun", "giulia", "nikos"], description: "published",
    attendance: { count: 58, signedOff: true }, photos: 131, report: true, esn: "script",
    claims: [{ who: "diego", kind: "ancillary", vendor: "Festzelt Tradition (table deposit)", amount: 15000, status: "paid", payout: "bank", early: true }],
  },
  {
    key: "vienna", plan: "vienna", cycle: -1, day: 25, oc: "tomasz", helpers: ["isabel", "thanh"], description: "published",
    attendance: { count: 33, signedOff: true }, photos: 140, report: true, esn: "manual",
    claims: [
      { who: "tomasz", kind: "travel_accommodation", vendor: "FlixBus + Wombat's Hostel", amount: 12400, status: "paid", payout: "paypal" },
      { who: "isabel", kind: "travel_accommodation", vendor: "FlixBus + Wombat's Hostel", amount: 12400, status: "paid", payout: "bank" },
      { who: "thanh", kind: "food_allowance", vendor: "Naschmarkt (3 days)", amount: 2900, days: 3, status: "paid", payout: "bank" },
      { who: "tomasz", kind: "social_ancillary", vendor: "Prater (group game)", amount: 6000, status: "paid", payout: "paypal" },
    ],
  },
];

// The archive months (2026-11-08): a done cycle for each of the nine months
// before the three past ones, so the Events team's month list covers every
// month of the year. Three events each, all handed in (published, signed
// off, photos, report, on ESN Activities), no claims – the finance demo stays
// in the recent months. Plans that fit any season, rotated; OC and helpers
// rotated over the regular volunteers.
export const ARCHIVE_MONTHS = [-12, -11, -10, -9, -8, -7, -6, -5, -4] as const;
const ARCHIVE_PLANS: EventKey[] = ["pubQuiz", "museumNight", "languageCafe", "salzburg", "boardGames", "karaoke", "bouldering", "nuremberg", "movieNight", "escapeRoom", "swing", "photoWalk", "stammtisch", "cityRally", "prague", "potluck", "volleyball", "vienna"];
const ARCHIVE_CREW = ["tomasz", "chloe", "diego", "oskar", "ingrid", "hamza", "felix", "isabel", "lea", "giulia", "kwame", "zeynep", "anna", "emil", "sara", "liam", "arjun", "mei"];
const ARCHIVE: Spec[] = ARCHIVE_MONTHS.flatMap((k, m) =>
  [0, 1, 2].map((j): Spec => {
    const n = m * 3 + j;
    const crew = (i: number) => ARCHIVE_CREW[(n * 2 + i) % ARCHIVE_CREW.length]!;
    return {
      key: `archive${-k}_${j}`, plan: ARCHIVE_PLANS[n % ARCHIVE_PLANS.length]!, cycle: k, day: 6 + j * 8,
      oc: crew(0), helpers: [crew(1), crew(5)], description: "published",
      attendance: { count: 18 + ((n * 7) % 35), signedOff: true }, photos: 12 + ((n * 13) % 90), report: true, esn: n % 4 === 3 ? "manual" : "script",
    };
  })
);

// The current month: done events with hand-ins open, two events today, the
// next days with every staffing and description situation.
const CURRENT: Spec[] = [
  {
    key: "pubQuiz", plan: "pubQuiz", cycle: 0, offset: -9, oc: "tomasz", helpers: ["kwame", "giulia"], description: "published",
    attendance: { count: 54, signedOff: true }, photos: 26, report: true, esn: "script",
    claims: [
      { who: "tomasz", kind: "ticket", vendor: "Shamrock Irish Pub", amount: 500, status: "checked", payout: "paypal" },
      { who: "kwame", kind: "ticket", vendor: "Shamrock Irish Pub", amount: 500, status: "checked", payout: "bank" },
    ],
  },
  {
    // Hand-in open: no photos in the folder yet, a Beleg not in. Report done → ready for ESN Activities.
    key: "languageCafePast", plan: "languageCafe", cycle: 0, offset: -6, oc: "chloe", helpers: ["lea"], description: "published",
    attendance: { count: 18, signedOff: true }, photos: 0, report: true,
    claims: [{ who: "chloe", kind: "ancillary", vendor: "Café Puck (name tags, snacks)", amount: 1890, status: "beleg_received", payout: "bank" }],
  },
  {
    // No event report yet: ESN Activities "not ready". Belege missing.
    key: "bouldering", plan: "bouldering", cycle: 0, offset: -4, oc: "diego", helpers: ["chloe", "marta"], description: "published",
    attendance: { count: 22, signedOff: true }, photos: 17,
    claims: [
      { who: "diego", kind: "ticket", vendor: "Boulderwelt München Ost", amount: 1450, status: "not_submitted", payout: "paypal" },
      { who: "chloe", kind: "ticket", vendor: "Boulderwelt München Ost", amount: 1450, status: "not_submitted" },
      { who: "marta", kind: "ticket", vendor: "Boulderwelt München Ost", amount: 1450, status: "beleg_received", payout: "bank" },
    ],
  },
  {
    // The attendance list still needs the OC's sign-off.
    key: "tegernsee", plan: "tegernsee", cycle: 0, offset: -2, oc: "chloe", helpers: ["kwame", "hiro"], description: "published",
    attendance: { count: 36, signedOff: false }, photos: 31,
    claims: [
      { who: "chloe", kind: "food_allowance", vendor: "Herzogliches Bräustüberl", amount: 1720, status: "not_submitted", payout: "bank" },
      { who: "kwame", kind: "food_allowance", vendor: "Herzogliches Bräustüberl", amount: 990, status: "beleg_received", payout: "bank" },
    ],
  },
  {
    // Missed: it happened without any description.
    key: "karaoke", plan: "karaoke", cycle: 0, offset: -1, oc: "isabel", helpers: ["thanh"], description: "none",
    attendance: { count: 29, signedOff: true }, photos: 12,
  },
  {
    // Happening right now: the attendance list is open.
    key: "languageCafeNow", plan: "languageCafe", cycle: 0, offset: 0, startedMinutesAgo: 40, oc: "chloe", helpers: ["kwame"], description: "published",
    attendance: { count: 11, signedOff: false, kiosk: 3 },
  },
  { key: "movieNight", plan: "movieNight", cycle: 0, offset: 0, time: "20:00", oc: "sofia", helpers: ["rafael", "ana"], description: "published" },
  {
    // Short of a helper; the OC decided to run it anyway. Approved, not yet published (late).
    key: "boardGames", plan: "boardGames", cycle: 0, offset: 1, oc: "hamza", helpers: ["yusuf", "kwame"], decision: true, description: "approved",
    dropouts: [{ who: "kwame", role: "helper", reason: "My exam was moved to the next morning, sorry!", before: 3 }],
  },
  {
    // A helper dropped out and someone claimed the open slot.
    key: "pubCrawl", plan: "pubCrawl", cycle: 0, offset: 2, oc: "chloe", helpers: ["giulia", "camila", "arjun"], description: "published",
    dropouts: [{ who: "camila", role: "helper", reason: "Caught a cold.", before: 4, replacedBy: "kwame" }],
  },
  {
    // Under-staffed and waiting for the OC's decision; the description came in late (Comms reminded the OC).
    // Not a draft: the month's deadline has passed, and pg_cron cancels events never submitted by then.
    key: "iceSkating", plan: "iceSkating", cycle: 0, offset: 3, oc: "oskar", helpers: ["marta", "emil"], description: "submitted", remindedOc: true,
    dropouts: [{ who: "marta", role: "helper", reason: "Sprained my ankle at bouldering.", before: 2 }],
  },
  // The OC persona's own coming events: one waiting for Comms, one sent back with changes.
  { key: "photoWalk", plan: "photoWalk", cycle: 0, offset: 3, oc: "chloe", helpers: ["kwame"], description: "submitted" },
  {
    key: "erasmusTalk", plan: "erasmusTalk", cycle: 0, offset: 5, oc: "chloe", helpers: ["lea"], description: "changes_requested",
    review: "Nice idea! Please name the four panelists and say that the talk is in English – then it can go out.",
  },
  {
    // Cancelled after the description went out; Comms has not marked it handled. Events can reopen it.
    key: "brunchMarket", plan: "brunchMarket", cycle: 0, offset: 4, time: "11:00", oc: "ingrid", helpers: ["lea"], description: "published", status: "cancelled",
    cancel: { reason: "The café cancelled our group booking.", before: 0 },
  },
];

// Next month: form closed, allocated, the Events team adjusting the roster.
// Staffing comes from the volunteer answers through lib/allocation.ts.
interface FutureSpec extends Spec {
  /** [person, OC rank, helper rank] on the volunteer form. */
  answers: Array<[string, Rank | null, Rank | null]>;
}
const NEXT: FutureSpec[] = [
  { key: "stammtisch", plan: "stammtisch", cycle: 1, day: 5, description: "submitted", answers: [["felix", 1, null], ["liam", null, 1], ["sara", null, 3]] },
  { key: "nuremberg", plan: "nuremberg", cycle: 1, day: 8, description: "none", answers: [["oskar", 1, 3], ["emil", null, 1]] },
  {
    key: "swing", plan: "swing", cycle: 1, day: 12, description: "none", answers: [["isabel", null, 1], ["thanh", null, 4]],
  },
  { key: "escapeRoom", plan: "escapeRoom", cycle: 1, day: 14, description: "none", answers: [] },
  {
    key: "thanksgiving", plan: "thanksgiving", cycle: 1, day: 19, description: "changes_requested", idea: { proposer: "zeynep", wantsOc: true },
    review: "Lovely text! Two things: please add the exact address of the Amerika Haus, and say whether vegetarian dishes are welcome.",
    answers: [["zeynep", 1, null], ["aisha", null, 1], ["hiro", 3, 1], ["camila", null, 3]],
  },
  {
    key: "prague", plan: "prague", cycle: 1, day: 20, description: "draft",
    answers: [["tomasz", 1, 3], ["chloe", 2, 1], ["diego", 5, 1], ["fatima", null, 1], ["nikos", null, 3]],
  },
  {
    key: "christmasOpening", plan: "christmasMarket", cycle: 1, day: 26, description: "none",
    answers: [["giulia", 1, 1], ["kwame", 3, 1], ["pedro", null, 1], ["mateo", null, 5]],
  },
  // The OC persona's description still to write (next month: its deadline is ahead).
  { key: "cityRally", plan: "cityRally", cycle: 1, day: 16, description: "none", answers: [["chloe", 1, null], ["kwame", null, 1], ["giulia", null, 3], ["hiro", null, 1]] },
  { key: "cleanUp", plan: "cleanUp", cycle: 1, day: 22, description: "none", answers: [["ingrid", 1, 3], ["sara", null, 1]] },
];

// The month after: volunteer form open, ideas coming in.
const LATER: FutureSpec[] = [
  { key: "iceStock", plan: "iceStock", cycle: 2, day: 9, answers: [["felix", 1, 1], ["yusuf", null, 1]] },
  { key: "zugspitze", plan: "zugspitze", cycle: 2, day: 12, answers: [["oskar", 1, null], ["emil", null, 1], ["chloe", 5, 3]] },
  { key: "christmasDinner", plan: "christmasDinner", cycle: 2, day: 17, idea: { proposer: "lea", wantsOc: true }, answers: [["lea", 1, null], ["rafael", null, 1]] },
  { key: "uglySweater", plan: "uglySweater", cycle: 2, day: 19, answers: [["kwame", 3, 1], ["giulia", null, 1], ["tomasz", 1, null]] },
  { key: "volleyball", plan: "volleyball", cycle: 2, day: 4, answers: [["diego", 1, null], ["arjun", null, 1], ["mei", null, 3]] },
];

const IDEAS: Array<{ title: string; cycle: 1 | 2 | 3; day: number; proposer: string; pitch: string; helpers: number; wantsOc: boolean; status: "proposed" | "rejected" | "merged"; note?: string; mergedInto?: string }> = [
  { title: "Silent Disco in the Englischer Garten", cycle: 2, day: 6, proposer: "rafael", pitch: "Headphones for 60 people, three DJ channels. Works in winter too with a heated tent.", helpers: 3, wantsOc: true, status: "proposed" },
  { title: "Skydiving Day", cycle: 2, day: 13, proposer: "nikos", pitch: "Tandem jumps at the Gersthof airfield.", helpers: 2, wantsOc: true, status: "rejected", note: "Too expensive for most students, and our insurance does not cover it." },
  { title: "Glühwein Evening", cycle: 2, day: 19, proposer: "anna", pitch: "Mulled wine at a Christmas market, nothing else planned.", helpers: 1, wantsOc: false, status: "merged", note: "Merged into the Ugly Sweater Party – same evening, same idea.", mergedInto: "uglySweater" },
  { title: "Sledging at the Blomberg", cycle: 3, day: 10, proposer: "hannah", pitch: "The longest natural toboggan run near Munich, sledges for rent at the top.", helpers: 2, wantsOc: false, status: "proposed" },
  { title: "Thermal Spa Day in Erding", cycle: 3, day: 24, proposer: "hannah", pitch: "Group ticket for the Therme Erding – the biggest spa in Europe.", helpers: 2, wantsOc: false, status: "proposed" },
  { title: "Pancake Breakfast", cycle: 3, day: 17, proposer: "mei", pitch: "Sweet and savoury pancakes before the exam phase starts.", helpers: 2, wantsOc: true, status: "proposed" },
];

// History (bot archive): [event, years back, days shifted, international and local participants (0 = no report)].
const HISTORY: Array<[EventKey, number, number, number, number]> = [
  ["pubQuiz", 1, -12, 41, 6], ["pubQuiz", 1, 85, 37, 4], ["pubQuiz", 2, 3, 29, 3], ["languageCafe", 1, -3, 22, 5],
  ["languageCafe", 1, 60, 0, 0], ["boardGames", 1, 20, 33, 2], ["christmasMarket", 1, 40, 0, 0], ["salzburg", 1, -70, 44, 1],
  ["kampenwand", 2, -40, 25, 2], ["potluck", 1, 90, 56, 7], ["iceSkating", 2, 25, 19, 3], ["karaoke", 1, 110, 38, 4],
  ["neuschwanstein", 2, -90, 47, 0], ["museumNight", 1, -45, 31, 2],
];

// Official example IBANs (published by banks and registries for testing) only.
const IBANS = ["DE89370400440532013000", "DE02120300000000202051", "AT611904300234573201", "NL91ABNA0417164300", "FR1420041010050500013M02606", "ES9121000418450200051332"];

// ── Seeding ─────────────────────────────────────────────────────────────────
interface Built {
  spec: Spec;
  id: string;
  title: string;
  type: EventType;
  startsAt: string;
  endsAt: string | null;
  cycleMonth: string;
  status: EventStatus;
  space: string | null;
  oc: string | null;
  helpers: string[];
  assignments: Array<{ id: string; who: string; role: "oc" | "helper"; source: string; status: string; at: string; droppedAt?: string }>;
}

export async function seedStaging(db: Db, opts: SeedOptions): Promise<SeedSummary> {
  const domain = (opts.domain ?? "esnmesa.org").toLowerCase();
  const now = (opts.now ?? new Date()).getTime();
  const log = opts.log ?? (() => {});
  const rng = new Rng(SEED);
  const TAG = stagingTag(domain);
  const email = (key: string) => demoEmail(person(key), domain);
  const pid = (key: string) => person(key).id;
  const events = email("amara");
  const comms = [email("sofia"), email("kenji")];
  const finance = email("priya");
  const treasurer = email("mateo");
  const eventUrl = (id: string) => `${opts.baseUrl.replace(/\/+$/, "")}/events/${id}`;

  // 1. Members (the database refuses unless it is a demo database), who
  // accepted the confidentiality rules the database asks for.
  const rulesVersion = check(await db.rpc("confidentiality_version"), "confidentiality version");
  for (const p of DEMO_PEOPLE) {
    const mail = demoEmail(p, domain);
    check(await db.rpc("staging_upsert_demo_user", { user_id: p.id, user_email: mail, user_name: p.name, user_password: demoPassword(mail, opts.serviceRoleKey) }), `member ${mail}`);
  }
  check(
    await db.from("organiser_acknowledgements").upsert(
      DEMO_PEOPLE.filter((p) => !p.newcomer).map((p) => ({ email: demoEmail(p, domain), version: rulesVersion })),
      { onConflict: "email,version", ignoreDuplicates: true }
    ),
    "confidentiality rules"
  );
  check(await db.from("organiser_acknowledgements").delete().in("email", DEMO_PEOPLE.filter((p) => p.newcomer).map((p) => demoEmail(p, domain))), "newcomer");
  const roleRows = DEMO_PEOPLE.flatMap((p) => p.roles.map((role) => ({ email: demoEmail(p, domain), role, source: "group" })));
  check(await db.from("role_members").upsert(roleRows, { onConflict: "email,role,source", ignoreDuplicates: true }), "roles");
  const directory = Object.entries(opts.groups ?? {}).flatMap(([role, group]) =>
    DEMO_PEOPLE.filter((p) => p.roles.includes(role as AppRole) || (role === "finance" && p.roles.includes("treasurer"))).map((p) => ({ group_email: group!, member_email: demoEmail(p, domain) }))
  );
  if (directory.length) check(await db.from("fake_directory_members").upsert(directory, { onConflict: "group_email,member_email", ignoreDuplicates: true }), "fake directory");

  // 2. What an earlier run (or the local demo seed) left.
  const removed = await removeStagingData(db, domain);

  // 3. Cycles.
  const M = monthOf(iso(now));
  const months = new Map<number, string>([...ARCHIVE_MONTHS, -3, -2, -1, 0, 1, 2, 3].map((k) => [k, addMonths(M, k)]));
  const taken = check(await db.from("planning_cycles").select("month, created_by").in("month", [-3, -2, -1, 0, 1, 2].map((k) => months.get(k)!)), "months");
  if (taken.length) {
    throw new Error(`Staging seed: these months already have a planning cycle that the seed did not create: ${taken.map((t) => t.month).join(", ")}. Reset the demo data (npm run staging:reset) or remove them.`);
  }
  // An archive month someone planned for real (or another seed) keeps its cycle: the seed leaves it out.
  const archiveTaken = new Set(check(await db.from("planning_cycles").select("month").in("month", ARCHIVE_MONTHS.map((k) => months.get(k)!)), "archive months").map((t) => t.month));
  const archiveMonths = ARCHIVE_MONTHS.filter((k) => !archiveTaken.has(months.get(k)!));
  if (archiveTaken.size) log(`  Archive months with a cycle already, left out: ${[...archiveTaken].join(", ")}`);

  // When each event happens.
  const today = berlinDate(iso(now));
  const placed = (s: Spec): { start: string; month: number } => {
    const plan = EVENTS[s.plan];
    if (s.startedMinutesAgo !== undefined) return { start: iso(Math.floor((now - s.startedMinutesAgo * 60_000) / 60_000) * 60_000), month: 0 };
    if (s.day !== undefined) return { start: at(months.get(s.cycle)!, Math.min(s.day, daysIn(months.get(s.cycle)!)), s.time ?? plan.time), month: s.cycle };
    // Days from today, kept inside the current month while that keeps past
    // events in the past and coming ones ahead; otherwise in the neighbour month.
    const true_ = plusDays(today, s.offset!);
    const first = `${M.slice(0, 8)}01`;
    const last = `${M.slice(0, 8)}${daysIn(M)}`;
    const clamped = true_ < first ? first : true_ > last ? last : true_;
    const start = berlinInputToIso(`${clamped}T${s.time ?? plan.time}`);
    const ok = s.offset! < 0 ? Date.parse(start) < now - 3 * HOUR : s.offset! > 0 ? Date.parse(start) > now + HOUR : true;
    if (ok) return { start, month: 0 };
    return { start: berlinInputToIso(`${true_}T${s.time ?? plan.time}`), month: s.offset! < 0 ? -1 : 1 };
  };

  const specs: Spec[] = [...ARCHIVE.filter((s) => archiveMonths.includes(s.cycle as (typeof ARCHIVE_MONTHS)[number])), ...PAST, ...CURRENT, ...NEXT, ...LATER];
  const built: Built[] = specs.map((spec) => {
    const plan = EVENTS[spec.plan] as (typeof EVENTS)[EventKey] & { hours?: number; days?: number };
    const { start, month } = placed(spec);
    const end = plan.days ? iso(Date.parse(at(monthOf(start), Number(berlinDate(start).slice(8)), plan.time)) + (plan.days - 1) * DAY + 11 * HOUR) : plan.hours ? iso(Date.parse(start) + plan.hours * HOUR) : null;
    const over = (end ? Date.parse(end) : Date.parse(start) + DAY) < now;
    let status: EventStatus = spec.status ?? (spec.cycle >= 1 ? "scheduled" : over ? "completed" : "confirmed");
    if (!spec.status && status === "confirmed" && spec.dropouts?.some((d) => !d.replacedBy) && !spec.decision) status = "understaffed";
    return {
      spec,
      id: rng.uuid(),
      title: plan.title,
      type: plan.type,
      startsAt: start,
      endsAt: end,
      cycleMonth: months.get(month === 0 ? spec.cycle : month)!,
      status,
      space: null,
      oc: spec.oc ?? null,
      helpers: spec.helpers ?? [],
      assignments: [],
    };
  });
  const byKey = new Map(built.map((b) => [b.spec.key, b]));

  const cycleRows = [...archiveMonths, -3, -2, -1, 0, 1, 2].map((k) => {
    const month = months.get(k)!;
    const firstDay = at(month, 1, "23:59");
    const firstStart = Math.min(...built.filter((b) => b.cycleMonth === month).map((b) => Date.parse(b.startsAt)));
    const opened = Date.parse(at(addMonths(month, -1), 10, "10:00"));
    if (k <= 0) {
      const closes = Math.min(Date.parse(at(addMonths(month, -1), 25, "23:59")), Date.parse(firstDay));
      return {
        id: rng.uuid(), month, k, status: "confirmed" as const, created_at: iso(opened - 5 * DAY), form_closes_at: iso(closes),
        allocated_at: iso(closes + 9 * HOUR), confirmed_at: iso(closes + 30 * HOUR), confirmed_by: events,
        description_deadline: iso(Math.min(firstStart - 2 * DAY, closes + 5 * DAY)), opened,
      };
    }
    if (k === 1) {
      const closes = Math.min(now - 26 * HOUR, Date.parse(firstDay));
      return {
        id: rng.uuid(), month, k, status: "allocated" as const, created_at: iso(opened - 5 * DAY), form_closes_at: iso(closes),
        allocated_at: iso(closes + 9 * HOUR), confirmed_at: null, confirmed_by: null,
        description_deadline: iso(Math.max(now + 2 * DAY, firstStart - 3 * DAY)), opened,
      };
    }
    return {
      id: rng.uuid(), month, k, status: "form_open" as const, created_at: iso(Math.min(opened, now - 6 * DAY) - 5 * DAY),
      form_closes_at: iso(Math.min(Date.parse(berlinInputToIso(`${plusDays(today, 4)}T23:59`)), Date.parse(firstDay))),
      allocated_at: null, confirmed_at: null, confirmed_by: null, description_deadline: null, opened: Math.min(opened, now - 6 * DAY),
    };
  });
  check(
    await db.from("planning_cycles").insert(
      cycleRows.map((c) => ({
        id: c.id, month: c.month, status: c.status, created_by: TAG, created_at: c.created_at, form_closes_at: c.form_closes_at,
        allocated_at: c.allocated_at, confirmed_at: c.confirmed_at, confirmed_by: c.confirmed_by, description_deadline: c.description_deadline,
      }))
    ),
    "cycles"
  );
  const cycleOf = (b: Built) => cycleRows.find((c) => c.month === b.cycleMonth)!;

  // 4. Ideas behind some events, and new ones.
  const ideaRows: Database["public"]["Tables"]["event_ideas"]["Insert"][] = [];
  for (const b of built) {
    if (!b.spec.idea) continue;
    const plan = EVENTS[b.spec.plan];
    const c = cycleOf(b);
    ideaRows.push({
      id: rng.uuid(), title: plan.title, proposed_date: berlinDate(b.startsAt), pitch: plan.intro, helpers_needed: plan.helpers,
      proposer_id: pid(b.spec.idea.proposer), wants_to_oc: b.spec.idea.wantsOc ?? false, status: "accepted", event_id: b.id,
      decided_by: events, created_at: iso(c.opened - 12 * DAY), updated_at: iso(c.opened - 4 * DAY),
    });
  }
  for (const i of IDEAS) {
    const month = months.get(i.cycle)!;
    const created = Math.min(now - (12 - i.day / 3) * DAY, Date.parse(at(addMonths(month, -1), 1, "12:00")));
    ideaRows.push({
      id: rng.uuid(), title: i.title, proposed_date: `${month.slice(0, 8)}${String(i.day).padStart(2, "0")}`, pitch: i.pitch, helpers_needed: i.helpers,
      proposer_id: pid(i.proposer), wants_to_oc: i.wantsOc, status: i.status, decision_note: i.note ?? null,
      decided_by: i.status === "proposed" ? null : events, event_id: i.mergedInto ? byKey.get(i.mergedInto)!.id : null,
      created_at: iso(created), updated_at: iso(i.status === "proposed" ? created : Math.min(now - HOUR, created + 3 * DAY)),
    });
  }

  // 5. Events.
  check(
    await db.from("events").insert(
      built.map((b) => {
        const plan = EVENTS[b.spec.plan];
        const c = cycleOf(b);
        return {
          id: b.id, title: b.title, type: b.type, status: b.status, starts_at: b.startsAt, ends_at: b.endsAt, location: plan.venue,
          ...("meeting" in plan ? { meeting_point: plan.meeting.place, meeting_time: plan.meeting.time } : {}),
          price_cents: plan.priceCents, capacity: plan.capacity, helpers_needed: plan.helpers, cycle_id: c.id, created_by: TAG,
          created_at: iso(c.opened - 3 * DAY), proposed_by: b.spec.idea ? pid(b.spec.idea.proposer) : null,
          understaffed_decision: b.spec.decision ? "run" : null,
          understaffed_decided_by: b.spec.decision ? email(b.spec.oc!) : null,
          understaffed_decided_at: b.spec.decision ? iso(Date.parse(b.startsAt) - 2 * DAY) : null,
        };
      })
    ),
    "events"
  );
  check(await db.from("event_ideas").insert(ideaRows), "ideas");

  // 6. Volunteer answers and the rosters.
  const responses: Database["public"]["Tables"]["volunteer_responses"]["Insert"][] = [];
  const choices: Database["public"]["Tables"]["volunteer_choices"]["Insert"][] = [];
  const answer = (c: (typeof cycleRows)[number], who: string, picks: Array<{ event: string; oc: number | null; helper: number | null }>) => {
    const closes = Date.parse(c.form_closes_at!);
    const submitted = c.opened + rng.next() * Math.max(HOUR, Math.min(closes, now) - c.opened - HOUR);
    let r = responses.find((x) => x.cycle_id === c.id && x.profile_id === pid(who));
    if (!r) {
      r = { id: rng.uuid(), cycle_id: c.id, profile_id: pid(who), submitted_at: iso(submitted), updated_at: iso(submitted), note: rng.next() < 0.15 ? "I can only come after 18:00 on weekdays." : "" };
      responses.push(r);
    }
    for (const p of picks) {
      const existing = choices.find((x) => x.response_id === r!.id && x.event_id === p.event);
      if (existing) {
        existing.oc_rank = existing.oc_rank ?? p.oc;
        existing.helper_rank = existing.helper_rank ?? p.helper;
      } else choices.push({ response_id: r.id!, event_id: p.event, oc_rank: p.oc, helper_rank: p.helper });
    }
    return r;
  };

  const assignmentRows: Database["public"]["Tables"]["assignments"]["Insert"][] = [];
  const dropReasons: Database["public"]["Tables"]["assignment_drop_reasons"]["Insert"][] = [];
  const addAssignment = (b: Built, who: string, role: "oc" | "helper", source: string, when: number, dropped?: number) => {
    const a = { id: rng.uuid(), who, role, source, status: dropped ? "dropped_out" : "active", at: iso(when), droppedAt: dropped ? iso(dropped) : undefined };
    b.assignments.push(a);
    assignmentRows.push({ id: a.id, event_id: b.id, profile_id: pid(who), role, source, status: a.status, created_at: a.at, dropped_at: a.droppedAt ?? null, created_by: source === "replacement" ? email(who) : events });
    return a;
  };

  // Past and current months: the confirmed rosters, as the form had them.
  for (const b of built.filter((x) => x.spec.cycle <= 0 && x.status !== "dropped")) {
    const c = cycleOf(b);
    const confirmed = Date.parse(c.confirmed_at!);
    const s = b.spec;
    const dropouts = s.dropouts ?? [];
    if (s.oc) addAssignment(b, s.oc, "oc", s.idea?.proposer === s.oc ? "proposer" : "auto", confirmed);
    for (const h of s.helpers ?? []) {
      const d = dropouts.find((x) => x.who === h);
      addAssignment(b, h, "helper", "auto", confirmed, d ? Date.parse(b.startsAt) - d.before * DAY - 5 * HOUR : undefined);
    }
    for (const d of dropouts) {
      const a = b.assignments.find((x) => x.who === d.who && x.status === "dropped_out")!;
      dropReasons.push({ assignment_id: a.id, event_id: b.id, reason: d.reason, created_at: a.droppedAt! });
      if (d.replacedBy) addAssignment(b, d.replacedBy, d.role, "replacement", Date.parse(a.droppedAt!) + 7 * HOUR);
    }
    b.helpers = b.assignments.filter((a) => a.role === "helper" && a.status === "active").map((a) => a.who);
    if (s.oc) answer(c, s.oc, [{ event: b.id, oc: 1, helper: null }]);
    for (const h of s.helpers ?? []) answer(c, h, [{ event: b.id, oc: null, helper: rng.pick([1, 1, 2, 3] as const) }]);
  }
  // The dropped event: nobody signed up. Answers without it.

  // Next month: the allocation from the answers, then the Events team's adjustments.
  const next = cycleRows.find((c) => c.k === 1)!;
  const nextBuilt = built.filter((b) => b.cycleMonth === next.month);
  for (const b of nextBuilt) {
    for (const [who, oc, helper] of (b.spec as FutureSpec).answers ?? []) answer(next, who, [{ event: b.id, oc, helper }]);
  }
  const allocation = allocate(
    nextBuilt.map((b) => ({ id: b.id, startsAt: b.startsAt, endsAt: b.endsAt, helpersNeeded: EVENTS[b.spec.plan].helpers, fixed: b.spec.idea?.wantsOc ? [{ profileId: pid(b.spec.idea.proposer), role: "oc" as const }] : [] })),
    responses
      .filter((r) => r.cycle_id === next.id)
      .flatMap((r) =>
        choices
          .filter((c) => c.response_id === r.id)
          .map((c): AllocationChoice => ({ profileId: r.profile_id, eventId: c.event_id, ocRank: (c.oc_rank ?? null) as Rank | null, helperRank: (c.helper_rank ?? null) as Rank | null }))
      ),
    { seed: next.id! }
  );
  const keyOf = new Map(DEMO_PEOPLE.map((p) => [p.id, p.key]));
  for (const a of allocation.assignments) {
    const b = built.find((x) => x.id === a.eventId)!;
    addAssignment(b, keyOf.get(a.profileId)!, a.role, a.source, Date.parse(next.allocated_at!));
  }
  // The Events team swapped OC and helper on the Christmas market tour.
  const xmas = byKey.get("christmasOpening")!;
  const xOc = xmas.assignments.find((a) => a.role === "oc");
  const xHelper = xmas.assignments.find((a) => a.role === "helper");
  if (xOc && xHelper) {
    for (const [a, role] of [[xOc, "helper"], [xHelper, "oc"]] as const) {
      const row = assignmentRows.find((r) => r.id === a.id)!;
      row.role = role;
      row.source = "manual";
      a.role = role;
      a.source = "manual";
    }
  }
  for (const b of built) {
    b.oc = b.assignments.find((a) => a.role === "oc" && a.status === "active")?.who ?? null;
    b.helpers = b.assignments.filter((a) => a.role === "helper" && a.status === "active").map((a) => a.who);
  }

  // The month after: answers so far (the member persona has not answered yet).
  const later = cycleRows.find((c) => c.k === 2)!;
  for (const b of built.filter((x) => x.cycleMonth === later.month)) {
    for (const [who, oc, helper] of (b.spec as FutureSpec).answers ?? []) answer(later, who, [{ event: b.id, oc, helper }]);
  }

  check(await db.from("volunteer_responses").insert(responses), "volunteer answers");
  check(await db.from("volunteer_choices").insert(choices), "volunteer choices");
  if (assignmentRows.length) check(await db.from("assignments").insert(assignmentRows), "assignments");
  if (dropReasons.length) check(await db.from("assignment_drop_reasons").insert(dropReasons), "drop-out reasons");

  // Staffing triggers ran on the inserts; put the planned statuses back.
  for (const b of built) {
    check(await db.from("events").update({ status: b.status }).eq("id", b.id), `status of ${b.title}`);
  }

  // 7. Chat spaces (confirmed months, events that ran or will run).
  const teamPeople = (): SpacePerson[] =>
    DEMO_PEOPLE.filter((p) => p.roles.some((r) => CHAT_SPACE_ROLES.includes(r))).map((p) => ({ email: demoEmail(p, domain), name: p.name, kind: "team" as const }));
  const peopleOf = (b: Built): SpacePerson[] => [
    ...(b.oc ? [{ email: email(b.oc), name: person(b.oc).name, kind: "oc" as const }] : []),
    ...b.helpers.map((h) => ({ email: email(h), name: person(h).name, kind: "helper" as const })),
  ];
  const spaces: Database["public"]["Tables"]["fake_chat_spaces"]["Insert"][] = [];
  const members: Database["public"]["Tables"]["fake_chat_members"]["Insert"][] = [];
  const messages: Database["public"]["Tables"]["fake_chat_messages"]["Insert"][] = [];
  const jobs: Database["public"]["Tables"]["jobs"]["Insert"][] = [];
  const msg = (space: string, key: string, text: string, when: number, edits = 0) => {
    messages.push({ name: `${space}/messages/${chatMessageId(key)}`, space, text, created_at: iso(when), updated_at: iso(when), edits });
    return `${space}/messages/${chatMessageId(key)}`;
  };
  const doneJob = (kind: string, key: string, event: string | null, when: number, payload: Record<string, unknown> = {}) => {
    jobs.push({ kind, idempotency_key: key, event_id: event, status: "done", attempts: 1, payload: json({ ...payload, ...(event ? { event_id: event } : {}) }), run_after: iso(when), created_at: iso(when), updated_at: iso(when + 20_000) });
  };

  for (const b of built.filter((x) => x.spec.cycle <= 0 && x.status !== "dropped")) {
    const c = cycleOf(b);
    const created = Date.parse(c.confirmed_at!) + 2 * 60_000;
    const name = `spaces/DEMO${rng.hex(11).toUpperCase()}`;
    b.space = name;
    const people = peopleOf(b);
    const ev = { id: b.id, title: b.title, starts_at: b.startsAt };
    spaces.push({ name, display_name: spaceDisplayName(ev), description: spaceDescription(ev, people), guidelines: spaceGuidelines(ev, people, eventUrl(b.id)), request_id: `create-space-${b.id}`, created_at: iso(created) });
    for (const p of [...people, ...teamPeople()]) if (!members.some((m) => m.space === name && m.email === p.email)) members.push({ space: name, email: p.email, added_at: iso(created) });
    msg(name, `welcome-${b.id}`, welcomeMessage(ev, peopleOf({ ...b, helpers: b.assignments.filter((a) => a.role === "helper" && a.source !== "replacement").map((a) => a.who) }), eventUrl(b.id)), created);
    doneJob("chat.create_space", `chat.create_space:${b.id}`, b.id, created - 60_000);
    for (const a of b.assignments.filter((x) => x.status === "dropped_out")) {
      const when = Date.parse(a.droppedAt!);
      msg(name, `roster-dropout-${a.id}`, rosterMessage("dropout", person(a.who).name, a.role, b.oc ? email(b.oc) : null, eventUrl(b.id), b.title), when);
      if (b.oc) msg(`dm:${email(b.oc)}`, `roster-dm-dropout-${a.id}`, rosterMessage("dropout", person(a.who).name, a.role, email(b.oc), eventUrl(b.id), b.title), when);
    }
    for (const a of b.assignments.filter((x) => x.source === "replacement")) {
      const when = Date.parse(a.at);
      msg(name, `roster-claim-${a.id}`, rosterMessage("claim", person(a.who).name, a.role, b.oc ? email(b.oc) : null, eventUrl(b.id), b.title), when);
      if (b.oc) msg(`dm:${email(b.oc)}`, `roster-dm-claim-${a.id}`, rosterMessage("claim", person(a.who).name, a.role, email(b.oc), eventUrl(b.id), b.title), when);
    }
    if (b.status === "cancelled") {
      const when = Date.parse(b.startsAt) - (b.spec.cancel!.before * DAY + 20 * HOUR);
      msg(name, `event-status-cancelled-${b.id}-${when}`, eventStatusMessage("cancelled", ev, people, eventUrl(b.id), b.spec.cancel!.reason), when);
    }
    const start = Date.parse(b.startsAt);
    if (start <= now && b.status !== "cancelled") {
      msg(name, `photos-start-${b.id}`, photoStartMessage(b.title), start);
      doneJob("chat.photo_reminder", `chat.photo_reminder:start:${b.id}`, b.id, start, { kind: "start" });
    }
  }

  // 8. Descriptions in every stage.
  const descRows: Database["public"]["Tables"]["descriptions"]["Insert"][] = [];
  const versions: Database["public"]["Tables"]["description_versions"]["Insert"][] = [];
  const reviews: Database["public"]["Tables"]["reviews"]["Insert"][] = [];
  const fieldsOf = (b: Built): DescriptionFields => {
    const plan = EVENTS[b.spec.plan] as (typeof EVENTS)[EventKey] & { important?: string; weather?: boolean };
    return {
      ...emptyFields(b.title),
      dateIso: berlinDate(b.startsAt),
      time: b.spec.time ?? plan.time,
      venue: plan.venue,
      meeting: "meeting" in plan ? plan.meeting.place : "",
      meetingTime: "meeting" in plan ? plan.meeting.time : "",
      price: plan.priceCents ? (plan.priceCents / 100).toFixed(2) : "free",
      priceNote: plan.type === "weekend_trip" ? "travel and hostel included" : "",
      hook: plan.hook,
      intro: plan.intro,
      program: plan.program.join("\n"),
      bring: plan.bring.join("\n"),
      important: plan.important ?? "",
      weather: plan.weather ?? false,
      closing: plan.closing,
      esnType: plan.esnType,
      esnObjectives: ESN_DEFAULT_OBJECTIVES[plan.esnType] ?? "",
    };
  };
  for (const b of built) {
    const stage = b.spec.description ?? (b.spec.cycle >= 2 ? "none" : "published");
    if (stage === "none") continue;
    const author = b.oc ? email(b.oc) : events;
    const reviewer = rng.pick(comms);
    const deadline = cycleOf(b).description_deadline ? Date.parse(cycleOf(b).description_deadline!) : Date.parse(b.startsAt) - 5 * DAY;
    const start = Date.parse(b.startsAt);
    const base = Math.min(deadline, now - 2 * HOUR, start - 2 * DAY);
    const t = { draft: base - 4 * DAY, submitted: base - 2 * DAY, approved: base - 1 * DAY, published: base - 20 * HOUR };
    if (stage === "submitted" || stage === "approved") {
      // Late ones: in after the deadline.
      t.submitted = Math.min(now - 30 * HOUR, Math.max(t.submitted, deadline + 6 * HOUR));
      t.approved = Math.min(now - 3 * HOUR, t.submitted + 20 * HOUR);
    }
    let fields = fieldsOf(b);
    if (stage === "draft") fields = { ...fields, program: "", bring: "", closing: "", esnType: "", esnObjectives: "" };
    const rendered = renderDescription(fields).chat;
    const row: Database["public"]["Tables"]["descriptions"]["Insert"] = {
      event_id: b.id, fields: json(fields), status: stage, version: stage === "draft" ? 3 : 7, updated_at: iso(stage === "draft" ? t.draft : t.submitted), updated_by: author,
    };
    if (stage !== "draft") {
      Object.assign(row, { submitted_at: iso(t.submitted), submitted_by: author });
      versions.push({ event_id: b.id, version: 7, kind: "submitted", fields: json(fields), text: rendered, created_by: author, created_at: iso(t.submitted) });
    }
    if (stage === "changes_requested") {
      reviews.push({ event_id: b.id, reviewer, decision: "changes_requested", comment: b.spec.review ?? "Please shorten the intro a little.", version: 7, created_at: iso(t.submitted + 5 * HOUR) });
    }
    if (stage === "approved" || stage === "published") {
      Object.assign(row, { approved_fields: json(fields), approved_text: rendered, approved_at: iso(t.approved), approved_by: reviewer });
      versions.push({ event_id: b.id, version: 7, kind: "approved", fields: json(fields), text: rendered, created_by: reviewer, created_at: iso(t.approved) });
      reviews.push({ event_id: b.id, reviewer, decision: "approved", comment: rng.next() < 0.4 ? "Great, thanks! 🙌" : "", version: 7, created_at: iso(t.approved) });
    }
    if (stage === "published" && b.space) {
      const posted = publishedPost(rendered);
      const name = msg(b.space, `description-${b.id}`, posted, t.published);
      Object.assign(row, { publish_requested_at: iso(t.published - 60_000), published_at: iso(t.published), published_by: reviewer, published_text: posted, published_message_name: name });
      versions.push({ event_id: b.id, version: 7, kind: "published", fields: json(fields), text: posted, created_by: reviewer, created_at: iso(t.published) });
      doneJob("chat.publish_description", `chat.publish_description:${b.id}`, b.id, t.published - 60_000);
    }
    descRows.push(row);
    if (b.spec.remindedOc && b.space && b.oc) msg(b.space, `remind-oc-description-${b.id}`, remindOcMessage("description", b.title, email(b.oc), eventUrl(b.id), cycleOf(b).description_deadline), deadline + 3 * HOUR);
  }
  check(await db.from("descriptions").insert(descRows), "descriptions");
  check(await db.from("description_versions").insert(versions), "description versions");
  check(await db.from("reviews").insert(reviews), "reviews");

  // 9. Cancellations and Chat spaces on the events.
  for (const b of built) {
    const patch: Database["public"]["Tables"]["events"]["Update"] = {};
    if (b.space) {
      Object.assign(patch, { chat_space_name: b.space, chat_space_url: `https://chat.google.com/room/${b.space.split("/")[1]}`, chat_space_requested_at: cycleOf(b).confirmed_at });
    }
    if (b.spec.cancel) {
      const when = Date.parse(b.startsAt) - (b.spec.cancel.before * DAY + 20 * HOUR);
      Object.assign(patch, {
        cancelled_at: iso(when), cancelled_by: events, cancel_reason: b.spec.cancel.reason,
        ...(b.spec.cancel.noted ? { cancellation_noted_at: iso(when + 5 * HOUR), cancellation_noted_by: comms[0] } : {}),
      });
    }
    if (Object.keys(patch).length) check(await db.from("events").update(patch).eq("id", b.id), `space of ${b.title}`);
  }

  // 10. Attendance lists, photo folders, event reports, ESN Activities.
  const participants: Database["public"]["Tables"]["participants"]["Insert"][] = [];
  const stats = new Map<string, number>();
  const folders: Database["public"]["Tables"]["fake_drive_folders"]["Insert"][] = [];
  const files: Database["public"]["Tables"]["fake_drive_files"]["Insert"][] = [];
  const photoFolders: Database["public"]["Tables"]["event_photo_folders"]["Insert"][] = [];
  const reports: Database["public"]["Tables"]["event_reports"]["Insert"][] = [];
  const uploads: Database["public"]["Tables"]["esn_uploads"]["Insert"][] = [];
  const root = opts.driveRoot || FAKE_DRIVE_ROOT;
  const semesterIds = new Map<string, string>();
  const existingSemesters = check(await db.from("fake_drive_folders").select("id, name").eq("parent_id", root), "semester folders");
  for (const b of built) {
    const s = b.spec;
    const start = Date.parse(b.startsAt);
    if (s.attendance) {
      const listOrganisers = [b.oc, ...b.helpers].filter(Boolean).map((k) => email(k!));
      for (let i = 0; i < s.attendance.count; i++) {
        const signedIn = start + Math.min(rng.next() * 2.5 * HOUR, Math.max(60_000, now - start - 60_000));
        const kiosk = i < (s.attendance.kiosk ?? 0);
        participants.push({
          event_id: b.id, first_name: rng.pick(FIRST_NAMES), last_name: rng.pick(LAST_NAMES), entry_method: kiosk ? "kiosk" : "self",
          recorded_by: kiosk ? rng.pick(listOrganisers) : null, notice_version: NOTICE_VERSION, terms_version: TERMS_VERSION, created_at: iso(signedIn),
        });
        const answers: Array<[string, string]> = [
          ["nationality", rng.next() < 0.9 ? rng.pick(NATIONALITIES) : "not_given"],
          ["university", rng.pick(UNIVERSITIES)],
          ["exchange_program", rng.pick(PROGRAMS)],
          ["esn_card", rng.next() < 0.7 ? "yes" : rng.next() < 0.8 ? "no" : "not_given"],
        ];
        for (const [q, a] of answers) stats.set(`${b.id}|${q}|${a}`, (stats.get(`${b.id}|${q}|${a}`) ?? 0) + 1);
      }
      if (s.attendance.signedOff) {
        check(
          await db.from("attendance_lists").update({ signed_off_at: iso(start + (b.endsAt ? Date.parse(b.endsAt) - start : 4 * HOUR) + 14 * HOUR), signed_off_by: email(b.oc!), headcount: s.attendance.count + rng.int(0, 4) }).eq("event_id", b.id),
          "sign-off"
        );
      }
    }
    if (s.photos !== undefined && b.space) {
      const [semester, name] = photoFolderPath(berlinDate(b.startsAt), b.title);
      if (!semesterIds.has(semester)) {
        const existing = existingSemesters.find((f) => f.name === semester);
        const id = existing?.id ?? `fakefolder-demosem-${rng.hex(10)}`;
        if (!existing) folders.push({ id, parent_id: root, name: semester, created_at: iso(start - 30 * DAY) });
        semesterIds.set(semester, id);
      }
      const id = `${EVENT_FOLDER_PREFIX}${rng.hex(10)}`;
      folders.push({ id, parent_id: semesterIds.get(semester)!, name, created_at: iso(start - 6 * HOUR) });
      const firstPhoto = rng.int(1000, 8000);
      for (let i = 0; i < s.photos; i++) files.push({ id: `${id}-${i + 1}`, folder_id: id, file_name: `IMG_${firstPhoto + i}.jpg`, mime_type: "image/jpeg", size: rng.int(1_800_000, 6_500_000), created_at: iso(start + 16 * HOUR + i * 60_000) });
      const counted = Math.min(now - 30 * 60_000, start + 3 * DAY);
      photoFolders.push({ event_id: b.id, folder_id: id, folder_url: driveFolderUrl(id), folder_path: `${semester}/${name}`, photo_count: s.photos, counted_at: iso(counted), created_at: iso(start - 6 * HOUR), updated_at: iso(counted) });
      doneJob("drive.ensure_folder", `drive.ensure_folder:${b.id}`, b.id, start - 6 * HOUR);
      const remindAt = Date.parse(berlinInputToIso(`${plusDays(berlinDate(b.endsAt ?? b.startsAt), 1)}T10:00`));
      if (remindAt <= now) {
        msg(b.space, `photos-upload-${b.id}`, photoUploadMessage(b.title, { url: driveFolderUrl(id), name }, s.report ? null : `${eventUrl(b.id)}/hand-in#event-report`), remindAt);
        doneJob("chat.photo_reminder", `chat.photo_reminder:upload:${b.id}`, b.id, remindAt, { kind: "upload" });
      }
    }
    if (s.report) {
      const total = s.attendance?.count ?? 20;
      const local = Math.max(1, Math.round(total * 0.12));
      const wrote = Math.min(now - HOUR, start + 2 * DAY);
      reports.push({
        event_id: b.id, intl_participants: total - local, local_participants: local, organizers: 1 + b.helpers.length, goals_reached: true,
        went_well: rng.pick(["Great mood all evening, lots of new faces.", "Everyone was on time and the group mixed really well.", "The venue was perfect and the staff very helpful.", "Many first-semester students came – exactly who we wanted to reach."]),
        could_be_better: rng.pick(["Book a bigger room next time.", "Start the sign-up a week earlier.", "", "More vegetarian options."]),
        access_needs: false, access_note: "", created_by: email(b.oc!), updated_by: email(b.oc!), created_at: iso(wrote), updated_at: iso(wrote),
      });
      if (s.esn && b.space) {
        const when = Math.min(now - HOUR, wrote + 3 * DAY);
        const url = `https://activities.esn.org/activity/${b.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${rng.int(10000, 99999)}`;
        uploads.push({ event_id: b.id, activity_url: url, via: s.esn, uploaded_by: comms[0]!, uploaded_at: iso(when) });
        msg(b.space, `esn-uploaded-${b.id}`, esnUploadedMessage(b.title, url), when + 60_000);
        doneJob("chat.esn_uploaded", `chat.esn_uploaded:${b.id}`, b.id, when);
      }
    }
  }
  if (participants.length) check(await db.from("participants").insert(participants), "participants");
  const statRows = [...stats].map(([k, total]) => {
    const [event_id, question, answer] = k.split("|");
    return { event_id: event_id!, question: question!, answer: answer!, total };
  });
  if (statRows.length) check(await db.from("event_stats").insert(statRows), "attendance stats");
  if (folders.length) check(await db.from("fake_drive_folders").insert(folders), "drive folders");
  if (files.length) check(await db.from("fake_drive_files").insert(files), "photos");
  if (photoFolders.length) check(await db.from("event_photo_folders").insert(photoFolders), "photo folders");
  if (reports.length) check(await db.from("event_reports").insert(reports), "event reports");
  if (uploads.length) check(await db.from("esn_uploads").insert(uploads), "ESN uploads");

  // 11. Finance: trip budgets, pre-approvals, receipts and claims, payout batches.
  const policy = check(await db.from("reimbursement_policies").select("id, version").eq("version", 1).single(), "rules version 1");
  const rules = check(await db.from("reimbursement_rules").select("*").eq("policy_id", policy.id), "rules");
  const budgets: Database["public"]["Tables"]["trip_budgets"]["Insert"][] = [];
  const preapprovals: Database["public"]["Tables"]["preapprovals"]["Insert"][] = [];
  const budget = (key: string, cents: number, note: string) => {
    const b = byKey.get(key)!;
    budgets.push({ event_id: b.id, amount_cents: cents, note, set_by: finance, set_at: iso(Date.parse(b.startsAt) - 12 * DAY) });
  };
  budget("constance", 15000, "Welcome dinner and games – about €5 per participant.");
  budget("vienna", 20000, "Prater evening and a group game.");
  budget("prague", 18000, "Pub quiz night at the hostel and snacks.");
  const preapproval = (key: string, who: string, description: string, cents: number, status: "requested" | "approved" | "rejected", note = "") => {
    const b = byKey.get(key)!;
    const id = rng.uuid();
    preapprovals.push({
      id, event_id: b.id, requester_id: pid(who), description, estimated_cents: cents, status, note,
      created_at: iso(Math.min(now - 5 * HOUR, Date.parse(b.startsAt) - 14 * DAY)), decided_by: status === "requested" ? null : treasurer, decided_at: status === "requested" ? null : iso(Math.min(now - 2 * HOUR, Date.parse(b.startsAt) - 12 * DAY)),
    });
    return id;
  };
  const zeppelin = preapproval("constance", "chloe", "Zeppelin Museum group ticket for the team (3 people)", 9600, "approved", "Fine – the team guides the group through the museum.");
  preapproval("vienna", "tomasz", "Schönbrunn palace tour tickets for the team", 7500, "rejected", "The palace visit is already part of the trip price for everyone.");
  preapproval("prague", "tomasz", "Prague Castle circuit tickets for the team (2 people)", 5000, "requested");
  check(await db.from("trip_budgets").insert(budgets), "trip budgets");
  check(await db.from("preapprovals").insert(preapprovals), "pre-approvals");

  // A month's batch may exist already (local stack): its claims join it.
  const existingBatches = check(await db.from("payout_batches").select("id, month, status, paid_at").in("month", [...months.values()]), "existing batches");
  const batches = new Map<string, { id: string; month: string; status: "open" | "paid"; paid_at: string | null }>();
  const reused = new Set<string>();
  const batchFor = (month: string, paid: boolean) => {
    const existing = existingBatches.find((b) => b.month === month);
    if (existing && !batches.has(month)) {
      batches.set(month, { id: existing.id, month, status: existing.status as "open" | "paid", paid_at: existing.paid_at ?? (paid ? iso(Math.min(now - 2 * DAY, Date.parse(at(addMonths(month, 1), 3, "10:00")))) : null) });
      reused.add(month);
    }
    if (!batches.has(month)) {
      const paidAt = paid ? Math.min(now - 2 * DAY, Date.parse(at(addMonths(month, 1), 3, "10:00"))) : null;
      batches.set(month, { id: rng.uuid(), month, status: paid ? "paid" : "open", paid_at: paidAt ? iso(paidAt) : null });
    }
    return batches.get(month)!;
  };
  const receipts: Database["public"]["Tables"]["receipts"]["Insert"][] = [];
  const claims: Database["public"]["Tables"]["reimbursements"]["Insert"][] = [];
  const payouts: Database["public"]["Tables"]["payout_details"]["Insert"][] = [];
  let ibanIndex = 0;
  for (const b of built) {
    for (const c of b.spec.claims ?? []) {
      const start = Date.parse(b.startsAt);
      const role = b.spec.oc === c.who ? "oc" : "helper";
      const ruleType = c.kind === "ancillary" ? "any" : b.type;
      const rule = rules.find((r) => r.event_type === ruleType && r.expense_kind === c.kind);
      if (!rule) throw new Error(`Staging seed: no rule for ${c.kind} on ${b.type}`);
      const usedBudget = claims.filter((x) => x.event_id === b.id && x.rule_id === rule.id).reduce((n, x) => n + (x.suggested_cents ?? 0), 0);
      const budgetCents = budgets.find((x) => x.event_id === b.id)?.amount_cents ?? null;
      const s = suggestAmount({
        rule: rule as unknown as Rule, role, amountCents: c.amount, days: c.days ?? null, preapproved: rule.requires_preapproval ? b.spec.key === "constance" : false,
        budgetRemainingCents: budgetCents === null ? null : budgetCents - usedBudget,
      });
      const receiptId = rng.uuid();
      const claimId = rng.uuid();
      const registered = Math.min(now - 3 * HOUR, start + (b.endsAt ? Date.parse(b.endsAt) - start : 0) + rng.int(10, 40) * HOUR);
      const beleg = c.status === "not_submitted" ? null : Math.min(now - 2 * HOUR, registered + rng.int(1, 4) * DAY);
      const checkedAt = ["checked", "paid", "rejected"].includes(c.status) ? Math.min(now - HOUR, beleg! + rng.int(1, 3) * DAY) : null;
      const approved = c.status === "rejected" || !checkedAt ? null : (c.approved ?? s.suggestedCents);
      // Paid claims went out with their month's batch; checked ones wait in this month's open batch.
      const batch = c.status === "paid" && !c.early ? batchFor(b.cycleMonth, true) : c.status === "checked" ? batchFor(M, false) : null;
      const paidAt = c.status === "paid" ? (c.early ? Math.min(now - HOUR, checkedAt! + DAY) : Date.parse(batch!.paid_at!)) : null;
      receipts.push({
        id: receiptId, event_id: b.id, claimant_id: pid(c.who), expense_kind: c.kind, vendor: c.vendor, amount_cents: c.amount,
        purchased_on: berlinDate(b.startsAt), days: c.days ?? null, description: c.description ?? "",
        beleg_received_at: beleg ? iso(beleg) : null, beleg_received_by: beleg ? finance : null, created_at: iso(registered),
      });
      claims.push({
        id: claimId, receipt_id: receiptId, event_id: b.id, claimant_id: pid(c.who), claimant_role: role, category: rule.category,
        policy_id: policy.id, policy_version: policy.version, rule_id: rule.id, suggested_cents: s.suggestedCents, flags: s.flags,
        approved_cents: approved, status: c.status, payout_method: c.payout === "paypal" ? "paypal" : c.payout === "bank" ? "bank" : null,
        checked_at: checkedAt ? iso(checkedAt) : null, checked_by: checkedAt ? finance : null, paid_at: paidAt ? iso(paidAt) : null, paid_by: paidAt ? finance : null,
        batch_id: batch?.id ?? null, early_payout: c.early ?? false, rejected_reason: c.reject ?? null, finance_note: c.note ?? "",
        preapproval_id: c.kind === "further_expenses" && b.spec.key === "constance" ? zeppelin : null, created_at: iso(registered),
      });
      // Payout details exist only until a claim is settled.
      if (c.payout && !["paid", "rejected"].includes(c.status)) {
        payouts.push(c.payout === "bank"
          ? { reimbursement_id: claimId, iban: IBANS[ibanIndex++ % IBANS.length]!, account_holder: person(c.who).name }
          : { reimbursement_id: claimId, paypal_email: `${person(c.who).handle}@example.com` });
      }
    }
  }
  check(await db.from("payout_batches").insert([...batches.values()].filter((b) => !reused.has(b.month)).map((b) => ({ ...b, paid_by: b.status === "paid" ? finance : null, created_at: iso(Date.parse(at(b.month, 1, "09:00"))) }))), "payout batches");
  check(await db.from("receipts").insert(receipts), "receipts");
  check(await db.from("reimbursements").insert(claims), "claims");
  if (payouts.length) check(await db.from("payout_details").insert(payouts), "payout details");

  // 12. Chat: what went out, and the jobs queue that sent it.
  check(await db.from("fake_chat_spaces").insert(spaces), "fake chat spaces");
  check(await db.from("fake_chat_members").insert(members), "fake chat members");
  check(await db.from("fake_chat_messages").upsert(messages, { onConflict: "name" }), "fake chat messages");
  check(await db.from("jobs").upsert(jobs, { onConflict: "idempotency_key" }), "jobs");

  // 13. The publishing schedule: posts published, skipped, planned and overdue
  // on Telegram, Instagram and pretix, one Telegram post bundling two events.
  // Round 2026-11-09: the content planning on them – titles, post / story /
  // reel, who makes them, how far they are, captions and Canva links – posts
  // without an event ("This week", the month's calendar, a recap), a trip's
  // whole campaign weeks ahead, and pretix pages ticked for some upcoming events.
  // Planned Telegram posts publish themselves (a job at their time, as the
  // schedule board enqueues it); published ones are in the fake channel.
  const tenAm = (date: string, hour = "10:00") => Date.parse(berlinInputToIso(`${date}T${hour}`));
  const eventDay = (key: string, days: number) => plusDays(berlinDate(byKey.get(key)!.startsAt), days);
  const posts: Database["public"]["Tables"]["publication_posts"]["Insert"][] = [];
  const postEvents: Database["public"]["Tables"]["publication_post_events"]["Insert"][] = [];
  const telegramMessages: Database["public"]["Tables"]["fake_telegram_messages"]["Insert"][] = [];
  let telegramId = TELEGRAM_IDS[0];
  const post = (channel: string, when: number, keys: string[], status: "planned" | "published" | "skipped", extra: Record<string, unknown> = {}) => {
    const id = rng.uuid();
    const by = ((extra.assignees as string[] | undefined) ?? [])[0] ?? comms[0]!;
    const row: Database["public"]["Tables"]["publication_posts"]["Insert"] = {
      id, channel, scheduled_for: iso(when), status, created_by: by, created_at: iso(Math.min(when, now) - 2 * DAY), updated_at: iso(Math.min(when, now)),
      ...(status === "published" ? { published_at: iso(when), published_by: by } : {}),
      ...extra,
    };
    if (channel === "telegram" && status === "published") {
      const items = keys.map((k) => fieldsOf(byKey.get(k)!));
      const html = eventMessage(items[0]!).html;
      telegramId += 1;
      telegramMessages.push({ chat_id: TELEGRAM_CHAT, message_id: telegramId, kind: "text", text: html, created_at: iso(when), updated_at: iso(when) });
      Object.assign(row, { link: `https://t.me/${TELEGRAM_CHAT.slice(1)}/${telegramId}`, telegram: json({ chatId: TELEGRAM_CHAT, picture: null, messages: [{ layout: "text", textMessageId: telegramId }], messageId: telegramId }) });
    }
    if (channel === "telegram" && status === "planned") {
      jobs.push({ kind: "telegram.publish_post", payload: json({ post_id: id, version: 1 }), idempotency_key: `telegram.publish_post:${id}:1`, status: "pending", run_after: iso(when), created_at: row.created_at! });
    }
    posts.push(row);
    keys.forEach((k, position) => postEvents.push({ post_id: id, event_id: byKey.get(k)!.id, position }));
    return id;
  };
  const [sofia, kenji] = comms as [string, string];
  const canva = (name: string) => `https://www.canva.com/design/staging-${name}/edit`;
  // Not before now for planned ones (the board would show them overdue).
  const ahead = (date: string, hour = "10:00") => Math.max(now + 2 * HOUR, tenAm(date, hour));
  const slug = (key: string) => byKey.get(key)!.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  post("pretix", tenAm(eventDay("pubQuiz", -8)), ["pubQuiz"], "published", { link: `https://pretix.eu/esnmesa/${slug("pubQuiz")}/` });
  post("instagram", tenAm(eventDay("pubQuiz", -5)), ["pubQuiz"], "published", {
    link: "https://www.instagram.com/p/staging-pub-quiz/", format: "post", assignees: [kenji], progress: "ready",
    caption: "🧠 Pub quiz night is back! Teams of up to five, prizes for the top three. Sign up via the link in our bio.", design_link: canva("pub-quiz"),
  });
  post("telegram", tenAm(eventDay("pubQuiz", -4)), ["pubQuiz"], "published");
  post("pretix", tenAm(eventDay("languageCafePast", -5)), ["languageCafePast"], "skipped", { skip_reason: "No pretix for free events" });
  post("telegram", tenAm(eventDay("bouldering", -3)), ["bouldering"], "published");
  post("instagram", tenAm(eventDay("brunchMarket", -6)), ["brunchMarket"], "published", { link: "https://www.instagram.com/p/staging-sunday-brunch/", format: "post", assignees: [sofia], progress: "ready" });
  post("telegram", Math.min(now - HOUR, tenAm(eventDay("movieNight", 0), "09:00")), ["movieNight"], "published");
  post("instagram", Math.min(now - HOUR, tenAm(eventDay("movieNight", -1))), ["movieNight"], "published", { link: "https://www.instagram.com/p/staging-movie-night/", format: "story", title: "Tonight!", assignees: [sofia], progress: "ready" });
  post("pretix", tenAm(eventDay("pubCrawl", -7)), ["pubCrawl"], "published", { link: `https://pretix.eu/esnmesa/${slug("pubCrawl")}/` });
  // Overdue: planned for yesterday morning, not posted yet.
  post("instagram", tenAm(plusDays(today, -1)), ["boardGames"], "planned", { format: "post", assignees: [kenji], progress: "in_progress", design_link: canva("board-games") });
  // Planned this week, one of them a bundle.
  post("instagram", ahead(plusDays(today, 1), "12:00"), ["pubCrawl"], "planned", {
    note: "Costume ideas carousel", title: "Costume ideas", format: "reel", assignees: [sofia, kenji], progress: "in_progress",
    caption: "👻 Need a costume for the pub crawl? Five last-minute ideas – which one are you?", design_link: canva("pub-crawl-costumes"),
  });
  post("telegram", Math.max(now + 3 * HOUR, tenAm(plusDays(today, 1))), ["boardGames", "pubCrawl"], "planned", { note: "This week at ESN MESA" });
  // Next month, planned before the description is approved (the board warns).
  post("telegram", tenAm(eventDay("stammtisch", -3)), ["stammtisch"], "planned");
  post("instagram", tenAm(eventDay("thanksgiving", -7)), ["thanksgiving"], "planned", { format: "post", assignees: [kenji] });
  // Next month's events posted together in one Instagram story.
  post("instagram", ahead(eventDay("swing", -5), "18:00"), ["swing", "escapeRoom"], "planned", { title: "Coming up", format: "story", assignees: [sofia] });

  // A trip's campaign, weeks ahead (several posts of one event, planned in one go).
  const tripPosts: Array<[string, number, "post" | "story" | "reel" | null, string, Record<string, unknown>]> = [
    ["instagram", -24, "post", "Save the date", { progress: "ready", caption: "🇨🇿 Prague, here we come! Save the weekend – tickets go on sale soon.", design_link: canva("prague-save-the-date") }],
    ["instagram", -16, "story", "Sales open soon", { progress: "in_progress" }],
    ["instagram", -14, "story", "Sales NOW", { progress: "todo" }],
    ["telegram", -14, null, "", {}],
    ["instagram", -3, "story", "Last chance", { progress: "todo" }],
  ];
  for (const [channel, before, format, title, extra] of tripPosts) {
    post(channel, ahead(eventDay("prague", before), title === "Sales NOW" ? "18:00" : "10:00"), ["prague"], "planned", {
      ...(title ? { title } : {}), ...(format ? { format } : {}), ...(channel === "instagram" ? { assignees: [sofia] } : {}), ...extra,
    });
  }
  // pretix pages Comms set up for upcoming events (the others are still to do on the pretix tab).
  for (const k of ["prague", "nuremberg", "boardGames"]) post("pretix", Math.min(now - HOUR, tenAm(plusDays(today, -2))), [k], "published", { link: `https://pretix.eu/esnmesa/${slug(k)}/` });

  // Posts without an event: the month's "This week" stories, next month's calendar, last month's recap.
  // The same titles "Regular posts" gives, so planning them again leaves these alone.
  for (const r of regularPosts(monthOf(iso(now)), today)) {
    const calendar = r.kind === "calendar";
    post("instagram", ahead(r.day, calendar ? "17:00" : "18:00"), [], "planned", {
      title: r.title, format: r.format, assignees: calendar ? [sofia, kenji] : [kenji], progress: calendar ? "in_progress" : "todo",
      ...(calendar ? { caption: `📅 You got plans for ${r.title.split(" ")[0]}? We certainly do! Save the dates 💙`, design_link: canva("month-calendar") } : {}),
    });
  }
  const lastMonth = addMonths(monthOf(iso(now)), -1);
  const lastName = new Date(`${lastMonth}T12:00:00Z`).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  post("instagram", Math.min(now - DAY, tenAm(plusDays(monthOf(iso(now)), 1))), [], "published", {
    title: `${lastName} recap`, format: "reel", assignees: [sofia], progress: "ready", link: "https://www.instagram.com/p/staging-recap/",
    caption: `A little look back at our ${lastName} moments ✨ #MESAlovesyou`,
  });
  check(await db.from("publication_posts").insert(posts, { defaultToNull: false }), "publication posts");
  check(await db.from("publication_post_events").insert(postEvents), "publication post events");
  if (telegramMessages.length) check(await db.from("fake_telegram_messages").insert(telegramMessages), "fake Telegram messages");
  check(await db.from("jobs").upsert(jobs.filter((j) => j.kind === "telegram.publish_post"), { onConflict: "idempotency_key" }), "Telegram jobs");

  // 14. History from the description bot's Sheet ("Get inspired" on /ideas),
  // as `npm run import:bot-archive` brings it in: the same kinds of events
  // one and two years back.
  const history = HISTORY.map(([key, yearsBack, dayShift, intl, local], i) => {
    const plan = EVENTS[key] as (typeof EVENTS)[EventKey];
    const date = plusDays(`${Number(today.slice(0, 4)) - yearsBack}${today.slice(4)}`, dayShift);
    const price = plan.priceCents ? `€ ${(plan.priceCents / 100).toFixed(2)}` : "FREE";
    const text = `Dear Internationals,

Are you ready for ${plan.hook}? 🎉

${plan.intro}

We can’t wait to ${plan.closing}! ✨`;
    const esnData = intl ? JSON.stringify({ types: [plan.esnType], intl, local, coord: 2 + (i % 3), reached: true, positive: "Lots of new faces." }) : "";
    return { date, time: plan.time, title: plan.title, venue: plan.venue, price, description: text, esnLink: "", esnData, publishedBy: comms[0], updated: "", eventId: `spaces/STAGINGARCHIVE${i}` };
  });
  const imported = await importArchive(db, history, { createdBy: TAG });

  // 14b. Categories and formats (round 2026-11-01) for the planned events and
  // the history, as "Save all" on /team/events/formats would; ideas follow.
  await applySuggestedSorting(db, { createdBy: TAG, proposers: DEMO_PEOPLE.map((p) => p.id) });

  // 15. Internal events, office hours, cash boxes, the ledger, personal settings.
  const internal = await seedInternalStaging(db, {
    rng, now, months, email, pid, ibans: IBANS,
    event: (key) => {
      const b = byKey.get(key)!;
      return { id: b.id, plan: b.spec.plan, title: b.title, startsAt: b.startsAt, endsAt: b.endsAt, oc: b.oc, helpers: b.helpers, attendance: b.spec.attendance?.count ?? null };
    },
  });

  // 16. The activity log, as the people did it (the triggers wrote "now" and no one).
  await writeActivity(db, { built, cycleRows, ideaRows, descRows, reviews, claims, events, comms: comms[0]!, finance, email, keyOf, eventIds: built.map((b) => b.id), cycleIds: cycleRows.map((c) => c.id), now });

  const count = <T,>(rows: T[], key: (r: T) => string) => rows.reduce<Record<string, number>>((m, r) => ({ ...m, [key(r)]: (m[key(r)] ?? 0) + 1 }), {});
  const summary: SeedSummary = {
    people: DEMO_PEOPLE.length,
    cycles: Object.fromEntries(cycleRows.map((c) => [c.month, c.status])),
    events: built.length,
    history: imported.imported + imported.updated,
    eventStatuses: count(built, (b) => b.status),
    descriptionStages: count(descRows, (d) => d.status!),
    claimStatuses: count(claims, (c) => c.status!),
    ideaStatuses: count(ideaRows, (i) => i.status!),
    internal,
    removed,
  };
  log(`Staging demo: ${summary.people} members, ${summary.events} events in ${Object.keys(summary.cycles).length} cycles (replaced ${removed} earlier events).`);
  return summary;
}

// The ESN objectives each activity type starts with (lib/description/template.ts).
const ESN_DEFAULT_OBJECTIVES: Record<string, string> = {
  "10": "413,426", "442": "413,418", "441": "413,407", "31": "422,413", "438": "424,426", "9": "424,425,428", "13": "412,423",
  "11": "412,411", "439": "410,426",
};

interface ActivityInput {
  built: Built[];
  cycleRows: Array<{ id: string; month: string; k: number; created_at: string; form_closes_at: string | null; allocated_at: string | null; confirmed_at: string | null; opened: number }>;
  ideaRows: Database["public"]["Tables"]["event_ideas"]["Insert"][];
  descRows: Database["public"]["Tables"]["descriptions"]["Insert"][];
  reviews: Database["public"]["Tables"]["reviews"]["Insert"][];
  claims: Database["public"]["Tables"]["reimbursements"]["Insert"][];
  events: string;
  comms: string;
  finance: string;
  email: (key: string) => string;
  keyOf: Map<string, string>;
  eventIds: string[];
  cycleIds: string[];
  now: number;
}

async function writeActivity(db: Db, a: ActivityInput) {
  // Drop what the triggers logged during the seed.
  for (let i = 0; i < a.eventIds.length; i += 100) check(await db.from("activity_log").delete().in("event_id", a.eventIds.slice(i, i + 100)), "trigger log");
  check(await db.from("activity_log").delete().in("cycle_id", a.cycleIds), "trigger log (cycles)");
  const ideaIds = a.ideaRows.map((i) => i.id!);
  check(await db.from("activity_log").delete().eq("entity", "event_ideas").in("entity_id", ideaIds), "trigger log (ideas)");

  const rows: Database["public"]["Tables"]["activity_log"]["Insert"][] = [];
  const add = (entity: string, action: string, at: number, actor: string | null, details: Record<string, unknown>, ids: { event?: string; cycle?: string; entity?: string }) => {
    if (at > a.now) return;
    rows.push({ entity, action, at: new Date(at).toISOString(), actor_email: actor, details: json(details), event_id: ids.event ?? null, cycle_id: ids.cycle ?? null, entity_id: ids.entity ?? null });
  };
  for (const c of a.cycleRows) {
    add("planning_cycles", "insert", Date.parse(c.created_at), a.events, { month: c.month, status: "planning" }, { cycle: c.id, entity: c.id });
    add("planning_cycles", "update", c.opened, a.events, { status: "form_open", form_closes_at: c.form_closes_at }, { cycle: c.id, entity: c.id });
    if (c.form_closes_at) add("planning_cycles", "update", Date.parse(c.form_closes_at), null, { status: "form_closed" }, { cycle: c.id, entity: c.id });
    if (c.allocated_at) add("planning_cycles", "update", Date.parse(c.allocated_at), a.events, { status: "allocated" }, { cycle: c.id, entity: c.id });
    if (c.confirmed_at) add("planning_cycles", "update", Date.parse(c.confirmed_at), a.events, { status: "confirmed", confirmed_by: a.events }, { cycle: c.id, entity: c.id });
  }
  for (const i of a.ideaRows) {
    add("event_ideas", "insert", Date.parse(i.created_at!), null, { title: i.title, status: "proposed" }, { entity: i.id! });
    if (i.status !== "proposed") add("event_ideas", "update", Date.parse(i.updated_at!), a.events, { status: i.status, ...(i.decision_note ? { decision_note: i.decision_note } : {}) }, { entity: i.id! });
  }
  for (const b of a.built) {
    const c = a.cycleRows.find((x) => x.month === b.cycleMonth)!;
    const ids = { event: b.id, cycle: c.id };
    add("events", "insert", c.opened - 3 * DAY, a.events, { title: b.title, type: b.type, status: "scheduled", starts_at: b.startsAt }, { ...ids, entity: b.id });
    for (const x of b.assignments) {
      add("assignments", "insert", Date.parse(x.at), x.source === "replacement" ? a.email(x.who) : a.events, { profile_id: [...a.keyOf].find(([, k]) => k === x.who)?.[0], role: x.role, source: x.source }, { ...ids, entity: x.id });
      if (x.droppedAt) add("assignments", "update", Date.parse(x.droppedAt), a.email(x.who), { status: "dropped_out" }, { ...ids, entity: x.id });
    }
    if (c.confirmed_at && b.status !== "scheduled") {
      const confirmedStatus = b.status === "dropped" ? "dropped" : "confirmed";
      add("events", "update", Date.parse(c.confirmed_at), a.events, { status: confirmedStatus }, { ...ids, entity: b.id });
    }
    if (b.space) add("events", "update", Date.parse(c.confirmed_at!) + 2 * 60_000, null, { chat_space_name: b.space, chat_space_url: `https://chat.google.com/room/${b.space.split("/")[1]}` }, { ...ids, entity: b.id });
    const drop = b.assignments.find((x) => x.status === "dropped_out" && !b.assignments.some((y) => y.source === "replacement"));
    if (drop && (b.status === "understaffed" || b.spec.decision)) add("events", "update", Date.parse(drop.droppedAt!) + 1000, null, { status: "understaffed" }, { ...ids, entity: b.id });
    if (b.spec.decision) add("events", "update", Date.parse(b.startsAt) - 2 * DAY, a.email(b.spec.oc!), { understaffed_decision: "run", status: "confirmed" }, { ...ids, entity: b.id });
    if (b.spec.cancel) add("events", "update", Date.parse(b.startsAt) - (b.spec.cancel.before * DAY + 20 * HOUR), a.events, { status: "cancelled", cancel_reason: b.spec.cancel.reason }, { ...ids, entity: b.id });
    if (b.status === "completed") add("events", "update", Date.parse(b.endsAt ?? b.startsAt) + (b.endsAt ? 15 * 60_000 : DAY + 15 * 60_000), null, { status: "completed" }, { ...ids, entity: b.id });
    const d = a.descRows.find((x) => x.event_id === b.id);
    if (d) {
      const author = b.oc ? a.email(b.oc) : a.events;
      const created = Date.parse(d.updated_at!) - 2 * DAY;
      add("descriptions", "insert", created, author, { status: "draft" }, { ...ids });
      if (d.submitted_at) add("descriptions", "update", Date.parse(d.submitted_at), author, { status: "submitted" }, ids);
      for (const r of a.reviews.filter((x) => x.event_id === b.id)) {
        add("reviews", "insert", Date.parse(r.created_at!), r.reviewer, { decision: r.decision, comment: r.comment }, { ...ids, entity: r.id ?? undefined });
        add("descriptions", "update", Date.parse(r.created_at!), r.reviewer, { status: r.decision }, ids);
      }
      if (d.published_at) add("descriptions", "update", Date.parse(d.published_at), d.published_by!, { status: "published" }, ids);
    }
    if (b.spec.attendance?.signedOff) add("attendance_lists", "update", Date.parse(b.startsAt) + 18 * HOUR, a.email(b.oc!), { signed_off_at: new Date(Date.parse(b.startsAt) + 18 * HOUR).toISOString(), headcount: b.spec.attendance.count }, { ...ids, entity: b.id });
  }
  for (const c of a.claims) {
    const ids = { event: c.event_id, entity: c.id! };
    add("reimbursements", "insert", Date.parse(c.created_at!), null, { status: "not_submitted", suggested_cents: c.suggested_cents }, ids);
    if (c.checked_at) add("reimbursements", "update", Date.parse(c.checked_at), a.finance, { status: c.status === "rejected" ? "rejected" : "checked", approved_cents: c.approved_cents }, ids);
    if (c.paid_at) add("reimbursements", "update", Date.parse(c.paid_at), a.finance, { status: "paid" }, ids);
  }
  for (let i = 0; i < rows.length; i += 500) check(await db.from("activity_log").insert(rows.slice(i, i + 500)), "activity log");
}

/**
 * Removes what an earlier seedStaging() created (and the local demo seed's
 * data, whose months it takes over). The members stay. Returns how many
 * events went.
 */
export async function removeStagingData(db: Db, domain = "esnmesa.org"): Promise<number> {
  const tags = [stagingTag(domain.toLowerCase()), DEMO_SEED_TAG];
  const cycles = check(await db.from("planning_cycles").select("id").in("created_by", tags), "old cycles").map((c) => c.id);
  const own = check(await db.from("events").select("id").in("created_by", tags), "old events").map((e) => e.id);
  const inCycles = cycles.length ? check(await db.from("events").select("id").in("cycle_id", cycles), "old cycle events").map((e) => e.id) : [];
  const ids = [...new Set([...own, ...inCycles])];
  const demoIds = DEMO_PEOPLE.map((p) => p.id);
  const demoEmails = DEMO_PEOPLE.map((p) => demoEmail(p, domain));

  // Posts without an event (round 2026-11-09) are not found through the events: the demo Comms team's go.
  const theirs = check(await db.from("publication_posts").select("id, publication_post_events(event_id)").in("created_by", demoEmails), "old posts without events");
  const loose = theirs.filter((p) => !p.publication_post_events.length).map((p) => p.id);
  if (loose.length) check(await db.from("publication_posts").delete().in("id", loose), "old posts without events");

  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const evs = check(await db.from("events").select("chat_space_name").in("id", chunk).not("chat_space_name", "is", null), "old spaces");
    const spaces = evs.map((e) => e.chat_space_name!);
    if (spaces.length) {
      check(await db.from("fake_chat_messages").delete().in("space", spaces), "old messages");
      check(await db.from("fake_chat_members").delete().in("space", spaces), "old space members");
      check(await db.from("fake_chat_spaces").delete().in("name", spaces), "old spaces");
    }
    const folders = check(await db.from("event_photo_folders").select("folder_id").in("event_id", chunk).not("folder_id", "is", null), "old photo folders");
    if (folders.length) check(await db.from("fake_drive_folders").delete().in("id", folders.map((f) => f.folder_id!)), "old drive folders");
    const oldPosts = check(await db.from("publication_post_events").select("post_id").in("event_id", chunk), "old posts").map((p) => p.post_id);
    for (const id of new Set(oldPosts)) check(await db.from("jobs").delete().like("idempotency_key", `telegram.publish_post:${id}:%`), "old post jobs");
    if (oldPosts.length) check(await db.from("publication_posts").delete().in("id", [...new Set(oldPosts)]), "old posts");
    check(await db.from("finance_entries").delete().in("event_id", chunk), "old ledger entries");
    check(await db.from("cash_reports").delete().in("event_id", chunk), "old cash boxes");
    check(await db.from("reimbursements").delete().in("event_id", chunk), "old claims");
    check(await db.from("receipts").delete().in("event_id", chunk), "old receipts");
    check(await db.from("jobs").delete().in("event_id", chunk), "old jobs");
    check(await db.from("activity_log").delete().in("event_id", chunk), "old log");
    check(await db.from("event_ideas").delete().in("event_id", chunk), "old linked ideas");
    check(await db.from("events").delete().in("id", chunk), "old events");
  }
  // Internal events (planned by the HR persona) with their cash boxes and ledger entries, and the local demo seed's.
  const internal = check(await db.from("internal_events").select("id").in("created_by", [...tags, ...demoEmails]), "old internal events").map((e) => e.id);
  for (let i = 0; i < internal.length; i += 100) {
    const chunk = internal.slice(i, i + 100);
    check(await db.from("finance_entries").delete().in("internal_event_id", chunk), "old internal ledger entries");
    check(await db.from("cash_reports").delete().in("internal_event_id", chunk), "old internal cash boxes");
    check(await db.from("internal_events").delete().in("id", chunk), "old internal events");
  }
  check(await db.from("finance_entries").delete().in("created_by", tags), "old ledger entries");
  // Cash box history, extra boxes, saved payout details, calendar links.
  await removeInternalStaging(db, demoEmails, demoIds, tags);
  // The seed's messages in the fake Telegram channel.
  check(await db.from("fake_telegram_messages").delete().eq("chat_id", TELEGRAM_CHAT).gte("message_id", TELEGRAM_IDS[0]).lte("message_id", TELEGRAM_IDS[1]), "old Telegram messages");
  // Event folders of an earlier run that stopped half-way.
  check(await db.from("fake_drive_folders").delete().like("id", `${EVENT_FOLDER_PREFIX}%`), "old event folders");
  // Direct messages to demo members, their ideas, their ESN tokens.
  check(await db.from("fake_chat_messages").delete().in("space", demoEmails.map((e) => `dm:${e}`)), "old direct messages");
  const oldIdeas = check(await db.from("event_ideas").select("id").in("proposer_id", demoIds), "old ideas").map((i) => i.id);
  if (oldIdeas.length) check(await db.from("activity_log").delete().eq("entity", "event_ideas").in("entity_id", oldIdeas), "old idea log");
  check(await db.from("event_ideas").delete().in("proposer_id", demoIds), "old ideas");
  check(await db.from("event_ideas").delete().like("title", "[demo]%"), "old demo ideas");
  check(await db.from("esn_access_tokens").delete().in("profile_id", demoIds), "old tokens");
  // Someone trying the blacklist on staging must not stop the next run (the seed assigns these people).
  check(await db.from("volunteer_blacklist").delete().in("profile_id", demoIds), "old blacklist entries");
  if (cycles.length) {
    check(await db.from("activity_log").delete().in("cycle_id", cycles), "old cycle log");
    check(await db.from("planning_cycles").delete().in("id", cycles), "old cycles");
  }
  // Payout batches left without claims (as the test cleanup does).
  const batches = check(await db.from("payout_batches").select("id, reimbursements(id)"), "batches");
  const empty = batches.filter((b) => !(b.reimbursements as unknown[] | null)?.length).map((b) => b.id);
  if (empty.length) check(await db.from("payout_batches").delete().in("id", empty), "empty batches");
  return ids.length;
}

/** Wipes the whole database (public.staging_wipe(), demo databases only), then seeds. */
export async function resetStagingData(db: Db, opts: SeedOptions): Promise<SeedSummary> {
  check(await db.rpc("staging_wipe"), "wipe");
  return seedStaging(db, opts);
}

/** Removes the demo members' accounts too (the tests' cleanup). */
export async function deleteDemoMembers(db: Db, domain = "esnmesa.org"): Promise<void> {
  check(await db.from("role_members").delete().in("email", DEMO_PEOPLE.map((p) => demoEmail(p, domain))), "demo roles");
  check(await db.from("organiser_acknowledgements").delete().in("email", DEMO_PEOPLE.map((p) => demoEmail(p, domain))), "demo acknowledgements");
  for (const p of DEMO_PEOPLE) {
    const { error } = await db.auth.admin.deleteUser(p.id);
    if (error && error.status !== 404) throw new Error(`Staging seed – delete ${p.key}: ${error.message}`);
  }
}

export type { DemoPerson };
