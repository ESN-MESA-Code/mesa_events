// Runs the matching (lib/payments/match.ts) over open payments in the
// database, a batch at a time (the import page calls it until nothing is
// left, so a year of PayPal history never runs into a request timeout):
// books by reference and pretix order, ignores PayPal's bookkeeping lines,
// and stores suggestions for the "To label" queue. Server only.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { berlinDate } from "@/lib/dates";
import { historyOf, matchPayment, type MatchContext, type MatchLink, type MatchOrder } from "./match";

type Db = SupabaseClient<Database>;

export interface MatchSummary {
  checked: number;
  booked: number;
  ignored: number;
  suggested: number;
  open: number;
  /** Open payments still to check (call again). */
  remaining: number;
  errors: string[];
}

async function context(db: Db): Promise<MatchContext> {
  const [{ data: links }, { data: orders }, { data: booked }, { data: cats }] = await Promise.all([
    db.from("payment_links").select("id, reference, title, amount_cents, category_id, event_id, internal_event_id, active, events(starts_at), internal_events(starts_at)"),
    db.from("pretix_orders").select("code, event_slug, total_cents, event_id, events(title)").neq("status", "pending"),
    db.from("payments").select("email, finance_entries(category_id, is_fee)").eq("status", "booked").neq("email", "").limit(5000),
    db.from("finance_categories").select("id, name, direction").eq("direction", "income").eq("name", "Event revenue").maybeSingle(),
  ]);
  const matchLinks: MatchLink[] = (links ?? []).map((l) => {
    const starts = (l.events as { starts_at: string } | null)?.starts_at ?? (l.internal_events as { starts_at: string } | null)?.starts_at ?? null;
    return {
      id: l.id,
      reference: l.reference,
      title: l.title,
      amount: l.amount_cents,
      categoryId: l.category_id,
      eventId: l.event_id,
      internalEventId: l.internal_event_id,
      day: starts ? berlinDate(starts) : null,
      active: l.active,
    };
  });
  const matchOrders: MatchOrder[] = (orders ?? []).map((o) => ({
    code: o.code,
    slug: o.event_slug,
    total: o.total_cents,
    eventId: o.event_id,
    eventTitle: (o.events as { title: string } | null)?.title ?? null,
  }));
  const history = historyOf(
    (booked ?? []).flatMap((p) =>
      ((p.finance_entries ?? []) as Array<{ category_id: string; is_fee: boolean }>).filter((e) => !e.is_fee).map((e) => ({ email: p.email, categoryId: e.category_id }))
    )
  );
  return { links: matchLinks, orders: matchOrders, history, ticketCategoryId: (cats as { id: string } | null)?.id ?? null };
}

/** Matches up to `limit` open payments not checked yet (of one import, or all). */
export async function matchOpenPayments(db: Db, opts: { importId?: string; limit?: number } = {}): Promise<MatchSummary> {
  const limit = opts.limit ?? 120;
  let q = db
    .from("payments")
    .select("id, gross_cents, booked_on, type, subject, note, invoice, email, name")
    .eq("status", "open")
    .is("checked_at", null)
    .order("occurred_at")
    .limit(limit);
  if (opts.importId) q = q.eq("import_id", opts.importId);
  const { data: open, error } = await q;
  if (error) throw new Error(error.message);
  const summary: MatchSummary = { checked: 0, booked: 0, ignored: 0, suggested: 0, open: 0, remaining: 0, errors: [] };
  if (open?.length) {
    const ctx = await context(db);
    const now = new Date().toISOString();
    for (const p of open) {
      summary.checked++;
      const m = matchPayment({ gross: p.gross_cents, day: p.booked_on, type: p.type, subject: p.subject, note: p.note, invoice: p.invoice, email: p.email }, ctx);
      let failed: string | null = null;
      if (m.kind === "transfer") {
        const { error: e } = await db.rpc("ignore_payment", { payment: p.id, reason: m.reason.slice(0, 200) });
        if (e) failed = e.message;
        else summary.ignored++;
      } else if (m.kind === "reference") {
        const { error: e } = await db.rpc("book_payment", {
          payment: p.id,
          category: m.link.categoryId,
          event: m.link.eventId ?? undefined,
          internal_event: m.link.internalEventId ?? undefined,
          link: m.link.id,
          description: `${m.link.title} (${m.link.reference})`,
          matched_by: "reference",
        });
        if (e) failed = e.message;
        else summary.booked++;
      } else if (m.kind === "pretix") {
        const { error: e } = await db.rpc("book_payment", {
          payment: p.id,
          category: ctx.ticketCategoryId!,
          event: m.order.eventId,
          description: `Ticket ${m.order.code}${m.order.eventTitle ? ` – ${m.order.eventTitle}` : ""} (pretix)`,
          matched_by: "pretix",
        });
        if (e) failed = e.message;
        else {
          summary.booked++;
          await db.from("pretix_orders").update({ payment_id: p.id }).ilike("event_slug", m.order.slug).eq("code", m.order.code);
        }
      }
      if (failed) summary.errors.push(`${p.name || p.email || p.id}: ${failed}`);
      const open = m.kind === "suggestion" || m.kind === "none" || failed;
      const suggestion =
        m.kind === "suggestion" && !failed
          ? { suggested_link_id: m.linkId, suggested_category_id: m.categoryId, suggested_event_id: m.eventId, suggested_internal_event_id: m.internalEventId, suggestion: m.reason.slice(0, 300) }
          : { suggested_link_id: null, suggested_category_id: null, suggested_event_id: null, suggested_internal_event_id: null, suggestion: failed ? `Could not book: ${failed}`.slice(0, 300) : "" };
      if (open) {
        if (m.kind === "suggestion" && !failed) summary.suggested++;
        else summary.open++;
      }
      await db.from("payments").update({ ...(open ? suggestion : {}), checked_at: now }).eq("id", p.id);
    }
  }
  let rq = db.from("payments").select("id", { count: "exact", head: true }).eq("status", "open").is("checked_at", null);
  if (opts.importId) rq = rq.eq("import_id", opts.importId);
  summary.remaining = (await rq).count ?? 0;
  return summary;
}

/** Marks every open payment to be matched again (after new links or pretix orders). */
export async function resetOpenPayments(db: Db): Promise<number> {
  const { count, error } = await db.from("payments").update({ checked_at: null }, { count: "exact" }).eq("status", "open");
  if (error) throw new Error(error.message);
  return count ?? 0;
}
