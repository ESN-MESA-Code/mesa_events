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

/** The space description: date and OCs (Chat allows 150 characters, plain text). */
export function spaceDescription(e: SpaceEvent, people: SpacePerson[]): string {
  const oc = people.filter((p) => p.kind === "oc").map((p) => p.name);
  return truncate(`📅 ${formatDateTime(e.starts_at)} · OC: ${oc.join(", ") || "open"}`, SPACE_DESCRIPTION_MAX);
}

/** One or several OCs (round 2026-11-04: an event can have several) as @-mentions, or "". */
function mentionOcs(ocEmail: string | string[] | null): string {
  return [ocEmail ?? []].flat().map(mention).join(" ");
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

export function rosterMessage(kind: "dropout" | "claim", person: string, role: "oc" | "helper", ocEmail: string | string[] | null, eventUrl: string, title: string): string {
  const roleName = role === "oc" ? "OC" : "helper";
  const tellOc = mentionOcs(ocEmail) ? ` ${mentionOcs(ocEmail)}` : "";
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
      "Receipts you already registered stay valid – hand the paper receipts to Finance as usual.",
      `Event page: ${eventUrl}${tell}`,
    ].join("\n");
  }
  return [`✅ *${e.title}* on ${formatDateTime(e.starts_at)} is back on – the Events team reopened it.`, `Event page: ${eventUrl}${tell}`].join("\n");
}

/**
 * The OC asks the Events team to cancel (round 2026-11-03): the Events team
 * mentioned, the reason, and that the event runs until they decide; or the
 * Events team keeps it on and tells the OC why.
 */
export function cancellationMessage(
  kind: "requested" | "declined",
  e: SpaceEvent,
  who: { oc: string | null; ocEmail: string | string[] | null; events: string[] },
  text: string,
  eventUrl: string
): string {
  if (kind === "requested") {
    return [
      `🛑 ${who.events.map(mention).join(" ")} ${who.oc ?? "The OC"} asks to cancel *${e.title}* on ${formatDateTime(e.starts_at)}: “${text}”`,
      `It stays on until the Events team cancels it or keeps it on: ${eventUrl}`,
    ].join("\n");
  }
  return `✅ ${mentionOcs(who.ocEmail) ? `${mentionOcs(who.ocEmail)} ` : ""}The Events team keeps *${e.title}* on ${formatDateTime(e.starts_at)}: “${text}” – ${eventUrl}`;
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

/** The executive board uploaded the event to ESN Activities (the bot's "📢 PR has uploaded …"), once per event. */
export function esnUploadedMessage(title: string, url: string): string {
  return `${MENTION_ALL} 📢 The executive board has uploaded *${title}* on ESN Activities. <${url}|Open>`;
}

/**
 * The automatic reminder to the OC (round 2026-11-03): the description, or
 * what is missing from the hand-in after the event (`missing`, e.g.
 * ["the attendance list", "the event report"]). "report" is the old manual
 * reminder of the event report, still in the queue. A description Comms
 * sent back (`sentBack`) is asked for again, with its own due date.
 */
export function remindOcMessage(
  about: "description" | "handin" | "report",
  title: string,
  ocEmail: string | string[] | null,
  eventUrl: string,
  deadline: string | null,
  missing: string[] = [],
  sentBack = false
): string {
  const who = mentionOcs(ocEmail) ? `${mentionOcs(ocEmail)} ` : "";
  const due = deadline ? ` – due ${formatDateTime(deadline)}, otherwise the event is cancelled` : "";
  if (about === "description" && sentBack) {
    return `✍️ ${who}A reminder: Comms asked for changes to the description of *${title}* – please send it again${due}: ${eventUrl}/description`;
  }
  if (about === "description") {
    return `✍️ ${who}A reminder: please write the description of *${title}*${due}: ${eventUrl}/description`;
  }
  if (about === "report" || !missing.length) {
    return `📝 ${who}A reminder: please fill in the short event report of *${title}* (for ESN Activities): ${eventUrl}/hand-in#event-report`;
  }
  const list = missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}` : missing[0];
  return `📝 ${who}A reminder: the hand-in of *${title}* is still missing ${list}: ${eventUrl}/hand-in`;
}

/** Comms published the event on a channel (the bot's "📢 PR has uploaded … on Telegram"), once per event and channel. */
export function channelPublishedMessage(title: string, channel: string, link: string | null): string {
  return `${MENTION_ALL} 📢 Comms has published *${title}* on ${channel}.${link ? ` <${link}|Open>` : ""}`;
}
