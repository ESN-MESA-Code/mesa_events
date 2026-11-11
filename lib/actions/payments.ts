// Payments (round 2026-11-11): PayPal.me links with references, PayPal and
// pretix imports, the "To label" queue, budget lines, balances and tax
// spheres. Finance only; RLS and the database functions check again.
import { z } from "zod";
import { dbError, defineAction, forbidden, notFound, PAGES, requireRole, uuid } from "@/lib/actions/core";
import { newReference } from "@/lib/payments/links";
import { matchOpenPayments, resetOpenPayments } from "@/lib/payments/runMatch";
import { fetchPretixOrders, pretixApiConfig, type PretixOrder } from "@/lib/payments/pretix";
import { berlinDate } from "@/lib/dates";
import type { ActionContext } from "@/lib/actions/core";

const FINANCE = [PAGES.finance] as const;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date (YYYY-MM-DD)");
const amount = z.number().int().min(1).max(100_000_000);
const optionalId = uuid.nullable().optional();

// ── Settings ───────────────────────────────────────────────────────────────

export const savePaypalSettings = defineAction(
  z.object({
    // "@mesamunich", "paypal.me/mesamunich" and the whole link are all fine.
    handle: z.string().trim().max(200).transform((h) => h.replace(/^@/, "").replace(/^(https?:\/\/)?(www\.)?paypal\.me\//i, "").replace(/\/.*$/, "")),
    account_name: z.string().trim().max(120).default(""),
  }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    dbError((await ctx.supabase.rpc("set_paypal_settings", { handle: i.handle, account_name: i.account_name })).error);
  },
  { revalidate: [...FINANCE, PAGES.officeHours, PAGES.event] }
);

// ── Payment links ──────────────────────────────────────────────────────────

async function insertLink(ctx: ActionContext, row: { title: string; amount_cents: number | null; category_id: string; event_id?: string | null; internal_event_id?: string | null; preset?: string | null; note?: string }) {
  // A fresh reference; a clash (one in 33 million) is tried again.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await ctx.supabase.from("payment_links").insert({ ...row, reference: newReference() }).select("id, reference").single();
    if (!error) return data!;
    if (error.code === "23505" && /preset/.test(error.message)) return null;
    if (error.code !== "23505") {
      if (error.code === "22023") throw forbidden(error.message);
      dbError(error);
    }
  }
  throw forbidden("Could not find a free reference – try again.");
}

export const createLink = defineAction(
  z.object({
    title: z.string().trim().min(1, "Say what it is for").max(120),
    amount_cents: amount.nullable(),
    category_id: uuid,
    event_id: optionalId,
    internal_event_id: optionalId,
    note: z.string().trim().max(500).default(""),
  }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    if (i.event_id && i.internal_event_id) throw forbidden("A link is for an event or an internal event, not both.");
    const link = await insertLink(ctx, i);
    if (!link) throw forbidden("This link exists already.");
    await resetOpenPayments(ctx.supabase);
    return link;
  },
  { revalidate: [...FINANCE, PAGES.officeHours, PAGES.event] }
);

export const updateLink = defineAction(
  z.object({ id: uuid, title: z.string().trim().min(1).max(120), amount_cents: amount.nullable(), category_id: uuid, active: z.boolean(), note: z.string().trim().max(500).default("") }),
  async (ctx, { id, ...patch }) => {
    requireRole(ctx, "finance");
    const { error, count } = await ctx.supabase.from("payment_links").update(patch, { count: "exact" }).eq("id", id);
    if (error?.code === "22023") throw forbidden(error.message);
    dbError(error);
    if (!count) throw notFound();
  },
  { revalidate: [...FINANCE, PAGES.officeHours, PAGES.event] }
);

export const deleteLink = defineAction(
  z.object({ id: uuid }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    const { count: used } = await ctx.supabase.from("payments").select("id", { count: "exact", head: true }).eq("link_id", i.id);
    if (used) throw forbidden("Payments were booked with this link – switch it off instead.");
    const { error, count } = await ctx.supabase.from("payment_links").delete({ count: "exact" }).eq("id", i.id);
    dbError(error);
    if (!count) throw notFound();
  },
  { revalidate: [...FINANCE, PAGES.officeHours, PAGES.event] }
);

// ── PayPal import ──────────────────────────────────────────────────────────

export const startImport = defineAction(
  z.object({ source: z.enum(["paypal", "pretix_csv", "pretix_api"]), filename: z.string().trim().max(200).default("") }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    const { data, error } = await ctx.supabase.from("payment_imports").insert(i).select("id").single();
    dbError(error);
    return { id: data!.id };
  },
  { revalidate: [] }
);

const paypalRow = z.object({
  id: z.string().trim().min(1).max(60),
  day,
  time: z.string().regex(/^\d{2}:\d{2}$/),
  type: z.string().max(120),
  name: z.string().max(200),
  email: z.string().max(200),
  gross: z.number().int().min(-100_000_000).max(100_000_000).refine((n) => n !== 0),
  fee: z.number().int().min(-10_000_000).max(10_000_000),
  balance: z.number().int().nullable(),
  subject: z.string().max(500),
  note: z.string().max(1000),
  invoice: z.string().max(200),
  referenceTxn: z.string().max(60),
});

/** One chunk of a PayPal file (transactions already imported are left alone). */
export const addPaypalRows = defineAction(
  z.object({ import_id: uuid, rows: z.array(paypalRow).min(1).max(300) }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    const ids = i.rows.map((r) => r.id);
    const { data: known, error: e1 } = await ctx.supabase.from("payments").select("external_id").eq("source", "paypal").in("external_id", ids);
    dbError(e1);
    const have = new Set((known ?? []).map((k) => k.external_id));
    const fresh = i.rows.filter((r) => !have.has(r.id));
    if (fresh.length) {
      const { error } = await ctx.supabase.from("payments").upsert(
        fresh.map((r) => ({
          import_id: i.import_id,
          source: "paypal",
          external_id: r.id,
          occurred_at: berlinIso(r.day, r.time),
          booked_on: r.day,
          type: r.type,
          name: r.name,
          email: r.email,
          gross_cents: r.gross,
          fee_cents: r.fee,
          subject: r.subject,
          note: r.note,
          invoice: r.invoice,
          reference_txn: r.referenceTxn,
        })),
        { onConflict: "source,external_id", ignoreDuplicates: true }
      );
      dbError(error);
    }
    return { added: fresh.length, known: have.size };
  },
  { revalidate: [] }
);

/** "2026-11-03" 18:02 in Berlin as an instant (good to the hour around DST). */
function berlinIso(day: string, time: string): string {
  const guess = new Date(`${day}T${time}:00Z`).getTime();
  for (const offset of [1, 2]) {
    const iso = new Date(guess - offset * 3_600_000).toISOString();
    if (berlinDate(iso) === day && new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)) === time) return iso;
  }
  return new Date(guess - 3_600_000).toISOString();
}

export const finishImport = defineAction(
  z.object({
    import_id: uuid,
    period_from: day.nullable(),
    period_to: day.nullable(),
    rows_total: z.number().int().min(0),
    rows_new: z.number().int().min(0),
    rows_skipped: z.number().int().min(0),
    balance_cents: z.number().int().nullable().optional(),
    balance_on: day.nullable().optional(),
  }),
  async (ctx, { import_id, ...stats }) => {
    requireRole(ctx, "finance");
    const { error } = await ctx.supabase.from("payment_imports").update(stats).eq("id", import_id);
    dbError(error);
  },
  { revalidate: FINANCE }
);

/** Matches the next batch of open payments (of an import, or all after "Match again"). */
export const matchPayments = defineAction(
  z.object({ import_id: uuid.optional(), again: z.boolean().default(false) }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    if (i.again) await resetOpenPayments(ctx.supabase);
    return matchOpenPayments(ctx.supabase, { importId: i.import_id });
  },
  { revalidate: FINANCE }
);

// ── The queue ──────────────────────────────────────────────────────────────

const booking = {
  category_id: uuid,
  event_id: optionalId,
  internal_event_id: optionalId,
  link_id: optionalId,
  description: z.string().trim().max(300).optional(),
};

export const bookPayment = defineAction(
  z.object({ id: uuid, ...booking, suggested: z.boolean().default(false) }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    const { error } = await ctx.supabase.rpc("book_payment", {
      payment: i.id,
      category: i.category_id,
      event: i.event_id ?? undefined,
      internal_event: i.internal_event_id ?? undefined,
      link: i.link_id ?? undefined,
      description: i.description || undefined,
      matched_by: i.suggested ? "suggestion" : "manual",
    });
    if (error?.code === "22023") throw forbidden(error.message);
    dbError(error);
  },
  { revalidate: FINANCE }
);

/** Several payments in the same category (and event). */
export const bookPayments = defineAction(
  z.object({ ids: z.array(uuid).min(1).max(200), ...booking }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    const errors: string[] = [];
    for (const id of i.ids) {
      const { error } = await ctx.supabase.rpc("book_payment", {
        payment: id,
        category: i.category_id,
        event: i.event_id ?? undefined,
        internal_event: i.internal_event_id ?? undefined,
        link: i.link_id ?? undefined,
        description: i.description || undefined,
        matched_by: "manual",
      });
      if (error) errors.push(error.message);
    }
    if (errors.length === i.ids.length) throw forbidden(errors[0]);
    return { booked: i.ids.length - errors.length, errors: [...new Set(errors)] };
  },
  { revalidate: FINANCE }
);

/** Books every listed payment as its suggestion says (those without a category stay). */
export const acceptSuggestions = defineAction(
  z.object({ ids: z.array(uuid).min(1).max(200) }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    const { data, error } = await ctx.supabase
      .from("payments")
      .select("id, suggested_category_id, suggested_event_id, suggested_internal_event_id, suggested_link_id, payment_links:suggested_link_id(title, reference)")
      .in("id", i.ids)
      .eq("status", "open");
    dbError(error);
    let booked = 0;
    const errors: string[] = [];
    for (const p of data ?? []) {
      if (!p.suggested_category_id) continue;
      const l = p.payment_links as { title: string; reference: string } | null;
      const { error: e } = await ctx.supabase.rpc("book_payment", {
        payment: p.id,
        category: p.suggested_category_id,
        event: p.suggested_event_id ?? undefined,
        internal_event: p.suggested_internal_event_id ?? undefined,
        link: p.suggested_link_id ?? undefined,
        description: l ? `${l.title} (${l.reference})` : undefined,
        matched_by: "suggestion",
      });
      if (e) errors.push(e.message);
      else booked++;
    }
    return { booked, errors: [...new Set(errors)] };
  },
  { revalidate: FINANCE }
);

export const ignorePayments = defineAction(
  z.object({ ids: z.array(uuid).min(1).max(200), reason: z.string().trim().min(1, "Say why").max(200) }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    for (const id of i.ids) {
      const { error } = await ctx.supabase.rpc("ignore_payment", { payment: id, reason: i.reason });
      if (error?.code === "22023") throw forbidden(error.message);
      dbError(error);
    }
  },
  { revalidate: FINANCE }
);

export const unbookPayment = defineAction(
  z.object({ id: uuid }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    const { error } = await ctx.supabase.rpc("unbook_payment", { payment: i.id });
    if (error?.code === "22023") throw forbidden(error.message);
    dbError(error);
    await ctx.supabase.from("pretix_orders").update({ payment_id: null }).eq("payment_id", i.id);
  },
  { revalidate: FINANCE }
);

// ── pretix ─────────────────────────────────────────────────────────────────

const pretixOrder = z.object({
  slug: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/),
  code: z.string().regex(/^[A-Za-z0-9]{1,30}$/),
  status: z.enum(["paid", "pending", "canceled", "expired"]),
  email: z.string().max(200),
  name: z.string().max(200),
  total: z.number().int().min(0).max(100_000_000),
  fees: z.number().int().min(-10_000_000).max(10_000_000),
  tickets: z.number().int().min(0).max(10_000),
  provider: z.string().max(60),
  orderedOn: day.nullable(),
  paidOn: day.nullable(),
});

async function saveOrders(ctx: ActionContext, importId: string, orders: PretixOrder[]) {
  const slugs = [...new Set(orders.map((o) => o.slug.toLowerCase()))];
  const { data: events } = await ctx.supabase.from("events").select("id, pretix_slug").not("pretix_slug", "is", null);
  const bySlug = new Map((events ?? []).map((e) => [e.pretix_slug!.toLowerCase(), e.id]));
  // Existing orders keep their links to payments and ledger lines (upsert only the order's own fields).
  const { data: existing } = await ctx.supabase.from("pretix_orders").select("id, event_slug, code").in("event_slug", [...new Set(orders.map((o) => o.slug))]);
  const known = new Map((existing ?? []).map((o) => [`${o.event_slug.toLowerCase()}:${o.code.toUpperCase()}`, o.id]));
  const rows = orders.map((o) => ({
    ...(known.has(`${o.slug.toLowerCase()}:${o.code}`) ? { id: known.get(`${o.slug.toLowerCase()}:${o.code}`)! } : {}),
    import_id: importId,
    event_slug: o.slug,
    code: o.code,
    event_id: bySlug.get(o.slug.toLowerCase()) ?? null,
    status: o.status,
    email: o.email,
    name: o.name,
    total_cents: o.total,
    fees_cents: o.fees,
    tickets: o.tickets,
    provider: o.provider,
    ordered_at: o.orderedOn ? `${o.orderedOn}T12:00:00Z` : null,
    paid_on: o.paidOn,
  }));
  const fresh = rows.filter((r) => !("id" in r));
  const old = rows.filter((r) => "id" in r);
  if (fresh.length) dbError((await ctx.supabase.from("pretix_orders").insert(fresh)).error);
  if (old.length) dbError((await ctx.supabase.from("pretix_orders").upsert(old, { onConflict: "id" })).error);
  return { added: fresh.length, updated: old.length, unlinked: slugs.filter((one) => !bySlug.has(one)) };
}

export const importPretixOrders = defineAction(
  z.object({ import_id: uuid, orders: z.array(pretixOrder).min(1).max(500) }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    const r = await saveOrders(ctx, i.import_id, i.orders);
    await resetOpenPayments(ctx.supabase);
    return r;
  },
  { revalidate: FINANCE }
);

/** Fetches the orders of the events from `from` to `to` that have a pretix page, through the pretix API. */
export const syncPretix = defineAction(
  z.object({ from: day, to: day }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    const cfg = pretixApiConfig();
    if (!cfg) throw forbidden("The pretix API is not set up (PRETIX_ORGANIZER and PRETIX_API_TOKEN) – import the CSV export instead.");
    const { data: events, error } = await ctx.supabase
      .from("events")
      .select("id, title, pretix_slug")
      .not("pretix_slug", "is", null)
      .gte("starts_at", `${i.from}T00:00:00Z`)
      .lte("starts_at", `${i.to}T23:59:59Z`)
      .limit(60);
    dbError(error);
    if (!events?.length) return { events: 0, added: 0, updated: 0, errors: [] as string[] };
    const { data: imp } = await ctx.supabase.from("payment_imports").insert({ source: "pretix_api", filename: `pretix API ${i.from} – ${i.to}`, period_from: i.from, period_to: i.to }).select("id").single();
    let added = 0;
    let updated = 0;
    let total = 0;
    const errors: string[] = [];
    for (const e of events) {
      try {
        const orders = await fetchPretixOrders(cfg, e.pretix_slug!);
        total += orders.length;
        if (orders.length) {
          const r = await saveOrders(ctx, imp!.id, orders);
          added += r.added;
          updated += r.updated;
        }
      } catch (err) {
        errors.push(`${e.title}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }
    await ctx.supabase.from("payment_imports").update({ rows_total: total, rows_new: added }).eq("id", imp!.id);
    await resetOpenPayments(ctx.supabase);
    return { events: events.length, added, updated, errors };
  },
  { revalidate: FINANCE }
);

export const linkPretixEvent = defineAction(
  z.object({ event_id: uuid, slug: z.string().trim().max(100) }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    const { error } = await ctx.supabase.rpc("link_pretix_event", { event: i.event_id, slug: i.slug });
    if (error?.code === "22023") throw forbidden(error.message);
    dbError(error);
    await resetOpenPayments(ctx.supabase);
  },
  { revalidate: [...FINANCE, PAGES.pretix] }
);

export const bookPretixOrders = defineAction(
  z.object({ event_id: uuid, category_id: uuid }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    const { data, error } = await ctx.supabase.rpc("book_pretix_orders", { event: i.event_id, category: i.category_id });
    if (error?.code === "22023") throw forbidden(error.message);
    dbError(error);
    return { orders: data ?? 0 };
  },
  { revalidate: FINANCE }
);

// ── Budget, balances, spheres ──────────────────────────────────────────────

const budgetLine = {
  semester: z.string().regex(/^\d{4}-[12]$/),
  category_id: uuid,
  event_id: optionalId,
  label: z.string().trim().max(120).default(""),
  planned_cents: z.number().int().min(0).max(100_000_000),
  note: z.string().trim().max(500).default(""),
};

export const saveBudgetLine = defineAction(
  z.object({ id: uuid.optional(), ...budgetLine }),
  async (ctx, { id, ...row }) => {
    requireRole(ctx, "finance");
    if (id) {
      const { error, count } = await ctx.supabase.from("budget_lines").update(row, { count: "exact" }).eq("id", id);
      dbError(error);
      if (!count) throw notFound();
    } else dbError((await ctx.supabase.from("budget_lines").insert(row)).error);
  },
  { revalidate: FINANCE }
);

export const deleteBudgetLine = defineAction(
  z.object({ id: uuid }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    const { error, count } = await ctx.supabase.from("budget_lines").delete({ count: "exact" }).eq("id", i.id);
    dbError(error);
    if (!count) throw notFound();
  },
  { revalidate: FINANCE }
);

/** Copies a semester's category lines (not the event lines) into another, as a start. */
export const copyBudget = defineAction(
  z.object({ from: z.string().regex(/^\d{4}-[12]$/), to: z.string().regex(/^\d{4}-[12]$/) }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    if (i.from === i.to) throw forbidden("Pick another semester.");
    const { count: existing } = await ctx.supabase.from("budget_lines").select("id", { count: "exact", head: true }).eq("semester", i.to);
    if (existing) throw forbidden("This semester has a plan already.");
    const { data, error } = await ctx.supabase.from("budget_lines").select("category_id, label, planned_cents, note").eq("semester", i.from).is("event_id", null);
    dbError(error);
    if (!data?.length) throw forbidden("Nothing to copy.");
    dbError((await ctx.supabase.from("budget_lines").insert(data.map((l) => ({ ...l, semester: i.to })))).error);
    return { copied: data.length };
  },
  { revalidate: FINANCE }
);

export const addBalance = defineAction(
  z.object({ account: z.enum(["bank", "paypal", "other"]), as_of: day, cents: z.number().int().min(-100_000_000).max(1_000_000_000), note: z.string().trim().max(300).default("") }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    dbError((await ctx.supabase.from("account_balances").insert(i)).error);
  },
  { revalidate: FINANCE }
);

export const deleteBalance = defineAction(
  z.object({ id: uuid }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    const { error, count } = await ctx.supabase.from("account_balances").delete({ count: "exact" }).eq("id", i.id);
    dbError(error);
    if (!count) throw notFound();
  },
  { revalidate: FINANCE }
);

export const setCategorySphere = defineAction(
  z.object({ id: uuid, sphere: z.enum(["ideell", "vermoegen", "zweckbetrieb", "wirtschaftlich"]) }),
  async (ctx, i) => {
    requireRole(ctx, "finance");
    const { error, count } = await ctx.supabase.from("finance_categories").update({ sphere: i.sphere }, { count: "exact" }).eq("id", i.id);
    dbError(error);
    if (!count) throw notFound();
  },
  { revalidate: FINANCE }
);

// ── QR codes made by the people on duty (round 2026-11-11 (2)) ──────────────

/** The OC or a helper makes a PayPal link for their event or office hour; the category follows from what is sold. */
export const createLinkHere = defineAction(
  z.object({
    event_id: optionalId,
    internal_event_id: optionalId,
    kind: z.enum(["drinks", "ticket", "other", "esncard_internal", "esncard_external"]),
    title: z.string().trim().max(120).default(""),
    amount_cents: amount.nullable(),
  }),
  async (ctx, i) => {
    if (!!i.event_id === !!i.internal_event_id) throw forbidden("Name the event or the office hour.");
    const { data, error } = await ctx.supabase.rpc("create_payment_link_here", {
      target_event: i.event_id ?? undefined,
      target_internal: i.internal_event_id ?? undefined,
      link_kind: i.kind,
      link_title: i.title || undefined,
      link_cents: i.amount_cents ?? undefined,
    });
    if (error?.code === "22023") throw forbidden(error.message);
    dbError(error);
    await resetOpenPayments(ctx.supabase).catch(() => 0);
    return data as { id: string; reference: string; existing: boolean };
  },
  { revalidate: [...FINANCE, PAGES.officeHours, PAGES.event] }
);

export const setLinkActive = defineAction(
  z.object({ id: uuid, active: z.boolean() }),
  async (ctx, i) => {
    const { error } = await ctx.supabase.rpc("set_payment_link_active", { link: i.id, on_off: i.active });
    dbError(error);
  },
  { revalidate: [...FINANCE, PAGES.officeHours, PAGES.event] }
);
