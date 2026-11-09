import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, FileText } from "lucide-react";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { berlinDate, berlinTime, cycleLabel, formatShortDate, monthOf, monthStartIso, addMonths, nowMs } from "@/lib/dates";
import { hasRole } from "@/lib/roles";
import { monthParam, parseMonthParam } from "@/lib/month";
import { FORMAT_LABEL, namesOf, type PostFormat, type Progress } from "@/lib/publishing";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { MonthSelector } from "@/components/MonthSelector";
import { CommsTabs } from "@/components/CommsTabs";
import { cn } from "@/lib/utils";
import { ProgressPick } from "./ProgressPick";

export const metadata: Metadata = { title: "Content list" };

type Show = "open" | "mine" | "all";

// The content list (round 2026-11-09): every post of the month as a task –
// the list Comms kept in their planning sheet (what, post / story / reel,
// when, who, status, caption and Canva link). The schedule is where posts
// are planned and moved; here the team sees what is still to make, by whom,
// and moves it along. Comms edits, Events and executives look on.
export default async function ContentPage({ searchParams }: { searchParams: Promise<{ month?: string; show?: string }> }) {
  const viewer = await requirePageRole(["comms", "events"], { executiveMayRead: true, page: "Content list" });
  const editable = hasRole(viewer.roles, "comms");
  const sp = await searchParams;
  const now = nowMs();
  const thisMonth = monthOf(new Date(now).toISOString());
  const month = parseMonthParam(sp.month) ?? thisMonth;
  const show: Show = sp.show === "mine" || sp.show === "all" ? sp.show : "open";
  const supabase = await createSessionClient();
  const [{ data: rows }, { data: channels }, { data: team }] = await Promise.all([
    supabase
      .from("publication_posts")
      .select("id, channel, scheduled_for, status, link, title, format, assignees, progress, caption, design_link, publication_post_events(position, events(title))")
      .gte("scheduled_for", monthStartIso(month))
      .lt("scheduled_for", monthStartIso(addMonths(month, 1)))
      .neq("channel", "pretix")
      .order("scheduled_for"),
    supabase.from("publication_channels").select("key, name"),
    supabase.rpc("comms_team"),
  ]);
  const channelName = new Map((channels ?? []).map((c) => [c.key, c.name]));
  const posts = (rows ?? []).map((p) => ({
    ...p,
    events: [...p.publication_post_events].sort((a, b) => a.position - b.position).map((x) => (x.events as { title: string } | null)?.title ?? "Event"),
  }));
  const open = (p: (typeof posts)[number]) => p.status === "planned";
  const shown = posts.filter((p) => (show === "all" ? true : show === "mine" ? p.assignees.includes(viewer.email) && open(p) : open(p)));
  const counts = { open: posts.filter(open).length, mine: posts.filter((p) => open(p) && p.assignees.includes(viewer.email)).length, all: posts.length };
  const nobody = posts.filter((p) => open(p) && !p.assignees.length).length;
  const showHref = (show: Show) => `/team/comms/content?month=${monthParam(month)}${show === "open" ? "" : `&show=${show}`}`;
  const today = berlinDate(new Date(now).toISOString());
  const months = Array.from({ length: 6 }, (_, i) => addMonths(thisMonth, i - 2));

  return (
    <>
      <PageHeader title="Comms" description="Every post of the month as a task – who makes it, how far it is, its caption and design. Plan and move posts on the schedule.">
        <MonthSelector
          options={months.map((m) => ({ value: monthParam(m), label: cycleLabel(m).replace(/ events$/, "") }))}
          current={monthParam(month)}
          path="/team/comms/content"
          storageKey="mesa:month:content"
          explicit={!!parseMonthParam(sp.month)}
        />
      </PageHeader>
      <CommsTabs current="content" month={monthParam(month)} executive={viewer.roles.includes("executive")} />

      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm" data-testid="content-list">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-4 sm:px-5">
          {(["open", "mine", "all"] as Show[]).map((tab) => (
            <Link
              key={tab}
              href={showHref(tab)}
              aria-current={show === tab ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                show === tab ? "border-esn bg-esn text-white" : "border-gray-200 bg-white text-gray-700 hover:border-esn hover:text-esn"
              )}
              data-testid={`content-show-${tab}`}
            >
              {tab === "open" ? "Still to post" : tab === "mine" ? "Mine" : "All"}
              <span className={cn("rounded-full px-1.5 text-xs font-semibold tabular-nums", show === tab ? "bg-white/20" : "bg-gray-100 text-gray-600")}>{counts[tab]}</span>
            </Link>
          ))}
          {nobody > 0 && (
            <span className="ml-auto text-xs font-medium text-amber-800" data-testid="content-unassigned">
              {nobody} without anyone yet
            </span>
          )}
        </div>
        {!shown.length ? (
          <div className="p-5">
            <EmptyState>
              {show === "mine" ? "Nothing on your list this month." : show === "open" ? "Everything this month is posted or skipped." : "No posts this month yet – plan them on the schedule."}
            </EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="text-left text-xs font-semibold text-gray-500">
                <tr className="border-b border-gray-100">
                  <th className="px-4 py-2 font-semibold sm:pl-5">When</th>
                  <th className="px-2 py-2 font-semibold">What</th>
                  <th className="px-2 py-2 font-semibold">Where</th>
                  <th className="px-2 py-2 font-semibold">Who</th>
                  <th className="px-2 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold sm:pr-5">Caption · design</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {shown.map((p) => {
                  const day = berlinDate(p.scheduled_for);
                  const overdue = p.status === "planned" && day < today;
                  const what = [p.title, p.events.length ? p.events.join(", ") : null].filter(Boolean).join(" · ");
                  return (
                    <tr key={p.id} className={cn("align-top", p.assignees.includes(viewer.email) && "bg-esn/[0.03]")} data-testid={`content-row-${p.id}`}>
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums sm:pl-5">
                        <span className={cn("block font-medium", overdue ? "text-red-700" : "text-gray-900")}>{formatShortDate(p.scheduled_for)}</span>
                        <span className="block text-xs text-gray-500">
                          {berlinTime(p.scheduled_for)}
                          {overdue && " · overdue"}
                        </span>
                      </td>
                      <td className="max-w-[18rem] px-2 py-2.5">
                        <Link href={`/team/comms/schedule?month=${monthParam(month)}&post=${p.id}`} className="line-clamp-2 break-words font-semibold text-gray-900 hover:text-esn" title={what}>
                          {what || "Post"}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-gray-700">
                        {channelName.get(p.channel) ?? p.channel}
                        {p.format && <span className="block text-xs text-gray-500">{FORMAT_LABEL[p.format as PostFormat]}</span>}
                      </td>
                      <td className="px-2 py-2.5 text-gray-700">{p.assignees.length ? namesOf(p.assignees, team ?? []) : <span className="text-amber-800">Nobody yet</span>}</td>
                      <td className="px-2 py-2.5">
                        <ProgressPick
                          post={{ id: p.id, status: p.status as "planned" | "published" | "skipped", progress: p.progress as Progress, title: p.title, format: p.format, assignees: p.assignees, caption: p.caption, designLink: p.design_link }}
                          editable={editable}
                        />
                      </td>
                      <td className="px-4 py-2.5 sm:pr-5">
                        <span className="flex items-center gap-2 text-xs">
                          <span className={cn("inline-flex items-center gap-1", p.caption ? "text-emerald-700" : "text-gray-400")} title={p.caption || "No caption yet"}>
                            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                            {p.caption ? "Caption" : "No caption"}
                          </span>
                          {p.design_link && (
                            <a href={p.design_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-esn hover:underline">
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Design
                            </a>
                          )}
                          {p.status === "published" && p.link && (
                            <a href={p.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-esn hover:underline">
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Live
                            </a>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <Card className="mt-4 p-4 text-xs text-gray-600">
        Posts without an event (the month&apos;s calendar, &ldquo;This week&rdquo;, awareness, recaps) and the regular ones are planned on the{" "}
        <Link href={`/team/comms/schedule?month=${monthParam(month)}`} className="font-semibold text-esn hover:underline">
          advertisement schedule
        </Link>
        ; click a post there or here for its caption, design link and who makes it.
      </Card>
    </>
  );
}
