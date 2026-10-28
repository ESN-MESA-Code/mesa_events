// The per-event checklist: what still has to happen, from planning to the
// hand-in, each item linked to the event tab where it is done. And the one
// next step for the OC or a helper (event page banner, Home). Pure, so the
// rules are tested (tests/unit/checklist.test.ts).

/** The event's tabs: "" is the overview. */
export type EventTab = "" | "description" | "attendance" | "hand-in";

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
  photos: number;
  receipts: number;
  belegeMissing: number;
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
      detail: descriptionDone ? undefined : i.description === "missing" ? "not started" : i.description.replace(/_/g, " "),
      tab: "description",
      due: descriptionDone || !i.descriptionDeadline ? undefined : i.descriptionDeadline,
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
      label: "Photos handed in",
      state: i.photos > 0 ? "done" : started ? "todo" : "later",
      detail: i.photos ? `${i.photos}` : started ? undefined : "after the event",
      tab: "hand-in",
    },
    {
      key: "receipts",
      label: "Belege handed to Finance",
      state: i.belegeMissing > 0 ? "todo" : i.receipts > 0 ? "done" : started ? "todo" : "later",
      detail: i.receipts ? `${i.receipts} receipt(s)${i.belegeMissing ? `, ${i.belegeMissing} Beleg(e) missing` : ""}` : "none registered",
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
  /** Deadline (ISO). */
  due?: string;
  /** action: theirs to do · waiting: on someone else · done: nothing left. */
  kind: "action" | "waiting" | "done";
}

/**
 * The one thing the OC (or a helper) should do next for this event, in the
 * order the event needs it.
 */
export function nextStep(i: ChecklistInput, role: "oc" | "helper"): NextStep {
  const started = Date.parse(i.startsAt) <= i.now;
  const handInOpen = i.photos === 0 || i.belegeMissing > 0;
  if (i.status === "cancelled" || i.status === "dropped") {
    return i.belegeMissing > 0
      ? { label: "Hand the Belege to Finance", tab: "hand-in", kind: "action" }
      : { label: "Event cancelled – nothing left to do", tab: "", kind: "done" };
  }
  if (role === "helper") {
    if (!started) return { label: "Help at the event – see the Chat space", tab: "", kind: "waiting" };
    if (i.belegeMissing > 0) return { label: "Hand the paper Belege to Finance", tab: "hand-in", kind: "action" };
    return { label: "Paid for something? Register the receipt", tab: "hand-in", kind: "done" };
  }
  if (i.status === "understaffed" && !started) return { label: "Decide: run under-staffed or cancel?", tab: "", kind: "action" };
  if (!started) {
    if (i.description === "missing" || i.description === "draft") {
      return { label: "Write the description", tab: "description", due: i.descriptionDeadline ?? undefined, kind: "action" };
    }
    if (i.description === "changes_requested") {
      return { label: "Fix the description (Comms asked for changes)", tab: "description", due: i.descriptionDeadline ?? undefined, kind: "action" };
    }
    if (i.description === "submitted" || i.description === "approved") return { label: "Description is with Comms", tab: "description", kind: "waiting" };
    return { label: "All set – the attendance list opens on the day", tab: "attendance", kind: "done" };
  }
  if (!i.listSignedOff) return { label: "Sign off the attendance list", tab: "attendance", kind: "action" };
  if (handInOpen) return { label: "Hand in photos and Belege", tab: "hand-in", kind: "action" };
  return { label: "Hand-in complete", tab: "hand-in", kind: "done" };
}
