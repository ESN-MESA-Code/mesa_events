import type { Metadata } from "next";
import Link from "next/link";
import { Ticket } from "lucide-react";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { addMonths, berlinDate, berlinTime, formatShortDate, monthOf, monthStartIso, nowMs } from "@/lib/dates";
import { hasRole } from "@/lib/roles";
import { dayDiff } from "@/lib/month";
import { plural } from "@/lib/plural";
import { AHEAD_MONTHS, PUBLISHABLE_STATUSES, advertisable, isBigEvent, namesOf } from "@/lib/publishing";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { DateTile } from "@/components/DateTile";
import { CommsTabs } from "@/components/CommsTabs";
import { DESCRIPTION_STATUS } from "@/components/status";
import { cn } from "@/lib/utils";
import { PretixSetup } from "./PretixSetup";

export const metadata: Metadata = { title: "pretix pages" };

type Show = "todo" | "done" | "all";

// pretix pages (round 2026-11-09): setting up an event's pretix page is a
// chore of Comms for every event, not advertising – so it has its own page
// instead of a tick on the advertisement schedule. The upcoming events the
// schedule lists (this month and the months ahead, drafts from six weeks
// on), each due before its first post (the posts link to it). The tick is
// stored as before (a published "pretix" post with the link), so the
// Telegram messages, the stages and Home keep reading it.
export default async function PretixPage({ searchParams }: { searchParams: Promise<{ show?: string; event?: string }> }) {
  const viewer = await requirePageRole(["comms", "events"], { executiveMayRead: true, page: "pretix pages" });
  const editable = hasRole(viewer.roles, "comms");
  const sp = await searchParams;
  const show: Show = sp.show === "done" || sp.show === "all" ? sp.show : "todo";
  const now = nowMs();
  const today = berlinDate(new Date(now).toISOString());
  const thisMonth = monthOf(new Date(now).toISOString());
  const supabase = await createSessionClient();

  const [{ data: channel }, { data: rows }, { data: team }] = await Promise.all([
    supabase.from("publication_channels").select("enabled").eq("key", "pretix").maybeSingle(),
    supabase
      .from("events")
      .select("id, title, starts_at, type, big, status, descriptions(status)")
      .in("status", ["draft", ...PUBLISHABLE_STATUSES])
      .eq("source", "platform")
      .gte("starts_at", new Date(now).toISOString())
      .lt("starts_at", monthStartIso(addMonths(thisMonth, AHEAD_MONTHS + 1)))
      .order("starts_at"),
    supabase.rpc("comms_team"),
  ]);
  // The event a link named (?event=…, from the stages or the board) is shown however far ahead it is.
  const asked = /^[0-9a-f-]{36}$/.test(sp.event ?? "") && !(rows ?? []).some((e) => e.id === sp.event)
    ? (await supabase.from("events").select("id, title, starts_at, type, big, status, descriptions(status)").eq("id", sp.event!).in("status", ["draft", ...PUBLISHABLE_STATUSES]).maybeSingle()).data
    : null;
  const events = [...(rows ?? []).filter((e) => advertisable({ status: e.status, startsAt: e.starts_at }, now)), ...(asked ? [asked] : [])];
  const ids = events.map((e) => e.id);
  const { data: links } = ids.length
    ? await supabase.from("publication_post_events").select("event_id, publication_posts!inner(channel, status, scheduled_for, link, published_at, published_by)").in("event_id", ids)
    : { data: [] };
  const done = new Map<string, { link: string | null; at: string | null; by: string | null }>();
  const firstPost = new Map<string, string>();
  for (const r of links ?? []) {
    const p = r.publication_posts;
    if (p.channel === "pretix") {
      if (p.status === "published" && !done.has(r.event_id)) done.set(r.event_id, { link: p.link, at: p.published_at, by: p.published_by });
    } else if (p.status !== "skipped") {
      const cur = firstPost.get(r.event_id);
      if (!cur || p.scheduled_for < cur) firstPost.set(r.event_id, p.scheduled_for);
    }
  }
  const dueOf = (id: string) => firstPost.get(id) ?? null;
  const todo = events
    .filter((e) => !done.has(e.id))
    .sort((a, b) => (dueOf(a.id) ?? "9999").localeCompare(dueOf(b.id) ?? "9999") || a.starts_at.localeCompare(b.starts_at));
  const finished = events.filter((e) => done.has(e.id));
  const listed = show === "todo" ? todo : show === "done" ? finished : events;
  // The event a link named stays in view whatever the filter (round 2026-11-10): it used to vanish from
  // "To set up" the moment it was ticked – no "Set up by", no Undo – and a link to one already set up showed nothing.
  const named = events.find((e) => e.id === sp.event);
  const shown = named && !listed.includes(named) ? [named, ...listed] : listed;
  const counts = { todo: todo.length, done: finished.length, all: events.length };
  const overdue = todo.filter((e) => dueOf(e.id) && berlinDate(dueOf(e.id)!) <= today).length;
  const showHref = (filter: Show) => `/team/comms/pretix${filter === "todo" ? "" : `?show=${filter}`}`;

  return (
    <>
      <PageHeader title="Comms" description="Set up each event's pretix page before it is advertised – the posts link to it. Due before the event's first post." />
      <CommsTabs current="pretix" month={null} executive={viewer.roles.includes("executive")} />
      {!channel?.enabled ? (
        <Card>
          <EmptyState>pretix is switched off (Admin → Publishing channels).</EmptyState>
        </Card>
      ) : (
        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm" data-testid="pretix-list">
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-4 sm:px-5">
            {(["todo", "done", "all"] as Show[]).map((filter) => (
              <Link
                key={filter}
                href={showHref(filter)}
                aria-current={show === filter ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                  show === filter ? "border-esn bg-esn text-white" : "border-gray-200 bg-white text-gray-700 hover:border-esn hover:text-esn"
                )}
                data-testid={`pretix-show-${filter}`}
              >
                {filter === "todo" ? "To set up" : filter === "done" ? "Done" : "All"}
                <span className={cn("rounded-full px-1.5 text-xs font-semibold tabular-nums", show === filter ? "bg-white/20" : "bg-gray-100 text-gray-600")}>{counts[filter]}</span>
              </Link>
            ))}
            {overdue > 0 && (
              <span className="ml-auto text-xs font-semibold text-red-700" data-testid="pretix-overdue">
                {plural(overdue, "event")} advertised without a pretix page
              </span>
            )}
          </div>
          {!shown.length ? (
            <div className="p-5">
              <EmptyState>{show === "todo" ? "Every upcoming event has its pretix page. 🎉" : "Nothing here yet."}</EmptyState>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {shown.map((e) => {
                const state = done.get(e.id) ?? null;
                const due = dueOf(e.id);
                const dueIn = due ? dayDiff(today, berlinDate(due)) : null;
                const inDays = dayDiff(today, berlinDate(e.starts_at));
                const desc = DESCRIPTION_STATUS[e.descriptions?.status ?? "missing"];
                return (
                  <li
                    key={e.id}
                    id={`pretix-${e.id}`}
                    className={cn("flex scroll-mt-24 flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5", sp.event === e.id && "bg-amber-50 ring-2 ring-inset ring-amber-300")}
                    data-testid={`pretix-row-${e.id}`}
                  >
                    <div className="flex min-w-0 flex-1 gap-3">
                      <DateTile iso={e.starts_at} />
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link href={`/events/${e.id}/description?from=comms`} className="break-words font-semibold text-gray-900 hover:text-esn">
                            {e.title}
                          </Link>
                          {isBigEvent({ big: e.big, type: e.type }) && <Badge tone="amber">big</Badge>}
                          {e.status === "draft" && <Badge tone="gray">draft</Badge>}
                        </div>
                        <p className="text-xs text-gray-500">
                          {berlinTime(e.starts_at)} · {inDays === 0 ? "today" : inDays === 1 ? "tomorrow" : `in ${plural(inDays, "day")}`} ·{" "}
                          <span className={cn(desc?.tone === "green" || desc?.tone === "purple" ? "text-emerald-700" : "text-gray-500")}>description: {desc?.label.toLowerCase() ?? "–"}</span>
                        </p>
                        {state ? (
                          <p className="text-xs text-emerald-700" data-testid="pretix-done-by">
                            ✓ Set up{state.by ? ` by ${namesOf([state.by], team ?? [])}` : ""}
                            {state.at ? `, ${formatShortDate(state.at)}` : ""}
                            {!state.link && <span className="text-amber-700"> · no link yet – the Telegram posts go out without “Sign up”</span>}
                          </p>
                        ) : (
                          <p className={cn("text-xs", dueIn === null ? "text-gray-500" : dueIn <= 0 ? "font-semibold text-red-700" : dueIn <= 3 ? "font-semibold text-amber-700" : "text-gray-600")} data-testid="pretix-due">
                            <Ticket className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
                            {due
                              ? dueIn! < 0
                                ? `Overdue – the first post was ${formatShortDate(due)}`
                                : dueIn === 0
                                  ? "Due today – the first post goes out today"
                                  : `Due before the first post, ${formatShortDate(due)}`
                              : "No post planned yet – set it up before the first one"}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="sm:shrink-0">
                      <PretixSetup event={{ id: e.id, title: e.title }} state={state ? { link: state.link } : null} editable={editable} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
