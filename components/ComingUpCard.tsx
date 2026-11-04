import Link from "next/link";
import { TZDate } from "@date-fns/tz";
import { format, startOfISOWeek } from "date-fns";
import { createSessionClient } from "@/lib/supabase/session";
import { berlinTime, monthOf } from "@/lib/dates";
import { TIME_ZONE } from "@/lib/env";
import { monthParam } from "@/lib/month";
import { INTERNAL_KIND_LABELS, internalPath, type InternalKind } from "@/lib/internal";
import { EmptyState } from "@/components/ui";

const DAY = 86_400_000;

const berlin = (iso: string | number) => new TZDate(typeof iso === "number" ? iso : Date.parse(iso), TIME_ZONE);
/** The ISO week in Berlin ("2026-45"). */
const weekKey = (iso: string | number) => format(berlin(iso), "RRRR-II");

/** "This week", "Next week", "Week of 16 Nov". */
function weekLabel(iso: string, now: number): string {
  const key = weekKey(iso);
  if (key === weekKey(now)) return "This week";
  if (key === weekKey(now + 7 * DAY)) return "Next week";
  return `Week of ${format(startOfISOWeek(berlin(iso)), "d MMM")}`;
}

/**
 * What comes up in MESA (round 2026-11-02): the internal events and
 * meetings of the next weeks – not office hours, which are ESN events
 * (2026-11-04); the member's own ESN events are under "My events", the month
 * at a glance is the Calendar. RLS shows executive board meetings to the
 * executive board only. Home's side panel, grouped by week (redesign
 * 2026-11-04); the kind is named only when the title doesn't say it.
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
      .neq("kind", "office_hour")
      .order("starts_at")
      .limit(18),
    supabase.from("internal_event_people").select("internal_event_id, role").eq("profile_id", viewerId),
  ]);
  const myRole = new Map((mine ?? []).map((p) => [p.internal_event_id, p.role]));
  // The member's own duties are under My events (round 2026-11-03 (2)).
  const next = (upcoming ?? []).filter((e) => !["oc", "helper"].includes(myRole.get(e.id) ?? "")).slice(0, 6);
  const weeks: { label: string; items: typeof next }[] = [];
  for (const item of next) {
    const label = weekLabel(item.starts_at, now);
    const last = weeks.at(-1);
    if (last && last.label === label) last.items.push(item);
    else weeks.push({ label, items: [item] });
  }
  return (
    <section aria-labelledby="coming-up-title" className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5" data-testid="home-internal">
      <div className="mb-3 flex items-baseline">
        <h2 id="coming-up-title" className="text-lg font-bold text-gray-900">
          Coming up in MESA
        </h2>
        <Link href={`/calendar?month=${monthParam(monthOf(new Date(now).toISOString()))}&show=internal`} className="ml-auto text-sm font-semibold text-esn hover:underline">
          Calendar →
        </Link>
      </div>
      {!weeks.length ? (
        <EmptyState>Nothing planned in the next four weeks.</EmptyState>
      ) : (
        <div className="space-y-4" data-testid="home-internal-next">
          {weeks.map((w) => (
            <div key={w.label}>
              <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-600">{w.label}</h3>
              <ul>
                {w.items.map((e) => {
                  const role = myRole.get(e.id);
                  const kind = INTERNAL_KIND_LABELS[e.kind as InternalKind];
                  const showKind = !e.title.toLowerCase().includes(kind.toLowerCase());
                  const day = berlin(e.starts_at);
                  return (
                    <li key={e.id}>
                      <Link href={internalPath(e.kind as InternalKind, e.id)} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50">
                        <span className="w-9 shrink-0 text-center leading-tight" aria-hidden="true">
                          <span className="block text-[11px] font-bold uppercase text-gray-600">{format(day, "EEE")}</span>
                          <span className="block text-base font-extrabold tabular-nums text-gray-900">{format(day, "d")}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="sr-only">{format(day, "EEE d MMM")}, </span>
                          <span className="block truncate text-xs tabular-nums text-gray-600">
                            {berlinTime(e.starts_at)}
                            {showKind && ` · ${kind}`}
                            {role && <span className="font-semibold text-emerald-700"> · ✓ Signed up</span>}
                          </span>
                          <span className="block truncate text-sm font-semibold text-gray-900" title={e.title}>
                            {e.title}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
