// The reminder setting as the pages load it (round 2026-11-03): members read
// app_settings (RLS); the defaults when it is missing.
import type { Db } from "@/lib/supabase/session";
import { parseReminderDays, type ReminderDays } from "@/lib/reminders";

export async function loadReminderDays(supabase: Db): Promise<ReminderDays> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "oc_reminders").maybeSingle();
  return parseReminderDays(data?.value);
}
