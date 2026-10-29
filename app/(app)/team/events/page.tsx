import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { cycleLabel, cyclePlannedIn } from "@/lib/dates";
import { CYCLE_STATUS_LABELS } from "@/lib/labels";
import { hasRole } from "@/lib/roles";
import { cyclesWithProgress } from "@/lib/cycleFacts";
import { Badge, Card, CardContent, EmptyState, PageHeader } from "@/components/ui";
import { NewCycleForm } from "./NewCycleForm";
import { EventsDashboard } from "./EventsDashboard";
import { CycleCard } from "./CycleCard";

export const metadata: Metadata = { title: "Events team" };

// The Events team's dashboard: one card per running cycle with its step,
// the schedule ahead and events short of people, past (done) cycles
// collapsed.
export default async function EventsTeamPage() {
  const viewer = await requirePageRole(["events"], { executiveMayRead: true, page: "Events team" });
  const supabase = await createSessionClient();
  const { data: cycles } = await supabase.from("planning_cycles").select("id, month, status, form_closes_at, description_deadline").order("month");
  // A cycle runs until its Done step (review 2026-10-29 A4).
  const checked = await cyclesWithProgress(supabase, cycles ?? []);
  const progress = checked.filter((c) => !c.progress.done);
  const doneIds = new Set(checked.filter((c) => c.progress.done).map((c) => c.id));
  const earlier = (cycles ?? []).filter((c) => !progress.some((p) => p.id === c.id)).reverse();

  return (
    <>
      <PageHeader title="Events team" description="Each month's cycle step by step: ideas, schedule, volunteer form, allocation, roster, descriptions, hand-in." />
      <div className="space-y-6">
        <section aria-label="Cycles" className="space-y-3">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="cycle-cards">
            {progress.map((c) => (
              <CycleCard key={c.id} cycle={c} />
            ))}
            {hasRole(viewer.roles, "events") && (
              <Card className="border-dashed">
                <CardContent className="pt-5">
                  <NewCycleForm />
                </CardContent>
              </Card>
            )}
          </div>
          {!progress.length && <EmptyState>No cycle running – start one for next month.</EmptyState>}
        </section>
        <EventsDashboard />
        {earlier.length > 0 && (
          <Card>
            <details data-testid="past-cycles">
              <summary className="cursor-pointer px-5 py-4 text-base font-semibold text-gray-900">
                Past cycles <span className="text-sm font-normal text-gray-500">({earlier.length})</span>
              </summary>
              <CardContent>
                <ul className="divide-y divide-gray-100 text-sm">
                  {earlier.map((c) => (
                    <li key={c.id}>
                      <Link href={`/team/events/cycles/${c.id}`} className="flex flex-wrap items-center gap-3 py-2 hover:bg-gray-50 px-1">
                        <span className="font-medium text-gray-900">{cycleLabel(c.month)}</span>
                        <span className="text-xs text-gray-500">{cyclePlannedIn(c.month)}</span>
                        <Badge tone={doneIds.has(c.id) ? "green" : "gray"} className="ml-auto">
                          {doneIds.has(c.id) ? "Done" : CYCLE_STATUS_LABELS[c.status]}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </details>
          </Card>
        )}
      </div>
    </>
  );
}
