// Loading an event for its pages, with what the viewer may do there.
import { cache } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { hasRole, isTeam } from "@/lib/roles";

/**
 * The event if the signed-in member may see it (RLS decides), else 404 –
 * the same answer for "does not exist" and "not yours" (no IDOR hints).
 */
export const loadEventForPage = cache(async (id: string) => {
  if (!z.uuid().safeParse(id).success) notFound();
  const viewer = await getViewer();
  if (!viewer) notFound();
  const supabase = await createSessionClient();
  const { data: event } = await supabase.from("events").select("*, planning_cycles(id, month, status, description_deadline)").eq("id", id).maybeSingle();
  if (!event) notFound();
  const { data: mine } = await supabase.from("assignments").select("id, role").eq("event_id", id).eq("profile_id", viewer.id).eq("status", "active").maybeSingle();
  const isEvents = hasRole(viewer.roles, "events");
  return {
    viewer,
    supabase,
    event,
    cycle: event.planning_cycles as { id: string; month: string; status: string; description_deadline: string | null } | null,
    myAssignment: mine,
    isOc: mine?.role === "oc",
    isStaff: !!mine,
    isEvents,
    isTeam: isTeam(viewer.roles),
    canManage: isEvents || mine?.role === "oc",
  };
});
