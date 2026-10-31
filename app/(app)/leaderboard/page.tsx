import type { Metadata } from "next";
import Link from "next/link";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { berlinDate, nowMs } from "@/lib/dates";
import { parseSemesterKey, semesterFor, shiftSemester } from "@/lib/internal";
import { LEADER_CATEGORIES, leaderboards, top, totals, type LeaderRow } from "@/lib/leaderboard";
import { Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { CATEGORY_STYLE, Podium, RankList } from "@/components/Leaderboard";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Leaderboard" };

const GROUPS = { active: "Active members", newbies: "Newbies" } as const;
type Group = keyof typeof GROUPS;
const ORDINAL = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

// The leaderboard (round 2026-10-30, own page 2026-10-31): per semester, who
// OC'd and who helped the most ESN events and who staffed the most office
// hours – a podium for the top three and everyone after it – once for the
// active members and once for the newbies. Earlier semesters stay readable.
export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ semester?: string; group?: string }> }) {
  const sp = await searchParams;
  const viewer = (await getViewer())!;
  const supabase = await createSessionClient();
  const current = semesterFor(berlinDate(new Date(nowMs()).toISOString()));
  const semester = parseSemesterKey(sp.semester) ?? current;
  const isCurrent = semester.key === current.key;
  const { data } = await supabase.rpc("leaderboard", { semester: semester.key });
  const rows = (data ?? []) as LeaderRow[];
  const mineRow = rows.find((r) => r.profile_id === viewer.id);
  const group: Group = sp.group === "newbies" || sp.group === "active" ? sp.group : mineRow?.newbie ? "newbies" : "active";
  const groupRows = rows.filter((r) => (group === "newbies" ? r.newbie : !r.newbie));
  const board = leaderboards(rows, Infinity)[group];
  const sum = totals(rows);
  const query = (p: { semester?: string; group?: Group }) => {
    const s = p.semester ?? semester.key;
    const g = p.group ?? (sp.group ? group : undefined);
    return `/leaderboard?semester=${s}${g ? `&group=${g}` : ""}`;
  };
  const prev = shiftSemester(semester, -1);
  const next = shiftSemester(semester, 1);

  // Where the viewer stands in their own group.
  const myPlaces = mineRow
    ? LEADER_CATEGORIES.map((c) => ({ c, r: top(rows.filter((r) => r.newbie === mineRow.newbie), c.metric, Infinity).find((r) => r.id === viewer.id) })).filter(
        (x): x is { c: (typeof LEADER_CATEGORIES)[number]; r: NonNullable<typeof x.r> } => !!x.r
      )
    : [];

  return (
    <>
      <PageHeader title="Leaderboard" description="Who organised, helped and staffed office hours the most. Events and office hours count once they have taken place.">
        <nav aria-label="Semester" className="flex items-center gap-1 text-sm">
          <Link href={query({ semester: prev.key })} className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-gray-700 hover:text-esn" aria-label={`Previous semester: ${prev.name}`}>
            ←
          </Link>
          <span className="min-w-28 rounded-md border border-esn/30 bg-esn/5 px-3 py-1.5 text-center font-semibold text-esn-dark" data-testid="leaderboard-semester">
            {semester.name}
          </span>
          {isCurrent ? (
            <span className="rounded-md border border-gray-200 px-2.5 py-1.5 text-gray-300" aria-hidden>
              →
            </span>
          ) : (
            <Link href={query({ semester: next.key })} className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-gray-700 hover:text-esn" aria-label={`Next semester: ${next.name}`}>
              →
            </Link>
          )}
        </nav>
      </PageHeader>

      <div className="space-y-6">
        {/* The semester in numbers */}
        <section aria-label={`${semester.name} in numbers`} className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="leaderboard-totals">
          {LEADER_CATEGORIES.map((c) => (
            <div key={c.metric} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg text-base" style={{ background: `${CATEGORY_STYLE[c.metric].color}1f` }} aria-hidden>
                  {CATEGORY_STYLE[c.metric].icon}
                </span>
                <span className="text-2xl font-bold tabular-nums text-gray-900">{sum[c.metric]}</span>
              </div>
              <p className="mt-1 text-xs text-gray-500">{CATEGORY_STYLE[c.metric].total}</p>
            </div>
          ))}
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-base" aria-hidden>
                🙌
              </span>
              <span className="text-2xl font-bold tabular-nums text-gray-900">{sum.people}</span>
            </div>
            <p className="mt-1 text-xs text-gray-500">members took part</p>
          </div>
        </section>

        {/* The viewer's semester */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-esn/30 bg-gradient-to-r from-esn/10 via-esn/5 to-transparent p-4" data-testid="leaderboard-me">
          <span className="text-2xl" aria-hidden>
            {myPlaces.some((p) => p.r.place <= 3) ? "🏆" : mineRow ? "⭐" : "🚀"}
          </span>
          <div className="mr-auto min-w-0">
            <p className="font-semibold text-esn-dark">{mineRow ? `Your ${semester.name}` : isCurrent ? "Not on the board yet" : `You were not on the board in ${semester.name}`}</p>
            <p className="text-sm text-gray-600">
              {mineRow
                ? myPlaces.map((p) => `${ORDINAL(p.r.place)} in ${p.c.title.replace(/^Most /, "").toLowerCase()} (${p.c.unit(p.r.count)})`).join(" · ")
                : isCurrent
                  ? "OC or help at an event, or take an office hour – it counts once it has taken place."
                  : "Earlier semesters stay here for the record."}
            </p>
          </div>
          {!mineRow && isCurrent && (
            <Link href="/calendar" className="text-sm font-medium text-esn hover:underline">
              Find an open slot →
            </Link>
          )}
        </div>

        <nav aria-label="Group" className="flex w-fit rounded-md border border-gray-300 text-sm">
          {(Object.keys(GROUPS) as Group[]).map((g) => (
            <Link key={g} href={query({ group: g })} aria-current={group === g ? "page" : undefined} className={cn("px-3 py-1.5 first:rounded-l-md last:rounded-r-md", group === g ? "bg-esn text-white" : "bg-white text-gray-700 hover:text-esn")}>
              {GROUPS[g]}
            </Link>
          ))}
        </nav>
        {group === "newbies" && <p className="-mt-3 text-xs text-gray-500">Members of the newbies group – their own board, so the first semester counts.</p>}

        <div className="grid gap-6 lg:grid-cols-3" data-testid={`leaderboard-${group}`}>
          {LEADER_CATEGORIES.map((c) => {
            const ranked = board[c.metric];
            const podium = ranked.filter((r) => r.place <= 3).slice(0, 3);
            const rest = ranked.slice(podium.length);
            return (
              <Card key={c.metric} data-testid={`leaderboard-${c.metric}`} className="overflow-hidden">
                <div className="h-1.5" style={{ background: CATEGORY_STYLE[c.metric].color }} aria-hidden />
                <CardHeader>
                  <span className="text-lg" aria-hidden>
                    {CATEGORY_STYLE[c.metric].icon}
                  </span>
                  <CardTitle>{c.title}</CardTitle>
                  <span className="text-xs tabular-nums text-gray-500">{groupRows.filter((r) => r[c.metric] > 0).length} on the board</span>
                </CardHeader>
                <CardContent className="space-y-4">
                  {ranked.length ? <Podium rows={podium} category={c} viewerId={viewer.id} /> : <p className="py-10 text-center text-sm text-gray-400">Nobody yet – be the first!</p>}
                  <RankList rows={rest} category={c} viewerId={viewer.id} max={ranked[0]?.count ?? 1} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
