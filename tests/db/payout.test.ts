// Payout details on the member's profile (round 2026-10-30): saved once,
// copied onto open claims and new ones, readable only by the member (Finance
// sees the claim's copy), deletable – also from claims Finance has not
// checked yet.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, admin, as, createEvent, hoursFromNow } from "../helpers/local";
import { actionContext } from "./actionContext";
import * as H from "@/lib/actions/handin";
import { berlinDate } from "@/lib/dates";

let eventId: string;
const today = berlinDate(new Date().toISOString());
const claimOf = async () => {
  const r = await H.registerReceipt(await actionContext(USERS.volunteer2), { event_id: eventId, kind: "ticket", vendor: "Payout test", amount_cents: 1000, purchased_on: today });
  if (!r.ok) throw new Error(r.message);
  return r.data.claim_id;
};
const details = async (claim: string) => (await admin.from("payout_details").select("iban, paypal_email, account_holder").eq("reimbursement_id", claim).maybeSingle()).data;
const method = async (claim: string) => (await admin.from("reimbursements").select("payout_method").eq("id", claim).single()).data!.payout_method;

beforeAll(async () => {
  await admin.from("profile_payout_details").delete().eq("profile_id", USERS.volunteer2.id);
  eventId = (await createEvent({ title: "Payout profile test", starts_at: hoursFromNow(-3), oc: USERS.oc, helpers: [USERS.volunteer2], helpers_needed: 1 })).id;
});
afterAll(async () => {
  await admin.from("profile_payout_details").delete().eq("profile_id", USERS.volunteer2.id);
  const { data: claims } = await admin.from("reimbursements").select("id").eq("event_id", eventId);
  await admin.from("reimbursements").delete().in("id", (claims ?? []).map((c) => c.id));
  await admin.from("receipts").delete().eq("event_id", eventId);
  await admin.from("events").delete().eq("id", eventId);
});

describe("payout details on the profile", () => {
  it("saving copies them onto the member's open claims; only the member reads them", async () => {
    const open = await claimOf();
    expect(await details(open)).toBeNull();
    const bad = await H.setMyPayoutDetails(await actionContext(USERS.volunteer2), { payout_method: "bank", account_holder: "Vera Volunteer", iban: "DE00 1234" });
    expect(bad).toMatchObject({ ok: false, error: "invalid_input" });
    const r = await H.setMyPayoutDetails(await actionContext(USERS.volunteer2), { payout_method: "bank", account_holder: "Vera Volunteer", iban: "de89 3704 0044 0532 0130 00" });
    expect(r).toMatchObject({ ok: true, data: { claims: 1 } });
    expect(await details(open)).toEqual({ iban: "DE89370400440532013000", paypal_email: null, account_holder: "Vera Volunteer" });
    expect(await method(open)).toBe("bank");
    expect((await (await as(USERS.volunteer2)).from("profile_payout_details").select("iban")).data).toEqual([{ iban: "DE89370400440532013000" }]);
    for (const u of [USERS.finance, USERS.treasurer, USERS.executive, USERS.oc, USERS.admin]) {
      expect((await (await as(u)).from("profile_payout_details").select("iban").eq("profile_id", USERS.volunteer2.id)).data, u.email).toEqual([]);
    }
    // Straight to the table: refused.
    expect((await (await as(USERS.volunteer2)).from("profile_payout_details").update({ iban: "DE02120300000000202051" }).eq("profile_id", USERS.volunteer2.id).select()).data ?? []).toEqual([]);
  });

  it("a new claim gets them; switching to PayPal replaces them on open claims", async () => {
    const fresh = await claimOf();
    expect(await method(fresh)).toBe("bank");
    expect((await H.setMyPayoutDetails(await actionContext(USERS.volunteer2), { payout_method: "paypal", paypal_email: "Vera@Example.com" })).ok).toBe(true);
    expect(await details(fresh)).toEqual({ iban: null, paypal_email: "vera@example.com", account_holder: null });
    expect(await method(fresh)).toBe("paypal");
  });

  it("deleting removes them from the profile and from claims Finance has not checked; checked ones keep theirs", async () => {
    const [checked, unchecked] = (await admin.from("reimbursements").select("id").eq("event_id", eventId).order("created_at")).data!.map((c) => c.id);
    await admin.from("reimbursements").update({ status: "checked", approved_cents: 500 }).eq("id", checked);
    const r = await H.deleteMyPayoutDetails(await actionContext(USERS.volunteer2), {});
    expect(r).toMatchObject({ ok: true, data: { claims: 1 } });
    expect((await admin.from("profile_payout_details").select("profile_id").eq("profile_id", USERS.volunteer2.id)).data).toEqual([]);
    expect(await details(unchecked)).toBeNull();
    expect(await method(unchecked)).toBeNull();
    expect(await details(checked)).not.toBeNull();
  });

  it("details typed into the receipt form are saved once and reach every open claim (round 2026-11-07)", async () => {
    const before = await claimOf();
    expect(await details(before)).toBeNull();
    const r = await H.registerReceipt(await actionContext(USERS.volunteer2), {
      event_id: eventId,
      kind: "ticket",
      vendor: "Payout test (remembered)",
      amount_cents: 1200,
      purchased_on: today,
      payout: { payout_method: "bank", account_holder: "Vera Volunteer", iban: "DE89 3704 0044 0532 0130 00" },
      remember: true,
    });
    if (!r.ok) throw new Error(r.message);
    const saved = { iban: "DE89370400440532013000", paypal_email: null, account_holder: "Vera Volunteer" };
    expect(await details(r.data.claim_id)).toEqual(saved);
    // The claim registered earlier without details got them too, and so does the next one.
    expect(await details(before)).toEqual(saved);
    expect(await details(await claimOf())).toEqual(saved);
    expect((await admin.from("profile_payout_details").select("iban").eq("profile_id", USERS.volunteer2.id)).data).toEqual([{ iban: saved.iban }]);
  });
});
