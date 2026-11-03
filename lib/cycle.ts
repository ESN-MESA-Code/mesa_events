// A planning cycle as steps (review C9): Ideas → Schedule → Volunteer form →
// Allocation → Roster → Descriptions → Hand-in → Done (review 2026-10-29
// A4). Pure, so the rules are tested (tests/unit/cycle.test.ts); the cycle
// pages show it as a stepper with the open steps' actions, the Events page
// lists every month's open steps.
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
   * handed in: attendance list signed off, photos in Drive, the event report
   * (receipts are Finance's).
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

/** One thing to do in a cycle: the step and what to do there. */
export interface CycleTodo {
  step: StepId;
  action: string;
}

export interface CycleProgress {
  steps: Step[];
  /** The first open step. */
  current: StepId | null;
  /**
   * The open steps with their action – usually one; a running month can
   * have descriptions and hand-ins open at once (review 2026-11-03 #8).
   */
  todos: CycleTodo[];
  /** What the Events team does next: the todos' actions in one line. */
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
  // A task, not a state: "to do: roster" must not read as done (review 2026-11-03 #3).
  roster: "Roster",
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
      return `${base}/ideas`;
    case "schedule":
      return `${base}/schedule`;
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

/** The month's line in a month selector: "done", or what is open ("to do: descriptions, hand-in"). */
export function monthNote(p: CycleProgress): string {
  return p.done ? "done" : `to do: ${p.todos.map((t) => LABELS[t.step].toLowerCase()).join(", ")}`;
}

export function cycleProgress(f: CycleFacts): CycleProgress {
  let current: StepId;
  let action: string;
  let summary: string;
  const todos: CycleTodo[] = [];
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
      action = "Nudge the members who have not answered yet, or close the form early";
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
      const handInOpen = h.happened - h.done;
      if (h.total === 0 || (h.happened >= h.total && h.done >= h.total)) {
        current = "done";
        action = "Every event is handed in – the cycle is done";
        summary = h.total ? `done · ${handedIn}` : "done · no events ran";
        break;
      }
      // Descriptions and hand-ins overlap once the first event happened:
      // both are open steps (review 2026-11-03 #8).
      if (upcomingMissing > 0)
        todos.push({
          step: "descriptions",
          action: !f.descriptionDeadline
            ? "Set the description deadline"
            : // The OCs are reminded automatically (round 2026-11-03): this says what is open.
              `${plural(upcomingMissing, "description")} ${isAre(upcomingMissing)} not in yet – the OCs are reminded automatically`,
        });
      if (handInOpen > 0 || !todos.length)
        todos.push({ step: "handin", action: handInOpen > 0 ? `${plural(handInOpen, "event")} ${isAre(handInOpen)} not handed in yet – the OCs are reminded automatically` : "Hand-in opens on each event's day" });
      current = todos[0].step;
      action = todos.map((t) => t.action).join(" · ");
      summary =
        upcomingMissing > 0 && h.happened > 0
          ? `running · ${done} of ${total} descriptions in · ${handedIn}`
          : upcomingMissing > 0
            ? `roster confirmed · ${done} of ${total} descriptions in`
            : `hand-in · ${handedIn}`;
      break;
    }
  }
  const finished = current === "done";
  const at = finished ? STEP_ORDER.length : STEP_ORDER.indexOf(current);

  // The timeline (round 2026-11-02): a date per step; the current step is late once its date passed.
  const t = f.timeline;
  const now = f.now ?? Date.now();
  // A form that closes before the standard opening day was opened early: the
  // standard ideas and schedule dates would run backwards (review 2026-11-03 #17).
  const early = !!t && Date.parse(f.formClosesAt ?? t.formCloses) <= Date.parse(t.formOpens);
  const notes: Partial<Record<StepId, string>> = t
    ? {
        ideas: early ? undefined : `ideas by ${milestoneDay(t.ideasDue)}`,
        schedule: early ? undefined : `by ${milestoneDay(t.formOpens)}`,
        form: early ? `opened early · until ${milestoneDay(f.formClosesAt!)}` : dayRange(t.formOpens, f.formClosesAt ?? t.formCloses),
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

  if (!finished && !todos.length) todos.push({ step: current, action });
  const open = new Set(todos.map((x) => x.step));
  const steps = STEP_ORDER.map(
    (id, i) => ({ id, label: LABELS[id], state: i < at ? "done" : open.has(id) ? "current" : "todo", note: notes[id], late: i === at && late ? true : undefined }) as Step
  );
  return { steps, current: finished ? null : current, todos, action, summary, done: finished, late, due };
}
