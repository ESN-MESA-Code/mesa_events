// Texts the platform posts to Google Chat (pure, unit-tested).
import { formatDateTime } from "@/lib/dates";
import { MENTION_ALL, SPACE_DESCRIPTION_MAX, mention } from "@/lib/google/types";
import { truncate } from "@/lib/google/chat";

export interface SpacePerson {
  email: string;
  name: string;
  kind: "oc" | "helper" | "team";
}

export interface SpaceEvent {
  id: string;
  title: string;
  starts_at: string;
}

export function spaceDisplayName(e: SpaceEvent): string {
  return truncate(`${e.title} · ${formatDateTime(e.starts_at)}`, 128);
}

/** The space description: date and OC (Chat allows 150 characters, plain text). */
export function spaceDescription(e: SpaceEvent, people: SpacePerson[]): string {
  const oc = people.find((p) => p.kind === "oc");
  return truncate(`📅 ${formatDateTime(e.starts_at)} · OC: ${oc?.name ?? "open"}`, SPACE_DESCRIPTION_MAX);
}

export function spaceGuidelines(e: SpaceEvent, people: SpacePerson[], eventUrl: string): string {
  const oc = people.filter((p) => p.kind === "oc");
  const helpers = people.filter((p) => p.kind === "helper");
  return [
    `${e.title} – ${formatDateTime(e.starts_at)}`,
    `OC: ${oc.map((p) => p.name).join(", ") || "open"}`,
    `Helpers: ${helpers.map((p) => p.name).join(", ") || "none yet"}`,
    `Event page (details, description, attendance, receipts): ${eventUrl}`,
  ].join("\n");
}

/** The first message in a new space, @-mentioning OC and helpers. */
export function welcomeMessage(e: SpaceEvent, people: SpacePerson[], eventUrl: string): string {
  const oc = people.filter((p) => p.kind === "oc");
  const helpers = people.filter((p) => p.kind === "helper");
  return [
    `👋 Welcome to the space for *${e.title}* on ${formatDateTime(e.starts_at)}!`,
    `OC: ${oc.map((p) => mention(p.email)).join(", ") || "open – claim it on the event page"}`,
    `Helpers: ${helpers.map((p) => mention(p.email)).join(", ") || "none yet"}`,
    `Event page: ${eventUrl}`,
  ].join("\n");
}

export function rosterMessage(kind: "dropout" | "claim", person: string, role: "oc" | "helper", ocEmail: string | null, eventUrl: string, title: string): string {
  const roleName = role === "oc" ? "OC" : "helper";
  const tellOc = ocEmail ? ` ${mention(ocEmail)}` : "";
  if (kind === "dropout") {
    return `⚠️ ${person} dropped out as ${roleName} of *${title}*. The ${roleName} slot is open – anyone can claim it on the event page: ${eventUrl}${tellOc}`;
  }
  return `✅ ${person} took the open ${roleName} slot of *${title}*.${tellOc}`;
}

/** The published description as posted to the space: the text plus @all. */
export function publishedPost(chatText: string): string {
  return `${chatText}\n\n${MENTION_ALL}`;
}

/** The space (or, without one, each of OC and helpers) is told an event was cancelled or reopened. */
export function eventStatusMessage(kind: "cancelled" | "reopened", e: SpaceEvent, people: SpacePerson[], eventUrl: string, reason: string | null): string {
  const staff = people.filter((p) => p.kind !== "team").map((p) => mention(p.email));
  const tell = staff.length ? `\n${staff.join(" ")}` : "";
  if (kind === "cancelled") {
    return [
      `🚫 *${e.title}* on ${formatDateTime(e.starts_at)} is cancelled.${reason ? ` Reason: ${reason}` : ""}`,
      "Receipts you already registered stay valid – hand the paper Belege to Finance as usual.",
      `Event page: ${eventUrl}${tell}`,
    ].join("\n");
  }
  return [`✅ *${e.title}* on ${formatDateTime(e.starts_at)} is back on – the Events team reopened it.`, `Event page: ${eventUrl}${tell}`].join("\n");
}

/** At the event's start (the bot's photo reminder). */
export function photoStartMessage(title: string): string {
  return `${MENTION_ALL} 📸 *${title}* starts now – please take lots of pictures and videos for our socials! 🎉`;
}

/**
 * The next morning: where the pictures go, and – until it is in – the
 * event report for ESN Activities (the bot's upload reminder).
 */
export function photoUploadMessage(title: string, folder: { url: string; name: string }, reportUrl: string | null): string {
  const lines = [`${MENTION_ALL} 📤 Thanks for making *${title}* happen! Please upload your pictures and videos here: <${folder.url}|📁 ${folder.name}>`];
  if (reportUrl) lines.push(`One organizer please also fill in the short *event report* (for ESN Activities): ${reportUrl}`);
  return lines.join("\n");
}

/** Comms uploaded the event to ESN Activities (the bot's "📢 PR has uploaded …"), once per event. */
export function esnUploadedMessage(title: string, url: string): string {
  return `${MENTION_ALL} 📢 Comms has uploaded *${title}* on ESN Activities. <${url}|Open>`;
}

/** Comms (or Events) reminds the OC: the description, or the event report after the event. */
export function remindOcMessage(about: "description" | "report", title: string, ocEmail: string | null, eventUrl: string, deadline: string | null): string {
  const who = ocEmail ? `${mention(ocEmail)} ` : "";
  if (about === "description") {
    return `✍️ ${who}A reminder from Comms: please write the description of *${title}*${deadline ? ` – due ${formatDateTime(deadline)}` : ""}: ${eventUrl}/description`;
  }
  return `📝 ${who}A reminder from Comms: please fill in the short event report of *${title}* (for ESN Activities): ${eventUrl}/hand-in#event-report`;
}
