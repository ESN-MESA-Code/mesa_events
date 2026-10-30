// ESN Activities (brief 2026-10-29, B): the OC's event report, the
// executive board's upload status (round 2026-10-30; it was Comms') (manual link) and personal access tokens for the browser
// script.
import { z } from "zod";
import { dbError, defineAction, PAGES, requireEventOc, requireRole, uuid } from "@/lib/actions/core";
import { isEsnActivityUrl } from "@/lib/esn/formData";

const count = (label: string) => z.number({ error: `${label}: please enter a number.` }).int(`${label}: please enter a number.`).min(0).max(99999);

export const saveEventReport = defineAction(
  z.object({
    event_id: uuid,
    intl_participants: count("International participants"),
    local_participants: count("Local participants").default(0),
    organizers: count("Organizers / volunteers"),
    goals_reached: z.boolean(),
    went_well: z.string().trim().min(1, "Tell us in 1–2 sentences what went well.").max(1000),
    could_be_better: z.string().trim().max(1000).default(""),
    access_needs: z.boolean().default(false),
    access_note: z.string().trim().max(1000).default(""),
  }),
  async (ctx, i) => {
    await requireEventOc(ctx, i.event_id);
    const { error } = await ctx.supabase.rpc("save_event_report", {
      event: i.event_id,
      intl_participants: i.intl_participants,
      local_participants: i.local_participants,
      organizers: i.organizers,
      goals_reached: i.goals_reached,
      went_well: i.went_well,
      could_be_better: i.could_be_better,
      access_needs: i.access_needs,
      access_note: i.access_note,
    });
    dbError(error);
  },
  { revalidate: [PAGES.event, PAGES.home, PAGES.comms, PAGES.eventsTeam] }
);

export const markEsnUploaded = defineAction(
  z.object({ event_id: uuid, url: z.string().trim().refine(isEsnActivityUrl, "Paste the link of the saved activity (https://activities.esn.org/activity/…).") }),
  async (ctx, i) => {
    requireRole(ctx, "executive");
    dbError((await ctx.supabase.rpc("mark_esn_uploaded", { event: i.event_id, url: i.url })).error);
  },
  { revalidate: [PAGES.event, PAGES.comms, PAGES.esn, PAGES.home] }
);

export const unmarkEsnUploaded = defineAction(z.object({ event_id: uuid }), async (ctx, i) => {
  requireRole(ctx, "executive");
  dbError((await ctx.supabase.rpc("unmark_esn_uploaded", { event: i.event_id })).error);
}, { revalidate: [PAGES.event, PAGES.comms, PAGES.esn, PAGES.home] });

/** Returns the token – the only time it is shown. */
export const createEsnToken = defineAction(
  z.object({ label: z.string().trim().min(1, "Name it, e.g. \"My laptop\"").max(60), valid_days: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)]) }),
  async (ctx, i) => {
    requireRole(ctx, "executive");
    const { data, error } = await ctx.supabase.rpc("create_esn_token", { label: i.label, valid_days: i.valid_days });
    dbError(error);
    return { token: data as string };
  },
  { revalidate: [] }
);

export const revokeEsnToken = defineAction(z.object({ token_id: uuid }), async (ctx, i) => {
  dbError((await ctx.supabase.rpc("revoke_esn_token", { token: i.token_id })).error);
}, { revalidate: [PAGES.esn] });
