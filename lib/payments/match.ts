// Matching imported PayPal payments (round 2026-11-11), in this order:
// 1. PayPal's own bookkeeping (withdrawals to the bank, holds …) → ignored;
// 2. a payment link's reference in the note → booked to the link's event
//    and category straight away;
// 3. a pretix order code (pretix's PayPal payments name the order) of a
//    linked event → booked as that event's ticket revenue;
// 4. otherwise a suggestion for Finance's "To label" queue: a link with
//    the same amount around its event's day, or the category this payer's
//    earlier payments were booked in. Pure (tests/unit/payments.test.ts).
import { findReferences } from "./links";
import { isTransfer } from "./paypal";
import { plural } from "@/lib/plural";

export interface MatchPayment {
  gross: number;
  /** "2026-11-11" */
  day: string;
  type: string;
  subject: string;
  note: string;
  invoice: string;
  email: string;
}

export interface MatchLink {
  id: string;
  reference: string;
  title: string;
  amount: number | null;
  categoryId: string;
  eventId: string | null;
  internalEventId: string | null;
  /** The day of its event or office hour (null: a link of its own, e.g. merch). */
  day: string | null;
  active: boolean;
}

export interface MatchOrder {
  code: string;
  slug: string;
  total: number;
  eventId: string | null;
  eventTitle: string | null;
}

export type Match =
  | { kind: "transfer"; reason: string }
  | { kind: "reference"; link: MatchLink }
  | { kind: "pretix"; order: MatchOrder & { eventId: string } }
  | { kind: "suggestion"; linkId: string | null; categoryId: string | null; eventId: string | null; internalEventId: string | null; reason: string }
  | { kind: "none" };

export interface MatchContext {
  links: MatchLink[];
  orders: MatchOrder[];
  /** Category of earlier booked payments per payer email (lower case), most used first. */
  history: Map<string, string>;
  /** The "Event revenue" category, for pretix orders. */
  ticketCategoryId: string | null;
}

const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** How the import treats one payment. */
export function matchPayment(p: MatchPayment, ctx: MatchContext): Match {
  if (isTransfer(p.type)) return { kind: "transfer", reason: `PayPal: ${p.type}` };
  const texts = [p.subject, p.note, p.invoice];
  const byRef = new Map(ctx.links.map((l) => [l.reference, l]));
  const refs = findReferences(texts, new Set(byRef.keys()));
  if (refs.length === 1 && p.gross > 0) return { kind: "reference", link: byRef.get(refs[0])! };
  if (refs.length) {
    const l = byRef.get(refs[0])!;
    return {
      kind: "suggestion",
      linkId: p.gross > 0 ? l.id : null,
      categoryId: p.gross > 0 ? l.categoryId : null,
      eventId: l.eventId,
      internalEventId: l.internalEventId,
      reason: p.gross < 0 ? `Money back? The note names ${refs.join(", ")} (${l.title})` : `The note names several references: ${refs.join(", ")}`,
    };
  }

  const order = findOrder(p, texts, ctx.orders);
  if (order && p.gross > 0 && order.eventId && ctx.ticketCategoryId) return { kind: "pretix", order: order as MatchOrder & { eventId: string } };
  if (order)
    return {
      kind: "suggestion",
      linkId: null,
      categoryId: p.gross > 0 ? ctx.ticketCategoryId : null,
      eventId: order.eventId,
      internalEventId: null,
      reason: order.eventId ? `Refund of pretix order ${order.code} (${order.eventTitle})?` : `pretix order ${order.code} of “${order.slug}” – no event is linked to that pretix page yet`,
    };

  if (p.gross > 0) {
    const candidates = ctx.links
      .filter((l) => l.active && l.amount === p.gross)
      .map((l) => ({ l, d: l.day ? diffDays(l.day, p.day) : null }))
      // Paid up to a week before its event or three days after; links of their own any time.
      .filter(({ d }) => d === null || (d >= -7 && d <= 3))
      .sort((a, b) => (a.d === null ? 99 : Math.abs(a.d)) - (b.d === null ? 99 : Math.abs(b.d)));
    if (candidates.length) {
      const { l } = candidates[0];
      const others = candidates.length - 1;
      return {
        kind: "suggestion",
        linkId: l.id,
        categoryId: l.categoryId,
        eventId: l.eventId,
        internalEventId: l.internalEventId,
        reason: `No reference – same amount as ${l.reference} (${l.title})${others ? ` and ${plural(others, "more link")}` : ""}`,
      };
    }
  }

  const earlier = p.email ? ctx.history.get(p.email.toLowerCase()) : undefined;
  if (earlier) return { kind: "suggestion", linkId: null, categoryId: earlier, eventId: null, internalEventId: null, reason: "Booked like this payer's earlier payments" };
  return { kind: "none" };
}

/** A pretix order the payment names (its code in the texts), preferring one of the same amount. */
function findOrder(p: MatchPayment, texts: string[], orders: MatchOrder[]): MatchOrder | null {
  if (!orders.length) return null;
  const text = texts.join(" ").toUpperCase();
  const tokens = new Set(text.match(/[A-Z0-9]{4,30}/g) ?? []);
  // pretix writes e.g. "esn-mesa-kayaking26-ABC12": the code is the last part.
  for (const m of text.matchAll(/-([A-Z0-9]{4,30})(?![A-Z0-9])/g)) tokens.add(m[1]);
  const hits = orders.filter((o) => tokens.has(o.code.toUpperCase()));
  if (!hits.length) return null;
  return hits.find((o) => o.total === Math.abs(p.gross)) ?? (hits.length === 1 ? hits[0] : null);
}

/** The most used category per payer email from earlier bookings. */
export function historyOf(rows: Array<{ email: string; categoryId: string }>): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.email) continue;
    const key = r.email.toLowerCase();
    const m = counts.get(key) ?? new Map<string, number>();
    m.set(r.categoryId, (m.get(r.categoryId) ?? 0) + 1);
    counts.set(key, m);
  }
  const out = new Map<string, string>();
  for (const [email, m] of counts) out.set(email, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  return out;
}
