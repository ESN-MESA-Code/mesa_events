// ESN Activities (brief 2026-10-29, B): the address parser and form data
// builder ported from the bot (its cases in test/harness.js), the status,
// and the API's pure helpers (rate limits, CORS, token hashing, the script).
import { describe, expect, it } from "vitest";
import { parseAddress } from "@/lib/esn/address";
import { MISSING, buildEsnFormData, esnGoal, esnStatus, esnUploadUrl, isEsnActivityUrl, type EsnFormInput, type EventReport } from "@/lib/esn/formData";
import { ESN_ORIGIN, RateLimiter, TOKEN_PATTERN, corsHeaders, hashToken } from "@/lib/esn/api";
import { userscript } from "@/lib/esn/script";
import { emptyFields, type DescriptionFields } from "@/lib/description/template";

describe("address from the venue (the bot's parseAddress_)", () => {
  it("reads street, postal code and city", () => {
    expect(parseAddress("Boulderwelt München Ost (Hanne-Hiob-Straße 4, 81671 München)")).toEqual({ street: "Hanne-Hiob-Straße 4", postal: "81671", city: "München" });
    expect(parseAddress("Shamrock Munich, Trautenwolfstraße 6, 80802 Munich")).toEqual({ street: "Trautenwolfstraße 6", postal: "80802", city: "Munich" });
    expect(parseAddress("LMU Main Building").street).toBe("");
  });

  it("keeps a postal code without a street, and copes with nothing", () => {
    expect(parseAddress("Somewhere in 80331 München")).toEqual({ street: "", postal: "80331", city: "München" });
    expect(parseAddress("Kulturzentrum, Gotzinger Str. 12a, 81371 München")).toEqual({ street: "Gotzinger Str. 12a", postal: "81371", city: "München" });
    expect(parseAddress(null)).toEqual({ street: "", postal: "", city: "" });
  });
});

const quiz: DescriptionFields = {
  ...emptyFields("Pub Quiz"),
  dateIso: "2026-11-02",
  time: "19:00",
  venue: "Shamrock Munich, Trautenwolfstraße 6, 80802 Munich",
  price: "free",
  hook: "Are you ready for a night of trivia?! 🎉",
  intro: "Teams of four battle it out. Prizes for the best three teams! Bring your friends and your brains.",
  program: "Six rounds\nPrizes",
  bring: "A pen",
  closing: "see you there",
  esnType: "10",
  esnObjectives: "413,426",
};
const report: EventReport = {
  intl_participants: 34,
  local_participants: 5,
  organizers: 3,
  goals_reached: true,
  went_well: " Great mix of teams,\nlots of laughs. ",
  could_be_better: "Bigger room",
  access_needs: false,
  access_note: "",
};
const input = (extra: Partial<EsnFormInput> = {}): EsnFormInput => ({
  eventId: "e1",
  event: { title: "Pub Quiz (event)", starts_at: "2026-11-02T18:00:00Z", ends_at: null, location: "Shamrock", price_cents: 0 },
  published: quiz,
  classification: null,
  report: null,
  ...extra,
});

describe("ESN form data (the bot's esnFormData_)", () => {
  it("free event: type and objectives, organiser funding, description HTML, the report missing", () => {
    const d = buildEsnFormData(input());
    expect(d).toMatchObject({
      v: 1,
      event: "e1",
      title: "Pub Quiz",
      start: "2026-11-02",
      end: "2026-11-02",
      country: "DE",
      street: "Trautenwolfstraße 6",
      postal: "80802",
      city: "Munich",
      types: ["10"],
      objectives: ["413", "426"],
      audience: ["431", "430"],
      funding: ["46"],
      fee: "",
      access: [2, 2, 2, 1],
      sustain: [1, 2],
      intl: 0,
      reached: false,
    });
    expect(d.description.startsWith("<p>🗓️")).toBe(true);
    expect(d.missing).toEqual([MISSING.report]);
  });

  it("with a fee: fee funding; with the report: participants and outcome", () => {
    const d = buildEsnFormData(input({ published: { ...quiz, price: "12,5", priceNote: "incl. drink" }, report }));
    expect(d).toMatchObject({ fee: "12.50", funding: ["44"], intl: 34, local: 5, coord: 3, reached: true, positive: "Great mix of teams, lots of laughs.", improve: "Bigger room" });
    expect(d.missing).toEqual([]);
  });

  it("the classification can change without a new publication", () => {
    const d = buildEsnFormData(input({ classification: { esnType: "9", esnObjectives: "424,425,428", esnGoal: "", esnAccess: "", esnSustain: "" } }));
    expect(d).toMatchObject({ types: ["9"], objectives: ["424", "425", "428"], access: [1, 2, 1, 3] });
  });

  it("the goal and ratings from the description win over the derived ones (round 2026-10-30)", () => {
    const d = buildEsnFormData(input({ classification: { esnType: "9", esnObjectives: "424", esnGoal: "  Get people hiking  together. ", esnAccess: "0,1,2,3", esnSustain: "3,3" } }));
    expect(d).toMatchObject({ goal: "Get people hiking together.", access: [0, 1, 2, 3], sustain: [3, 3] });
    // Broken ratings fall back to the type's.
    expect(buildEsnFormData(input({ classification: { esnType: "9", esnObjectives: "424", esnGoal: "", esnAccess: "4,1", esnSustain: "x" } }))).toMatchObject({ access: [1, 2, 1, 3], sustain: [1, 2] });
  });

  it("lists what is missing: no publication, type, address, TBA price", () => {
    const none = buildEsnFormData(input({ published: null, event: { title: "Draft", starts_at: "2026-11-02T18:00:00Z", ends_at: "2026-11-04T18:00:00Z", location: "LMU", price_cents: null } }));
    expect(none.missing).toEqual([MISSING.published, MISSING.type, MISSING.address, MISSING.report, MISSING.price]);
    expect(none).toMatchObject({ title: "Draft", end: "2026-11-04", city: "München", description: "", goal: "" });
  });

  it("the goal: the hook capitalised and the intro's first two sentences", () => {
    expect(esnGoal(quiz)).toBe("A night of trivia. Teams of four battle it out. Prizes for the best three teams!");
    expect(esnGoal({ hook: "", intro: "x".repeat(700) })).toHaveLength(600);
  });
});

describe("status", () => {
  const upload = { activity_url: "https://activities.esn.org/activity/pub-quiz-123", uploaded_at: "2026-11-05T10:00:00Z", uploaded_by: "comms@esnmesa.org", via: "manual" };
  it("not ready (listed) → ready → uploaded", () => {
    expect(esnStatus(buildEsnFormData(input()), null)).toEqual({ state: "not_ready", missing: [MISSING.report] });
    expect(esnStatus(buildEsnFormData(input({ report })), null)).toEqual({ state: "ready" });
    expect(esnStatus(buildEsnFormData(input({ report })), upload)).toEqual({ state: "uploaded", url: upload.activity_url, by: "comms@esnmesa.org", at: upload.uploaded_at, via: "manual" });
  });

  it("a TBA price alone does not block the upload", () => {
    expect(esnStatus({ missing: [MISSING.price] }, null)).toEqual({ state: "ready" });
  });

  it("knows saved activity pages and the form's address", () => {
    expect(isEsnActivityUrl("https://activities.esn.org/activity/pub-quiz-12345")).toBe(true);
    expect(isEsnActivityUrl("https://activities.esn.org/node/987/")).toBe(true);
    expect(isEsnActivityUrl("https://activities.esn.org/add/physical-activity")).toBe(false);
    expect(isEsnActivityUrl("https://evil.example/activity/x")).toBe(false);
    expect(esnUploadUrl("abc")).toBe("https://activities.esn.org/add/physical-activity#mesa=abc");
  });
});

describe("API helpers", () => {
  it("rate limits per key within a window", () => {
    const l = new RateLimiter(2, 1000);
    expect([l.hit("a", 0), l.hit("a", 1), l.hit("a", 2), l.hit("b", 2)]).toEqual([0, 0, 1, 0]);
    expect(l.hit("a", 1001)).toBe(0);
  });

  it("allows CORS for activities.esn.org only", () => {
    expect(corsHeaders(ESN_ORIGIN)["Access-Control-Allow-Origin"]).toBe(ESN_ORIGIN);
    expect(corsHeaders("https://evil.example")["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(corsHeaders(null)).toEqual({ Vary: "Origin", "Cache-Control": "no-store" });
  });

  it("hashes tokens with SHA-256 and knows their shape", () => {
    const token = `mesa_esn_${"A".repeat(43)}`;
    expect(TOKEN_PATTERN.test(token)).toBe(true);
    expect(TOKEN_PATTERN.test("mesa_esn_short")).toBe(false);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fills the script with this platform's address (and a token only when one is given)", () => {
    const plain = userscript("https://events.esnmesa.org/");
    expect(plain).toContain("const BASE = 'https://events.esnmesa.org';");
    expect(plain).toContain("// @connect      events.esnmesa.org");
    expect(plain).toContain("const EMBEDDED_TOKEN = '';");
    expect(plain).not.toContain("__MESA_");
    const token = `mesa_esn_${"b".repeat(43)}`;
    expect(userscript("http://localhost:3000", token)).toContain(`const EMBEDDED_TOKEN = '${token}';`);
    expect(userscript("http://localhost:3000", "x'; alert(1); '")).toContain("const EMBEDDED_TOKEN = '';");
  });
});
