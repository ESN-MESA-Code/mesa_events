import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadInternalForPage } from "@/lib/internalEvents";
import { loadCashBox } from "@/lib/cashView";
import { internalPath } from "@/lib/internal";
import { plural } from "@/lib/plural";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { InternalHeader } from "@/components/InternalHeader";
import { CashBox } from "@/components/CashBox";

export const metadata: Metadata = { title: "Office hour" };

// One office hour (round 2026-10-30): always the same text, the OC and
// helpers on duty, and their cash box with the ESNcards sold (internal for
// members, external) – signed off by the OC. Finance sees it too.
export default async function OfficeHourPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, description, people, mine, isOc, isStaff, isPlanner, viewer, supabase } = await loadInternalForPage(id);
  if (event.kind !== "office_hour") redirect(internalPath(event.kind, id));
  const { report, finance, boxes } = await loadCashBox(supabase, { internal_event_id: id }, viewer.roles, true);
  const oc = people.find((p) => p.role === "oc");
  const helpers = people.filter((p) => p.role === "helper");

  return (
    <div className="space-y-5">
      <InternalHeader event={event} back={{ href: "/office-hours", label: "Office hours" }} role={mine?.role ?? null} planner={isPlanner} />
      {event.status === "cancelled" && <Alert tone="warning">This office hour is cancelled.</Alert>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Office hour</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="whitespace-pre-wrap" data-testid="office-hour-text">
              {description || "ESN MESA office hour."}
            </p>
            {event.note && <p className="whitespace-pre-wrap text-gray-600">{event.note}</p>}
          </CardContent>
        </Card>
        <Card data-testid="duty">
          <CardHeader>
            <CardTitle>On duty</CardTitle>
            <Badge tone={oc && helpers.length >= event.helpers_needed ? "green" : "amber"}>{oc ? `OC + ${plural(helpers.length, "helper")}` : "No OC yet"}</Badge>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <span className="text-gray-500">OC:</span> {oc?.name ?? "–"}
            </p>
            <p>
              <span className="text-gray-500">
                Helpers ({helpers.length}/{event.helpers_needed}):
              </span>{" "}
              {helpers.map((h) => h.name).join(", ") || "–"}
            </p>
          </CardContent>
        </Card>
      </div>
      {(isStaff || report || finance || isPlanner) && (
        <CashBox report={report} target={{ internal_event_id: id }} officeHour canCount={isStaff && event.status === "scheduled"} isOc={isOc} finance={finance} boxes={boxes} />
      )}
    </div>
  );
}
