// Payments (round 2026-11-11): PayPal links and their references, the PayPal
// import with automatic booking (reference, pretix order, transfers) and
// the queue, booking with the fee as its own line, unbooking, the guards
// on imported lines, pretix slugs from Comms' links, pretix orders booked
// per event, budget lines – and who may do what.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, admin, as, createEvent } from "../helpers/local";
import { actionContext } from "./actionContext";
import * as A from "@/lib/actions/payments";
import * as P from "@/lib/actions/publishing";
import { parsePaypalCsv } from "@/lib/payments/paypal";

const tag = crypto.randomUUID().slice(0, 6).toUpperCase();
const txn = (n: number) => `T${tag}${n}`;
let eventId: string;
let slug: string;
let importId: string;
const cat = async (direction: string, name: string) => (await admin.from("finance_categories").select("id").eq("direction", direction).eq("name", name).single()).data!.id;

beforeAll(async () => {
  eventId = (await createEvent({ title: `Payments test ${tag}`, status: "confirmed" })).id;
  slug = `pay-${tag.toLowerCase()}`;
});

afterAll(async () => {
  await admin.from("pretix_orders").delete().ilike("event_slug", `%${tag.toLowerCase()}%`);
  await admin.from("payments").delete().like("external_id", `T${tag}%`);
  await admin.from("finance_entries").delete().eq("event_id", eventId);
  await admin.from("payment_links").delete().eq("event_id", eventId);
  await admin.from("payment_links").delete().like("title", `%${tag}%`);
  await admin.from("budget_lines").delete().eq("event_id", eventId);
  await admin.from("payment_imports").delete().like("filename", `%${tag}%`);
  await admin.from("publication_posts").delete().like("link", `%${slug}%`);
  await admin.from("events").delete().eq("id", eventId);
});

describe("payment links", () => {
  it("Finance creates them with a fresh reference; members read them, nobody else writes", async () => {
    const r = await A.createLink(await actionContext(USERS.finance), { title: `Drinks ${tag}`, amount_cents: 300, category_id: await cat("income", "Cash box takings"), event_id: eventId });
    expect(r).toMatchObject({ ok: true, data: { reference: expect.stringMatching(/^MESA-[2-9A-HJ-NP-Z]{5}$/) } });
    expect(await A.createLink(await actionContext(USERS.events), { title: "x", amount_cents: 1, category_id: await cat("income", "Other income") })).toMatchObject({ ok: false, error: "forbidden" });
    // Spending categories are refused.
    expect(await A.createLink(await actionContext(USERS.finance), { title: `x ${tag}`, amount_cents: 1, category_id: await cat("expense", "Event costs") })).toMatchObject({ ok: false });
    expect((await (await as(USERS.member)).from("payment_links").select("id").eq("event_id", eventId)).data).toHaveLength(1);
    expect((await (await as(USERS.member)).from("payment_links").insert({ reference: "MESA-ZZZZZ", title: "x", category_id: await cat("income", "Other income") })).error).not.toBeNull();
  });

  it("an event's ticket link (made on its Cash tab) books as event revenue", async () => {
    const r = await A.createLinkHere(await actionContext(USERS.finance), { event_id: eventId, kind: "ticket", title: "", amount_cents: 1000 });
    expect(r).toMatchObject({ ok: true, data: { existing: false } });
    expect((await admin.from("payment_links").select("title, finance_categories(name)").eq("event_id", eventId).eq("title", "Ticket").single()).data).toEqual({ title: "Ticket", finance_categories: { name: "Event revenue" } });
  });
});

describe("PayPal import", () => {
  it("books by reference and pretix order, ignores transfers, queues the rest with suggestions", async () => {
    const ctx = await actionContext(USERS.finance);
    const ticket = (await admin.from("payment_links").select("reference").eq("event_id", eventId).eq("title", "Ticket").single()).data!.reference;
    // A pretix order of the event (linked by its slug).
    expect((await A.linkPretixEvent(ctx, { event_id: eventId, slug })).ok).toBe(true);
    const imp = await A.startImport(ctx, { source: "pretix_csv", filename: `test ${tag}` });
    expect(imp.ok).toBe(true);
    const order = { slug, code: `Q${tag.slice(0, 4)}`, status: "paid" as const, email: "", name: "", total: 1500, fees: 0, tickets: 1, provider: "paypal", orderedOn: "2026-11-01", paidOn: "2026-11-01" };
    expect(await A.importPretixOrders(ctx, { import_id: imp.ok ? imp.data.id : "", orders: [order, { ...order, code: `B${tag.slice(0, 4)}`, provider: "banktransfer", total: 2000 }] })).toMatchObject({ ok: true, data: { added: 2, unlinked: [] } });

    const csv = [
      "Datum,Uhrzeit,Zeitzone,Name,Typ,Status,Währung,Brutto,Gebühr,Netto,Absender E-Mail-Adresse,Empfänger E-Mail-Adresse,Transaktionscode,Betreff,Hinweis,Guthaben",
      `03.11.2026,18:00:00,MEZ,Anna,Zahlung erhalten,Abgeschlossen,EUR,"10,00","-0,55","9,45",anna-${tag}@example.org,,${txn(1)},,"for ${ticket.toLowerCase()}","9,45"`,
      `03.11.2026,19:00:00,MEZ,Ben,Zahlung erhalten,Abgeschlossen,EUR,"15,00","-0,70","14,30",ben@example.org,,${txn(2)},"esn-mesa-${slug}-${order.code}",,"23,75"`,
      `04.11.2026,10:00:00,MEZ,,Allgemeine Abbuchung,Abgeschlossen,EUR,"-20,00","0,00","-20,00",,,${txn(3)},,,"3,75"`,
      `05.11.2026,10:00:00,MEZ,Carla,Zahlung erhalten,Abgeschlossen,EUR,"3,00","0,00","3,00",carla@example.org,,${txn(4)},,"thanks!","6,75"`,
      `06.11.2026,10:00:00,MEZ,Shop,Zahlung gesendet,Abgeschlossen,EUR,"-50,00","0,00","-50,00",,shop@example.org,${txn(5)},Hoodies,,"-43,25"`,
    ].join("\n");
    const parsed = parsePaypalCsv(csv);
    expect(parsed.rows).toHaveLength(5);
    const s = await A.startImport(ctx, { source: "paypal", filename: `paypal ${tag}.csv` });
    importId = s.ok ? s.data.id : "";
    expect(await A.addPaypalRows(ctx, { import_id: importId, rows: parsed.rows })).toMatchObject({ ok: true, data: { added: 5, known: 0 } });
    // Again: nothing new.
    expect(await A.addPaypalRows(ctx, { import_id: importId, rows: parsed.rows })).toMatchObject({ ok: true, data: { added: 0, known: 5 } });
    const m = await A.matchPayments(ctx, { import_id: importId });
    expect(m).toMatchObject({ ok: true, data: { booked: 2, ignored: 1, remaining: 0 } });

    const pay = async (n: number) => (await admin.from("payments").select("status, matched_by, suggestion, suggested_link_id, link_id, ignore_reason").eq("external_id", txn(n)).single()).data!;
    expect(await pay(1)).toMatchObject({ status: "booked", matched_by: "reference" });
    expect(await pay(2)).toMatchObject({ status: "booked", matched_by: "pretix" });
    expect(await pay(3)).toMatchObject({ status: "ignored", ignore_reason: expect.stringContaining("Abbuchung") });
    // The drinks link is € 3 at this event – but the event is a week away, so no suggestion by amount… unless the day fits.
    expect((await pay(4)).status).toBe("open");
    expect((await pay(5)).status).toBe("open");

    // The reference booked income plus the fee as its own line.
    const lines = (await admin.from("finance_entries").select("direction, amount_cents, is_fee, event_id, payment_method, payments!inner(external_id)").eq("payments.external_id", txn(1))).data!;
    expect(lines.map((l) => [l.direction, l.amount_cents, l.is_fee, l.event_id, l.payment_method]).sort()).toEqual([
      ["expense", 55, true, eventId, "paypal"],
      ["income", 1000, false, eventId, "paypal"],
    ]);
    // The pretix order knows its PayPal payment.
    expect((await admin.from("pretix_orders").select("payment_id").eq("code", order.code).single()).data!.payment_id).not.toBeNull();
  });

  it("only the booking functions change a payment's status; imported lines are not deleted or re-dated by hand", async () => {
    const fin = await as(USERS.finance);
    const id = (await admin.from("payments").select("id").eq("external_id", txn(4)).single()).data!.id;
    expect((await fin.from("payments").update({ status: "booked" }).eq("id", id)).error?.message).toContain("Book or ignore");
    const entry = (await admin.from("finance_entries").select("id, payments!inner(external_id)").eq("payments.external_id", txn(1)).eq("is_fee", false).single()).data!.id;
    expect((await fin.from("finance_entries").update({ amount_cents: 1 }).eq("id", entry)).error?.message).toContain("imported payment");
    await fin.from("finance_entries").delete().eq("id", entry);
    expect((await admin.from("finance_entries").select("id").eq("id", entry)).data).toHaveLength(1);
    // Its category and text may change.
    expect((await fin.from("finance_entries").update({ description: "Ticket (relabelled)" }).eq("id", entry)).error).toBeNull();
  });

  it("Finance books from the queue, in bulk, ignores and unbooks; nobody else sees payments", async () => {
    const ctx = await actionContext(USERS.finance);
    const id = async (n: number) => (await admin.from("payments").select("id").eq("external_id", txn(n)).single()).data!.id;
    expect(await A.bookPayment(ctx, { id: await id(5), category_id: await cat("income", "Donations") })).toMatchObject({ ok: false, message: expect.stringContaining("category for spending") });
    expect(await A.bookPayments(ctx, { ids: [await id(5)], category_id: await cat("expense", "Merchandise") })).toMatchObject({ ok: true, data: { booked: 1 } });
    expect(await A.bookPayment(await actionContext(USERS.events), { id: await id(4), category_id: await cat("income", "Donations") })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await A.ignorePayments(ctx, { ids: [await id(4)], reason: "Private payment by mistake (sent back)" })).toMatchObject({ ok: true });
    expect(await A.unbookPayment(ctx, { id: await id(4) })).toMatchObject({ ok: true });
    expect(await A.bookPayment(ctx, { id: await id(4), category_id: await cat("income", "Donations"), event_id: eventId })).toMatchObject({ ok: true });
    expect((await admin.from("payments").select("status, matched_by").eq("id", await id(4)).single()).data).toEqual({ status: "booked", matched_by: "manual" });
    // Unbooking removes its ledger lines.
    expect(await A.unbookPayment(ctx, { id: await id(1) })).toMatchObject({ ok: true });
    expect((await admin.from("finance_entries").select("id").eq("payment_id", await id(1))).data).toHaveLength(0);

    expect((await (await as(USERS.member)).from("payments").select("id").eq("id", await id(4))).data).toEqual([]);
    expect((await (await as(USERS.events)).from("payments").select("id").eq("id", await id(4))).data).toEqual([]);
    expect((await (await as(USERS.executive)).from("payments").select("id").eq("id", await id(4))).data).toHaveLength(1);
  });
});

describe("pretix", () => {
  it("orders paid otherwise than PayPal are booked per event, once", async () => {
    const ctx = await actionContext(USERS.finance);
    const r = await A.bookPretixOrders(ctx, { event_id: eventId, category_id: await cat("income", "Event revenue") });
    expect(r).toMatchObject({ ok: true, data: { orders: 1 } });
    expect(await A.bookPretixOrders(ctx, { event_id: eventId, category_id: await cat("income", "Event revenue") })).toMatchObject({ ok: true, data: { orders: 0 } });
    const line = (await admin.from("finance_entries").select("amount_cents, payment_method, counterparty").eq("event_id", eventId).eq("counterparty", "pretix").single()).data;
    expect(line).toEqual({ amount_cents: 2000, payment_method: "bank", counterparty: "pretix" });
  });

  it("Comms' pretix link sets the event's slug and links its orders", async () => {
    // Unlink, then let Comms' tick link it again.
    expect((await A.linkPretixEvent(await actionContext(USERS.finance), { event_id: eventId, slug: "" })).ok).toBe(true);
    expect((await admin.from("pretix_orders").select("event_id").eq("event_slug", slug)).data!.every((o) => o.event_id === null)).toBe(true);
    const res = await P.setPretixReady(await actionContext(USERS.comms), { event_id: eventId, ready: true, link: `https://pretix.eu/esnmesa/${slug}/` });
    expect(res.ok).toBe(true);
    expect((await admin.from("events").select("pretix_slug").eq("id", eventId).single()).data!.pretix_slug).toBe(slug);
    expect((await admin.from("pretix_orders").select("event_id").eq("event_slug", slug)).data!.every((o) => o.event_id === eventId)).toBe(true);
  });
});

describe("budget and settings", () => {
  it("Finance plans; executives read; others nothing", async () => {
    const ctx = await actionContext(USERS.finance);
    expect(await A.saveBudgetLine(ctx, { semester: "2026-2", category_id: await cat("expense", "Event costs"), event_id: eventId, label: `test ${tag}`, planned_cents: 50000 })).toMatchObject({ ok: true });
    expect((await (await as(USERS.executive)).from("budget_lines").select("id").eq("event_id", eventId)).data).toHaveLength(1);
    expect((await (await as(USERS.member)).from("budget_lines").select("id").eq("event_id", eventId)).data).toEqual([]);
    expect(await A.saveBudgetLine(await actionContext(USERS.events), { semester: "2026-2", category_id: await cat("expense", "Event costs"), planned_cents: 1 })).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("only Finance sets the PayPal.me name, letters and digits only", async () => {
    expect(await A.savePaypalSettings(await actionContext(USERS.events), { handle: "x", account_name: "" })).toMatchObject({ ok: false });
    expect(await A.savePaypalSettings(await actionContext(USERS.finance), { handle: "esn mesa", account_name: "" })).toMatchObject({ ok: false });
    // "@name" and the whole link work too; the default is MESA's account.
    const before = (await admin.from("app_settings").select("key, value").in("key", ["paypal_me_handle", "paypal_account_name"])).data!;
    try {
      expect((await A.savePaypalSettings(await actionContext(USERS.finance), { handle: "@mesamunich", account_name: "ESN MESA e.V." })).ok).toBe(true);
      expect((await admin.from("app_settings").select("value").eq("key", "paypal_me_handle").single()).data!.value).toBe("mesamunich");
      expect((await A.savePaypalSettings(await actionContext(USERS.finance), { handle: "https://www.paypal.me/mesamunich/5EUR", account_name: "" })).ok).toBe(true);
      expect((await admin.from("app_settings").select("value").eq("key", "paypal_me_handle").single()).data!.value).toBe("mesamunich");
    } finally {
      await admin.from("app_settings").upsert(before, { onConflict: "key" });
    }
  });
});

describe("QR codes made by the people on duty (round 2026-11-11 (2))", () => {
  it("the OC makes links for their event with their own amount; others may not", async () => {
    const ev = await createEvent({ title: `Staff links ${tag}`, oc: USERS.oc, helpers: [USERS.helper] });
    try {
      const r = await A.createLinkHere(await actionContext(USERS.oc), { event_id: ev.id, kind: "drinks", title: "Beer", amount_cents: 300 });
      expect(r).toMatchObject({ ok: true, data: { reference: expect.stringMatching(/^MESA-[2-9A-HJ-NP-Z]{5}$/), existing: false } });
      const link = (await admin.from("payment_links").select("id, title, amount_cents, created_by, finance_categories(name)").eq("event_id", ev.id).single()).data!;
      expect(link).toMatchObject({ title: "Beer", amount_cents: 300, created_by: USERS.oc.email, finance_categories: { name: "Cash box takings" } });
      // A helper makes a second price; a ticket books as event revenue.
      expect((await A.createLinkHere(await actionContext(USERS.helper), { event_id: ev.id, kind: "ticket", amount_cents: 1200 })).ok).toBe(true);
      expect(await A.createLinkHere(await actionContext(USERS.member), { event_id: ev.id, kind: "drinks", amount_cents: 300 })).toMatchObject({ ok: false, error: "forbidden" });
      expect(await A.createLinkHere(await actionContext(USERS.oc), { event_id: ev.id, kind: "esncard_internal", amount_cents: null })).toMatchObject({ ok: false });
      // Switching off: the OC yes, a member no.
      expect(await A.setLinkActive(await actionContext(USERS.member), { id: link.id, active: false })).toMatchObject({ ok: false, error: "forbidden" });
      expect((await A.setLinkActive(await actionContext(USERS.oc), { id: link.id, active: false })).ok).toBe(true);
      expect((await admin.from("payment_links").select("active").eq("id", link.id).single()).data!.active).toBe(false);
    } finally {
      await admin.from("payment_links").delete().eq("event_id", ev.id);
      await admin.from("events").delete().eq("id", ev.id);
    }
  });

  it("ESNcard links of an office hour: the current price, one per card", async () => {
    const { data: oh } = await admin.from("internal_events").insert({ kind: "office_hour", title: `Office hour ${tag}`, starts_at: new Date(Date.now() + 2 * 86_400_000).toISOString() }).select("id").single();
    try {
      await admin.from("internal_event_people").insert({ internal_event_id: oh!.id, profile_id: USERS.oc.id, role: "oc" });
      const price = (await admin.from("app_settings").select("value").eq("key", "esncard_price_internal_cents").maybeSingle()).data?.value ?? null;
      const ctx = await actionContext(USERS.oc);
      const first = await A.createLinkHere(ctx, { internal_event_id: oh!.id, kind: "esncard_internal", amount_cents: null });
      expect(first).toMatchObject({ ok: true, data: { existing: false } });
      expect((await admin.from("payment_links").select("amount_cents").eq("internal_event_id", oh!.id).single()).data!.amount_cents).toBe(price);
      // Again with another amount: the same link, the new amount.
      const again = await A.createLinkHere(ctx, { internal_event_id: oh!.id, kind: "esncard_internal", amount_cents: 1100 });
      expect(again).toMatchObject({ ok: true, data: { existing: true, reference: first.ok ? first.data.reference : "" } });
      expect((await admin.from("payment_links").select("amount_cents").eq("internal_event_id", oh!.id).single()).data!.amount_cents).toBe(1100);
      expect(await A.createLinkHere(ctx, { internal_event_id: oh!.id, kind: "ticket", amount_cents: 500 })).toMatchObject({ ok: false });
    } finally {
      await admin.from("payment_links").delete().eq("internal_event_id", oh!.id);
      await admin.from("internal_events").delete().eq("id", oh!.id);
    }
  });
});

describe("an office hour's ESNcard QR codes come with its cash box (round 2026-11-11 (3))", () => {
  it("starting the box makes both, once", async () => {
    const { startCashBox } = await import("@/lib/actions/cash");
    const { data: oh } = await admin.from("internal_events").insert({ kind: "office_hour", title: `Auto codes ${tag}`, starts_at: new Date(Date.now() + 3 * 86_400_000).toISOString() }).select("id").single();
    try {
      await admin.from("internal_event_people").insert({ internal_event_id: oh!.id, profile_id: USERS.oc.id, role: "oc" });
      const ctx = await actionContext(USERS.oc);
      expect((await startCashBox(ctx, { internal_event_id: oh!.id })).ok).toBe(true);
      expect((await startCashBox(ctx, { internal_event_id: oh!.id })).ok).toBe(true);
      const links = (await admin.from("payment_links").select("preset, finance_categories(name)").eq("internal_event_id", oh!.id)).data!;
      expect(links.map((l) => l.preset).sort()).toEqual(["esncard_external", "esncard_internal"]);
      expect(links.every((l) => (l.finance_categories as { name: string } | null)?.name === "ESNcard sales")).toBe(true);
    } finally {
      await admin.from("payment_links").delete().eq("internal_event_id", oh!.id);
      await admin.from("cash_reports").delete().eq("internal_event_id", oh!.id);
      await admin.from("internal_events").delete().eq("id", oh!.id);
    }
  });
});
