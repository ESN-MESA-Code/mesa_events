// Chat jobs: spaces per event, their members, roster messages. Every step is
// idempotent (request ids, message ids, recorded members), so a retry after
// a failure halfway through finishes the work without duplicates.
import { createHash } from "node:crypto";
import type { Job, JobDeps, JobHandler } from "@/lib/jobs/runner";
import { eventStatusMessage, rosterMessage, spaceDescription, spaceDisplayName, spaceGuidelines, welcomeMessage, type SpacePerson } from "@/lib/chatMessages";

const eventIdOf = (job: Job) => {
  const id = (job.payload as { event_id?: string }).event_id;
  if (!id) throw new Error("Job without event_id");
  return id;
};

const eventUrl = (deps: JobDeps, id: string) => `${deps.baseUrl}/events/${id}`;

async function loadEvent(deps: JobDeps, id: string) {
  const { data, error } = await deps.admin.from("events").select("id, title, starts_at, status, chat_space_name, chat_space_url").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function roster(deps: JobDeps, eventId: string): Promise<SpacePerson[]> {
  const { data, error } = await deps.admin.rpc("chat_space_roster", { event: eventId });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ email: r.email, name: r.full_name, kind: r.kind as SpacePerson["kind"] }));
}

/** Adds missing members, removes people the platform added who left the roster, refreshes the details. */
async function syncMembers(deps: JobDeps, event: NonNullable<Awaited<ReturnType<typeof loadEvent>>>) {
  const space = event.chat_space_name!;
  const people = await roster(deps, event.id);
  const wanted = new Set(people.map((p) => p.email));
  const { data: recorded, error } = await deps.admin.from("event_chat_members").select("email").eq("event_id", event.id);
  if (error) throw new Error(error.message);
  const have = new Set((recorded ?? []).map((r) => r.email));

  const added: string[] = [];
  const removed: string[] = [];
  for (const email of [...wanted].sort()) {
    if (have.has(email)) continue;
    await deps.google.chat.addMember(space, email);
    const { error: e } = await deps.admin.from("event_chat_members").upsert({ event_id: event.id, email });
    if (e) throw new Error(e.message);
    added.push(email);
  }
  for (const email of [...have].sort()) {
    if (wanted.has(email)) continue;
    await deps.google.chat.removeMember(space, email);
    const { error: e } = await deps.admin.from("event_chat_members").delete().eq("event_id", event.id).eq("email", email);
    if (e) throw new Error(e.message);
    removed.push(email);
  }
  await deps.google.chat.updateSpaceDetails(space, {
    description: spaceDescription(event, people),
    guidelines: spaceGuidelines(event, people, eventUrl(deps, event.id)),
  });
  return { people, added, removed };
}

export const createSpace: JobHandler = async (job, deps) => {
  const event = await loadEvent(deps, eventIdOf(job));
  if (!event || ["draft", "dropped", "cancelled"].includes(event.status)) return { skipped: "event not running" };
  if (!event.chat_space_name) {
    const space = await deps.google.chat.createSpace({ displayName: spaceDisplayName(event), requestId: `mesa-event-${event.id}` });
    const { error } = await deps.admin.from("events").update({ chat_space_name: space.name, chat_space_url: space.url }).eq("id", event.id);
    if (error) throw new Error(error.message);
    event.chat_space_name = space.name;
    event.chat_space_url = space.url;
  }
  const { people, added } = await syncMembers(deps, event);
  await deps.google.chat.postMessage(event.chat_space_name, welcomeMessage(event, people, eventUrl(deps, event.id)), `welcome-${event.id}`);
  return { space: event.chat_space_name, added: added.length };
};

export const syncSpaceMembers: JobHandler = async (job, deps) => {
  const event = await loadEvent(deps, eventIdOf(job));
  if (!event) return { skipped: "event gone" };
  if (!event.chat_space_name) {
    // The space is still being created; that job syncs the members too.
    return { skipped: "no space yet" };
  }
  const { added, removed } = await syncMembers(deps, event);
  return { added, removed };
};

export const rosterChange: JobHandler = async (job, deps) => {
  const p = job.payload as { event_id: string; kind: "dropout" | "claim"; profile_id: string; role: "oc" | "helper"; assignment_id: string };
  const event = await loadEvent(deps, p.event_id);
  if (!event) return { skipped: "event gone" };
  const [{ data: person }, people, { data: setting }] = await Promise.all([
    deps.admin.from("profiles").select("full_name, email").eq("id", p.profile_id).single(),
    roster(deps, event.id),
    deps.admin.from("app_settings").select("value").eq("key", "chat_notifications").maybeSingle(),
  ]);
  const oc = people.find((x) => x.kind === "oc" && x.email !== person?.email) ?? null;
  const text = rosterMessage(p.kind, person?.full_name ?? "Someone", p.role, oc?.email ?? null, eventUrl(deps, event.id), event.title);
  const out: Record<string, boolean> = { posted: false, notified: false };
  if (event.chat_space_name) {
    await deps.google.chat.postMessage(event.chat_space_name, text, `roster-${p.kind}-${p.assignment_id}`);
    out.posted = true;
  }
  if (oc && setting?.value !== false) {
    await deps.google.chat.notify(oc.email, text, `roster-dm-${p.kind}-${p.assignment_id}`);
    out.notified = true;
  }
  return out;
};

/**
 * An event was cancelled or reopened: a message to its space, @-mentioning
 * OC and helpers; without a space, a direct message to each of them (the
 * only way they hear of it, so not switched off by chat_notifications).
 */
export const eventStatusChange: JobHandler = async (job, deps) => {
  const p = job.payload as { event_id: string; kind: "cancelled" | "reopened"; at: string };
  const { data: event, error } = await deps.admin.from("events").select("id, title, starts_at, status, chat_space_name, cancel_reason").eq("id", p.event_id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!event) return { skipped: "event gone" };
  // Reopened (or cancelled again) since: the newer job tells the newer news.
  if ((p.kind === "cancelled") !== (event.status === "cancelled")) return { skipped: "status changed since" };
  const people = await roster(deps, event.id);
  const text = eventStatusMessage(p.kind, event, people, eventUrl(deps, event.id), p.kind === "cancelled" ? event.cancel_reason : null);
  // Chat message ids are at most 63 characters: one per event and cancellation/reopening.
  const id = `status-${p.kind}-${createHash("sha256").update(`${event.id}:${p.at}`).digest("hex").slice(0, 32)}`;
  if (event.chat_space_name) {
    await deps.google.chat.postMessage(event.chat_space_name, text, id);
    return { posted: true };
  }
  const staff = people.filter((x) => x.kind !== "team");
  for (const person of staff) await deps.google.chat.notify(person.email, text, `${id}-${person.email}`);
  return { posted: false, notified: staff.length };
};
