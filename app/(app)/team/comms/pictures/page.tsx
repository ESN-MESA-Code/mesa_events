import type { Metadata } from "next";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { hasRole } from "@/lib/roles";
import { parseMonthParam, monthParam } from "@/lib/month";
import { EVENT_TYPES, EVENT_TYPE_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/ui";
import { CommsTabs } from "@/components/CommsTabs";
import { DefaultPictures, type PictureSlot } from "./PicturesClient";

export const metadata: Metadata = { title: "Advertising pictures" };

// Default pictures for the advertising (round 2026-11-03, -09): one per
// format (an event series such as the Language Café), per category (hike,
// pub, city tour …) and per event type. A Telegram message of an event
// without its own picture takes its format's, else its category's, else its
// type's – so recurring events need no new upload every time.
// Comms chooses them; Events and executives look on.
export default async function PicturesPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const viewer = await requirePageRole(["comms", "events"], { executiveMayRead: true, page: "Advertisement schedule" });
  const editable = hasRole(viewer.roles, "comms");
  const sp = await searchParams;
  const month = parseMonthParam(sp.month);
  const supabase = await createSessionClient();
  const [{ data: formats }, { data: categories }, { data: pictures }] = await Promise.all([
    supabase.from("event_formats").select("id, name, type, active").order("name"),
    supabase.from("event_categories").select("id, name, emoji, active").order("sort"),
    supabase.from("advertising_pictures").select("format_id, category_id, event_type, picture, updated_at"),
  ]);
  const byFormat = new Map((pictures ?? []).filter((p) => p.format_id).map((p) => [p.format_id!, p.picture]));
  const byCategory = new Map((pictures ?? []).filter((p) => p.category_id).map((p) => [p.category_id!, p.picture]));
  const byType = new Map((pictures ?? []).filter((p) => p.event_type).map((p) => [p.event_type as string, p.picture]));
  const types: PictureSlot[] = EVENT_TYPES.map((t) => ({ key: `type:${t}`, eventType: t, name: EVENT_TYPE_LABELS[t], note: "Without a format or category picture", picture: byType.get(t) ?? null }));
  const categorySlots: PictureSlot[] = (categories ?? [])
    .filter((c) => c.active || byCategory.has(c.id))
    .map((c) => ({ key: `category:${c.id}`, categoryId: c.id, name: `${c.emoji ? `${c.emoji} ` : ""}${c.name}`, note: c.active ? "Without a format picture" : "No longer in use", picture: byCategory.get(c.id) ?? null }));
  const formatSlots: PictureSlot[] = (formats ?? [])
    .filter((f) => f.active || byFormat.has(f.id))
    .map((f) => ({ key: `format:${f.id}`, formatId: f.id, name: f.name, note: `${EVENT_TYPE_LABELS[f.type]}${f.active ? "" : " · no longer in use"}`, picture: byFormat.get(f.id) ?? null }));

  return (
    <>
      <PageHeader
        title="Comms"
        description="Default pictures for the Telegram posts – a post's own picture wins, else the format's, else the category's, else the type's."
      />
      <CommsTabs current="pictures" month={month ? monthParam(month) : null} executive={viewer.roles.includes("executive")} />
      <DefaultPictures types={types} categories={categorySlots} formats={formatSlots} editable={editable} />
    </>
  );
}
