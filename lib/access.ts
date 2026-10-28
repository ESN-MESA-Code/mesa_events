import { notFound } from "next/navigation";
import { getViewer, type Viewer } from "@/lib/supabase/session";
import { hasRole, type AppRole } from "@/lib/roles";

/**
 * The signed-in member if they have one of `roles` (executives may be
 * allowed to look too); otherwise the page does not exist for them (404,
 * not a hint that it exists). Server components only.
 */
export async function requirePageRole(roles: AppRole[], opts: { executiveMayRead?: boolean } = {}): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) notFound();
  const ok = roles.some((r) => hasRole(viewer.roles, r)) || (opts.executiveMayRead && viewer.roles.includes("executive"));
  if (!ok) notFound();
  return viewer;
}
