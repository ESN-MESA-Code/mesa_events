// Hand-in photos: from the private Storage bucket to the event's Drive
// folder, then removed from Storage (Drive is where photos live). Retries
// are safe: the Drive client returns an existing file of the same name.
import type { JobHandler } from "@/lib/jobs/runner";
import { berlinDate } from "@/lib/dates";

export const uploadPhoto: JobHandler = async (job, { admin, google }) => {
  const photoId = (job.payload as { photo_id?: string }).photo_id;
  if (!photoId) throw new Error("Job without photo_id");
  const { data: photo, error } = await admin.from("event_photos").select("*, events(title, starts_at)").eq("id", photoId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!photo) return { skipped: "photo gone" };
  if (photo.status === "uploaded") return { skipped: "already uploaded" };

  const event = photo.events as { title: string; starts_at: string } | null;
  const { data: blob, error: dlError } = await admin.storage.from("event-photos").download(photo.storage_path);
  if (dlError || !blob) throw new Error(`Download failed: ${dlError?.message ?? "no data"}`);

  const file = await google.drive.uploadFile({
    folder: `${event ? berlinDate(event.starts_at) : "unknown"} ${event?.title ?? photo.event_id}`,
    fileName: `${photo.id}-${photo.file_name}`,
    mimeType: photo.mime_type,
    data: new Uint8Array(await blob.arrayBuffer()),
  });
  const { error: upError } = await admin.from("event_photos").update({ status: "uploaded", drive_file_id: file.id, drive_url: file.url }).eq("id", photoId);
  if (upError) throw new Error(upError.message);
  await admin.storage.from("event-photos").remove([photo.storage_path]);
  return { drive_file_id: file.id };
};
