// Loading internal events for their pages. Server only.
import { cache } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createSessionClient, getViewer, type Db } from "@/lib/supabase/session";
import { isInternalPlanner } from "@/lib/roles";
import type { InternalKind } from "@/lib/internal";

export interface InternalPerson {
  id: string;
  profileId: string;
  name: string;
  role: "oc" | "helper" | "attendee";
}

/** People of internal events by event id, with names. */
export async function peopleOf(supabase: Db, ids: string[]): Promise<Map<string, InternalPerson[]>> {
  const out = new Map<string, InternalPerson[]>();
  if (!ids.length) return out;
  const { data } = await supabase.from("internal_event_people").select("id, internal_event_id, profile_id, role, profiles(full_name, email)").in("internal_event_id", ids).order("created_at");
  for (const p of data ?? []) {
    const prof = p.profiles as { full_name: string; email: string } | null;
    const list = out.get(p.internal_event_id) ?? [];
    list.push({ id: p.id, profileId: p.profile_id, name: prof?.full_name || prof?.email || "?", role: p.role as InternalPerson["role"] });
    out.set(p.internal_event_id, list);
  }
  return out;
}

/**
 * The internal event if the signed-in member may see it (RLS: board
 * meetings only for the executive board), else 404 – no hint that it exists.
 */
export const loadInternalForPage = cache(async (id: string) => {
  if (!z.uuid().safeParse(id).success) notFound();
  const viewer = await getViewer();
  if (!viewer) notFound();
  const supabase = await createSessionClient();
  const { data: event } = await supabase.from("internal_events").select("*").eq("id", id).maybeSingle();
  if (!event) notFound();
  const [{ data: settings }, people] = await Promise.all([
    supabase.from("internal_kind_settings").select("description").eq("kind", event.kind).single(),
    peopleOf(supabase, [id]),
  ]);
  const list = people.get(id) ?? [];
  const mine = list.find((p) => p.profileId === viewer.id) ?? null;
  return {
    viewer,
    supabase,
    event: event as typeof event & { kind: InternalKind },
    description: settings?.description ?? "",
    people: list,
    mine,
    isOc: mine?.role === "oc",
    isStaff: mine?.role === "oc" || mine?.role === "helper",
    isPlanner: isInternalPlanner(viewer.roles),
  };
});
