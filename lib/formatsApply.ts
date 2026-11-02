// Sorting events by the suggestions, without anyone clicking (round
// 2026-11-01): what "Save all" on /team/events/formats does with the rows as
// suggested – every event without a format gets the suggested category
// (one already set is kept), every name that ran more than once a format
// (an existing one of the same name is reused) – and ideas follow: accepted
// ones their event, open ones the suggestion from their title. Used by the
// demo seed and `npm run sort:events`; writes with the service role.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { suggestCategory, unsortedGroups } from "@/lib/formats";

type Db = SupabaseClient<Database>;

export interface SortingResult {
  /** Events that got a category (they had none). */
  categorized: number;
  /** Events linked to a format. */
  linked: number;
  formatsCreated: string[];
  ideas: number;
  /** Events left without a category (no keyword matched). */
  unmatched: string[];
}

function check<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as NonNullable<T>;
}

/** `createdBy`: only events of that tag (the demo); `proposers`: only their ideas; `dryRun`: count, write nothing. */
export async function applySuggestedSorting(db: Db, opts: { createdBy?: string; proposers?: string[]; dryRun?: boolean } = {}): Promise<SortingResult> {
  const categories = check(await db.from("event_categories").select("id, name, emoji, esn_type, keywords, active, sort"), "categories");
  const formats = check(await db.from("event_formats").select("id, name, category_id, type, helpers_needed, location, active"), "formats");
  let q = db
    .from("events")
    .select("id, title, starts_at, type, location, helpers_needed, category_id, format_id, descriptions(hook:approved_fields->>hook, intro:approved_fields->>intro)")
    .not("status", "in", "(dropped,cancelled)")
    .limit(10000);
  if (opts.createdBy) q = q.eq("created_by", opts.createdBy);
  const rows = check(await q, "events").map((e) => {
    const d = e.descriptions as { hook: string | null; intro: string | null } | null;
    return { ...e, hook: d?.hook ?? "", intro: d?.intro ?? "" };
  });

  const result: SortingResult = { categorized: 0, linked: 0, formatsCreated: [], ideas: 0, unmatched: [] };
  for (const g of unsortedGroups(rows, formats, categories)) {
    let formatId = g.formatId;
    if (!formatId && g.events.length > 1) {
      result.formatsCreated.push(g.name);
      if (!opts.dryRun) {
        const first = g.events[0];
        formatId = check(
          await db
            .from("event_formats")
            .insert({ name: g.name, category_id: g.categoryId, type: first.type, helpers_needed: first.helpers_needed > 0 ? first.helpers_needed : 2, location: first.location, created_by: opts.createdBy ?? null })
            .select("id")
            .single(),
          `format ${g.name}`
        ).id;
      }
    }
    const uncategorized = g.events.filter((e) => !e.category_id).map((e) => e.id);
    if (!g.categoryId) result.unmatched.push(...g.events.filter((e) => !e.category_id).map((e) => e.title));
    else result.categorized += uncategorized.length;
    if (g.formatId || g.events.length > 1) result.linked += g.events.length;
    if (opts.dryRun) continue;
    if (g.categoryId && uncategorized.length) check(await db.from("events").update({ category_id: g.categoryId }).in("id", uncategorized), `category of ${g.name}`);
    if (formatId) check(await db.from("events").update({ format_id: formatId }).in("id", g.events.map((e) => e.id)), `format of ${g.name}`);
  }

  // Ideas without a category: accepted and merged ones like their event, open ones by their title.
  let iq = db.from("event_ideas").select("id, title, event_id").is("category_id", null).limit(10000);
  if (opts.proposers) iq = iq.in("proposer_id", opts.proposers);
  const ideas = check(await iq, "ideas");
  const linkedIds = ideas.map((i) => i.event_id).filter((id): id is string => !!id);
  const events = new Map<string, { category_id: string | null; format_id: string | null }>();
  for (let i = 0; i < linkedIds.length; i += 200) {
    for (const e of check(await db.from("events").select("id, category_id, format_id").in("id", linkedIds.slice(i, i + 200)), "idea events")) events.set(e.id, e);
  }
  for (const i of ideas) {
    const ev = i.event_id ? events.get(i.event_id) : undefined;
    const patch = ev?.category_id ? { category_id: ev.category_id, format_id: ev.format_id } : { category_id: suggestCategory({ title: i.title }, categories)?.id ?? null };
    if (!patch.category_id) continue;
    result.ideas++;
    if (!opts.dryRun) check(await db.from("event_ideas").update(patch).eq("id", i.id), "idea");
  }
  return result;
}
