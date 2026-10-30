// Finance's ledger (round 2026-10-30): other income and spending with
// categories (merch, an event's revenue, a Beleg paid straight from the MESA
// bank account …), optionally per event. Finance only; RLS checks again.
import { z } from "zod";
import { dbError, defineAction, forbidden, notFound, PAGES, requireRole, uuid } from "@/lib/actions/core";

const direction = z.enum(["income", "expense"]);
const entry = {
  direction,
  category_id: uuid,
  event_id: uuid.nullable().optional(),
  amount_cents: z.number().int().min(1).max(100_000_000),
  booked_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date (YYYY-MM-DD)"),
  description: z.string().trim().min(1, "Required").max(300),
  counterparty: z.string().trim().max(200).optional(),
  payment_method: z.enum(["bank", "cash", "paypal", "card", "other"]),
  beleg_ref: z.string().trim().max(100).optional(),
  beleg_received: z.boolean().optional(),
  note: z.string().trim().max(1000).optional(),
};
const LEDGER = [PAGES.finance] as const;

function categoryError(error: { code?: string; message: string } | null) {
  if (error?.code === "22023") throw forbidden(error.message);
  dbError(error);
}

export const addEntry = defineAction(
  z.object(entry),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    const { data, error } = await ctx.supabase.from("finance_entries").insert(i).select("id").single();
    categoryError(error);
    return { id: data!.id };
  },
  { revalidate: LEDGER }
);

export const updateEntry = defineAction(
  z.object({ id: uuid, ...entry }),
  async (ctx, { id, ...patch }) => {
    requireRole(ctx, "finance");
    const { error, count } = await ctx.supabase.from("finance_entries").update(patch, { count: "exact" }).eq("id", id);
    categoryError(error);
    if (!count) throw notFound();
  },
  { revalidate: LEDGER }
);

export const deleteEntry = defineAction(
  z.object({ id: uuid }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    const { error, count } = await ctx.supabase.from("finance_entries").delete({ count: "exact" }).eq("id", i.id);
    dbError(error);
    if (!count) throw notFound();
  },
  { revalidate: LEDGER }
);

export const addCategory = defineAction(
  z.object({ direction, name: z.string().trim().min(1, "Required").max(80) }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    const { error } = await ctx.supabase.from("finance_categories").insert(i);
    if (error?.code === "23505") throw forbidden("There is a category with this name already.");
    dbError(error);
  },
  { revalidate: LEDGER }
);

/** Categories are never deleted (entries keep theirs); unused ones are hidden from the form. */
export const setCategoryActive = defineAction(
  z.object({ id: uuid, active: z.boolean() }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    const { error, count } = await ctx.supabase.from("finance_categories").update({ active: i.active }, { count: "exact" }).eq("id", i.id);
    dbError(error);
    if (!count) throw notFound();
  },
  { revalidate: LEDGER }
);
