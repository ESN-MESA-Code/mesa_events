import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { cycleLabel, cyclePlannedIn, monthOf, nowMs } from "@/lib/dates";
import { CYCLE_STATUS_LABELS } from "@/lib/labels";
import { hasRole } from "@/lib/roles";
import { cyclesWithProgress } from "@/lib/cycleFacts";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { NewCycleForm } from "./NewCycleForm";
import { EventsDashboard } from "./EventsDashboard";
import { CycleCard } from "./CycleCard";

export const metadata: Metadata = { title: "Events team" };

// The Events team's dashboard: one card per running cycle with its step,
// the schedule ahead and events short of people, earlier cycles.
export default async function EventsTeamPage() {
  const viewer = await requirePageRole(["events"], { executiveMayRead: true, page: "Events team" });
  const supabase = await createSessionClient();
  const { data: cycles } = await supabase.from("planning_cycles").select("id, month, status, form_closes_at, description_deadline").order("month");
  const thisMonth = monthOf(new Date(nowMs()).toISOString());
  const running = (cycles ?? []).filter((c) => c.month >= thisMonth || c.status !== "confirmed");
  const earlier = (cycles ?? []).filter((c) => !running.includes(c)).reverse();
  const progress = await cyclesWithProgress(supabase, running);

  return (
    <>
      <PageHeader title="Events team" description="Each month's cycle step by step: ideas, schedule, volunteer form, allocation, roster, descriptions." />
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
            <CardHeader>
              <CardTitle>Earlier cycles</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-gray-100 text-sm">
                {earlier.map((c) => (
                  <li key={c.id}>
                    <Link href={`/team/events/cycles/${c.id}`} className="flex flex-wrap items-center gap-3 py-2 hover:bg-gray-50 px-1">
                      <span className="font-medium text-gray-900">{cycleLabel(c.month)}</span>
                      <span className="text-xs text-gray-500">{cyclePlannedIn(c.month)}</span>
                      <Badge className="ml-auto">{CYCLE_STATUS_LABELS[c.status]}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
