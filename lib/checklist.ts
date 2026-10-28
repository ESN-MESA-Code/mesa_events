// The per-event checklist: what still has to happen, from planning to the
// hand-in. Pure, so the rules are tested (tests/unit/checklist.test.ts).

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
    },
    {
      key: "chat",
      label: "Chat space",
      state: i.chatSpace === "created" ? "done" : i.chatSpace === "requested" ? "todo" : "later",
      detail: i.chatSpace === "requested" ? "being created" : i.chatSpace === "none" ? "after the roster is confirmed" : undefined,
    },
    {
      key: "description",
      label: "Description published",
      state: descriptionDone ? "done" : deadlinePassed || started ? "late" : "todo",
      detail: descriptionDone ? undefined : i.description === "missing" ? "not started" : i.description.replace(/_/g, " "),
    },
    {
      key: "attendance",
      label: "Attendance list signed off",
      state: i.listSignedOff ? "done" : started ? "todo" : "later",
    },
    { key: "photos", label: "Photos handed in", state: i.photos > 0 ? "done" : started ? "todo" : "later", detail: i.photos ? `${i.photos}` : undefined },
    {
      key: "receipts",
      label: "Belege handed to Finance",
      state: i.belegeMissing > 0 ? "todo" : i.receipts > 0 ? "done" : started ? "todo" : "later",
      detail: i.receipts ? `${i.receipts} receipt(s)${i.belegeMissing ? `, ${i.belegeMissing} Beleg(e) missing` : ""}` : "none registered",
    },
  ];
  // Cancelled or dropped events only need the money sorted out.
  if (i.status === "cancelled" || i.status === "dropped") return items.filter((x) => x.key === "receipts" && i.receipts > 0);
  return items;
}

export function checklistDone(items: ChecklistItem[]): boolean {
  return items.every((x) => x.state === "done");
}
