// Staging only: Admin → "Reset demo data" (docs/STAGING.md). Wipes all data
// (public.staging_wipe() – the database refuses unless it is marked as a demo
// database) and builds the demo again; refused unless every staging gate
// holds (lib/staging.ts), so it can never run against production.
import { z } from "zod";
import { defineAction, forbidden, PAGES, requireRole } from "@/lib/actions/core";
import { WORKSPACE_DOMAIN } from "@/lib/auth";
import { appBaseUrl } from "@/lib/env";
import { roleGroups } from "@/lib/roles";
import { isStaging, stagingGatesHold } from "@/lib/staging";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resetStagingData } from "@/lib/staging/seed";

/** What the admin types to confirm. */
export const RESET_CONFIRMATION = "RESET";

export const resetDemoData = defineAction(
  z.object({ confirm: z.literal(RESET_CONFIRMATION) }),
  async (ctx) => {
    requireRole(ctx, "admin");
    if (process.env.NEXT_PUBLIC_APP_ENV !== "staging" || !isStaging() || !stagingGatesHold()) {
      throw forbidden("Resetting the demo data is only possible on the staging site.");
    }
    const admin = supabaseAdmin();
    const startedAt = new Date().toISOString();
    console.log(`Demo data reset by ${ctx.viewer.email}`);
    const summary = await resetStagingData(admin, {
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      baseUrl: appBaseUrl(),
      domain: WORKSPACE_DOMAIN,
      groups: roleGroups(),
      driveRoot: process.env.DRIVE_PHOTOS_FOLDER_ID || undefined,
    });
    // After the wipe, so it stays in the log.
    await admin.from("activity_log").insert({
      entity: "staging",
      action: "reset",
      actor_email: ctx.viewer.email,
      details: { started_at: startedAt, events: summary.events, people: summary.people },
    });
    return { events: summary.events, people: summary.people };
  },
  // Everything changed, the navigation included.
  { revalidate: [PAGES.all] }
);
