// Cash boxes (round 2026-10-30): the OC and helpers of an office hour or an
// ESN event count it before and after and count ESNcards sold; the OC signs
// it off. Finance checks, reopens or books it, and keeps the boxes. The database functions check
// who may do what (staff, OC, Finance).
import { z } from "zod";
import { dbError, defineAction, forbidden, PAGES, requireRole, uuid } from "@/lib/actions/core";
import { DENOMINATIONS, countTotal } from "@/lib/cash";

const CASH = [PAGES.officeHours, PAGES.event, PAGES.finance] as const;

const counts = z
  .record(z.string(), z.number().int().min(0).max(100_000))
  .refine((c) => Object.keys(c).every((k) => (DENOMINATIONS as readonly number[]).includes(Number(k))), "Not a euro note or coin")
  .refine((c) => (countTotal(c) ?? Infinity) <= 100_000_000, "Not a valid count");

export const startCashBox = defineAction(
  z.union([z.object({ event_id: uuid, box_id: uuid.optional() }), z.object({ internal_event_id: uuid, box_id: uuid.optional() })]),
  async (ctx, i) => {
    const target = "event_id" in i ? { event: i.event_id } : { internal_event: i.internal_event_id };
    const { data, error } = await ctx.supabase.rpc("ensure_cash_report", { ...target, ...(i.box_id ? { box: i.box_id } : {}) });
    dbError(error);
    return { report_id: data as string };
  },
  { revalidate: CASH }
);

export const saveCashCount = defineAction(
  z.object({ report_id: uuid, phase: z.enum(["opening", "closing"]), counts }),
  async (ctx, i) => {
    const { data, error } = await ctx.supabase.rpc("save_cash_count", { report: i.report_id, phase: i.phase, counts: i.counts });
    dbError(error);
    return { total_cents: data as number };
  },
  { revalidate: CASH }
);

/** +1 / −1 ESNcard (atomic in the database, so two phones can count at once). */
export const bumpEsncards = defineAction(
  z.object({ report_id: uuid, card: z.enum(["internal", "external"]), delta: z.number().int().min(-50).max(50).refine((d) => d !== 0) }),
  async (ctx, i) => {
    const { data, error } = await ctx.supabase.rpc("bump_esncards", { report: i.report_id, card: i.card, delta: i.delta });
    dbError(error);
    return data as { internal: number; external: number };
  },
  { revalidate: [] }
);

export const setCashNote = defineAction(
  z.object({ report_id: uuid, note: z.string().trim().max(1000) }),
  async (ctx, i) => {
    dbError((await ctx.supabase.rpc("set_cash_note", { report: i.report_id, note: i.note })).error);
  },
  { revalidate: CASH }
);

/** The OC's sign-off: sales and counts are final. */
export const closeCashBox = defineAction(
  z.object({ report_id: uuid }),
  async (ctx, i) => {
    dbError((await ctx.supabase.rpc("close_cash_report", { report: i.report_id })).error);
  },
  { revalidate: CASH }
);

export const checkCashBox = defineAction(
  z.object({ report_id: uuid }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    dbError((await ctx.supabase.rpc("check_cash_report", { report: i.report_id })).error);
  },
  { revalidate: CASH }
);

export const reopenCashBox = defineAction(
  z.object({ report_id: uuid }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    dbError((await ctx.supabase.rpc("reopen_cash_report", { report: i.report_id })).error);
  },
  { revalidate: CASH }
);

/** Books the takings into the ledger as income (once). */
export const bookCashBox = defineAction(
  z.object({ report_id: uuid, category_id: uuid }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    const { data, error } = await ctx.supabase.rpc("book_cash_report", { report: i.report_id, category: i.category_id });
    if (error?.code === "23505") throw forbidden("These takings are booked already.");
    dbError(error);
    return { entry_id: data as string };
  },
  { revalidate: CASH }
);

// The cash boxes themselves (round 2026-10-31): Finance adds and removes
// them, picks the default box of office hours and events, and puts money
// in, takes it out or recounts a box.

export const addCashBox = defineAction(
  z.object({ name: z.string().trim().min(1, "Give the cash box a name").max(80) }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    const { data, error } = await ctx.supabase.rpc("add_cash_box", { name: i.name });
    dbError(error);
    return { box_id: data as string };
  },
  { revalidate: CASH }
);

export const removeCashBox = defineAction(
  z.object({ box_id: uuid }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    dbError((await ctx.supabase.rpc("remove_cash_box", { box: i.box_id })).error);
  },
  { revalidate: CASH }
);

export const setCashBoxDefault = defineAction(
  z.object({ box_id: uuid, kind: z.enum(["office_hour", "event"]) }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    dbError((await ctx.supabase.rpc("set_cash_box_default", { box: i.box_id, kind: i.kind })).error);
  },
  { revalidate: CASH }
);

/** Money in, out, or the box counted anew; returns its new total. */
export const adjustCashBox = defineAction(
  z.object({ box_id: uuid, mode: z.enum(["in", "out", "recount"]), counts, note: z.string().trim().max(300).default("") }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    const { data, error } = await ctx.supabase.rpc("adjust_cash_box", { box: i.box_id, mode: i.mode, counts: i.counts, note: i.note });
    dbError(error);
    return { total_cents: data as number };
  },
  { revalidate: CASH }
);

export const setEsncardPrices = defineAction(
  z.object({ internal_cents: z.number().int().min(0).max(100_000), external_cents: z.number().int().min(0).max(100_000) }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    dbError((await ctx.supabase.rpc("set_esncard_prices", { internal_cents: i.internal_cents, external_cents: i.external_cents })).error);
  },
  { revalidate: CASH }
);
