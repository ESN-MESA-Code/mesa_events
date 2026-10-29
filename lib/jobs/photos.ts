// Event photos in Drive (brief 2026-10-29, A), scheduled by
// private.schedule_photo_jobs() (pg_cron, every 5 minutes):
// * drive.ensure_folder – the event's folder <semester>/<yyyy-MM-dd Title>,
//   created or found by name, stored in event_photo_folders;
// * drive.count_photos – the number of files in it (coalescing: "Check
//   again" and the hourly count share one job per event);
// * chat.photo_reminder – "starts now – take pictures" and, the next
//   morning, "upload here" with the folder link, once each (idempotency key
//   per event and kind; fixed Chat message ids on top).
import type { Job, JobDeps, JobHandler } from "@/lib/jobs/runner";
import { berlinDate } from "@/lib/dates";
import { photoFolderPath } from "@/lib/photos";
import { photoStartMessage, photoUploadMessage } from "@/lib/chatMessages";

const RUNNING = ["confirmed", "understaffed", "completed"];

const eventIdOf = (job: Job) => {
  const id = (job.payload as { event_id?: string }).event_id;
  if (!id) throw new Error("Job without event_id");
  return id;
};

async function loadEvent(deps: JobDeps, id: string) {
  const { data, error } = await deps.admin.from("events").select("id, title, starts_at, status, chat_space_name").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** The event's folder: the stored one, or found/created in Drive and stored. */
async function ensurePhotoFolder(deps: JobDeps, event: { id: string; title: string; starts_at: string }) {
  const { data: row, error } = await deps.admin.from("event_photo_folders").select("folder_id, folder_url, folder_path").eq("event_id", event.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (row?.folder_id && row.folder_url && row.folder_path) return { id: row.folder_id, url: row.folder_url, path: row.folder_path };
  const path = photoFolderPath(berlinDate(event.starts_at), event.title);
  const folder = await deps.google.drive.ensureFolder(path);
  const { error: e } = await deps.admin
    .from("event_photo_folders")
    .upsert({ event_id: event.id, folder_id: folder.id, folder_url: folder.url, folder_path: path.join("/") }, { onConflict: "event_id" });
  if (e) throw new Error(e.message);
  return { ...folder, path: path.join("/") };
}

export const ensureFolder: JobHandler = async (job, deps) => {
  const event = await loadEvent(deps, eventIdOf(job));
  if (!event || !RUNNING.includes(event.status)) return { skipped: "event not running" };
  const folder = await ensurePhotoFolder(deps, event);
  return { folder: folder.path };
};

export const countPhotos: JobHandler = async (job, deps) => {
  const eventId = eventIdOf(job);
  const { data: row, error } = await deps.admin.from("event_photo_folders").select("folder_id").eq("event_id", eventId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row?.folder_id) return { skipped: "no folder yet" };
  const now = new Date().toISOString();
  try {
    const n = await deps.google.drive.countFiles(row.folder_id);
    const { error: e } = await deps.admin.from("event_photo_folders").update({ photo_count: n, counted_at: now, count_error: null }).eq("event_id", eventId);
    if (e) throw new Error(e.message);
    return { photos: n };
  } catch (err) {
    // Shown on the hand-in ("Drive could not be read"), so the OC can tick by hand; then retried.
    await deps.admin.from("event_photo_folders").update({ count_error: (err instanceof Error ? err.message : String(err)).slice(0, 500) }).eq("event_id", eventId);
    throw err;
  }
};

export const photoReminder: JobHandler = async (job, deps) => {
  const kind = (job.payload as { kind?: string }).kind;
  if (kind !== "start" && kind !== "upload") throw new Error(`Unknown photo reminder "${kind}"`);
  const event = await loadEvent(deps, eventIdOf(job));
  if (!event || !RUNNING.includes(event.status)) return { skipped: "event not running" };
  if (!event.chat_space_name) return { skipped: "no Chat space" };
  if (kind === "start") {
    await deps.google.chat.postMessage(event.chat_space_name, photoStartMessage(event.title), `photos-start-${event.id}`);
    return { posted: "start" };
  }
  const folder = await ensurePhotoFolder(deps, event);
  // Until the report is in, the reminder asks for it (as the bot's report button did).
  const { data: report, error: reportError } = await deps.admin.from("event_reports").select("event_id").eq("event_id", event.id).maybeSingle();
  if (reportError) throw new Error(reportError.message);
  const reportUrl = report ? null : `${deps.baseUrl}/events/${event.id}/hand-in#event-report`;
  const name = folder.path.split("/").at(-1)!;
  await deps.google.chat.postMessage(event.chat_space_name, photoUploadMessage(event.title, { url: folder.url, name }, reportUrl), `photos-upload-${event.id}`);
  return { posted: "upload", folder: folder.path };
};
