import type { Metadata } from "next";
import Link from "next/link";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { berlinTime, formatDate, nowMs } from "@/lib/dates";
import { peopleOf } from "@/lib/internalEvents";
import { CASH_STATUS_LABELS, CASH_STATUS_TONES, cashStatus } from "@/lib/cash";
import { internalStaffing } from "@/lib/internal";
import { isInternalPlanner } from "@/lib/roles";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Office hours" };

const DAY = 86_400_000;

// Office hours (round 2026-10-30): the coming ones with who is on duty, the
// member's own, and the last weeks' with their cash box (for the staff,
// Finance and the planners – RLS hides other boxes).
export default async function OfficeHoursPage() {
  const viewer = (await getViewer())!;
  const supabase = await createSessionClient();
  const now = nowMs();
  const { data: rows } = await supabase
    .from("internal_events")
    .select("id, title, starts_at, ends_at, location, status, helpers_needed")
    .eq("kind", "office_hour")
    .gte("starts_at", new Date(now - 42 * DAY).toISOString())
    .lte("starts_at", new Date(now + 70 * DAY).toISOString())
    .order("starts_at");
  const list = rows ?? [];
  const ids = list.map((r) => r.id);
  const [people, { data: boxes }] = await Promise.all([
    peopleOf(supabase, ids),
    ids.length ? supabase.from("cash_reports").select("internal_event_id, closed_at, checked_at").in("internal_event_id", ids) : Promise.resolve({ data: [] }),
  ]);
  const boxOf = new Map((boxes ?? []).map((b) => [b.internal_event_id, b]));
  // The office hour running now counts as coming (until it ends).
  const ends = (r: (typeof list)[number]) => Date.parse(r.ends_at ?? r.starts_at) + (r.ends_at ? 0 : 2 * 3_600_000);
  const coming = list.filter((r) => ends(r) > now);
  const past = list.filter((r) => ends(r) <= now).reverse();
  const mineIds = new Set(ids.filter((id) => (people.get(id) ?? []).some((p) => p.profileId === viewer.id)));
  const mine = coming.filter((r) => mineIds.has(r.id));

  const Row = ({ r, showCash }: { r: (typeof list)[number]; showCash: boolean }) => {
    const ps = people.get(r.id) ?? [];
    const oc = ps.find((p) => p.role === "oc");
    const helpers = ps.filter((p) => p.role === "helper");
    const me = ps.find((p) => p.profileId === viewer.id);
    const staffing = internalStaffing(!!oc, helpers.length, r.helpers_needed);
    const box = boxOf.get(r.id);
    const status = cashStatus(box ?? null);
    return (
      <li>
        <Link href={`/office-hours/${r.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-gray-50 md:grid-cols-[13rem_minmax(0,1fr)_14rem]">
          <span className="text-sm tabular-nums text-gray-700">
            {formatDate(r.starts_at)}, {berlinTime(r.starts_at)}
            {r.ends_at && `–${berlinTime(r.ends_at)}`}
          </span>
          <span className="col-span-2 min-w-0 text-sm text-gray-600 md:col-span-1">
            <span className="font-medium text-gray-900">{oc?.name ?? "No OC"}</span>
            {helpers.length > 0 && ` + ${helpers.map((h) => h.name).join(", ")}`}
            {r.location && <span className="text-gray-400"> · {r.location}</span>}
          </span>
          <span className="col-span-2 flex flex-wrap gap-1 md:col-span-1 md:justify-end">
            {r.status === "cancelled" && <Badge tone="red">Cancelled</Badge>}
            {me && <Badge tone="blue">You: {me.role === "oc" ? "OC" : "helper"}</Badge>}
            {r.status !== "cancelled" && !showCash && staffing !== "staffed" && <Badge tone="amber">{staffing === "no_oc" ? "OC needed" : "Helper needed"}</Badge>}
            {showCash && (box || me) && <Badge tone={CASH_STATUS_TONES[status]}>Cash box: {CASH_STATUS_LABELS[status]}</Badge>}
          </span>
        </Link>
      </li>
    );
  };

  return (
    <>
      <PageHeader title="Office hours" description="ESNcards, questions and help – who is on duty, and the cash box of each office hour.">
        {isInternalPlanner(viewer.roles) && (
          <Link href="/team/internal" className="self-center text-sm text-esn hover:underline">
            Plan office hours →
          </Link>
        )}
      </PageHeader>
      <div className="space-y-6">
        {mine.length > 0 && (
          <Card data-testid="my-office-hours">
            <CardHeader>
              <CardTitle>Your next office hours</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-gray-100">
                {mine.map((r) => (
                  <Row key={r.id} r={r} showCash />
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Coming up</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!coming.length ? (
              <EmptyState>No office hours planned yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-gray-100" data-testid="office-hours-coming">
                {coming.map((r) => (
                  <Row key={r.id} r={r} showCash={false} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>The last six weeks</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!past.length ? (
              <EmptyState>No office hours in the last six weeks.</EmptyState>
            ) : (
              <ul className="divide-y divide-gray-100" data-testid="office-hours-past">
                {past.map((r) => (
                  <Row key={r.id} r={r} showCash />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
