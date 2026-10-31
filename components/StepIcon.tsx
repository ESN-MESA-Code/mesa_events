// One icon set for steps and checklists (usability review #9 and #28), in
// place of mixed emoji (✅ ◻️ ⬜ …) and the "…" that read as loading.
import { ArrowRight, Circle, CircleCheck, CircleDashed, Clock, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepIconKind = "done" | "todo" | "late" | "later" | "action" | "waiting";

const ICONS = { done: CircleCheck, todo: Circle, late: TriangleAlert, later: CircleDashed, action: ArrowRight, waiting: Clock } as const;
const LABELS: Record<StepIconKind, string> = { done: "Done", todo: "Open", late: "Late", later: "Not yet", action: "To do", waiting: "Waiting" };
const TONES: Record<StepIconKind, string> = {
  done: "text-emerald-600",
  todo: "text-gray-500",
  late: "text-red-600",
  later: "text-gray-300",
  action: "text-esn",
  waiting: "text-gray-500",
};

/** A step's state as an icon with a text alternative. */
export function StepIcon({ kind, className }: { kind: StepIconKind; className?: string }) {
  const Icon = ICONS[kind];
  return <Icon role="img" aria-label={LABELS[kind]} className={cn("inline-block h-4 w-4 shrink-0 align-[-0.15em]", TONES[kind], className)} />;
}
