// The personal calendar subscription (round 2026-10-30): a secret feed link
// for calendar apps, shown once, replaced or turned off by its owner.
import { z } from "zod";
import { dbError, defineAction, PAGES } from "@/lib/actions/core";
import { feedUrl } from "@/lib/calendarFeed";

/** A new link (the old one stops working). Returned once – the database keeps only its hash. */
export const createCalendarFeed = defineAction(
  z.object({}),
  async (ctx) => {
    const { data, error } = await ctx.supabase.rpc("create_calendar_feed");
    dbError(error);
    return { url: feedUrl(data as string) };
  },
  { revalidate: [PAGES.calendar] }
);

export const revokeCalendarFeed = defineAction(
  z.object({}),
  async (ctx) => {
    dbError((await ctx.supabase.rpc("revoke_calendar_feed")).error);
  },
  { revalidate: [PAGES.calendar] }
);
