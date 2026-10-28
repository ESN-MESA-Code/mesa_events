import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { formatDateTime, monthLabel } from "@/lib/dates";
import { CYCLE_STATUS_LABELS } from "@/lib/labels";
import { hasRole } from "@/lib/roles";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { NewCycleForm } from "./NewCycleForm";
import { EventsDashboard } from "./EventsDashboard";

export const metadata: Metadata = { title: "Events team" };

export default async function EventsTeamPage() {
  const viewer = await requirePageRole(["events"], { executiveMayRead: true });
  const supabase = await createSessionClient();
  const [{ data: cycles }, { data: openIdeas }] = await Promise.all([
    supabase.from("planning_cycles").select("id, month, status, form_closes_at, description_deadline").order("month", { ascending: false }),
    supabase.from("event_ideas").select("id", { count: "exact" }).eq("status", "proposed"),
  ]);

  return (
    <>
      <PageHeader title="Events team" description="Month schedules, volunteer forms, allocation and rosters." />
      <div className="space-y-6">
        <EventsDashboard />
        <Card>
          <CardHeader>
            <CardTitle>Planning cycles</CardTitle>
            <span className="text-sm text-gray-500">{openIdeas?.length ?? 0} open ideas</span>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasRole(viewer.roles, "events") && <NewCycleForm />}
            {!cycles?.length && <EmptyState>No cycles yet – start one for next month.</EmptyState>}
            <ul className="divide-y divide-gray-100">
              {(cycles ?? []).map((c) => (
                <li key={c.id}>
                  <Link href={`/team/events/cycles/${c.id}`} className="flex flex-wrap items-center gap-3 py-3 hover:bg-gray-50 px-1">
                    <span className="font-medium text-gray-900 w-40">{monthLabel(c.month)}</span>
                    <Badge tone={c.status === "confirmed" ? "green" : c.status === "form_open" ? "blue" : "gray"}>{CYCLE_STATUS_LABELS[c.status]}</Badge>
                    {c.form_closes_at && c.status === "form_open" && <span className="text-xs text-gray-500">form closes {formatDateTime(c.form_closes_at)}</span>}
                    {c.description_deadline && <span className="text-xs text-gray-500 ml-auto">descriptions due {formatDateTime(c.description_deadline)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
