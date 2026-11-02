// A planning cycle as steps (review C9): Ideas → Schedule → Volunteer form →
// Allocation → Roster confirmed → Descriptions → Hand-in → Done (review
// 2026-10-29 A4). Pure, so the rules are tested (tests/unit/cycle.test.ts);
// the cycle page and the Events dashboard show it as a stepper with the
// current step's main action.
import type { CycleStatus } from "@/lib/labels";
import { isAre, plural } from "@/lib/plural";
import { berlinTime, formatShortDate } from "@/lib/dates";
import { dayRange, milestoneDay, type CycleTimeline } from "@/lib/timeline";

export type StepId = "ideas" | "schedule" | "form" | "allocation" | "roster" | "descriptions" | "handin" | "done";

export interface CycleFacts {
  status: CycleStatus;
  /** Events on the schedule (not dropped). */
  events: number;
  /** Open ideas dated in the cycle's month. */
  openIdeas: number;
  responses: number;
  formClosesAt: string | null;
  descriptionDeadline: string | null;
  /**
   * Running events of the confirmed roster and how many descriptions are in
   * (submitted or further); upcomingMissing: events not started yet whose
   * description is not in (the only ones worth a reminder).
   */
  descriptions: { total: number; in: number; published: number; upcomingMissing: number };
  /**
   * Running events (not cancelled), how many have started, and how many are
   * handed in: attendance list signed off, photos in Drive, the event report,
   * every Beleg with Finance.
   */
  handIn: { total: number; happened: number; done: number };
  /** The cycle's standard dates (lib/timeline.ts): each step shows its date, the current one turns late. */
  timeline?: CycleTimeline;
  now?: number;
}

export interface Step {
  id: StepId;
  label: string;
  state: "done" | "current" | "todo";
  /** When the step is due ("by 10 Nov"). */
  note?: string;
  /** The current step is behind the timeline. */
  late?: boolean;
}

export interface CycleProgress {
  steps: Step[];
  current: StepId | null;
  /** What the Events team does next (the highlighted action). */
  action: string;
  /** One line for the dashboard. */
  summary: string;
  /** Every step is behind the cycle: it moves to "Past cycles". */
  done: boolean;
  /** The current step is behind the timeline (it was due at `due`). */
  late: boolean;
  due: string | null;
}

const LABELS: Record<StepId, string> = {
  ideas: "Ideas",
  schedule: "Schedule",
  form: "Volunteer form",
  allocation: "Allocation",
  roster: "Roster confirmed",
  descriptions: "Descriptions",
  handin: "Hand-in",
  done: "Done",
};
export const STEP_ORDER: StepId[] = ["ideas", "schedule", "form", "allocation", "roster", "descriptions", "handin", "done"];

/** The page of a cycle where a step is done – the stepper links there. */
export function stepHref(cycleId: string, step: StepId): string {
  const base = `/team/events/cycles/${cycleId}`;
  switch (step) {
    case "ideas":
    case "schedule":
      return base;
    case "form":
      return `${base}/form`;
    case "allocation":
    case "roster":
      return `${base}/roster`;
    case "descriptions":
      return `${base}/descriptions`;
    case "handin":
    case "done":
      return `${base}/hand-in`;
  }
}

export function cycleProgress(f: CycleFacts): CycleProgress {
  let current: StepId;
  let action: string;
  let summary: string;
  switch (f.status) {
    case "planning":
      if (f.events === 0) {
        current = "ideas";
        action = f.openIdeas ? `Accept or reject the ${plural(f.openIdeas, "idea")}, or add events` : "Add events (no ideas for this month yet)";
        summary = `${plural(f.openIdeas, "open idea")}, no events yet`;
      } else {
        current = "schedule";
        action = "Set the event types, then open the volunteer form";
        summary = `${plural(f.events, "event")} planned${f.openIdeas ? ` · ${plural(f.openIdeas, "idea")} waiting` : ""}`;
      }
      break;
    case "form_open":
      current = "form";
      action = "Nudge those who have not answered (volunteer form page), or close the form early";
      summary = `form open · ${plural(f.responses, "answer")}`;
      break;
    case "form_closed":
      current = "allocation";
      action = "Run the allocation";
      summary = `form closed · ${plural(f.responses, "answer")} · allocate`;
      break;
    case "allocated":
      current = "roster";
      action = "Adjust the roster, then confirm it";
      summary = "allocated · check and confirm the roster";
      break;
    case "confirmed": {
      const { total, in: done, upcomingMissing } = f.descriptions;
      const h = f.handIn;
      const handedIn = `${h.done} of ${plural(h.total, "event")} handed in`;
      if (h.total === 0 || (h.happened >= h.total && h.done >= h.total)) {
        current = "done";
        action = "Every event is handed in – the cycle is done";
        summary = h.total ? `done · ${handedIn}` : "done · no events ran";
      } else if (upcomingMissing > 0) {
        current = "descriptions";
        action = f.descriptionDeadline ? "Remind OCs whose descriptions are missing" : "Set the description deadline";
        summary = `roster confirmed · ${done} of ${total} descriptions in`;
      } else {
        current = "handin";
        const open = h.happened - h.done;
        action = open > 0 ? `Remind the OCs of ${plural(open, "event")} that ${isAre(open)} not handed in yet` : "Hand-in opens on each event's day";
        summary = `hand-in · ${handedIn}`;
      }
      break;
    }
  }
  const finished = current === "done";
  const at = finished ? STEP_ORDER.length : STEP_ORDER.indexOf(current);

  // The timeline (round 2026-11-02): a date per step; the current step is late once its date passed.
  const t = f.timeline;
  const now = f.now ?? Date.now();
  const notes: Partial<Record<StepId, string>> = t
    ? {
        ideas: `ideas by ${milestoneDay(t.ideasDue)}`,
        schedule: `by ${milestoneDay(t.formOpens)}`,
        // A form someone closed before the standard opening day shows its own date only.
        form: Date.parse(f.formClosesAt ?? t.formCloses) > Date.parse(t.formOpens) ?dayRange(t.formOpens, f.formClosesAt ?? t.formCloses) : `until ${milestoneDay(f.formClosesAt!)}`,
        roster: `by ${milestoneDay(t.rosterDue)}`,
        descriptions: `by ${milestoneDay(f.descriptionDeadline ?? t.descriptionsDue)}`,
      }
    : {};
  const dueOf: Partial<Record<StepId, string>> = t ? { ideas: t.formOpens, schedule: t.formOpens, allocation: t.rosterDue, roster: t.rosterDue } : {};
  const due = finished ? null : (dueOf[current] ?? null);
  const late = !!due && Date.parse(due) < now;
  if (late) {
    action = `Overdue since ${formatShortDate(due!)}: ${action}`;
  } else if (t && (current === "ideas" || current === "schedule") && Date.parse(t.formOpens) > now) {
    const opens = `${formatShortDate(t.formOpens)}, ${berlinTime(t.formOpens)}`;
    action = current === "schedule" ? `Set the event types – the form opens by itself on ${opens} (or open it earlier)` : `${action} – the form opens by itself on ${opens} with the events on the schedule`;
  }

  const steps = STEP_ORDER.map(
    (id, i) => ({ id, label: LABELS[id], state: i < at ? "done" : i === at ? "current" : "todo", note: notes[id], late: i === at && late ? true : undefined }) as Step
  );
  return { steps, current: finished ? null : current, action, summary, done: finished, late, due };
}
