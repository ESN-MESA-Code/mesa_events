// Payment imports (round 2026-11-11): CSV reading, PayPal and pretix
// exports in English and German, references and PayPal.me links, matching.
import { describe, expect, it } from "vitest";
import { centsDe, detectDateOrder, parseAmount, parseCsv, parseDate, parseTime, toCsv } from "@/lib/payments/csv";
import { isTransfer, parsePaypalCsv } from "@/lib/payments/paypal";
import { fetchPretixOrders, fromApiOrder, normaliseProvider, parsePretixCsv, pretixApiConfig, pretixSlugOf, pretixStatus } from "@/lib/payments/pretix";
import { findReferences, newReference, paypalAmount, paypalMeUrl, REFERENCE_ALPHABET } from "@/lib/payments/links";
import { historyOf, matchPayment, type MatchContext, type MatchLink } from "@/lib/payments/match";

describe("CSV", () => {
  it("reads quotes, doubled quotes, newlines inside quotes and a BOM", () => {
    expect(parseCsv('﻿a,b,c\n"1,5","say ""hi""","two\nlines"\r\n\n')).toEqual([
      ["a", "b", "c"],
      ["1,5", 'say "hi"', "two\nlines"],
    ]);
  });
  it("detects semicolons and tabs", () => {
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it.each([
    ["1.234,56", 123456],
    ["1,234.56", 123456],
    ["-12,50", -1250],
    ["12.5", 1250],
    ["€ 5", 500],
    ["(3.00)", -300],
    ["0,35-", -35],
    ["1.234", 123400],
    ["abc", null],
    ["", null],
  ])("amount %s → %s", (raw, cents) => expect(parseAmount(raw)).toBe(cents));
  it("dates in every order", () => {
    expect(parseDate("11.11.2026")).toBe("2026-11-11");
    expect(parseDate("2026-11-03")).toBe("2026-11-03");
    expect(parseDate("03/11/2026", "dmy")).toBe("2026-11-03");
    expect(parseDate("03/11/2026", "mdy")).toBe("2026-03-11");
    expect(parseDate("31.02.2026")).toBeNull();
    expect(detectDateOrder(["01/02/2026", "13/02/2026"])).toBe("dmy");
    expect(detectDateOrder(["02/13/2026"])).toBe("mdy");
    expect(parseTime("2:05:10 PM")).toBe("14:05");
    expect(parseTime("09:30:00")).toBe("09:30");
  });
  it("writes spreadsheet CSV with German decimals", () => {
    expect(toCsv([["a;b", 'x"y'], [centsDe(-1205), centsDe(5)]])).toBe('﻿"a;b";"x""y"\r\n-12,05;0,05\r\n');
  });
});

const PAYPAL_DE = [
  '"Datum","Uhrzeit","Zeitzone","Name","Typ","Status","Währung","Brutto","Gebühr","Netto","Absender E-Mail-Adresse","Empfänger E-Mail-Adresse","Transaktionscode","Betreff","Hinweis","Zugehöriger Transaktionscode","Guthaben"',
  '"03.11.2026","18:02:11","MEZ","Anna Example","Zahlung erhalten","Abgeschlossen","EUR","10,00","-0,55","9,45","anna@example.org","mesa@example.org","1AB23456CD789012E","","MESA-K7Q2P ESNcard","","109,45"',
  '"04.11.2026","10:00:00","MEZ","","Allgemeine Abbuchung","Abgeschlossen","EUR","-100,00","0,00","-100,00","mesa@example.org","","2XY","","","","9,45"',
  '"05.11.2026","12:00:00","MEZ","Bob","Zahlung erhalten","Ausstehend","EUR","5,00","0,00","5,00","bob@example.org","","3XY","","","","9,45"',
  '"05.11.2026","12:30:00","MEZ","Carl","Zahlung erhalten","Abgeschlossen","USD","5,00","0,00","5,00","carl@example.org","","4XY","","","","9,45"',
].join("\n");

const PAYPAL_EN = [
  "Date,Time,TimeZone,Name,Type,Status,Currency,Gross,Fee,Net,From Email Address,To Email Address,Transaction ID,Subject,Note,Reference Txn ID,Balance",
  '11/13/2026,2:05:00 PM,PST,Shop GmbH,Express Checkout Payment,Completed,EUR,"-1,234.50",0.00,"-1,234.50",mesa@example.org,shop@example.com,5ZZ,Hoodies,,,"500.00"',
].join("\n");

describe("PayPal activity download", () => {
  it("reads a German export: completed euro payments only, the balance, the period", () => {
    const r = parsePaypalCsv(PAYPAL_DE);
    expect(r.missing).toEqual([]);
    expect(r.rows.map((x) => x.id)).toEqual(["1AB23456CD789012E", "2XY"]);
    expect(r.rows[0]).toMatchObject({ day: "2026-11-03", time: "18:02", gross: 1000, fee: -55, email: "anna@example.org", note: "MESA-K7Q2P ESNcard", name: "Anna Example" });
    expect(r.rows[1].email).toBe("");
    expect(r.skipped.map((s) => s.reason)).toEqual(["status “Ausstehend”", "in USD"]);
    expect([r.from, r.to]).toEqual(["2026-11-03", "2026-11-04"]);
    expect(r.balance).toEqual({ cents: 945, day: "2026-11-04" });
  });
  it("reads an English (US) export: month first, the recipient as the other side", () => {
    const r = parsePaypalCsv(PAYPAL_EN);
    expect(r.dateOrder).toBe("mdy");
    expect(r.rows[0]).toMatchObject({ day: "2026-11-13", time: "14:05", gross: -123450, email: "shop@example.com", subject: "Hoodies" });
  });
  it("names the missing columns of the wrong report", () => {
    expect(parsePaypalCsv("Foo,Bar\n1,2").missing).toEqual(["date", "gross", "transaction id"]);
  });
  it("knows PayPal's own bookkeeping lines", () => {
    expect(isTransfer("Allgemeine Abbuchung")).toBe(true);
    expect(isTransfer("General Withdrawal")).toBe(true);
    expect(isTransfer("Bank Deposit to PP Account")).toBe(true);
    expect(isTransfer("Hold on Balance for Dispute Investigation")).toBe(true);
    expect(isTransfer("Zahlung erhalten")).toBe(false);
    expect(isTransfer("Express Checkout Payment")).toBe(false);
  });
});

describe("pretix", () => {
  it("takes the event slug from the link", () => {
    expect(pretixSlugOf("https://pretix.eu/esn-mesa/kayaking26/")).toBe("kayaking26");
    expect(pretixSlugOf("https://pretix.eu/esn-mesa/kayaking26/redeem?x=1")).toBe("kayaking26");
    expect(pretixSlugOf("https://tickets.esn-mesa.de/party")).toBe("party");
    expect(pretixSlugOf("https://pretix.eu/")).toBeNull();
    expect(pretixSlugOf("pretix.eu/a/b")).toBeNull();
  });
  it("reads statuses and providers in both languages", () => {
    expect(["Paid", "bezahlt", "p", "Ausstehend", "Storniert", "expired", "?"].map(pretixStatus)).toEqual(["paid", "paid", "paid", "pending", "canceled", "expired", null]);
    expect(["PayPal", "Überweisung", "Stripe (card)", "", "Gratis"].map(normaliseProvider)).toEqual(["paypal", "banktransfer", "stripe", "", "free"]);
  });
  it("reads an organizer export with the event column", () => {
    const csv = ["Event slug,Order code,Order total,Status,Email,Order date,Date of last payment,Payment providers", "kayaking26,abc12,25.00,Paid,a@x.org,2026-11-01,2026-11-02,PayPal", "party,XYZ99,0.00,Paid,,2026-11-01,,Free", "party,BAD!,1,Paid,,,,"].join("\n");
    const r = parsePretixCsv(csv);
    expect(r.hasSlug).toBe(true);
    expect(r.orders).toHaveLength(2);
    expect(r.orders[0]).toMatchObject({ slug: "kayaking26", code: "ABC12", total: 2500, status: "paid", provider: "paypal", orderedOn: "2026-11-01", paidOn: "2026-11-02" });
    expect(r.skipped).toHaveLength(1);
  });
  it("gives a one-event export the chosen event", () => {
    const csv = "Bestellnummer;Bestellsumme;Status;E-Mail\nAAA11;12,50;bezahlt;x@y.de";
    expect(parsePretixCsv(csv).skipped[0].reason).toBe("no event chosen");
    expect(parsePretixCsv(csv, "quiz").orders[0]).toMatchObject({ slug: "quiz", total: 1250 });
  });
  it("maps API orders and follows pages", async () => {
    expect(
      fromApiOrder("quiz", { code: "q1abc", status: "p", total: "10.00", email: "a@b.c", datetime: "2026-11-01T10:00:00Z", fees: [{ value: "0.50" }], positions: [{}, {}], payments: [{ provider: "paypal", state: "confirmed", payment_date: "2026-11-02T08:00:00Z", amount: "10.00" }] })
    ).toMatchObject({ code: "Q1ABC", total: 1000, fees: 50, tickets: 2, provider: "paypal", paidOn: "2026-11-02" });
    const cfg = pretixApiConfig({ PRETIX_ORGANIZER: "esn-mesa", PRETIX_API_TOKEN: "t" })!;
    expect(cfg.url).toBe("https://pretix.eu");
    expect(pretixApiConfig({})).toBeNull();
    const pages: Record<string, unknown> = {
      "https://pretix.eu/api/v1/organizers/esn-mesa/events/quiz/orders/": { next: "https://pretix.eu/api/v1/organizers/esn-mesa/events/quiz/orders/?page=2", results: [{ code: "A1", status: "p", total: "5.00" }] },
      "https://pretix.eu/api/v1/organizers/esn-mesa/events/quiz/orders/?page=2": { next: "https://evil.example/next", results: [{ code: "A2", status: "n", total: "5.00" }] },
    };
    const seen: string[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      seen.push(url);
      expect((init.headers as Record<string, string>).Authorization).toBe("Token t");
      return new Response(JSON.stringify(pages[url]), { status: 200 });
    }) as unknown as typeof fetch;
    const orders = await fetchPretixOrders(cfg, "quiz", fake);
    expect(orders.map((o) => `${o.code}:${o.status}`)).toEqual(["A1:paid", "A2:pending"]);
    expect(seen).toHaveLength(2);
  });
});

describe("payment links", () => {
  it("makes references from the unambiguous alphabet", () => {
    expect(REFERENCE_ALPHABET).not.toMatch(/[01OI]/);
    const ref = newReference(() => new Uint8Array([0, 31, 32, 255, 9]));
    expect(ref).toMatch(/^MESA-[2-9A-HJ-NP-Z]{5}$/);
    expect(ref).toBe("MESA-2Z2ZB");
  });
  it("builds PayPal.me links", () => {
    expect(paypalAmount(500)).toBe("5");
    expect(paypalAmount(550)).toBe("5.50");
    expect(paypalMeUrl("esnmesa", 1050)).toBe("https://paypal.me/esnmesa/10.50EUR");
    expect(paypalMeUrl("esnmesa", null)).toBe("https://paypal.me/esnmesa");
  });
  it("finds references however they were typed", () => {
    const known = new Set(["MESA-K7Q2P", "MESA-ABCDE"]);
    expect(findReferences(["mesa k7q2p thanks"], known)).toEqual(["MESA-K7Q2P"]);
    expect(findReferences(["MESAK7Q2P"], known)).toEqual(["MESA-K7Q2P"]);
    expect(findReferences(["for k7q2p"], known)).toEqual(["MESA-K7Q2P"]);
    expect(findReferences(["MESA-ZZZZZ"], known)).toEqual([]);
    expect(findReferences(["XK7Q2PX"], known)).toEqual([]);
  });
});

describe("matching", () => {
  const link = (over: Partial<MatchLink>): MatchLink => ({ id: "l1", reference: "MESA-K7Q2P", title: "ESNcard", amount: 1000, categoryId: "cards", eventId: null, internalEventId: "oh1", day: "2026-11-03", active: true, ...over });
  const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({ links: [link({})], orders: [], history: new Map(), ticketCategoryId: "tickets", ...over });
  const pay = { gross: 1000, day: "2026-11-03", type: "Zahlung erhalten", subject: "", note: "", invoice: "", email: "a@x.org" };

  it("ignores PayPal's own bookkeeping", () => {
    expect(matchPayment({ ...pay, type: "General Withdrawal", gross: -5000 }, ctx()).kind).toBe("transfer");
  });
  it("books by the reference", () => {
    const m = matchPayment({ ...pay, note: "mesa-k7q2p" }, ctx());
    expect(m).toMatchObject({ kind: "reference", link: { id: "l1" } });
  });
  it("only suggests for money back that names a reference", () => {
    expect(matchPayment({ ...pay, gross: -1000, note: "MESA-K7Q2P" }, ctx())).toMatchObject({ kind: "suggestion", linkId: null, internalEventId: "oh1" });
  });
  it("books pretix orders of linked events, suggests for unlinked ones", () => {
    const orders = [{ code: "ABC12", slug: "quiz", total: 1000, eventId: "ev1", eventTitle: "Quiz" }];
    expect(matchPayment({ ...pay, invoice: "esn-mesa-quiz-ABC12" }, ctx({ orders }))).toMatchObject({ kind: "pretix", order: { eventId: "ev1" } });
    expect(matchPayment({ ...pay, subject: "Order ABC12" }, ctx({ orders: [{ ...orders[0], eventId: null }] }))).toMatchObject({ kind: "suggestion", eventId: null });
  });
  it("suggests a link of the same amount around its day, the closest first", () => {
    const links = [link({ id: "far", reference: "MESA-AAAAA", day: "2026-10-01" }), link({ id: "near", reference: "MESA-BBBBB", day: "2026-11-04" }), link({ id: "merch", reference: "MESA-CCCCC", day: null, internalEventId: null })];
    const m = matchPayment(pay, ctx({ links }));
    expect(m).toMatchObject({ kind: "suggestion", linkId: "near" });
    expect(m.kind === "suggestion" && m.reason).toContain("1 more link");
    expect(matchPayment({ ...pay, gross: 777 }, ctx({ links })).kind).toBe("none");
  });
  it("suggests the payer's usual category", () => {
    const history = historyOf([
      { email: "A@x.org", categoryId: "merch" },
      { email: "a@x.org", categoryId: "merch" },
      { email: "a@x.org", categoryId: "other" },
    ]);
    expect(matchPayment({ ...pay, gross: 4242 }, ctx({ history }))).toMatchObject({ kind: "suggestion", categoryId: "merch" });
  });
});
