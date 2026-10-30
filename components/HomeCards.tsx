import Link from "next/link";
import { createSessionClient } from "@/lib/supabase/session";
import { berlinDate, berlinTime, formatShortDate, monthLabel, monthOf, monthStartIso, nextMonthStartIso } from "@/lib/dates";
import { calendarWeeks, monthParam } from "@/lib/month";
import { INTERNAL_KIND_DOTS, INTERNAL_KIND_LABELS, INTERNAL_KIND_TONES, internalPath, semesterFor, type InternalKind } from "@/lib/internal";
import { leaderboards, type LeaderRow, type Ranked } from "@/lib/leaderboard";
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

function Top({ title, rows, viewerId, unit }: { title: string; rows: Ranked[]; viewerId: string; unit: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>
      {!rows.length ? (
        <p className="text-xs text-gray-400">Nobody yet – be the first!</p>
      ) : (
        <ol className="space-y-0.5 text-sm">
          {rows.map((r) => (
            <li key={r.id} className={cn("flex items-center gap-2", r.id === viewerId && "font-semibold text-esn-dark")}>
              <span className="w-5 text-center" aria-label={`Place ${r.place}`}>
                {["🥇", "🥈", "🥉"][r.place - 1] ?? `${r.place}.`}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {r.name}
                {r.id === viewerId && " (you)"}
              </span>
              <span className="tabular-nums text-gray-600">
                {r.count} {unit}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * The leaderboard (round 2026-10-30): who OC'd and who helped the most ESN
 * events this semester – active members and newbies (the newbies group)
 * apart, to motivate people to organise and help.
 */
export async function LeaderboardCard({ viewerId, now }: { viewerId: string; now: number }) {
  const supabase = await createSessionClient();
  const semester = semesterFor(berlinDate(new Date(now).toISOString()));
  const { data } = await supabase.rpc("leaderboard", { semester: semester.key });
  const boards = leaderboards((data ?? []) as LeaderRow[]);
  const section = (label: string, b: (typeof boards)["active"], testId: string) => (
    <div className="space-y-3" data-testid={testId}>
      <p className="text-sm font-semibold text-gray-800">{label}</p>
      <Top title="Most events as OC" rows={b.oc} viewerId={viewerId} unit="OC" />
      <Top title="Most events helped" rows={b.helper} viewerId={viewerId} unit="helped" />
    </div>
  );
  return (
    <Card data-testid="home-leaderboard">
      <CardHeader>
        <CardTitle>Leaderboard {semester.name}</CardTitle>
        <span className="text-xs text-gray-500">events that took place</span>
      </CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-2">
        {section("Active members", boards.active, "leaderboard-active")}
        {section("Newbies", boards.newbies, "leaderboard-newbies")}
      </CardContent>
    </Card>
  );
}
