// A planning cycle as steps (review C9): Ideas → Schedule → Volunteer form →
// Allocation → Roster confirmed → Descriptions. Pure, so the rules are
// tested (tests/unit/cycle.test.ts); the cycle page and the Events
// dashboard show it as a stepper with the current step's main action.
import type { CycleStatus } from "@/lib/labels";

export type StepId = "ideas" | "schedule" | "form" | "allocation" | "roster" | "descriptions";

export interface CycleFacts {
  status: CycleStatus;
  /** Events on the schedule (not dropped). */
  events: number;
  /** Open ideas dated in the cycle's month. */
  openIdeas: number;
  responses: number;
  formClosesAt: string | null;
  descriptionDeadline: string | null;
  /** Running events of the confirmed roster and how many descriptions are in (submitted or further). */
  descriptions: { total: number; in: number; published: number };
}

export interface Step {
  id: StepId;
  label: string;
  state: "done" | "current" | "todo";
}

export interface CycleProgress {
  steps: Step[];
  current: StepId | null;
  /** What the Events team does next (the highlighted action). */
  action: string;
  /** One line for the dashboard. */
  summary: string;
}

const LABELS: Record<StepId, string> = {
  ideas: "Ideas",
  schedule: "Schedule",
  form: "Volunteer form",
  allocation: "Allocation",
  roster: "Roster confirmed",
  descriptions: "Descriptions",
};
export const STEP_ORDER: StepId[] = ["ideas", "schedule", "form", "allocation", "roster", "descriptions"];

export function cycleProgress(f: CycleFacts): CycleProgress {
  let current: StepId | null;
  let action: string;
  let summary: string;
  switch (f.status) {
    case "planning":
      if (f.events === 0) {
        current = "ideas";
        action = f.openIdeas ? `Accept or reject the ${f.openIdeas} idea${f.openIdeas === 1 ? "" : "s"}, or add events` : "Add events (no ideas for this month yet)";
        summary = `${f.openIdeas} open idea${f.openIdeas === 1 ? "" : "s"}, no events yet`;
      } else {
        current = "schedule";
        action = "Set the event types, then open the volunteer form";
        summary = `${f.events} event${f.events === 1 ? "" : "s"} planned${f.openIdeas ? ` · ${f.openIdeas} idea${f.openIdeas === 1 ? "" : "s"} waiting` : ""}`;
      }
      break;
    case "form_open":
      current = "form";
      action = "Wait for answers, or close the form early";
      summary = `form open · ${f.responses} answer${f.responses === 1 ? "" : "s"}`;
      break;
    case "form_closed":
      current = "allocation";
      action = "Run the allocation";
      summary = `form closed · ${f.responses} answer${f.responses === 1 ? "" : "s"} · allocate`;
      break;
    case "allocated":
      current = "roster";
      action = "Adjust the roster, then confirm it";
      summary = "allocated · check and confirm the roster";
      break;
    case "confirmed": {
      const { total, in: done } = f.descriptions;
      if (total > 0 && done >= total) {
        current = null;
        action = "All descriptions are in";
        summary = `roster confirmed · ${done} of ${total} descriptions in`;
      } else {
        current = "descriptions";
        action = f.descriptionDeadline ? "Remind OCs whose descriptions are missing" : "Set the description deadline";
        summary = `roster confirmed · ${done} of ${total} descriptions in`;
      }
      break;
    }
  }
  const at = current === null ? STEP_ORDER.length : STEP_ORDER.indexOf(current);
  const steps = STEP_ORDER.map((id, i) => ({ id, label: LABELS[id], state: i < at ? "done" : i === at ? "current" : "todo" }) as Step);
  return { steps, current, action, summary };
}
