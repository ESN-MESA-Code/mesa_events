// Planning cycle actions: ideas, month schedule, volunteer form, allocation,
// roster adjustments, confirmation.
import { z } from "zod";
import { dbError, defineAction, forbidden, notFound, requireEventOc, requireRole, uuid, ActionError, type ActionContext } from "@/lib/actions/core";
import { allocate, type AllocationChoice, type Rank } from "@/lib/allocation";
import { berlinInputToIso, monthOf } from "@/lib/dates";
import { EVENT_TYPES } from "@/lib/labels";
import { hasRole } from "@/lib/roles";

export const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use a date and time")
  .transform((v) => berlinInputToIso(v));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date (YYYY-MM-DD)").refine((d) => !Number.isNaN(Date.parse(d)), "Not a date");
const title = z.string().trim().min(1, "Required").max(200);
const helpers = z.number().int().min(0).max(50);
const eventType = z.enum(EVENT_TYPES as [string, ...string[]]).transform((t) => t as (typeof EVENT_TYPES)[number]);
const rank = z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]);

// ── Ideas ───────────────────────────────────────────────────────────────────

export const proposeIdea = defineAction(
  z.object({
    title,
    proposed_date: isoDate,
    pitch: z.string().trim().max(2000).default(""),
    helpers_needed: helpers.default(2),
    wants_to_oc: z.boolean().default(true),
  }),
  async (ctx, input) => {
    const { data, error } = await ctx.supabase
      .from("event_ideas")
      .insert({ ...input, proposer_id: ctx.viewer.id })
      .select("id")
      .single();
    dbError(error);
    return data!;
  }
);

export const withdrawIdea = defineAction(z.object({ id: uuid }), async (ctx, { id }) => {
  const { error, count } = await ctx.supabase.from("event_ideas").delete({ count: "exact" }).eq("id", id).eq("proposer_id", ctx.viewer.id);
  dbError(error);
  if (!count) throw notFound("This idea cannot be withdrawn any more.");
});

export const acceptIdea = defineAction(
  z.object({ idea_id: uuid, cycle_id: uuid, type: eventType, starts_at: localDateTime, helpers_needed: helpers.optional() }),
  async (ctx, i) => {
    requireRole(ctx, "events");
    const { data, error } = await ctx.supabase.rpc("accept_idea", {
      idea: i.idea_id,
      cycle: i.cycle_id,
      event_type: i.type,
      starts: i.starts_at,
      helpers: i.helpers_needed,
    });
    dbError(error);
    return { event_id: data as string };
  }
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
});

export const rejectIdea = defineAction(z.object({ idea_id: uuid, note: z.string().trim().max(1000).optional() }), async (ctx, i) => {
  requireRole(ctx, "events");
  const { error, count } = await ctx.supabase
    .from("event_ideas")
    .update({ status: "rejected", decision_note: i.note ?? null }, { count: "exact" })
    .eq("id", i.idea_id)
    .eq("status", "proposed");
  dbError(error);
  if (!count) throw notFound("This idea is not open any more.");
});

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
});

// ── Cycles and the schedule ─────────────────────────────────────────────────

export const createCycle = defineAction(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM") }), async (ctx, { month }) => {
  requireRole(ctx, "events");
  const { data, error } = await ctx.supabase.from("planning_cycles").insert({ month: `${month}-01` }).select("id").single();
  if (error?.code === "23505") throw new ActionError("failed", "There is already a cycle for this month.");
  dbError(error);
  return data!;
});

const eventFields = {
  title,
  type: eventType,
  starts_at: localDateTime,
  ends_at: localDateTime.nullable().optional(),
  location: z.string().trim().max(300).nullable().optional(),
  helpers_needed: helpers,
  price_cents: z.number().int().min(0).max(1_000_000).nullable().optional(),
  capacity: z.number().int().min(1).max(100_000).nullable().optional(),
};

export const createEvent = defineAction(z.object({ cycle_id: uuid, ...eventFields }), async (ctx, i) => {
  requireRole(ctx, "events");
  const { data: cycle } = await ctx.supabase.from("planning_cycles").select("status, month").eq("id", i.cycle_id).single();
  if (!cycle) throw notFound();
  if (!["planning", "form_open"].includes(cycle.status)) throw new ActionError("failed", "Events can only be added while the schedule is being planned.");
  if (i.ends_at && i.ends_at < i.starts_at) throw new ActionError("failed", "The end is before the start.");
  const { data, error } = await ctx.supabase
    .from("events")
    .insert({ ...i, status: cycle.status === "form_open" ? "scheduled" : "draft" })
    .select("id")
    .single();
  dbError(error);
  return { id: data!.id, outsideMonth: monthOf(i.starts_at) !== cycle.month };
});

/** Event details: Events changes everything, the OC the practical details. */
export const updateEvent = defineAction(
  z.object({
    id: uuid,
    title: title.optional(),
    type: eventType.optional(),
    helpers_needed: helpers.optional(),
    starts_at: localDateTime.optional(),
    ends_at: localDateTime.nullable().optional(),
    location: z.string().trim().max(300).nullable().optional(),
    price_cents: z.number().int().min(0).max(1_000_000).nullable().optional(),
    capacity: z.number().int().min(1).max(100_000).nullable().optional(),
  }),
  async (ctx, { id, ...patch }) => {
    if (!hasRole(ctx.viewer.roles, "events")) {
      await requireEventOc(ctx, id);
      if (patch.title !== undefined || patch.type !== undefined || patch.helpers_needed !== undefined) {
        throw forbidden("Only the Events team changes the title, type and number of helpers.");
      }
    }
    const { error, count } = await ctx.supabase.from("events").update(patch, { count: "exact" }).eq("id", id);
    dbError(error);
    if (!count) throw notFound();
  }
);

/** Removes a draft event from the month plan (it is dropped, not deleted). */
export const dropEvent = defineAction(z.object({ id: uuid }), async (ctx, { id }) => {
  requireRole(ctx, "events");
  const { error, count } = await ctx.supabase.from("events").update({ status: "dropped" }, { count: "exact" }).eq("id", id).in("status", ["draft", "scheduled"]);
  dbError(error);
  if (!count) throw notFound("Only planned events can be removed here.");
});

export const openForm = defineAction(z.object({ cycle_id: uuid, closes_at: localDateTime }), async (ctx, i) => {
  requireRole(ctx, "events");
  dbError((await ctx.supabase.rpc("open_volunteer_form", { cycle: i.cycle_id, closes_at: i.closes_at })).error);
});

export const closeForm = defineAction(z.object({ cycle_id: uuid }), async (ctx, i) => {
  requireRole(ctx, "events");
  dbError((await ctx.supabase.rpc("close_volunteer_form", { cycle: i.cycle_id })).error);
});

// ── Volunteer form ──────────────────────────────────────────────────────────

export const submitVolunteerForm = defineAction(
  z.object({
    cycle_id: uuid,
    note: z.string().trim().max(1000).default(""),
    choices: z
      .array(z.object({ event_id: uuid, oc_rank: rank, helper_rank: rank }))
      .max(200)
      .refine((cs) => new Set(cs.map((c) => c.event_id)).size === cs.length, "Each event once")
      .transform((cs) => cs.filter((c) => c.oc_rank !== null || c.helper_rank !== null)),
  }),
  async (ctx, i) => {
    const { error } = await ctx.supabase.rpc("submit_volunteer_form", { cycle: i.cycle_id, choices: i.choices, note: i.note });
    dbError(error);
    return { events: i.choices.length };
  }
);

/** Events clears one person's (locked) answers so they can submit again; logged with the reason. */
export const clearVolunteerResponse = defineAction(
  z.object({ cycle_id: uuid, profile_id: uuid, reason: z.string().trim().min(1, "Give a reason").max(500) }),
  async (ctx, i) => {
    requireRole(ctx, "events");
    dbError((await ctx.supabase.rpc("clear_volunteer_response", { cycle: i.cycle_id, profile: i.profile_id, reason: i.reason })).error);
  }
);

// ── Allocation and roster ───────────────────────────────────────────────────

/** Runs the automatic allocation on the form's answers and saves it (replacing any earlier run). */
export const runAllocation = defineAction(z.object({ cycle_id: uuid }), async (ctx, { cycle_id }) => {
  requireRole(ctx, "events");
  const [{ data: events, error: e1 }, { data: signups, error: e2 }] = await Promise.all([
    ctx.supabase.from("events").select("id, starts_at, ends_at, helpers_needed, proposed_by").eq("cycle_id", cycle_id).eq("status", "scheduled"),
    ctx.supabase.rpc("cycle_signups", { cycle: cycle_id }),
  ]);
  dbError(e1 ?? e2);
  const choices: AllocationChoice[] = (signups ?? []).map((s) => ({
    profileId: s.profile_id,
    eventId: s.event_id,
    ocRank: s.oc_rank as Rank | null,
    helperRank: s.helper_rank as Rank | null,
    submittedAt: s.submitted_at,
  }));
  const result = allocate(
    (events ?? []).map((e) => ({ id: e.id, startsAt: e.starts_at, endsAt: e.ends_at, helpersNeeded: e.helpers_needed, defaultOcId: e.proposed_by })),
    choices
  );
  const rows = result.assignments.map((a) => ({ event_id: a.eventId, profile_id: a.profileId, role: a.role, source: a.source }));
  dbError((await ctx.supabase.rpc("save_allocation", { cycle: cycle_id, rows })).error);
  return { assignments: rows.length, events: result.events, conflicts: result.conflicts };
});

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
  if (i.role === "oc") {
    // The previous OC becomes a helper.
    dbError((await ctx.supabase.from("assignments").update({ role: "helper" }).eq("event_id", i.event_id).eq("role", "oc").eq("status", "active").neq("profile_id", i.profile_id)).error);
  }
  if (existing) {
    dbError((await ctx.supabase.from("assignments").update({ role: i.role }).eq("id", existing.id)).error);
    return;
  }
  dbError((await ctx.supabase.from("assignments").insert({ ...i, source: "manual" })).error);
});

/** Drag and drop on the roster board: moves a person to another event and/or role. */
export const moveAssignment = defineAction(z.object({ assignment_id: uuid, event_id: uuid, role: z.enum(["oc", "helper"]) }), async (ctx, i) => {
  requireRole(ctx, "events");
  const { data: a } = await ctx.supabase.from("assignments").select("*").eq("id", i.assignment_id).single();
  if (!a || a.status !== "active") throw notFound();
  await requireAdjustable(ctx, i.event_id);
  if (a.event_id === i.event_id && a.role === i.role) return;
  if (i.role === "oc") {
    dbError((await ctx.supabase.from("assignments").update({ role: "helper" }).eq("event_id", i.event_id).eq("role", "oc").eq("status", "active").neq("id", a.id)).error);
  }
  if (a.event_id === i.event_id) {
    dbError((await ctx.supabase.from("assignments").update({ role: i.role }).eq("id", a.id)).error);
    return;
  }
  const { data: dup } = await ctx.supabase.from("assignments").select("id").eq("event_id", i.event_id).eq("profile_id", a.profile_id).eq("status", "active").maybeSingle();
  if (dup) throw new ActionError("failed", "This person is already on that event.");
  dbError((await ctx.supabase.from("assignments").delete().eq("id", a.id)).error);
  dbError((await ctx.supabase.from("assignments").insert({ event_id: i.event_id, profile_id: a.profile_id, role: i.role, source: "manual" })).error);
});

export const unassign = defineAction(z.object({ assignment_id: uuid }), async (ctx, i) => {
  requireRole(ctx, "events");
  const { error, count } = await ctx.supabase.from("assignments").delete({ count: "exact" }).eq("id", i.assignment_id);
  dbError(error);
  if (!count) throw notFound();
});

export const confirmAllocation = defineAction(z.object({ cycle_id: uuid }), async (ctx, i) => {
  requireRole(ctx, "events");
  dbError((await ctx.supabase.rpc("confirm_allocation", { cycle: i.cycle_id })).error);
});
