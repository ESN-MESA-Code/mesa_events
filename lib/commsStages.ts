// The Comms page by stage (brief 2026-10-29, C): one track per event,
//   Description To write → In review → Approved → Published → Event happened
//   → Report → ESN Activities uploaded,
// the current stage with Comms' action, marks (late, missed), the filter it
// falls under and whether it needs Comms. Pure (tests/unit/commsStages.test.ts).
import type { StepView } from "@/components/status";
import type { EsnStatus } from "@/lib/esn/formData";

export type StageId = "write" | "review" | "approved" | "published" | "happened" | "report" | "esn";

export const STAGES: Array<{ id: StageId; label: string }> = [
  { id: "write", label: "To write" },
  { id: "review", label: "In review" },
  { id: "approved", label: "Approved" },
  { id: "published", label: "Published" },
  { id: "happened", label: "Event happened" },
  { id: "report", label: "Report" },
  { id: "esn", label: "ESN Activities uploaded" },
];

export type FilterId = "needs" | "write" | "review" | "publish" | "waiting" | "report" | "esn" | "done" | "all";

export const FILTERS: Array<{ id: Exclude<FilterId, "all" | "needs">; label: string }> = [
  { id: "write", label: "To write" },
  { id: "review", label: "In review" },
  { id: "publish", label: "Ready to publish" },
  { id: "waiting", label: "Waiting for the event" },
  { id: "report", label: "Report missing" },
  { id: "esn", label: "ESN to upload" },
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
  esn: EsnStatus["state"];
}

export interface StageView {
  steps: StepView[];
  /** null: everything done (uploaded). */
  current: StageId | null;
  /** 1-based position of the current stage ("3 of 7"); 7 when done. */
  position: number;
  filter: Exclude<FilterId, "all" | "needs">;
  /** Comms has something to do: review, publish, upload, or chase a late description. */
  needsComms: boolean;
  marks: Array<"late" | "missed">;
}

const IN = ["submitted", "approved", "published"];

export function eventStage(i: StageInput): StageView {
  const started = Date.parse(i.startsAt) <= i.now;
  const published = i.description === "published";
  let current: StageId | null;
  if (!started && !published) current = i.description === "submitted" ? "review" : i.description === "approved" ? "approved" : "write";
  else if (!started) current = "published";
  else if (!i.reportIn) current = "report";
  else if (i.esn !== "uploaded") current = "esn";
  else current = null;

  // Stages behind the current one are done – except a description never
  // published (missed): those stay open, the row is marked.
  const reached: Record<StageId, boolean> = {
    write: IN.includes(i.description),
    review: ["approved", "published"].includes(i.description),
    approved: ["approved", "published"].includes(i.description),
    published,
    happened: started,
    report: i.reportIn,
    esn: i.esn === "uploaded",
  };
  const steps: StepView[] = STAGES.map((s) => ({ label: s.label, state: s.id === current ? "current" : reached[s.id] ? "done" : "todo" }));
  const position = current ? STAGES.findIndex((s) => s.id === current) + 1 : STAGES.length;

  const filter: StageView["filter"] =
    current === "write" ? "write" : current === "review" ? "review" : current === "approved" ? "publish" : current === "published" ? "waiting" : current === "report" ? "report" : current === "esn" ? "esn" : "done";
  const marks: StageView["marks"] = [];
  if (i.late && current === "write") marks.push("late");
  if (i.missed) marks.push("missed");
  const needsComms = current === "review" || current === "approved" || (current === "esn" && i.esn === "ready") || (current === "write" && i.late);
  return { steps, current, position, filter, needsComms, marks };
}

/** "In review 2 · Ready to publish 1 · …": counts per filter, plus "Needs Comms". */
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
