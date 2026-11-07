// Server actions: every mutation validates its input with zod and checks
// authorization on the server, from the database's view of the signed-in
// member – never from what the UI shows. RLS then checks again.
//
// An action is defined once as `(ctx, input) => result` (testable with any
// context, see tests/db/actions.test.ts) and exported from a "use server"
// file through run(), which builds the context from the request's cookies.
// Each action declares which pages it changes (`revalidate`); run()
// revalidates only those after a success (description autosave: none).
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasRole, isTeam, type AppRole } from "@/lib/roles";
import type { Database } from "@/types/database";

export interface ActionContext {
  supabase: SupabaseClient<Database>;
  viewer: { id: string; email: string; roles: AppRole[]; accepted: boolean } | null;
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: "unauthenticated" | "forbidden" | "invalid_input" | "not_found" | "failed"; message: string; issues?: string[] };

export class ActionError extends Error {
  constructor(
    public code: "forbidden" | "not_found" | "failed",
    message: string
  ) {
    super(message);
  }
}

export const forbidden = (message = "You are not allowed to do this.") => new ActionError("forbidden", message);
export const notFound = (message = "Not found.") => new ActionError("not_found", message);

export type Member = NonNullable<ActionContext["viewer"]>;

export function requireRole(ctx: ActionContext, role: AppRole): void {
  if (!hasRole(ctx.viewer!.roles, role)) throw forbidden(`Only the ${role} team can do this.`);
}

export function requireTeam(ctx: ActionContext): void {
  if (!isTeam(ctx.viewer!.roles)) throw forbidden();
}

/** Throws unless the signed-in member is the event's active OC (or has `orRole`). */
export async function requireEventOc(ctx: ActionContext, eventId: string, orRole: AppRole | null = "events") {
  if (orRole && hasRole(ctx.viewer!.roles, orRole)) return;
  const { data, error } = await ctx.supabase.rpc("is_event_oc", { event: eventId });
  if (error || data !== true) throw forbidden("Only the event's OC can do this.");
}

/** Throws unless the member is OC or helper of the event (or has `orRole`). */
export async function requireEventStaff(ctx: ActionContext, eventId: string, orRole: AppRole | null = "events") {
  if (orRole && hasRole(ctx.viewer!.roles, orRole)) return;
  const { data, error } = await ctx.supabase.rpc("is_event_staff", { event: eventId });
  if (error || data !== true) throw forbidden("Only the event's OC and helpers can do this.");
}

/** Turns a Postgres/PostgREST error into an ActionError (RLS refusals → forbidden). */
export function dbError(error: { code?: string; message: string } | null): never | void {
  if (!error) return;
  if (error.code === "42501" || /row-level security/i.test(error.message)) throw forbidden(error.message);
  if (error.code === "PGRST116") throw notFound();
  throw new ActionError("failed", error.message);
}

/** A page path ("/calendar") or a route pattern with its type (["/events/[id]", "layout"]). */
export type RevalidateTarget = string | readonly [string, "page" | "layout"];

/** Pages actions change. The client refreshes the page it is on itself (useAction). */
export const PAGES = {
  /** Every page (the navigation shows the open volunteer form and the roles). */
  all: ["/", "layout"],
  home: "/",
  calendar: "/calendar",
  ideas: "/ideas",
  volunteer: "/volunteer",
  me: "/me",
  reimbursements: "/me/reimbursements",
  event: ["/events/[id]", "layout"],
  eventsTeam: ["/team/events", "layout"],
  comms: "/team/comms",
  esn: "/team/esn-activities",
  schedule: "/team/comms/schedule",
  pictures: "/team/comms/pictures",
  finance: ["/team/finance", "layout"],
  internal: "/team/internal",
  internalEvent: ["/internal/[id]", "page"],
  activity: "/team/internal/activity",
  reliability: "/team/reliability",
  officeHours: ["/office-hours", "layout"],
  admin: "/admin",
} as const satisfies Record<string, RevalidateTarget>;

export type Action<R> = ((ctx: ActionContext, raw: unknown) => Promise<ActionResult<R>>) & {
  /** What run() revalidates after a success. */
  revalidate: readonly RevalidateTarget[];
};

export function defineAction<S extends z.ZodType, R>(
  schema: S,
  handler: (ctx: ActionContext & { viewer: Member }, input: z.infer<S>) => Promise<R>,
  opts: { revalidate: readonly RevalidateTarget[] }
): Action<R> {
  const action = async (ctx: ActionContext, raw: unknown): Promise<ActionResult<R>> => {
    if (!ctx.viewer || !ctx.viewer.accepted) {
      return { ok: false, error: "unauthenticated", message: "Please sign in." };
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error: "invalid_input",
        message: "Please check your input.",
        issues: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`),
      };
    }
    try {
      return { ok: true, data: await handler(ctx as ActionContext & { viewer: Member }, parsed.data) };
    } catch (err) {
      if (err instanceof ActionError) return { ok: false, error: err.code, message: err.message };
      console.error("Action failed:", err);
      return { ok: false, error: "failed", message: err instanceof Error ? err.message : "Something went wrong." };
    }
  };
  return Object.assign(action, { revalidate: opts.revalidate });
}

// ── Shared input schemas ──────────────────────────────────────────────────
export const uuid = z.uuid();
export const cents = z.number().int().min(0).max(10_000_000);
