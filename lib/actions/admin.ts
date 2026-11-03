// Admin (IT): manual role members, job retries, settings, role sync.
import { z } from "zod";
import { dbError, defineAction, PAGES, requireRole } from "@/lib/actions/core";
import { APP_ROLES } from "@/lib/roles";
import { WORKSPACE_DOMAIN } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { timelineDaysError } from "@/lib/timeline";
import { reminderDaysError } from "@/lib/reminders";

const workspaceEmail = z
  .email()
  .transform((e) => e.toLowerCase())
  .refine((e) => e.endsWith(`@${WORKSPACE_DOMAIN}`), `Must be an @${WORKSPACE_DOMAIN} address`);

export const addManualRole = defineAction(
  z.object({ email: workspaceEmail, role: z.enum(APP_ROLES as [string, ...string[]]) }),
  async (ctx, { email, role }) => {
    requireRole(ctx, "admin");
    const { error } = await ctx.supabase
      .from("role_members")
      .insert({ email, role: role as (typeof APP_ROLES)[number], source: "manual" });
    dbError(error);
  },
  { revalidate: [PAGES.admin, PAGES.all] }
);

export const removeManualRole = defineAction(
  z.object({ email: workspaceEmail, role: z.enum(APP_ROLES as [string, ...string[]]) }),
  async (ctx, { email, role }) => {
    requireRole(ctx, "admin");
    const { error } = await ctx.supabase
      .from("role_members")
      .delete()
      .eq("email", email)
      .eq("role", role as (typeof APP_ROLES)[number])
      .eq("source", "manual");
    dbError(error);
  },
  { revalidate: [PAGES.admin, PAGES.all] }
);

export const retryJob = defineAction(z.object({ id: z.number().int().positive() }), async (ctx, { id }) => {
  requireRole(ctx, "admin");
  dbError((await ctx.supabase.rpc("retry_job", { job_id: id })).error);
}, { revalidate: [PAGES.admin] });

export const syncRolesNow = defineAction(z.object({}), async (ctx) => {
  requireRole(ctx, "admin");
  // Only the service role enqueues; the admin check above guards it.
  const { error } = await supabaseAdmin().rpc("enqueue_job", {
    job_kind: "directory.sync_roles",
    job_payload: {},
    key: "directory.sync_roles",
    coalescing: true,
  });
  dbError(error);
}, { revalidate: [PAGES.admin] });

export const SETTINGS = {
  default_helpers_needed: z.number().int().min(0).max(50),
  chat_notifications: z.boolean(),
  early_payout_threshold_cents: z.number().int().min(0).max(1_000_000),
  // The cycle's timeline (round 2026-11-02): days of the month before the events; the database checks the order too.
  cycle_timeline: z
    .object({ ideas_due: z.number().int(), form_opens: z.number().int(), form_closes: z.number().int(), descriptions_due: z.number().int() })
    .superRefine((v, c) => {
      const problem = timelineDaysError({ ideasDue: v.ideas_due, formOpens: v.form_opens, formCloses: v.form_closes, descriptionsDue: v.descriptions_due });
      if (problem) c.addIssue({ code: "custom", message: problem });
    }),
  // Days the OC has to send a description again that Comms sent back, then the event is cancelled (round 2026-11-03).
  description_fix_days: z.number().int().min(1).max(14),
  // The automatic reminders to the OC (round 2026-11-03); the database checks the ranges too.
  oc_reminders: z
    .object({ description_days_before: z.number().int(), description_every_days: z.number().int(), handin_days_after: z.number().int(), handin_every_days: z.number().int(), handin_max: z.number().int() })
    .superRefine((v, c) => {
      const problem = reminderDaysError({ descriptionDaysBefore: v.description_days_before, descriptionEveryDays: v.description_every_days, handinDaysAfter: v.handin_days_after, handinEveryDays: v.handin_every_days, handinMax: v.handin_max });
      if (problem) c.addIssue({ code: "custom", message: problem });
    }),
} as const;

export const updateSetting = defineAction(
  z.discriminatedUnion("key", [
    z.object({ key: z.literal("default_helpers_needed"), value: SETTINGS.default_helpers_needed }),
    z.object({ key: z.literal("chat_notifications"), value: SETTINGS.chat_notifications }),
    z.object({ key: z.literal("early_payout_threshold_cents"), value: SETTINGS.early_payout_threshold_cents }),
    z.object({ key: z.literal("cycle_timeline"), value: SETTINGS.cycle_timeline }),
    z.object({ key: z.literal("oc_reminders"), value: SETTINGS.oc_reminders }),
    z.object({ key: z.literal("description_fix_days"), value: SETTINGS.description_fix_days }),
  ]),
  async (ctx, { key, value }) => {
    requireRole(ctx, "admin");
    const { error } = await ctx.supabase.from("app_settings").update({ value }).eq("key", key);
    dbError(error);
  },
  // The timeline shows on every page (Home, Ideas, calendar, the Events team).
  { revalidate: [PAGES.admin, PAGES.all] }
);
