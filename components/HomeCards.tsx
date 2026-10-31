import Link from "next/link";
import { createSessionClient } from "@/lib/supabase/session";
import { berlinDate, berlinTime, formatShortDate, monthLabel, monthOf, monthStartIso, nextMonthStartIso } from "@/lib/dates";
import { calendarWeeks, monthParam } from "@/lib/month";
import { INTERNAL_KIND_DOTS, INTERNAL_KIND_LABELS, INTERNAL_KIND_TONES, internalPath, semesterFor, type InternalKind } from "@/lib/internal";
import { LEADER_CATEGORIES, leaderboards, type LeaderRow } from "@/lib/leaderboard";
import { CATEGORY_STYLE } from "@/components/Leaderboard";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const DAY = 86_400_000;

/**
 * Internal events, meetings and office hours on Home (round 2026-10-30): this
 * month as a small calendar and what comes next – RLS shows executive board
 * meetings to the executive board only.
 */
export async function InternalCalendarCard({ viewerId, now }: { viewerId: string; now: number }) {
  const supabase = await createSessionClient();
  const today = berlinDate(new Date(now).toISOString());
  const month = monthOf(new Date(now).toISOString());
  const [{ data: inMonth }, { data: next }, { data: mine }] = await Promise.all([
    supabase.from("internal_events").select("id, kind, starts_at, status").gte("starts_at", monthStartIso(month)).lt("starts_at", nextMonthStartIso(month)),
    supabase
      .from("internal_events")
      .select("id, kind, title, starts_at, status")
      .gte("starts_at", new Date(now).toISOString())
      .lte("starts_at", new Date(now + 45 * DAY).toISOString())
      .eq("status", "scheduled")
      .order("starts_at")
      .limit(6),
    supabase.from("internal_event_people").select("internal_event_id, role").eq("profile_id", viewerId),
  ]);
  const myRole = new Map((mine ?? []).map((p) => [p.internal_event_id, p.role]));
  const byDay = new Map<string, Array<{ kind: InternalKind; mine: boolean }>>();
  for (const e of inMonth ?? []) {
    if (e.status === "cancelled") continue;
    const d = berlinDate(e.starts_at);
    byDay.set(d, [...(byDay.get(d) ?? []), { kind: e.kind as InternalKind, mine: myRole.has(e.id) }]);
  }
  return (
    <Card data-testid="home-internal">
      <CardHeader>
        <CardTitle>Internal calendar</CardTitle>
        <Link href={`/calendar?month=${monthParam(month)}&show=internal`} className="text-sm text-esn hover:underline">
          Full calendar →
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="mb-1 text-xs font-semibold text-gray-600">{monthLabel(month)}</p>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-gray-400">
            {WEEKDAYS.map((d, i) => (
              <span key={i}>{d}</span>
            ))}
            {calendarWeeks(month)
              .flat()
              .map((day, i) =>
                day ? (
                  <Link
                    key={day}
                    href={`/calendar?month=${monthParam(month)}&show=internal`}
                    title={(byDay.get(day) ?? []).map((x) => INTERNAL_KIND_LABELS[x.kind]).join(", ") || undefined}
                    className={cn("flex h-8 flex-col items-center justify-start rounded pt-0.5 tabular-nums", day === today ? "bg-esn/10 font-bold text-esn" : day < today ? "text-gray-300" : "text-gray-600")}
                  >
                    {Number(day.slice(8))}
                    <span className="flex gap-0.5">
                      {(byDay.get(day) ?? []).slice(0, 3).map((x, j) => (
                        <span key={j} className={cn("h-1.5 w-1.5 rounded-full", INTERNAL_KIND_DOTS[x.kind], x.mine && "ring-1 ring-esn ring-offset-1")} />
                      ))}
                    </span>
                  </Link>
                ) : (
                  <span key={`b-${i}`} />
                )
              )}
          </div>
        </div>
        {!next?.length ? (
          <EmptyState>Nothing internal in the next weeks.</EmptyState>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm" data-testid="home-internal-next">
            {next.map((e) => {
              const kind = e.kind as InternalKind;
              const role = myRole.get(e.id);
              return (
                <li key={e.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <span className="w-24 text-xs tabular-nums text-gray-500">
                    {formatShortDate(e.starts_at)} {berlinTime(e.starts_at)}
                  </span>
                  <Link href={internalPath(kind, e.id)} className="min-w-0 flex-1 truncate font-medium text-gray-900 hover:text-esn">
                    {e.title}
                  </Link>
                  {role ? <Badge tone="blue">{role === "oc" ? "You: OC" : role === "helper" ? "You: helper" : "Signed up"}</Badge> : <Badge tone={INTERNAL_KIND_TONES[kind]}>{INTERNAL_KIND_LABELS[kind]}</Badge>}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The leaderboard teaser on Home (2026-10-31; the board has its own page):
 * the leader of each category in the viewer's group and their own places.
 */
export async function LeaderboardCard({ viewerId, now }: { viewerId: string; now: number }) {
  const supabase = await createSessionClient();
  const semester = semesterFor(berlinDate(new Date(now).toISOString()));
  const { data } = await supabase.rpc("leaderboard", { semester: semester.key });
  const rows = (data ?? []) as LeaderRow[];
  const newbie = rows.find((r) => r.profile_id === viewerId)?.newbie ?? false;
  const board = leaderboards(rows, Infinity)[newbie ? "newbies" : "active"];
  return (
    <Card data-testid="home-leaderboard">
      <CardHeader>
        <CardTitle>
          <span aria-hidden>🏆 </span>Leaderboard {semester.name}
        </CardTitle>
        <Link href="/leaderboard" className="text-sm text-esn hover:underline">
          See the leaderboard →
        </Link>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-3 sm:grid-cols-3">
          {LEADER_CATEGORIES.map((c) => {
            const leader = board[c.metric][0];
            const me = board[c.metric].find((r) => r.id === viewerId);
            return (
              <li key={c.metric} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <span aria-hidden>{CATEGORY_STYLE[c.metric].icon} </span>
                  {c.title}
                </p>
                <p className={cn("truncate font-medium", leader?.id === viewerId ? "text-esn-dark" : "text-gray-900")}>{leader ? `🥇 ${leader.name}${leader.id === viewerId ? " (you)" : ""} · ${c.unit(leader.count)}` : "Nobody yet – be the first!"}</p>
                {me && me.place > 1 && <p className="text-xs text-esn-dark">You: place {me.place}</p>}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
