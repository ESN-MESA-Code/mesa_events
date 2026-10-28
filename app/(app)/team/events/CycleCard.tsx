import Link from "next/link";
import { cycleLabel, cyclePlannedIn, formatDateTime } from "@/lib/dates";
import type { CycleWithProgress } from "@/lib/cycleFacts";
import { Card, CardContent } from "@/components/ui";
import { Stepper } from "@/components/status";

// One planning cycle with its step and the next action (Events dashboard).
export function CycleCard({ cycle }: { cycle: CycleWithProgress }) {
  const { progress } = cycle;
  return (
    <Card data-testid={`cycle-card-${cycle.month}`}>
      <CardContent className="pt-5 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Link href={`/team/events/cycles/${cycle.id}`} className="text-base font-semibold text-gray-900 hover:text-esn">
            {cycleLabel(cycle.month)}
          </Link>
          <span className="text-xs text-gray-500">{cyclePlannedIn(cycle.month)}</span>
        </div>
        <Stepper steps={progress.steps} label={`Steps of ${cycleLabel(cycle.month)}`} compact />
        <p className="text-sm text-gray-600">
          {progress.summary}
          {cycle.status === "form_open" && cycle.form_closes_at && ` · closes ${formatDateTime(cycle.form_closes_at)}`}
        </p>
        <Link
          href={`/team/events/cycles/${cycle.id}`}
          className={progress.current ? "block rounded-md bg-esn/5 border border-esn/30 px-3 py-2 text-sm font-medium text-esn-dark hover:underline" : "block text-sm text-emerald-700"}
        >
          {progress.current ? `→ ${progress.action}` : `✓ ${progress.action}`}
        </Link>
      </CardContent>
    </Card>
  );
}
