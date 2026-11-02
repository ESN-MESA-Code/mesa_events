// Categories and formats as the pages load them (round 2026-11-01); members
// read both (RLS). Hidden ones are included: events keep theirs, the forms
// offer only the active ones (sortedCategories, activeFormats).
import type { Db } from "@/lib/supabase/session";
import type { Category, Format } from "@/lib/formats";

export async function loadSorting(supabase: Db): Promise<{ categories: Category[]; formats: Format[] }> {
  const [{ data: categories }, { data: formats }] = await Promise.all([
    supabase.from("event_categories").select("id, name, emoji, esn_type, keywords, active, sort").order("sort"),
    supabase.from("event_formats").select("id, name, category_id, type, helpers_needed, location, meeting_point, active").order("name"),
  ]);
  return { categories: categories ?? [], formats: formats ?? [] };
}
