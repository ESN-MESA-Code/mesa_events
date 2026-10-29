// Hand-in and reimbursements: the formula in the database equals the
// TypeScript one, policies are versioned and Treasurer-only, receipts and
// bank details are Finance's and the claimant's only, statuses, batches,
// early payout, pre-approval, trip budgets, no receipt or event photos in Storage.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, admin, anonClient, as, createEvent, daysFromNow, type SeedUser } from "../helpers/local";
import { actionContext } from "./actionContext";
import * as H from "@/lib/actions/handin";
import { SPEC_RULES, suggestAmount, type Rule } from "@/lib/reimbursement";
import type { Json } from "@/types/database";

const IBAN = "DE89370400440532013000";
const bank = { payout_method: "bank" as const, account_holder: "Hugo Helper", iban: "DE89 3704 0044 0532 0130 00" };
const cleanupEvents: string[] = [];

async function register(user: SeedUser, eventId: string, extra: Record<string, unknown> = {}) {
  return H.registerReceipt(await actionContext(user), {
    event_id: eventId,
    kind: "ticket",
    vendor: "Shamrock",
    amount_cents: 2500,
    purchased_on: "2026-11-01",
    payout: bank,
    ...extra,
  });
}
const claimId = (r: Awaited<ReturnType<typeof register>>) => {
  if (!r.ok) throw new Error(r.message);
  return r.data.claim_id;
};

let standard: string;
let weekend: string;
let other: string;

beforeAll(async () => {
  standard = (await createEvent({ title: "Quiz (claims)", type: "standard", oc: USERS.oc, helpers: [USERS.helper], starts_at: daysFromNow(-2) })).id;
  weekend = (await createEvent({ title: "Alps (claims)", type: "weekend_trip", oc: USERS.oc, helpers: [USERS.helper], starts_at: daysFromNow(10), ends_at: daysFromNow(12) })).id;
  other = (await createEvent({ title: "Other (claims)", oc: USERS.volunteer1, helpers: [USERS.volunteer2], starts_at: daysFromNow(-3) })).id;
  cleanupEvents.push(standard, weekend, other);
});
afterAll(async () => {
  const { data: claims } = await admin.from("reimbursements").select("id, receipt_id").in("event_id", cleanupEvents);
  if (claims?.length) {
    await admin.from("reimbursements").delete().in("id", claims.map((c) => c.id));
    await admin.from("receipts").delete().in("id", claims.map((c) => c.receipt_id));
  }
  await admin.from("events").delete().in("id", cleanupEvents);
  await admin.from("reimbursement_policies").delete().gt("version", 1);
});

describe("the formula in the database equals lib/reimbursement.ts", () => {
  it("version 1 holds exactly the SPEC table", async () => {
    const { data: pol } = await admin.from("reimbursement_policies").select("id").eq("version", 1).single();
    const { data: rules } = await admin.from("reimbursement_rules").select("*").eq("policy_id", pol!.id);
    const strip = (r: Rule) => ({ ...r });
    expect(
      rules!.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== "id" && k !== "policy_id"))).sort((a, b) => `${a.event_type}${a.expense_kind}`.localeCompare(`${b.event_type}${b.expense_kind}`))
    ).toEqual(SPEC_RULES.map(strip).sort((a, b) => `${a.event_type}${a.expense_kind}`.localeCompare(`${b.event_type}${b.expense_kind}`)));
  });

  it("for every rule, role, amount, day count, pre-approval and budget", async () => {
    const { data: pol } = await admin.from("reimbursement_policies").select("id").eq("version", 1).single();
    const { data: rules } = await admin.from("reimbursement_rules").select("*").eq("policy_id", pol!.id);
    const caller = await as(USERS.finance);
    for (const rule of rules!) {
      for (const role of ["oc", "helper"] as const) {
        for (const amount of [0, 1, 799, 999, 1600, 2501, 30000]) {
          for (const days of [null, 1, 3]) {
            for (const preapproved of [false, true]) {
              for (const budget of rule.within_trip_budget ? [null, 0, 1000, 100000] : [null]) {
                const ts = suggestAmount({ rule, role, amountCents: amount, days, preapproved, budgetRemainingCents: budget });
                const { data, error } = await caller.rpc("suggest_reimbursement", {
                  rule: rule.id, claim_role: role, amount_cents: amount, days: days ?? undefined, preapproved, budget_left_cents: budget ?? undefined,
                });
                expect(error).toBeNull();
                expect({ suggestedCents: data![0].suggested_cents, flags: data![0].flags }, `${rule.event_type}/${rule.expense_kind} ${role} ${amount} ${days} ${preapproved} ${budget}`).toEqual(ts);
              }
            }
          }
        }
      }
    }
  }, 120_000);
});

describe("registering receipts", () => {
  it("the event's OC and helpers claim; the database computes the suggestion", async () => {
    const id = claimId(await register(USERS.helper, standard));
    const { data } = await admin.from("reimbursements").select("claimant_role, category, policy_version, suggested_cents, flags, status, payout_method").eq("id", id).single();
    expect(data).toEqual({ claimant_role: "helper", category: "team_costs", policy_version: 1, suggested_cents: 800, flags: ["capped"], status: "not_submitted", payout_method: "bank" });
    const { data: details } = await admin.from("payout_details").select("iban, account_holder").eq("reimbursement_id", id).single();
    expect(details).toEqual({ iban: IBAN, account_holder: "Hugo Helper" });
  });

  it("others cannot claim on an event (other events' staff, members, Finance)", async () => {
    for (const u of [USERS.volunteer1, USERS.member, USERS.finance, USERS.events]) {
      expect(await register(u, standard), u.email).toMatchObject({ ok: false, error: "forbidden" });
      expect((await (await as(u)).rpc("register_receipt", { event: standard, kind: "ticket", vendor: "x", amount_cents: 100, purchased_on: "2026-11-01" })).error?.code, u.email).toBe("42501");
    }
  });

  it("refuses kinds the event type has no rule for, bad IBANs and bad input", async () => {
    expect(await register(USERS.oc, standard, { kind: "travel_accommodation" })).toMatchObject({ ok: false });
    expect(await register(USERS.oc, standard, { payout: { ...bank, iban: "DE00 1234" } })).toMatchObject({ ok: false, error: "invalid_input" });
    expect(await register(USERS.oc, standard, { amount_cents: -5 })).toMatchObject({ ok: false, error: "invalid_input" });
  });

  it("claims: Finance, executives (read-only) and the claimant; bank details: Finance and the claimant only", async () => {
    const id = claimId(await register(USERS.helper, standard, { vendor: "Visible test" }));
    const sees = async (u: SeedUser) => {
      const c = await as(u);
      const [r, d] = await Promise.all([c.from("reimbursements").select("id").eq("id", id), c.from("payout_details").select("iban").eq("reimbursement_id", id)]);
      return { claim: (r.data ?? []).length, iban: (d.data ?? []).length };
    };
    expect(await sees(USERS.helper)).toEqual({ claim: 1, iban: 1 });
    expect(await sees(USERS.finance)).toEqual({ claim: 1, iban: 1 });
    expect(await sees(USERS.treasurer)).toEqual({ claim: 1, iban: 1 });
    expect(await sees(USERS.executive)).toEqual({ claim: 1, iban: 0 });
    for (const u of [USERS.oc, USERS.events, USERS.admin, USERS.member, USERS.comms]) expect(await sees(u), u.email).toEqual({ claim: 0, iban: 0 });
    expect((await anonClient().from("payout_details").select("iban")).data ?? []).toEqual([]);
    // The event's people see counts only.
    const { data: summary } = await (await as(USERS.oc)).rpc("event_claims_summary", { event: standard });
    expect(summary).toMatchObject({ receipts: expect.any(Number) });
  });

  it("the claimant withdraws a claim before handing in the Beleg", async () => {
    const id = claimId(await register(USERS.oc, standard, { vendor: "Withdrawn" }));
    expect(await H.withdrawReceipt(await actionContext(USERS.helper), { claim_id: id })).toMatchObject({ ok: false, error: "forbidden" });
    expect((await H.withdrawReceipt(await actionContext(USERS.oc), { claim_id: id })).ok).toBe(true);
    expect((await admin.from("reimbursements").select("id").eq("id", id)).data).toEqual([]);
  });
});

describe("Finance: Beleg, check, batch, payout", () => {
  it("only Finance moves claims; the flow ends paid with the bank details gone", async () => {
    const id = claimId(await register(USERS.oc, standard, { vendor: "Flow" }));
    for (const u of [USERS.oc, USERS.events, USERS.executive, USERS.admin]) {
      expect(await H.markBelegReceived(await actionContext(u), { claim_id: id }), u.email).toMatchObject({ ok: false, error: "forbidden" });
      expect((await (await as(u)).rpc("mark_beleg_received", { claim: id })).error?.code, u.email).toBe("42501");
    }
    // Checking needs the Beleg first.
    expect((await H.checkReimbursement(await actionContext(USERS.finance), { claim_id: id, approved_cents: 1600 })).ok).toBe(false);
    expect((await H.markBelegReceived(await actionContext(USERS.finance), { claim_id: id })).ok).toBe(true);
    const { data: receipt } = await admin.from("reimbursements").select("receipts(beleg_received_by, beleg_received_at)").eq("id", id).single();
    expect(receipt!.receipts).toMatchObject({ beleg_received_by: USERS.finance.email });

    // Finance overrides the suggestion.
    expect((await H.checkReimbursement(await actionContext(USERS.finance), { claim_id: id, approved_cents: 1500, note: "Tip not refunded" })).ok).toBe(true);
    const { data: checked } = await admin.from("reimbursements").select("status, approved_cents, batch_id, checked_by").eq("id", id).single();
    expect(checked).toMatchObject({ status: "checked", approved_cents: 1500, checked_by: USERS.finance.email });
    expect(checked!.batch_id).toBeTruthy();

    // €15 is not above €100: no early payout.
    expect((await H.payEarly(await actionContext(USERS.finance), { claim_id: id })).ok).toBe(false);

    expect(await H.payBatch(await actionContext(USERS.oc), { batch_id: checked!.batch_id! })).toMatchObject({ ok: false, error: "forbidden" });
    const paid = await H.payBatch(await actionContext(USERS.finance), { batch_id: checked!.batch_id! });
    expect(paid.ok).toBe(true);
    const { data: after } = await admin.from("reimbursements").select("status, paid_by").eq("id", id).single();
    expect(after).toEqual({ status: "paid", paid_by: USERS.finance.email });
    expect((await admin.from("payout_details").select("*").eq("reimbursement_id", id)).data).toEqual([]);
    expect((await admin.from("payout_batches").select("status").eq("id", checked!.batch_id!).single()).data!.status).toBe("paid");
  });

  it("claims above €100 can be paid early, outside the batch", async () => {
    const special = (await createEvent({ title: "Special (claims)", type: "special", oc: USERS.oc, starts_at: daysFromNow(-1) })).id;
    cleanupEvents.push(special);
    const id = claimId(await register(USERS.oc, special, { amount_cents: 15000, vendor: "Opera" }));
    const fin = await actionContext(USERS.finance);
    await H.markBelegReceived(fin, { claim_id: id });
    await H.checkReimbursement(fin, { claim_id: id, approved_cents: 15000 });
    expect((await H.payEarly(fin, { claim_id: id })).ok).toBe(true);
    const { data } = await admin.from("reimbursements").select("status, early_payout, batch_id").eq("id", id).single();
    expect(data).toEqual({ status: "paid", early_payout: true, batch_id: null });
  });

  it("checking needs payout details; rejecting needs a reason and removes them", async () => {
    const noDetails = claimId(await register(USERS.helper, standard, { payout: null, vendor: "No details" }));
    const fin = await actionContext(USERS.finance);
    await H.markBelegReceived(fin, { claim_id: noDetails });
    expect(await H.checkReimbursement(fin, { claim_id: noDetails, approved_cents: 800 })).toMatchObject({ ok: false });
    expect((await H.setPayoutDetails(await actionContext(USERS.oc), { claim_id: noDetails, payout_method: "paypal", paypal_email: "x@example.com" })).ok).toBe(false);
    expect((await H.setPayoutDetails(await actionContext(USERS.helper), { claim_id: noDetails, payout_method: "paypal", paypal_email: "Hugo@Example.com" })).ok).toBe(true);
    expect((await admin.from("payout_details").select("paypal_email, iban").eq("reimbursement_id", noDetails).single()).data).toEqual({ paypal_email: "hugo@example.com", iban: null });

    expect(await H.rejectReimbursement(fin, { claim_id: noDetails, reason: "" })).toMatchObject({ ok: false, error: "invalid_input" });
    expect((await H.rejectReimbursement(fin, { claim_id: noDetails, reason: "No valid receipt" })).ok).toBe(true);
    expect((await admin.from("payout_details").select("*").eq("reimbursement_id", noDetails)).data).toEqual([]);
  });
});

describe("policy versions", () => {
  it("only the Treasurer publishes; claims keep their version, later events use the new one", async () => {
    const rules = SPEC_RULES.map((r) => (r.event_type === "standard" && r.expense_kind === "ticket" ? { ...r, oc_cap_cents: 2000 } : r));
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    for (const u of [USERS.finance, USERS.events, USERS.admin, USERS.executive]) {
      expect(await H.publishPolicy(await actionContext(u), { effective_from: tomorrow, rules }), u.email).toMatchObject({ ok: false, error: "forbidden" });
      expect((await (await as(u)).rpc("publish_policy", { rules: rules as unknown as Json, effective_from: tomorrow })).error?.code, u.email).toBe("42501");
    }
    for (const u of [USERS.treasurer, USERS.finance]) {
      expect((await (await as(u)).from("reimbursement_rules").update({ oc_cap_cents: 99999 }).eq("expense_kind", "ticket")).error, u.email).not.toBeNull();
    }
    const before = claimId(await register(USERS.oc, standard, { vendor: "Before v2" }));
    const r = await H.publishPolicy(await actionContext(USERS.treasurer), { effective_from: tomorrow, notes: "Higher ticket cap", rules });
    expect(r).toMatchObject({ ok: true, data: { version: 2 } });

    // The past event stays under version 1, a future one uses version 2.
    const future = (await createEvent({ title: "Future (claims)", type: "standard", oc: USERS.oc, starts_at: daysFromNow(5) })).id;
    cleanupEvents.push(future);
    const after = claimId(await register(USERS.oc, future, { vendor: "After v2" }));
    const old = claimId(await register(USERS.oc, standard, { vendor: "Old event" }));
    const rows = await admin.from("reimbursements").select("id, policy_version, suggested_cents").in("id", [before, after, old]);
    const by = Object.fromEntries(rows.data!.map((x) => [x.id, x]));
    expect(by[before]).toMatchObject({ policy_version: 1, suggested_cents: 1600 });
    expect(by[old]).toMatchObject({ policy_version: 1, suggested_cents: 1600 });
    expect(by[after]).toMatchObject({ policy_version: 2, suggested_cents: 2000 });
  });
});

describe("weekend trips: pre-approval and trip budget", () => {
  it("further expenses need the Treasurer's pre-approval", async () => {
    const without = claimId(await register(USERS.helper, weekend, { kind: "further_expenses", amount_cents: 3000, vendor: "Museum" }));
    expect((await admin.from("reimbursements").select("suggested_cents, flags").eq("id", without).single()).data).toEqual({ suggested_cents: 0, flags: ["needs_preapproval"] });

    expect(await H.requestPreapproval(await actionContext(USERS.volunteer1), { event_id: weekend, description: "Castle", estimated_cents: 3000 })).toMatchObject({ ok: false });
    const req = await H.requestPreapproval(await actionContext(USERS.helper), { event_id: weekend, description: "Castle tickets", estimated_cents: 3000 });
    const preId = (req as { data: { id: string } }).data.id;
    expect(await H.decidePreapproval(await actionContext(USERS.finance), { id: preId, approve: true })).toMatchObject({ ok: false, error: "forbidden" });
    expect((await (await as(USERS.finance)).rpc("decide_preapproval", { preapproval: preId, approve: true })).error?.code).toBe("42501");
    expect(await H.decidePreapproval(await actionContext(USERS.treasurer), { id: preId, approve: true, note: "ok" })).toMatchObject({ ok: true });

    const withIt = claimId(await register(USERS.helper, weekend, { kind: "further_expenses", amount_cents: 3000, vendor: "Castle", preapproval_id: preId }));
    expect((await admin.from("reimbursements").select("suggested_cents, flags").eq("id", withIt).single()).data).toEqual({ suggested_cents: 1500, flags: [] });
    // Someone else's pre-approval does not count.
    expect(await register(USERS.oc, weekend, { kind: "further_expenses", amount_cents: 3000, preapproval_id: preId })).toMatchObject({ ok: false });
  });

  it("social ancillary costs stay within a budget set before the trip", async () => {
    expect(await H.setTripBudget(await actionContext(USERS.oc), { event_id: weekend, amount_cents: 5000 })).toMatchObject({ ok: false, error: "forbidden" });
    const first = claimId(await register(USERS.oc, weekend, { kind: "social_ancillary", amount_cents: 2000, vendor: "Games" }));
    expect((await admin.from("reimbursements").select("suggested_cents, flags").eq("id", first).single()).data).toEqual({ suggested_cents: 0, flags: ["no_trip_budget"] });
    await admin.from("reimbursements").update({ status: "rejected" }).eq("id", first);

    expect((await H.setTripBudget(await actionContext(USERS.finance), { event_id: weekend, amount_cents: 5000 })).ok).toBe(true);
    const a = claimId(await register(USERS.oc, weekend, { kind: "social_ancillary", amount_cents: 3000, vendor: "Snacks" }));
    const b = claimId(await register(USERS.helper, weekend, { kind: "social_ancillary", amount_cents: 3000, vendor: "Drinks" }));
    const rows = Object.fromEntries((await admin.from("reimbursements").select("id, suggested_cents, flags").in("id", [a, b])).data!.map((x) => [x.id, x]));
    expect(rows[a]).toMatchObject({ suggested_cents: 3000, flags: [] });
    expect(rows[b]).toMatchObject({ suggested_cents: 2000, flags: ["over_trip_budget"] });
    // Not after the trip started.
    expect((await H.setTripBudget(await actionContext(USERS.finance), { event_id: standard, amount_cents: 5000 })).ok).toBe(false);
  });

  it("food allowance per day", async () => {
    const id = claimId(await register(USERS.helper, weekend, { kind: "food_allowance", amount_cents: 5000, days: 3, vendor: "Supermarket" }));
    expect((await admin.from("reimbursements").select("suggested_cents").eq("id", id).single()).data!.suggested_cents).toBe(2400);
  });
});

describe("the activity log does not leak claims (review B1)", () => {
  it("a real claim's log entries: Finance only, not the event's OC and helpers or other teams", async () => {
    // The OC claims on an event the helper is staff of too; Finance moves it on.
    const id = claimId(await register(USERS.oc, standard, { vendor: "Log leak test" }));
    expect((await H.markBelegReceived(await actionContext(USERS.finance), { claim_id: id })).ok).toBe(true);
    expect((await H.rejectReimbursement(await actionContext(USERS.finance), { claim_id: id, reason: "Duplicate of another receipt" })).ok).toBe(true);
    const { data: all } = await admin.from("activity_log").select("id, details").eq("entity", "reimbursements").eq("entity_id", id);
    expect(all!.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(all)).toContain("Duplicate of another receipt");

    const seen = async (u: SeedUser) => (await (await as(u)).from("activity_log").select("id, details").eq("entity_id", id)).data ?? [];
    // The helper of the same event: staff of it, yet none of the claim's entries.
    expect(await seen(USERS.helper)).toEqual([]);
    for (const u of [USERS.oc, USERS.events, USERS.admin, USERS.comms, USERS.member]) expect(await seen(u), u.email).toEqual([]);
    expect(await seen(USERS.finance)).toHaveLength(all!.length);
    // Executives oversee Finance read-only (review C4).
    expect(await seen(USERS.executive)).toHaveLength(all!.length);
    expect(await seen(USERS.treasurer)).toHaveLength(all!.length);
    // Nothing of a claim reaches the event's staff through the event filter either.
    const { data: viaEvent } = await (await as(USERS.helper)).from("activity_log").select("entity, details").eq("event_id", standard);
    expect(viaEvent!.length).toBeGreaterThan(0); // the event and its roster
    expect(viaEvent!.filter((l) => l.entity === "reimbursements")).toEqual([]);
    expect(JSON.stringify(viaEvent)).not.toContain("Log leak test");
  });
});

describe("Storage: no files at all", () => {
  const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" });

  it("receipts are data only: no receipt photo bucket, column or parameter", async () => {
    // The paper Beleg is mandatory; nothing about a receipt is stored as a file.
    const helper = await as(USERS.helper);
    expect((await helper.storage.from("receipts").upload(`${standard}/${USERS.helper.id}/${crypto.randomUUID()}.png`, png, { contentType: "image/png" })).error).not.toBeNull();
    expect((await admin.storage.getBucket("receipts")).error).not.toBeNull();
    expect((await admin.from("receipts").select("reference_path" as "id").limit(1)).error).not.toBeNull();
    const old = await helper.rpc("register_receipt" as never, { event: standard, kind: "ticket", vendor: "x", amount_cents: 100, purchased_on: "2026-11-01", reference_path: "a/b/c.png" } as never);
    expect(old.error).not.toBeNull();
    // Unknown fields are not passed on by the action either.
    const r = await register(USERS.helper, standard, { vendor: "No photo", reference_path: "../../etc/passwd" });
    expect(r.ok).toBe(true);
    const { data } = await admin.from("receipts").select("expense_kind, vendor, amount_cents, purchased_on, description").eq("vendor", "No photo").single();
    expect(data).toEqual({ expense_kind: "ticket", vendor: "No photo", amount_cents: 2500, purchased_on: "2026-11-01", description: "" });
  });

  it("no event photos in Storage either: they go to Drive (brief 2026-10-29, A)", async () => {
    expect((await admin.storage.getBucket("event-photos")).error).not.toBeNull();
    expect((await (await as(USERS.oc)).storage.from("event-photos").upload(`${standard}/${crypto.randomUUID()}.png`, png, { contentType: "image/png" })).error).not.toBeNull();
    expect((await (await as(USERS.oc)).rpc("add_event_photo" as never, { event: standard } as never)).error).not.toBeNull();
  });
});
