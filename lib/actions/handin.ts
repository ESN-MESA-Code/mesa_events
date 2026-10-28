// Hand-in (receipts, photos, pre-approvals) and Finance (Beleg, checks,
// payouts, budgets) and the Treasurer (rules, pre-approvals).
import { z } from "zod";
import { dbError, defineAction, forbidden, requireEventStaff, requireRole, uuid, cents } from "@/lib/actions/core";
import { isValidIban } from "@/lib/reimbursement";
import { PHOTO_PATH, RECEIPT_PATH, UPLOADS } from "@/lib/uploads";

const kind = z.enum(["ticket", "food_allowance", "ancillary", "travel_accommodation", "further_expenses", "social_ancillary"]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const iban = z
  .string()
  .transform((s) => s.replace(/\s+/g, "").toUpperCase())
  .refine(isValidIban, "This IBAN is not valid");
const payout = z.discriminatedUnion("payout_method", [
  z.object({ payout_method: z.literal("bank"), account_holder: z.string().trim().min(1).max(200), iban, paypal_email: z.undefined().optional() }),
  z.object({ payout_method: z.literal("paypal"), paypal_email: z.email().max(200), account_holder: z.string().trim().max(200).optional(), iban: z.undefined().optional() }),
]);

export const registerReceipt = defineAction(
  z
    .object({
      event_id: uuid,
      kind,
      vendor: z.string().trim().min(1, "Who did you pay?").max(200),
      amount_cents: cents.min(1, "Enter the amount"),
      purchased_on: date,
      description: z.string().trim().max(500).default(""),
      days: z.number().int().min(1).max(31).nullable().optional(),
      reference_path: z.string().regex(RECEIPT_PATH).nullable().optional(),
      preapproval_id: uuid.nullable().optional(),
      payout: payout.nullable().optional(),
    })
    .refine((i) => !i.reference_path || i.reference_path.startsWith(`${i.event_id}/`), { message: "The photo belongs to another event", path: ["reference_path"] }),
  async (ctx, i) => {
    await requireEventStaff(ctx, i.event_id, null);
    const { data, error } = await ctx.supabase.rpc("register_receipt", {
      event: i.event_id,
      kind: i.kind,
      vendor: i.vendor,
      amount_cents: i.amount_cents,
      purchased_on: i.purchased_on,
      description: i.description,
      days: i.days ?? undefined,
      reference_path: i.reference_path ?? undefined,
      preapproval: i.preapproval_id ?? undefined,
      payout_method: i.payout?.payout_method,
      account_holder: i.payout?.account_holder,
      iban: i.payout?.payout_method === "bank" ? i.payout.iban : undefined,
      paypal_email: i.payout?.payout_method === "paypal" ? i.payout.paypal_email : undefined,
    });
    dbError(error);
    return { claim_id: data as string };
  }
);

export const setPayoutDetails = defineAction(z.object({ claim_id: uuid }).and(payout), async (ctx, i) => {
  const { error } = await ctx.supabase.rpc("set_payout_details", {
    claim: i.claim_id,
    method: i.payout_method,
    account_holder: i.account_holder,
    iban: i.payout_method === "bank" ? i.iban : undefined,
    paypal_email: i.payout_method === "paypal" ? i.paypal_email : undefined,
  });
  dbError(error);
});

export const withdrawReceipt = defineAction(z.object({ claim_id: uuid }), async (ctx, i) => {
  dbError((await ctx.supabase.rpc("withdraw_receipt", { claim: i.claim_id })).error);
});

export const addEventPhoto = defineAction(
  z.object({
    event_id: uuid,
    path: z.string().regex(PHOTO_PATH),
    file_name: z.string().trim().min(1).max(200),
    mime_type: z.enum(UPLOADS.photo.types),
    size_bytes: z.number().int().min(1).max(UPLOADS.photo.maxBytes),
  }),
  async (ctx, i) => {
    if (!i.path.startsWith(`${i.event_id}/`)) throw forbidden("The photo belongs to another event.");
    await requireEventStaff(ctx, i.event_id, null);
    const { error } = await ctx.supabase.rpc("add_event_photo", { event: i.event_id, path: i.path, file_name: i.file_name, mime_type: i.mime_type, size_bytes: i.size_bytes });
    dbError(error);
  }
);

export const requestPreapproval = defineAction(
  z.object({ event_id: uuid, description: z.string().trim().min(1).max(1000), estimated_cents: cents }),
  async (ctx, i) => {
    await requireEventStaff(ctx, i.event_id, null);
    const { data, error } = await ctx.supabase.rpc("request_preapproval", { event: i.event_id, description: i.description, estimated: i.estimated_cents });
    dbError(error);
    return { id: data as string };
  }
);

// ── Finance ─────────────────────────────────────────────────────────────────

export const markBelegReceived = defineAction(z.object({ claim_id: uuid }), async (ctx, i) => {
  requireRole(ctx, "finance");
  dbError((await ctx.supabase.rpc("mark_beleg_received", { claim: i.claim_id })).error);
});

export const checkReimbursement = defineAction(z.object({ claim_id: uuid, approved_cents: cents, note: z.string().trim().max(1000).default("") }), async (ctx, i) => {
  requireRole(ctx, "finance");
  dbError((await ctx.supabase.rpc("check_reimbursement", { claim: i.claim_id, approved: i.approved_cents, note: i.note })).error);
});

export const rejectReimbursement = defineAction(z.object({ claim_id: uuid, reason: z.string().trim().min(1, "Give a reason").max(1000) }), async (ctx, i) => {
  requireRole(ctx, "finance");
  dbError((await ctx.supabase.rpc("reject_reimbursement", { claim: i.claim_id, reason: i.reason })).error);
});

export const payEarly = defineAction(z.object({ claim_id: uuid }), async (ctx, i) => {
  requireRole(ctx, "finance");
  dbError((await ctx.supabase.rpc("pay_early", { claim: i.claim_id })).error);
});

export const payBatch = defineAction(z.object({ batch_id: uuid }), async (ctx, i) => {
  requireRole(ctx, "finance");
  const { data, error } = await ctx.supabase.rpc("pay_batch", { batch: i.batch_id });
  dbError(error);
  return { paid: data as number };
});

export const setTripBudget = defineAction(z.object({ event_id: uuid, amount_cents: cents, note: z.string().trim().max(500).default("") }), async (ctx, i) => {
  requireRole(ctx, "finance");
  dbError((await ctx.supabase.rpc("set_trip_budget", { event: i.event_id, amount: i.amount_cents, note: i.note })).error);
});

// ── Treasurer ───────────────────────────────────────────────────────────────

export const decidePreapproval = defineAction(z.object({ id: uuid, approve: z.boolean(), note: z.string().trim().max(1000).default("") }), async (ctx, i) => {
  requireRole(ctx, "treasurer");
  dbError((await ctx.supabase.rpc("decide_preapproval", { preapproval: i.id, approve: i.approve, decision_note: i.note })).error);
});

const ruleSchema = z.object({
  event_type: z.enum(["standard", "special", "day_trip", "weekend_trip", "any"]),
  expense_kind: kind,
  category: z.enum(["team_costs", "ancillary_costs"]),
  oc_rate_bp: z.number().int().min(0).max(10_000),
  helper_rate_bp: z.number().int().min(0).max(10_000),
  oc_cap_cents: cents.nullable(),
  helper_cap_cents: cents.nullable(),
  per_day: z.boolean(),
  requires_preapproval: z.boolean(),
  within_trip_budget: z.boolean(),
  condition_note: z.string().trim().max(500),
});

/** The Treasurer publishes a new version of the rules (the old one stays for its claims). */
export const publishPolicy = defineAction(
  z.object({
    effective_from: date,
    notes: z.string().trim().max(2000).default(""),
    rules: z
      .array(ruleSchema)
      .min(1)
      .max(50)
      .refine((rs) => new Set(rs.map((r) => `${r.event_type}/${r.expense_kind}`)).size === rs.length, "Each event type and expense kind once"),
  }),
  async (ctx, i) => {
    requireRole(ctx, "treasurer");
    const { data, error } = await ctx.supabase.rpc("publish_policy", { rules: i.rules, effective_from: i.effective_from, notes: i.notes });
    dbError(error);
    return { version: data as number };
  }
);
