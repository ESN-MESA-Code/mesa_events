// The Comms page by stage (brief 2026-10-29, C; round 2026-11-03): one track per event,
//   Description To write → In review → Approved (it goes to the Chat space by
//   itself) → pretix page → Advertised (Telegram, Instagram) → Event happened
//   → Report,
// the current stage with Comms' action, marks (late, missed), the filter it
// falls under and whether it needs Comms. "Publish" is the description in
// the Chat space, "advertise" the posts on the channels; ESN Activities is
// the executive board's and has its own tab. Pure (tests/unit/month.test.ts).
import type { StepView } from "@/components/status";

export type StageId = "write" | "review" | "approved" | "pretix" | "advertise" | "happened" | "report";

export const STAGES: Array<{ id: StageId; label: string }> = [
  { id: "write", label: "To write" },
  { id: "review", label: "In review" },
  { id: "approved", label: "In the Chat space" },
  { id: "pretix", label: "pretix page" },
  { id: "advertise", label: "Advertised" },
  { id: "happened", label: "Event happened" },
  { id: "report", label: "Report" },
];

export type FilterId = "needs" | "write" | "review" | "pretix" | "advertise" | "waiting" | "report" | "done" | "all";

export const FILTERS: Array<{ id: Exclude<FilterId, "all" | "needs">; label: string }> = [
  { id: "write", label: "To write" },
  { id: "review", label: "In review" },
  { id: "pretix", label: "pretix to set up" },
  { id: "advertise", label: "To advertise" },
  { id: "waiting", label: "Waiting for the event" },
  { id: "report", label: "Report missing" },
  { id: "done", label: "Done" },
];

export interface StageInput {
  /** Description status ("missing" when none). */
  description: string;
  startsAt: string;
  now: number;
  late: boolean;
  missed: boolean;
  reportIn: boolean;
  /** The pretix page is up (ticked), or pretix is switched off. */
  pretix: boolean;
  /** Posted (or skipped on purpose) on every required advertising channel. */
  advertised: boolean;
}

export interface StageView {
  steps: StepView[];
  /** null: everything done (the report is in). */
  current: StageId | null;
  /** 1-based position of the current stage ("3 of 7"); 7 when done. */
  position: number;
  filter: Exclude<FilterId, "all" | "needs">;
  /** Comms has something to do: review, pretix, advertise, or chase a late description. */
  needsComms: boolean;
  marks: Array<"late" | "missed">;
}

const IN = ["submitted", "approved", "published"];
const APPROVED = ["approved", "published"];

export function eventStage(i: StageInput): StageView {
  const started = Date.parse(i.startsAt) <= i.now;
  const approved = APPROVED.includes(i.description);
  let current: StageId | null;
  if (!started && !approved) current = i.description === "submitted" ? "review" : "write";
  // pretix comes first: the posts link to it.
  else if (!started && !i.pretix) current = "pretix";
  else if (!started && !i.advertised) current = "advertise";
  else if (!started) current = "happened";
  else if (!i.reportIn) current = "report";
  else current = null;

  // Stages behind the current one are done – except a description never
  // published (missed): those stay open, the row is marked.
  const reached: Record<StageId, boolean> = {
    write: IN.includes(i.description),
    review: approved,
    approved,
    pretix: i.pretix,
    advertise: i.advertised,
    happened: started,
    report: i.reportIn,
  };
  const steps: StepView[] = STAGES.map((s) => ({ label: s.label, state: s.id === current ? "current" : reached[s.id] ? "done" : "todo" }));
  const position = current ? STAGES.findIndex((s) => s.id === current) + 1 : STAGES.length;

  const filter: StageView["filter"] =
    current === "write" ? "write" : current === "review" ? "review" : current === "pretix" ? "pretix" : current === "advertise" ? "advertise" : current === "happened" ? "waiting" : current === "report" ? "report" : "done";
  const marks: StageView["marks"] = [];
  if (i.late && current === "write") marks.push("late");
  if (i.missed) marks.push("missed");
  const needsComms = current === "review" || current === "pretix" || current === "advertise" || (current === "write" && i.late);
  return { steps, current, position, filter, needsComms, marks };
}

/** "In review 2 · To advertise 1 · …": counts per filter, plus "Needs Comms". */
export function stageCounts(views: StageView[]): Record<FilterId, number> {
  const counts = Object.fromEntries([...FILTERS.map((f) => [f.id, 0]), ["needs", 0], ["all", views.length]]) as Record<FilterId, number>;
  for (const v of views) {
    counts[v.filter]++;
    if (v.needsComms) counts.needs++;
  }
  return counts;
}

export function parseFilter(raw: string | string[] | undefined): FilterId {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return s === "all" || FILTERS.some((f) => f.id === s) ? (s as FilterId) : "needs";
}
