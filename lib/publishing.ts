// Publishing (brief 2026-10-29, E): the rules of the schedule board and the
// per-event channel status. Pure (tests/unit/publishing.test.ts).
import { berlinDate } from "@/lib/dates";
import { isTbaPrice } from "@/lib/description/template";

export type ChannelState = "published" | "planned" | "skipped" | "not_planned";

/** The chip on the Comms row and the event page: ✓ published, ⏰ planned, – not planned, ⨯ skipped. */
export const STATE_MARK: Record<ChannelState, string> = { published: "✓", planned: "⏰", not_planned: "–", skipped: "⨯" };
export const STATE_LABEL: Record<ChannelState, string> = { published: "published", planned: "planned", not_planned: "not planned", skipped: "skipped" };

export interface PostEventFacts {
  id: string;
  title: string;
  startsAt: string;
  /** Description status ("missing" when none). */
  description: string;
  /** The price as written in the description (TBA while not fixed). */
  price: string;
}

/** Why the platform will not post this to Telegram (the bot's rules): an unapproved description or a TBA price. */
export function telegramRefusal(events: PostEventFacts[]): string | null {
  const unapproved = events.filter((e) => !["approved", "published"].includes(e.description));
  if (unapproved.length) return `The description of ${unapproved.map((e) => `“${e.title}”`).join(", ")} is not approved yet.`;
  const tba = events.filter((e) => isTbaPrice(e.price));
  if (tba.length) return `The price of ${tba.map((e) => `“${e.title}”`).join(", ")} is still TBA.`;
  return null;
}

/**
 * Warnings on a post card: planned before the description is approved,
 * after the event, a TBA price on Telegram, an event planned twice on the
 * same channel. `plannedOnChannel`: how many posts of this channel hold
 * the event (all of them, this one included).
 */
export function postWarnings(post: { channel: string; scheduledFor: string; status: string }, events: PostEventFacts[], plannedOnChannel: Map<string, number>): string[] {
  if (post.status !== "planned") return [];
  const out: string[] = [];
  const day = berlinDate(post.scheduledFor);
  for (const e of events) {
    if (!["approved", "published"].includes(e.description)) out.push(`“${e.title}”: description not approved yet`);
    if (day > berlinDate(e.startsAt)) out.push(`“${e.title}”: planned after the event`);
    if (post.channel === "telegram" && isTbaPrice(e.price)) out.push(`“${e.title}”: price still TBA`);
    if ((plannedOnChannel.get(e.id) ?? 0) > 1) out.push(`“${e.title}”: planned more than once on this channel`);
  }
  return out;
}

/** 10:00 Berlin of a day ("2026-11-05") – the time a post dropped on a day gets. */
export const DEFAULT_POST_HOUR = "10:00";
