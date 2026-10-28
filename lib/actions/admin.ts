// Admin (IT): manual role members, job retries, settings, role sync.
import { z } from "zod";
import { dbError, defineAction, requireRole } from "@/lib/actions/core";
import { APP_ROLES } from "@/lib/roles";
import { WORKSPACE_DOMAIN } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

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
  }
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
  }
);

export const retryJob = defineAction(z.object({ id: z.number().int().positive() }), async (ctx, { id }) => {
  requireRole(ctx, "admin");
  dbError((await ctx.supabase.rpc("retry_job", { job_id: id })).error);
});

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
});

export const SETTINGS = {
  default_helpers_needed: z.number().int().min(0).max(50),
  chat_notifications: z.boolean(),
  early_payout_threshold_cents: z.number().int().min(0).max(1_000_000),
} as const;

export const updateSetting = defineAction(
  z.discriminatedUnion("key", [
    z.object({ key: z.literal("default_helpers_needed"), value: SETTINGS.default_helpers_needed }),
    z.object({ key: z.literal("chat_notifications"), value: SETTINGS.chat_notifications }),
    z.object({ key: z.literal("early_payout_threshold_cents"), value: SETTINGS.early_payout_threshold_cents }),
  ]),
  async (ctx, { key, value }) => {
    requireRole(ctx, "admin");
    const { error } = await ctx.supabase.from("app_settings").update({ value }).eq("key", key);
    dbError(error);
  }
);
