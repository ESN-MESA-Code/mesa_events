import { notFound, redirect } from "next/navigation";
import { getViewer, type Viewer } from "@/lib/supabase/session";
import { hasRole, type AppRole } from "@/lib/roles";

/**
 * The signed-in member if they have one of `roles` (executives may be
 * allowed to look too). Otherwise a team page sends them to "No access"
 * (`page` names it there); pages of one record (`hide`: a cycle, a batch)
 * answer 404 instead – the same as "does not exist", no hint that the id is
 * real. Server components only.
 */
export async function requirePageRole(
  roles: AppRole[],
  opts: { executiveMayRead?: boolean; page?: string; hide?: boolean } = {}
): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) notFound();
  const ok = roles.some((r) => hasRole(viewer.roles, r)) || (opts.executiveMayRead && viewer.roles.includes("executive"));
  if (!ok) {
    if (opts.hide || !opts.page) notFound();
    redirect(`/no-access?page=${encodeURIComponent(opts.page)}`);
  }
  return viewer;
}
