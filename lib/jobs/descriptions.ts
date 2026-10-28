// Publishing an approved description to the event's Chat space with @all.
// Idempotent: the first run posts with a fixed message id; later runs (a
// new approval after an edit) edit that same message.
import type { JobHandler } from "@/lib/jobs/runner";
import { MENTION_ALL } from "@/lib/google/types";
import { CONFIG } from "@/lib/description/template";

/** The posted text: the description plus @all, or @all as its own message if that would pass Chat's limit. */
export function postedTexts(text: string): { main: string; extra: string | null } {
  const combined = `${text}\n\n${MENTION_ALL}`;
  if (combined.length <= CONFIG.MAX_CHARS) return { main: combined, extra: null };
  return { main: text, extra: `${MENTION_ALL} ☝️ The description is up.` };
}

export const publishDescription: JobHandler = async (job, { admin, google }) => {
  const eventId = (job.payload as { event_id?: string }).event_id;
  if (!eventId) throw new Error("Job without event_id");
  const [{ data: d, error: e1 }, { data: ev, error: e2 }] = await Promise.all([
    admin.from("descriptions").select("approved_text, published_message_name, published_text").eq("event_id", eventId).maybeSingle(),
    admin.from("events").select("chat_space_name").eq("id", eventId).maybeSingle(),
  ]);
  if (e1 || e2) throw new Error((e1 ?? e2)!.message);
  if (!d?.approved_text) return { skipped: "nothing approved" };
  if (!ev?.chat_space_name) throw new Error("The event's Chat space does not exist yet");

  const { main, extra } = postedTexts(d.approved_text);
  let name = d.published_message_name;
  if (name) {
    if (d.published_text !== main) await google.chat.updateMessage(name, main);
  } else {
    name = (await google.chat.postMessage(ev.chat_space_name, main, `description-${eventId}`)).name;
    if (extra) await google.chat.postMessage(ev.chat_space_name, extra, `description-all-${eventId}`);
  }
  const { error } = await admin.rpc("mark_description_published", { event: eventId, message_name: name, posted_text: main });
  if (error) throw new Error(error.message);
  return { message: name, edited: !!d.published_message_name };
};
