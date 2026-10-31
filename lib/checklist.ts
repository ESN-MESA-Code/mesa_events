// The per-event checklist: what still has to happen, from planning to the
// hand-in, each item linked to the event tab where it is done. And the one
// next step for the OC or a helper (event page banner, Home). Pure, so the
// rules are tested (tests/unit/checklist.test.ts).
import { plural } from "@/lib/plural";

/** The event's tabs: "" is the overview. */
export type EventTab = "" | "description" | "attendance" | "hand-in";

/** Ids of the sections the next step points to (review 2026-10-29 B4). */
export type StepAnchor = "decide" | "chat-space" | "description" | "sign-off" | "hand-in-status" | "register-receipt" | "your-receipts" | "event";

export interface ChecklistInput {
  status: string;
  startsAt: string;
  now: number;
  hasOc: boolean;
  helpers: number;
  helpersNeeded: number;
  chatSpace: "none" | "requested" | "created";
  description: "missing" | "draft" | "submitted" | "changes_requested" | "approved" | "published";
  descriptionDeadline: string | null;
  listSignedOff: boolean;
  /** Files in the event's Drive folder when last counted (null: not counted yet). */
  photos: number | null;
  /** At least one file in the folder, or ticked by hand (lib/photos.ts photosIn). */
  photosIn: boolean;
  /** The OC's event report after the event (ESN Activities) is in. */
  reportIn: boolean;
  receipts: number;
  /** The whole team's paper Belege not handed to Finance yet. */
  belegeMissing: number;
  /** Of those, the ones of the member the next step is for (usability review #5). */
  myBelegeMissing: number;
}

export interface ChecklistItem {
  key: string;
  label: string;
  state: "done" | "todo" | "late" | "later";
  detail?: string;
  /** Where it is done. */
  tab: EventTab;
  /** Deadline (ISO), while not done. */
  due?: string;
}

export function eventChecklist(i: ChecklistInput): ChecklistItem[] {
  const started = Date.parse(i.startsAt) <= i.now;
  const descriptionDone = i.description === "published";
  const deadlinePassed = i.descriptionDeadline !== null && Date.parse(i.descriptionDeadline) < i.now;
  const items: ChecklistItem[] = [
    {
      key: "team",
      label: "Team complete",
      state: i.hasOc && i.helpers >= i.helpersNeeded ? "done" : started ? "late" : "todo",
      detail: `${i.hasOc ? "OC" : "no OC"} · ${i.helpers}/${i.helpersNeeded} helpers`,
      tab: "",
    },
    {
      key: "chat",
      label: "Chat space",
      state: i.chatSpace === "created" ? "done" : i.chatSpace === "requested" ? "todo" : "later",
      detail: i.chatSpace === "requested" ? "being created" : i.chatSpace === "none" ? "after the roster is confirmed" : undefined,
      tab: "",
    },
    {
      key: "description",
      label: "Description published",
      state: descriptionDone ? "done" : deadlinePassed || started ? "late" : "todo",
      detail: descriptionDone ? undefined : `${i.description === "missing" ? "not started" : i.description.replace(/_/g, " ")}${started ? " · the event already started" : ""}`,
      tab: "description",
      due: descriptionDone || started || !i.descriptionDeadline ? undefined : i.descriptionDeadline,
    },
    {
      key: "attendance",
      label: "Attendance list signed off",
      state: i.listSignedOff ? "done" : started ? "todo" : "later",
      detail: i.listSignedOff || started ? undefined : "opens on the day",
      tab: "attendance",
    },
    {
      key: "photos",
      label: "Photos in Drive",
      state: i.photosIn ? "done" : started ? "todo" : "later",
      detail: i.photos ? `${i.photos} in the folder` : i.photosIn ? "ticked by hand" : started ? undefined : "after the event",
      tab: "hand-in",
    },
    {
      key: "report",
      label: "Event report written",
      state: i.reportIn ? "done" : started ? "todo" : "later",
      detail: i.reportIn ? undefined : started ? "participants and results, for ESN Activities" : "after the event",
      tab: "hand-in",
    },
    {
      key: "receipts",
      label: "Belege handed to Finance",
      state: i.belegeMissing > 0 ? "todo" : i.receipts > 0 ? "done" : started ? "todo" : "later",
      detail: i.receipts ? `${plural(i.receipts, "receipt")}${i.belegeMissing ? `, ${plural(i.belegeMissing, "Beleg", "Belege")} missing` : ""}` : "none registered",
      tab: "hand-in",
    },
  ];
  // Cancelled or dropped events only need the money sorted out.
  if (i.status === "cancelled" || i.status === "dropped") return items.filter((x) => x.key === "receipts" && i.receipts > 0);
  return items;
}

export function checklistDone(items: ChecklistItem[]): boolean {
  return items.every((x) => x.state === "done");
}

export interface NextStep {
  label: string;
  tab: EventTab;
  /** The element on the tab where it is done (an id; the banner scrolls there on that tab). */
  anchor: StepAnchor;
  /** Deadline (ISO). */
  due?: string;
  /** What happens when the deadline passes ("after that the event is cancelled"). */
  dueNote?: string;
  /** action: theirs to do · waiting: on someone else · done: nothing left. */
  kind: "action" | "waiting" | "done";
}

/**
 * The one thing the OC (or a helper) should do next for this event, in the
 * order the event needs it.
 */
/**
 * At the description deadline, events whose description was never submitted
 * are cancelled (round 2026-10-30); the OC is told so wherever the deadline
 * shows (usability review #1).
 */
export const DEADLINE_CANCELS = "after that the event is cancelled";

export function nextStep(i: ChecklistInput, role: "oc" | "helper"): NextStep {
  const started = Date.parse(i.startsAt) <= i.now;
  // Only the member's own Belege are theirs to hand in; the rest of the team's are waited for (usability review #5).
  const mine = Math.min(i.myBelegeMissing, i.belegeMissing);
  const others = i.belegeMissing - mine;
  const othersWaiting: NextStep = {
    label: `The rest of the team still has to hand in ${plural(others, "Beleg", "Belege")} – remind them in the Chat space`,
    tab: "hand-in",
    anchor: "hand-in-status",
    kind: "waiting",
  };
  if (i.status === "cancelled" || i.status === "dropped") {
    if (mine > 0) return { label: "Hand your Belege to Finance", tab: "hand-in", anchor: "your-receipts", kind: "action" };
    if (others > 0 && role === "oc") return othersWaiting;
    return { label: "Event cancelled – nothing left to do", tab: "", anchor: "event", kind: "done" };
  }
  if (role === "helper") {
    if (!started) return { label: "Help at the event – see the Chat space", tab: "", anchor: "chat-space", kind: "waiting" };
    if (mine > 0) return { label: "Hand the paper Belege to Finance", tab: "hand-in", anchor: "your-receipts", kind: "action" };
    return { label: "Paid for something? Register the receipt", tab: "hand-in", anchor: "register-receipt", kind: "done" };
  }
  if (i.status === "understaffed" && !started) return { label: "Decide: run under-staffed or cancel?", tab: "", anchor: "decide", kind: "action" };
  if (!started) {
    if (i.description === "missing" || i.description === "draft") {
      return {
        label: "Write the description",
        tab: "description",
        anchor: "description",
        due: i.descriptionDeadline ?? undefined,
        dueNote: i.descriptionDeadline ? DEADLINE_CANCELS : undefined,
        kind: "action",
      };
    }
    if (i.description === "changes_requested") {
      return { label: "Fix the description (Comms asked for changes)", tab: "description", anchor: "description", due: i.descriptionDeadline ?? undefined, kind: "action" };
    }
    if (i.description === "submitted" || i.description === "approved") return { label: "Description is with Comms", tab: "description", anchor: "description", kind: "waiting" };
    return { label: "All set – the attendance list opens on the day", tab: "attendance", anchor: "sign-off", kind: "done" };
  }
  if (!i.listSignedOff) return { label: "Sign off the attendance list", tab: "attendance", anchor: "sign-off", kind: "action" };
  if (!i.photosIn || !i.reportIn || mine > 0) return { label: handInLabel(i, mine), tab: "hand-in", anchor: "hand-in-status", kind: "action" };
  if (others > 0) return othersWaiting;
  return { label: "Hand-in complete", tab: "hand-in", anchor: "hand-in-status", kind: "done" };
}

/** "Upload the photos to Drive, write the event report and hand in your Belege" – what is still open. */
function handInLabel(i: ChecklistInput, mine: number): string {
  const parts = [!i.photosIn && "upload the photos to Drive", !i.reportIn && "write the event report", mine > 0 && "hand in your Belege"].filter((x): x is string => !!x);
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const TAB_LABEL: Record<EventTab, string> = { "": "Overview", description: "Description", attendance: "Attendance", "hand-in": "Hand-in" };

/**
 * Where the next-step banner leads (review 2026-10-29 B4): to the step's tab
 * and section, or – on that tab already – just down to the section.
 */
export function stepLink(eventId: string, step: Pick<NextStep, "tab" | "anchor">, pathname: string): { href: string; label: string } {
  const tabPath = `/events/${eventId}${step.tab ? `/${step.tab}` : ""}`;
  return pathname === tabPath ? { href: `#${step.anchor}`, label: "Go to it ↓" } : { href: `${tabPath}#${step.anchor}`, label: `${TAB_LABEL[step.tab]} →` };
}

/**
 * Who decides whether an under-staffed event runs, said to the one reading
 * (review 2026-10-29 B6): the OC; without an OC, the Events team.
 */
export function understaffedNote(hasOc: boolean, viewer: "oc" | "events" | "other"): string {
  if (!hasOc) {
    return viewer === "events"
      ? "Without an OC the Events team decides: find an OC (an open slot or the roster) so it can run, or cancel it."
      : "Without an OC the Events team decides whether it runs.";
  }
  if (viewer === "oc") return "As OC you decide whether it runs as it is or is cancelled.";
  if (viewer === "events") return "The OC decides whether it runs; the Events team can decide in their place.";
  return "The OC decides whether it runs.";
}
