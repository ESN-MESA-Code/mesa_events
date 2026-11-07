// Planning cycle actions: ideas, month schedule, volunteer form, allocation,
// roster adjustments, confirmation.
import { z } from "zod";
import { dbError, defineAction, PAGES, forbidden, notFound, requireEventOc, requireRole, uuid, ActionError, type ActionContext } from "@/lib/actions/core";
import { allocate, type AllocationChoice, type AllocationPerson, type Rank } from "@/lib/allocation";
import { berlinInputToIso, monthLabel, monthOf } from "@/lib/dates";
import { EVENT_TYPES } from "@/lib/labels";
import { hasRole } from "@/lib/roles";
import { validateAddress } from "@/lib/address";
import { verifyAddress } from "@/lib/geocode";

export const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use a date and time")
  .transform((v) => berlinInputToIso(v));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date (YYYY-MM-DD)").refine((d) => !Number.isNaN(Date.parse(d)), "Not a date");
const title = z.string().trim().min(1, "Required").max(200);
const helpers = z.number().int().min(0).max(50);
const ocsNeeded = z.number().int().min(1).max(10);
/** Partners named on an idea (round 2026-11-04): each asked as co-OC or helper, at most five. */
const partners = z
  .array(z.object({ profile_id: uuid, role: z.enum(["oc", "helper"]) }))
  .max(5, "At most five partners")
  .refine((ps) => new Set(ps.map((x) => x.profile_id)).size === ps.length, "Each person once")
  .default([]);
const eventType = z.enum(EVENT_TYPES as [string, ...string[]]).transform((t) => t as (typeof EVENT_TYPES)[number]);
const rank = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.null()]);
/** Category and format (round 2026-11-01); a format brings its category (trigger). */
const sorting = { category_id: uuid.nullable().optional(), format_id: uuid.nullable().optional() };

// ── Ideas ───────────────────────────────────────────────────────────────────

export const proposeIdea = defineAction(
  z.object({
    title,
    proposed_date: isoDate,
    pitch: z.string().trim().max(2000).default(""),
    helpers_needed: helpers.default(2),
    ocs_needed: ocsNeeded.default(1),
    wants_to_oc: z.boolean().default(true),
    type_suggestion: z.enum(["standard", "special", "day_trip", "weekend_trip"]).nullable().optional(),
    partners,
    ...sorting,
  }),
  async (ctx, { partners: named, ...input }) => {
    if (named.some((x) => x.profile_id === ctx.viewer.id)) throw new ActionError("failed", "You are the proposer already.");
    const { data, error } = await ctx.supabase
      .from("event_ideas")
      .insert({ ...input, proposer_id: ctx.viewer.id })
      .select("id")
      .single();
    dbError(error);
    if (named.length) dbError((await ctx.supabase.rpc("set_idea_partners", { idea: data!.id, partners: named })).error);
    return data!;
  },
  { revalidate: [PAGES.ideas, PAGES.home, PAGES.eventsTeam] }
);

export const withdrawIdea = defineAction(z.object({ id: uuid }), async (ctx, { id }) => {
  const { error, count } = await ctx.supabase.from("event_ideas").delete({ count: "exact" }).eq("id", id).eq("proposer_id", ctx.viewer.id);
  dbError(error);
  if (!count) throw notFound("This idea cannot be withdrawn any more.");
}, { revalidate: [PAGES.ideas, PAGES.home, PAGES.eventsTeam] });

/** The proposer changes an open idea's partners; unchanged ones keep their answer. */
export const setIdeaPartners = defineAction(z.object({ idea_id: uuid, partners }), async (ctx, i) => {
  dbError((await ctx.supabase.rpc("set_idea_partners", { idea: i.idea_id, partners: i.partners })).error);
}, { revalidate: [PAGES.ideas, PAGES.home, PAGES.eventsTeam] });

/** A partner named on an idea says yes or no (until the month's roster is made). */
export const respondIdeaPartner = defineAction(z.object({ idea_id: uuid, accept: z.boolean() }), async (ctx, i) => {
  dbError((await ctx.supabase.rpc("respond_idea_partner", { idea: i.idea_id, accept: i.accept })).error);
}, { revalidate: [PAGES.ideas, PAGES.home, PAGES.eventsTeam] });

export const acceptIdea = defineAction(
  z.object({ idea_id: uuid, cycle_id: uuid, type: eventType, starts_at: localDateTime, helpers_needed: helpers.optional(), ...sorting }),
  async (ctx, i) => {
    requireRole(ctx, "events");
    const { data, error } = await ctx.supabase.rpc("accept_idea", {
      idea: i.idea_id,
      cycle: i.cycle_id,
      event_type: i.type,
      starts: i.starts_at,
      helpers: i.helpers_needed,
      category: i.category_id ?? undefined,
      format: i.format_id ?? undefined,
    });
    dbError(error);
    return { event_id: data as string };
  },
  { revalidate: [PAGES.eventsTeam, PAGES.ideas, PAGES.home] }
);

export const mergeIdea = defineAction(z.object({ idea_id: uuid, event_id: uuid, note: z.string().trim().max(1000).optional() }), async (ctx, i) => {
  requireRole(ctx, "events");
  const { error, count } = await ctx.supabase
    .from("event_ideas")
    .update({ status: "merged", event_id: i.event_id, decision_note: i.note ?? null }, { count: "exact" })
    .eq("id", i.idea_id)
    .eq("status", "proposed");
  dbError(error);
  if (!count) throw notFound("This idea is not open any more.");
}, { revalidate: [PAGES.eventsTeam, PAGES.ideas, PAGES.home] });

export const rejectIdea = defineAction(z.object({ idea_id: uuid, note: z.string().trim().max(1000).optional() }), async (ctx, i) => {
  requireRole(ctx, "events");
  const { error, count } = await ctx.supabase
    .from("event_ideas")
    .update({ status: "rejected", decision_note: i.note ?? null }, { count: "exact" })
    .eq("id", i.idea_id)
    .eq("status", "proposed");
  dbError(error);
  if (!count) throw notFound("This idea is not open any more.");
}, { revalidate: [PAGES.eventsTeam, PAGES.ideas, PAGES.home] });

/** Moves an idea to another date (and so possibly another month). */
export const moveIdea = defineAction(z.object({ idea_id: uuid, proposed_date: isoDate }), async (ctx, i) => {
  requireRole(ctx, "events");
  const { error, count } = await ctx.supabase
    .from("event_ideas")
    .update({ proposed_date: i.proposed_date }, { count: "exact" })
    .eq("id", i.idea_id)
    .eq("status", "proposed");
  dbError(error);
  if (!count) throw notFound("This idea is not open any more.");
}, { revalidate: [PAGES.eventsTeam, PAGES.ideas, PAGES.home] });

// ── Cycles and the schedule ─────────────────────────────────────────────────

export const createCycle = defineAction(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM") }), async (ctx, { month }) => {
  requireRole(ctx, "events");
  const { data, error } = await ctx.supabase.from("planning_cycles").insert({ month: `${month}-01` }).select("id").single();
  if (error?.code === "23505") throw new ActionError("failed", "There is already a cycle for this month.");
  dbError(error);
  return data!;
}, { revalidate: [PAGES.eventsTeam, PAGES.home] });

const eventFields = {
  title,
  type: eventType,
  starts_at: localDateTime,
  ends_at: localDateTime.nullable().optional(),
  location: z.string().trim().max(300).nullable().optional(),
  // Where people meet, when not at the location (round 2026-11-02): the name only here; address and time on the event page.
  meeting_point: z.string().trim().max(300).nullable().optional(),
  helpers_needed: helpers,
  ocs_needed: ocsNeeded.default(1),
  price_cents: z.number().int().min(0).max(1_000_000).nullable().optional(),
  capacity: z.number().int().min(1).max(100_000).nullable().optional(),
  ...sorting,
};

export const createEvent = defineAction(z.object({ cycle_id: uuid, ...eventFields }), async (ctx, i) => {
  requireRole(ctx, "events");
  const { data: cycle } = await ctx.supabase.from("planning_cycles").select("status, month").eq("id", i.cycle_id).single();
  if (!cycle) throw notFound();
  if (!["planning", "form_open"].includes(cycle.status)) throw new ActionError("failed", "Events can only be added while the schedule is being planned.");
  if (i.ends_at && i.ends_at < i.starts_at) throw new ActionError("failed", "The end is before the start.");
  if (monthOf(i.starts_at) !== cycle.month) throw new ActionError("failed", `The event must take place in ${monthLabel(cycle.month)} – the month of this cycle.`);
  const { data, error } = await ctx.supabase
    .from("events")
    .insert({ ...i, status: cycle.status === "form_open" ? "scheduled" : "draft" })
    .select("id")
    .single();
  dbError(error);
  return { id: data!.id };
}, { revalidate: [PAGES.eventsTeam, PAGES.calendar, PAGES.home] });

/** The address as ESN Activities wants it, checked as the form does (lib/address.ts). */
const address = z
  .object({ country: z.string().regex(/^[A-Z]{2}$/), street: z.string().trim().max(200), postal_code: z.string().trim().max(10), city: z.string().trim().max(100) })
  .superRefine((a, ctx) => {
    const errors = validateAddress({ country: a.country, street: a.street, postalCode: a.postal_code, city: a.city });
    for (const [field, message] of Object.entries(errors)) ctx.addIssue({ code: "custom", path: [field === "postalCode" ? "postal_code" : field], message });
  });

/**
 * Where people meet when it is not the location (round 2026-11-02): a place's
 * name, optionally its address (checked like the event's) and the time to be
 * there. null clears it (they meet at the location).
 */
const meeting = z
  .object({
    point: z.string().trim().max(300),
    address: address.nullable(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM, e.g. 08:15").nullable(),
  })
  .refine((m) => m.point || m.address, { message: "Name the meeting point or give its address.", path: ["point"] });

/** Event details: Events changes everything, the OC the place (venue, address and meeting point), price and capacity. */
export const updateEvent = defineAction(
  z.object({
    id: uuid,
    title: title.optional(),
    type: eventType.optional(),
    helpers_needed: helpers.optional(),
    ocs_needed: ocsNeeded.optional(),
    starts_at: localDateTime.optional(),
    ends_at: localDateTime.nullable().optional(),
    location: z.string().trim().max(300).nullable().optional(),
    price_cents: z.number().int().min(0).max(1_000_000).nullable().optional(),
    capacity: z.number().int().min(1).max(100_000).nullable().optional(),
    address: address.nullable().optional(),
    /** The meeting point's name alone (the schedule form); empty: they meet at the location (address and time go too). */
    meeting_point: z.string().trim().max(300).nullable().optional(),
    meeting: meeting.nullable().optional(),
    ...sorting,
  }),
  async (ctx, { id, address: a, meeting: m, meeting_point: point, ...rest }) => {
    // Checked against the address lookup like a delivery address (round 2026-10-30); a lookup that cannot answer does not block.
    for (const [which, x] of [["This address", a], ["The meeting point's address", m?.address]] as const) {
      if (x && (await verifyAddress({ country: x.country, street: x.street, postalCode: x.postal_code, city: x.city })) === "not_found") {
        throw new ActionError("failed", `${which} was not found – pick it from the suggestions, or check street, house number, postal code and city.`);
      }
    }
    const patch = {
      ...rest,
      ...(a === undefined
        ? {}
        : a === null
          ? { address_street: null, address_postal_code: null, address_city: null }
          : { address_country: a.country, address_street: a.street, address_postal_code: a.postal_code, address_city: a.city }),
      ...(m === undefined
        ? point === undefined
          ? {}
          : point
            ? { meeting_point: point }
            : { meeting_point: null, meeting_street: null, meeting_postal_code: null, meeting_city: null, meeting_time: null }
        : {
            meeting_point: m?.point || null,
            meeting_country: m?.address?.country ?? "DE",
            meeting_street: m?.address?.street ?? null,
            meeting_postal_code: m?.address?.postal_code ?? null,
            meeting_city: m?.address?.city ?? null,
            meeting_time: m?.time ?? null,
          }),
    };
    if (!hasRole(ctx.viewer.roles, "events")) {
      await requireEventOc(ctx, id);
      if (patch.title !== undefined || patch.type !== undefined || patch.helpers_needed !== undefined || patch.category_id !== undefined || patch.format_id !== undefined) {
        throw forbidden("Only the Events team changes the title, type, category, format and number of helpers.");
      }
      if (patch.starts_at !== undefined || patch.ends_at !== undefined) {
        throw forbidden("Only the Events team changes the date – ask them in the Chat space.");
      }
    }
    const { error, count } = await ctx.supabase.from("events").update(patch, { count: "exact" }).eq("id", id);
    dbError(error);
    if (!count) throw notFound();
  },
  { revalidate: [PAGES.event, PAGES.eventsTeam, PAGES.calendar, PAGES.me, PAGES.home] }
);

/** Removes a draft event from the month plan (it is dropped, not deleted). */
export const dropEvent = defineAction(z.object({ id: uuid }), async (ctx, { id }) => {
  requireRole(ctx, "events");
  const { error, count } = await ctx.supabase.from("events").update({ status: "dropped" }, { count: "exact" }).eq("id", id).in("status", ["draft", "scheduled"]);
  dbError(error);
  if (!count) throw notFound("Only planned events can be removed here.");
}, { revalidate: [PAGES.eventsTeam, PAGES.calendar, PAGES.home] });

export const openForm = defineAction(z.object({ cycle_id: uuid, closes_at: localDateTime }), async (ctx, i) => {
  requireRole(ctx, "events");
  dbError((await ctx.supabase.rpc("open_volunteer_form", { cycle: i.cycle_id, closes_at: i.closes_at })).error);
}, { revalidate: [PAGES.all] });

export const closeForm = defineAction(z.object({ cycle_id: uuid }), async (ctx, i) => {
  requireRole(ctx, "events");
  dbError((await ctx.supabase.rpc("close_volunteer_form", { cycle: i.cycle_id })).error);
}, { revalidate: [PAGES.all] });

// ── Volunteer form ──────────────────────────────────────────────────────────

export const submitVolunteerForm = defineAction(
  z.object({
    cycle_id: uuid,
    note: z.string().trim().max(1000).default(""),
    /** How many events this month; null = no limit. */
    max_events: z.number().int().min(1).max(31).nullable().default(null),
    /** How many of them as OC; null = no limit. */
    max_oc: z.number().int().min(1).max(31).nullable().default(1),
    choices: z
      .array(z.object({ event_id: uuid, oc_rank: rank, helper_rank: rank }))
      .max(200)
      .refine((cs) => new Set(cs.map((c) => c.event_id)).size === cs.length, "Each event once")
      .transform((cs) => cs.filter((c) => c.oc_rank !== null || c.helper_rank !== null)),
  }),
  async (ctx, i) => {
    const { error } = await ctx.supabase.rpc("submit_volunteer_form", {
      cycle: i.cycle_id,
      choices: i.choices,
      note: i.note,
      // Omitted = no limit (the function's default).
      ...(i.max_events !== null && { max_events: i.max_events }),
      ...(i.max_oc !== null && { max_oc: i.max_oc }),
    });
    dbError(error);
    return { events: i.choices.length };
  },
  { revalidate: [PAGES.all] }
);

/** Events clears one person's (locked) answers so they can submit again; logged with the reason. */
export const clearVolunteerResponse = defineAction(
  z.object({ cycle_id: uuid, profile_id: uuid, reason: z.string().trim().min(1, "Give a reason").max(500) }),
  async (ctx, i) => {
    requireRole(ctx, "events");
    dbError((await ctx.supabase.rpc("clear_volunteer_response", { cycle: i.cycle_id, profile: i.profile_id, reason: i.reason })).error);
  },
  { revalidate: [PAGES.eventsTeam] }
);

// ── Allocation and roster ───────────────────────────────────────────────────

/**
 * Runs the automatic allocation on the form's answers and saves it (replacing any earlier run).
 * People on the blacklist are left out (2026-11-07): the Events team adds them by hand.
 */
export const runAllocation = defineAction(z.object({ cycle_id: uuid }), async (ctx, { cycle_id }) => {
  requireRole(ctx, "events");
  const [{ data: events, error: e1 }, { data: signups, error: e2 }, { data: history, error: e3 }, { data: fixed, error: e4 }, { data: blacklist, error: e5 }] = await Promise.all([
    ctx.supabase.from("events").select("id, starts_at, ends_at, helpers_needed, ocs_needed").eq("cycle_id", cycle_id).eq("status", "scheduled"),
    ctx.supabase.rpc("cycle_signups", { cycle: cycle_id }),
    ctx.supabase.rpc("allocation_history", { cycle: cycle_id }),
    ctx.supabase.rpc("event_fixed_people", { cycle: cycle_id }),
    ctx.supabase.from("volunteer_blacklist").select("profile_id").is("removed_at", null),
  ]);
  dbError(e1 ?? e2 ?? e3 ?? e4 ?? e5);
  const choices: AllocationChoice[] = (signups ?? []).map((s) => ({
    profileId: s.profile_id,
    eventId: s.event_id,
    ocRank: s.oc_rank as Rank | null,
    helperRank: s.helper_rank as Rank | null,
  }));
  const limits = new Map((signups ?? []).map((s) => [s.profile_id, { maxEvents: s.max_events, maxOc: s.max_oc }]));
  const people: AllocationPerson[] = (history ?? []).map((h) => ({
    profileId: h.profile_id,
    ...limits.get(h.profile_id),
    recentEvents: h.recent_events,
    pastEvents: h.past_events,
    unplacedLastCycle: h.unplaced_last_cycle,
  }));
  const result = allocate(
    (events ?? []).map((e) => ({
      id: e.id,
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      helpersNeeded: e.helpers_needed,
      ocsNeeded: e.ocs_needed,
      fixed: (fixed ?? []).filter((f) => f.event_id === e.id).map((f) => ({ profileId: f.profile_id, role: f.role as "oc" | "helper" })),
    })),
    choices,
    { seed: cycle_id, people, blocked: (blacklist ?? []).map((b) => b.profile_id) }
  );
  const rows = result.assignments.map((a) => ({ event_id: a.eventId, profile_id: a.profileId, role: a.role, source: a.source }));
  dbError((await ctx.supabase.rpc("save_allocation", { cycle: cycle_id, rows })).error);
  return { assignments: rows.length, events: result.events, conflicts: result.conflicts, issues: result.issues, unplaced: result.unplaced.length, blocked: result.blocked.length, topChoices: result.topChoices };
}, { revalidate: [PAGES.eventsTeam, PAGES.event, PAGES.me, PAGES.home] });

/**
 * Someone becomes OC: when the event's OC slots (ocs_needed) are full, the
 * OC who has been on it longest becomes a helper – with one OC, the previous
 * OC, as before (round 2026-11-04).
 */
async function makeRoomForOc(ctx: ActionContext, eventId: string, incoming: { profileId?: string; assignmentId?: string }) {
  const [{ data: ev }, { data: current }] = await Promise.all([
    ctx.supabase.from("events").select("ocs_needed").eq("id", eventId).single(),
    ctx.supabase.from("assignments").select("id, profile_id").eq("event_id", eventId).eq("role", "oc").eq("status", "active").order("created_at"),
  ]);
  const others = (current ?? []).filter((x) => x.profile_id !== incoming.profileId && x.id !== incoming.assignmentId);
  const surplus = others.length + 1 - (ev?.ocs_needed ?? 1);
  if (surplus <= 0) return;
  dbError((await ctx.supabase.from("assignments").update({ role: "helper" }).in("id", others.slice(0, surplus).map((x) => x.id))).error);
}

async function requireAdjustable(ctx: ActionContext, eventId: string) {
  const { data } = await ctx.supabase.from("events").select("cycle_id, planning_cycles(status)").eq("id", eventId).single();
  if (!data) throw notFound();
  const status = (data.planning_cycles as { status: string } | null)?.status;
  if (status && !["allocated", "confirmed"].includes(status)) {
    throw new ActionError("failed", "Run the allocation before adjusting the roster.");
  }
}

export const assign = defineAction(z.object({ event_id: uuid, profile_id: uuid, role: z.enum(["oc", "helper"]) }), async (ctx, i) => {
  requireRole(ctx, "events");
  await requireAdjustable(ctx, i.event_id);
  // A person already active on the event changes role instead.
  const { data: existing } = await ctx.supabase.from("assignments").select("id").eq("event_id", i.event_id).eq("profile_id", i.profile_id).eq("status", "active").maybeSingle();
  if (i.role === "oc") await makeRoomForOc(ctx, i.event_id, { profileId: i.profile_id });
  if (existing) {
    dbError((await ctx.supabase.from("assignments").update({ role: i.role }).eq("id", existing.id)).error);
    return;
  }
  dbError((await ctx.supabase.from("assignments").insert({ ...i, source: "manual" })).error);
}, { revalidate: [PAGES.eventsTeam, PAGES.event, PAGES.me, PAGES.home] });

/** Drag and drop on the roster board: moves a person to another event and/or role. */
export const moveAssignment = defineAction(z.object({ assignment_id: uuid, event_id: uuid, role: z.enum(["oc", "helper"]) }), async (ctx, i) => {
  requireRole(ctx, "events");
  const { data: a } = await ctx.supabase.from("assignments").select("*").eq("id", i.assignment_id).single();
  if (!a || a.status !== "active") throw notFound();
  await requireAdjustable(ctx, i.event_id);
  if (a.event_id === i.event_id && a.role === i.role) return;
  if (i.role === "oc") await makeRoomForOc(ctx, i.event_id, { assignmentId: a.id });
  if (a.event_id === i.event_id) {
    dbError((await ctx.supabase.from("assignments").update({ role: i.role }).eq("id", a.id)).error);
    return;
  }
  const { data: dup } = await ctx.supabase.from("assignments").select("id").eq("event_id", i.event_id).eq("profile_id", a.profile_id).eq("status", "active").maybeSingle();
  if (dup) throw new ActionError("failed", "This person is already on that event.");
  dbError((await ctx.supabase.from("assignments").delete().eq("id", a.id)).error);
  dbError((await ctx.supabase.from("assignments").insert({ event_id: i.event_id, profile_id: a.profile_id, role: i.role, source: "manual" })).error);
}, { revalidate: [PAGES.eventsTeam, PAGES.event, PAGES.me, PAGES.home] });

export const unassign = defineAction(z.object({ assignment_id: uuid }), async (ctx, i) => {
  requireRole(ctx, "events");
  const { error, count } = await ctx.supabase.from("assignments").delete({ count: "exact" }).eq("id", i.assignment_id);
  dbError(error);
  if (!count) throw notFound();
}, { revalidate: [PAGES.eventsTeam, PAGES.event, PAGES.me, PAGES.home] });

export const confirmAllocation = defineAction(z.object({ cycle_id: uuid }), async (ctx, i) => {
  requireRole(ctx, "events");
  dbError((await ctx.supabase.rpc("confirm_allocation", { cycle: i.cycle_id })).error);
}, { revalidate: [PAGES.eventsTeam, PAGES.event, PAGES.calendar, PAGES.me, PAGES.home] });
