import Link from "next/link";
import { createSessionClient } from "@/lib/supabase/session";
import { berlinTime, formatShortDate, monthOf } from "@/lib/dates";
import { monthParam } from "@/lib/month";
import { INTERNAL_KIND_LABELS, internalPath, type InternalKind } from "@/lib/internal";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";

const DAY = 86_400_000;

/**
 * What comes up in MESA (round 2026-11-02): the internal events, meetings
 * and office hours of the next weeks – the member's own ESN events are under
 * "My events", the month at a glance is the Calendar. RLS shows executive
 * board meetings to the executive board only.
 */
export async function ComingUpCard({ viewerId, now }: { viewerId: string; now: number }) {
  const supabase = await createSessionClient();
  const [{ data: upcoming }, { data: mine }] = await Promise.all([
    supabase
      .from("internal_events")
      .select("id, kind, title, starts_at, status")
      .gte("starts_at", new Date(now).toISOString())
      .lte("starts_at", new Date(now + 30 * DAY).toISOString())
      .eq("status", "scheduled")
      .order("starts_at")
      .limit(18),
    supabase.from("internal_event_people").select("internal_event_id, role").eq("profile_id", viewerId),
  ]);
  const myRole = new Map((mine ?? []).map((p) => [p.internal_event_id, p.role]));
  // The member's own duties are under My events (round 2026-11-03 (2)).
  const next = (upcoming ?? []).filter((e) => !["oc", "helper"].includes(myRole.get(e.id) ?? "")).slice(0, 6);
  return (
    <Card data-testid="home-internal">
      <CardHeader>
        <CardTitle>Coming up in MESA</CardTitle>
        <Link href={`/calendar?month=${monthParam(monthOf(new Date(now).toISOString()))}&show=internal`} className="text-sm text-esn hover:underline">
          Calendar →
        </Link>
      </CardHeader>
      <CardContent>
        {!next?.length ? (
          <EmptyState>Nothing planned in the next four weeks.</EmptyState>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm" data-testid="home-internal-next">
            {next.map((e) => {
              const role = myRole.get(e.id);
              const kind = e.kind as InternalKind;
              return (
                <li key={e.id} className="flex items-center gap-3 py-2">
                  <span className="w-20 shrink-0 text-xs tabular-nums text-gray-500">
                    {formatShortDate(e.starts_at)}
                    <span className="block">{berlinTime(e.starts_at)}</span>
                  </span>
                  <Link href={internalPath(kind, e.id)} className="min-w-0 flex-1 truncate font-medium text-gray-900 hover:text-esn">
                    {e.title}
                  </Link>
                  {role ? <Badge tone="blue">Signed up</Badge> : <Badge tone="gray">{INTERNAL_KIND_LABELS[kind]}</Badge>}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
