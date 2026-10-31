import Link from "next/link";
import { createSessionClient } from "@/lib/supabase/session";
import { berlinDate, berlinInputToIso, berlinTime, formatShortDate, monthOf } from "@/lib/dates";
import { addDays, monthParam } from "@/lib/month";
import { INTERNAL_KIND_DOTS, INTERNAL_KIND_LABELS, INTERNAL_KIND_TONES, internalPath, semesterFor, type InternalKind } from "@/lib/internal";
import { LEADER_CATEGORIES, leaderboards, type LeaderRow } from "@/lib/leaderboard";
import { CATEGORY_STYLE } from "@/components/Leaderboard";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const DAY = 86_400_000;

/**
 * Internal events, meetings and office hours on Home (round 2026-10-30), with
 * the member's own events (usability review #12): the next four weeks as a
 * small calendar (no links – the list below is where to click) and what comes
 * next. RLS shows executive board meetings to the executive board only.
 */
export async function InternalCalendarCard({ viewerId, now }: { viewerId: string; now: number }) {
  const supabase = await createSessionClient();
  const today = berlinDate(new Date(now).toISOString());
  // From this week's Monday, four weeks.
  const first = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const days = Array.from({ length: 28 }, (_, i) => addDays(first, i));
  const until = new Date(now + 45 * DAY).toISOString();
  const [{ data: inRange }, { data: next }, { data: mine }, { data: myEvents }] = await Promise.all([
    supabase.from("internal_events").select("id, kind, starts_at, status").gte("starts_at", berlinInputToIso(`${first}T00:00`)).lt("starts_at", berlinInputToIso(`${addDays(first, 28)}T00:00`)),
    supabase
      .from("internal_events")
      .select("id, kind, title, starts_at, status")
      .gte("starts_at", new Date(now).toISOString())
      .lte("starts_at", until)
      .eq("status", "scheduled")
      .order("starts_at")
      .limit(6),
    supabase.from("internal_event_people").select("internal_event_id, role").eq("profile_id", viewerId),
    // The member's own ESN events (OC or helper).
    supabase.from("assignments").select("role, events!inner(id, title, starts_at, status)").eq("profile_id", viewerId).eq("status", "active").gte("events.starts_at", berlinInputToIso(`${first}T00:00`)).lte("events.starts_at", until),
  ]);
  const myRole = new Map((mine ?? []).map((p) => [p.internal_event_id, p.role]));
  const own = (myEvents ?? [])
    .map((a) => ({ role: a.role, ev: a.events as unknown as { id: string; title: string; starts_at: string; status: string } }))
    .filter((a) => !["cancelled", "dropped", "draft"].includes(a.ev.status));
  const byDay = new Map<string, Array<{ dot: string; label: string; mine: boolean }>>();
  const mark = (iso: string, x: { dot: string; label: string; mine: boolean }) => byDay.set(berlinDate(iso), [...(byDay.get(berlinDate(iso)) ?? []), x]);
  for (const e of inRange ?? []) if (e.status !== "cancelled") mark(e.starts_at, { dot: INTERNAL_KIND_DOTS[e.kind as InternalKind], label: INTERNAL_KIND_LABELS[e.kind as InternalKind], mine: myRole.has(e.id) });
  for (const a of own) mark(a.ev.starts_at, { dot: "bg-esn", label: a.ev.title, mine: true });
  // One list: internal dates and the member's events, soonest first.
  const list = [
    ...(next ?? []).map((e) => ({ key: e.id, at: e.starts_at, title: e.title, href: internalPath(e.kind as InternalKind, e.id), badge: myRole.get(e.id) ? { tone: "blue" as const, text: myRole.get(e.id) === "oc" ? "You: OC" : myRole.get(e.id) === "helper" ? "You: helper" : "Signed up" } : { tone: INTERNAL_KIND_TONES[e.kind as InternalKind], text: INTERNAL_KIND_LABELS[e.kind as InternalKind] } })),
    ...own.filter((a) => Date.parse(a.ev.starts_at) >= now).map((a) => ({ key: a.ev.id, at: a.ev.starts_at, title: a.ev.title, href: `/events/${a.ev.id}?from=home`, badge: { tone: "blue" as const, text: a.role === "oc" ? "Your event: OC" : "Your event: helper" } })),
  ]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, 8);
  return (
    <Card data-testid="home-internal">
      <CardHeader>
        <CardTitle>Internal calendar</CardTitle>
        <Link href={`/calendar?month=${monthParam(monthOf(new Date(now).toISOString()))}&show=internal`} className="text-sm text-esn hover:underline">
          Full calendar →
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        <div aria-hidden="true">
          <p className="mb-1 text-xs font-semibold text-gray-600">Next four weeks</p>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-gray-400">
            {WEEKDAYS.map((d, i) => (
              <span key={i}>{d}</span>
            ))}
            {days.map((day) => (
              <span
                key={day}
                title={(byDay.get(day) ?? []).map((x) => x.label).join(", ") || undefined}
                className={cn("flex h-8 flex-col items-center justify-start rounded pt-0.5 tabular-nums", day === today ? "bg-esn/10 font-bold text-esn" : day < today ? "text-gray-300" : "text-gray-600")}
              >
                {Number(day.slice(8)) === 1 || day === first ? `${Number(day.slice(8))}.${Number(day.slice(5, 7))}.` : Number(day.slice(8))}
                <span className="flex gap-0.5">
                  {(byDay.get(day) ?? []).slice(0, 3).map((x, j) => (
                    <span key={j} className={cn("h-1.5 w-1.5 rounded-full", x.dot, x.mine && "ring-1 ring-esn ring-offset-1")} />
                  ))}
                </span>
              </span>
            ))}
          </div>
        </div>
        {!list.length ? (
          <EmptyState>Nothing in the next weeks.</EmptyState>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm" data-testid="home-internal-next">
            {list.map((e) => (
              <li key={e.key} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="w-24 text-xs tabular-nums text-gray-500">
                  {formatShortDate(e.at)} {berlinTime(e.at)}
                </span>
                <Link href={e.href} className="min-w-0 flex-1 truncate font-medium text-gray-900 hover:text-esn">
                  {e.title}
                </Link>
                <Badge tone={e.badge.tone}>{e.badge.text}</Badge>
              </li>
            ))}
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
