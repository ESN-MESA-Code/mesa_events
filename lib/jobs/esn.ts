// ESN Activities (brief 2026-10-29, B): the first link of an event to its
// ESN activity is told in the event's Chat space, once (idempotency key
// chat.esn_uploaded:<event>, fixed Chat message id).
import type { JobHandler } from "@/lib/jobs/runner";
import { esnUploadedMessage } from "@/lib/chatMessages";

export const esnUploaded: JobHandler = async (job, deps) => {
  const eventId = (job.payload as { event_id?: string }).event_id;
  if (!eventId) throw new Error("Job without event_id");
  const [{ data: event, error }, { data: upload }] = await Promise.all([
    deps.admin.from("events").select("id, title, chat_space_name").eq("id", eventId).maybeSingle(),
    deps.admin.from("esn_uploads").select("activity_url").eq("event_id", eventId).maybeSingle(),
  ]);
  if (error) throw new Error(error.message);
  if (!event) return { skipped: "event gone" };
  if (!upload) return { skipped: "link taken back" };
  if (!event.chat_space_name) return { skipped: "no Chat space" };
  await deps.google.chat.postMessage(event.chat_space_name, esnUploadedMessage(event.title, upload.activity_url), `esn-uploaded-${event.id}`);
  return { posted: true };
};
