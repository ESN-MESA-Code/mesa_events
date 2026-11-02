// The cycle timeline's days as the pages load them (round 2026-11-02):
// members read the setting (RLS); the defaults when it is missing.
import type { Db } from "@/lib/supabase/session";
import { parseTimelineDays, type TimelineDays } from "@/lib/timeline";

export async function loadTimelineDays(supabase: Db): Promise<TimelineDays> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "cycle_timeline").maybeSingle();
  return parseTimelineDays(data?.value);
}
