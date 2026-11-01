import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { hasRole } from "@/lib/roles";
import { loadSorting } from "@/lib/sortingLoad";
import { formatStats, unsortedGroups, type SortableEvent } from "@/lib/formats";
import { plural } from "@/lib/plural";
import { nowMs } from "@/lib/dates";
import { PageHeader } from "@/components/ui";
import { CategoriesCard, FormatsCard, SortCard } from "./FormatsClient";

export const metadata: Metadata = { title: "Categories and formats" };

// Categories and formats (round 2026-11-01): the Events team sorts events
// into categories and formats (recurring events) – past ones from the bot
// archive in bulk, with suggestions from the keywords and the names – and
// keeps both lists. Executives read.
export default async function FormatsPage() {
  const viewer = await requirePageRole(["events"], { executiveMayRead: true, page: "Events team" });
  const canEdit = hasRole(viewer.roles, "events");
  const supabase = await createSessionClient();
  const [{ categories, formats }, { data: rows }, { data: past }] = await Promise.all([
    loadSorting(supabase),
    supabase
      .from("events")
      .select("id, title, starts_at, type, location, category_id, format_id, helpers_needed, descriptions(hook:approved_fields->>hook, intro:approved_fields->>intro)")
      .not("status", "in", "(dropped,cancelled)")
      .order("starts_at", { ascending: false })
      .limit(5000),
    // Headcounts of the events that happened (list, else the report).
    supabase.rpc("inspiration_events"),
  ]);

  const headcount = new Map((past ?? []).map((p) => [p.event_id, p.headcount]));
  const events = (rows ?? []).map((e) => {
    const d = e.descriptions as { hook: string | null; intro: string | null } | null;
    return { ...e, hook: d?.hook ?? "", intro: d?.intro ?? "", headcount: headcount.get(e.id) ?? null };
  });
  const groups = unsortedGroups<SortableEvent & { helpers_needed: number }>(events, formats, categories);
  const runsOf = new Map<string, typeof events>();
  for (const e of events) if (e.format_id) runsOf.set(e.format_id, [...(runsOf.get(e.format_id) ?? []), e]);
  const perCategory = new Map<string, number>();
  for (const e of events) if (e.category_id) perCategory.set(e.category_id, (perCategory.get(e.category_id) ?? 0) + 1);
  const withoutCategory = events.filter((e) => !e.category_id).length;
  const now = nowMs();

  return (
    <>
      <PageHeader
        title="Categories and formats"
        description={
          <>
            What kind of event each one is, and which recurring event it is another run of – for Get inspired, the idea inbox and the description templates.{" "}
            <Link href="/team/events" className="text-esn hover:underline">
              Back to the Events team
            </Link>
          </>
        }
      />
      <div className="space-y-6">
        <p className="text-sm text-gray-600" data-testid="sorting-summary">
          {plural(events.length, "event")} · {withoutCategory} without a category · {events.filter((e) => !e.format_id).length} without a format · {plural(formats.filter((f) => f.active).length, "format")}
        </p>
        <SortCard
          canEdit={canEdit}
          categories={categories}
          formats={formats}
          groups={groups.map((g) => ({
            key: g.key,
            name: g.name,
            categoryId: g.categoryId,
            formatId: g.formatId,
            uncategorized: g.events.filter((e) => !e.category_id).length,
            type: g.events[0].type,
            helpers: g.events[0].helpers_needed,
            location: g.events.find((e) => e.location)?.location ?? null,
            events: g.events.map((e) => ({ id: e.id, title: e.title, startsAt: e.starts_at })),
          }))}
        />
        <FormatsCard
          canEdit={canEdit}
          categories={categories}
          formats={formats.map((f) => {
            const runs = runsOf.get(f.id) ?? [];
            const done = runs.filter((r) => Date.parse(r.starts_at) <= now);
            return { ...f, stats: formatStats(done), runs: runs.map((r) => ({ id: r.id, title: r.title, startsAt: r.starts_at, headcount: r.headcount })) };
          })}
        />
        <CategoriesCard canEdit={canEdit} categories={categories.map((c) => ({ ...c, events: perCategory.get(c.id) ?? 0 }))} />
      </div>
    </>
  );
}
