// `npm run fake:drive -- <event id> [count]` – "uploads" photos to an event's
// folder in the FAKE photo drive (local only), as members would in Drive.
// Then press "Check again" on the event's Hand-in tab, or wait for the
// hourly count. The folder exists from the event's day on (pg_cron).
import { createClient } from "@supabase/supabase-js";
import { LOCAL_ENV } from "./local-supabase.mjs";

const [eventId, n = "5"] = process.argv.slice(2);
if (!eventId) {
  console.error("Usage: npm run fake:drive -- <event id> [count]");
  process.exit(1);
}
const db = createClient(LOCAL_ENV.NEXT_PUBLIC_SUPABASE_URL, LOCAL_ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: folder, error } = await db.from("event_photo_folders").select("folder_id, folder_path").eq("event_id", eventId).maybeSingle();
if (error) throw new Error(error.message);
if (!folder?.folder_id) {
  console.error("This event has no photo folder yet – it is created on the event's day (the jobs run every 30 seconds while the stack is up).");
  process.exit(1);
}
const stamp = Date.now();
const rows = Array.from({ length: Number(n) }, (_, i) => ({ id: `${folder.folder_id}-${stamp}-${i}`, folder_id: folder.folder_id, file_name: `IMG_${stamp}_${i}.jpg` }));
const { error: insertError } = await db.from("fake_drive_files").insert(rows);
if (insertError) throw new Error(insertError.message);
console.log(`Added ${rows.length} files to ${folder.folder_path}. Press "Check again" on the Hand-in tab.`);
