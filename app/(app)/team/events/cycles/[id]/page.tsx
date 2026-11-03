import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { cyclesWithProgress } from "@/lib/cycleFacts";
import { stepHref } from "@/lib/cycle";

// A month opens on the tab of its current step – the hand-in once it is
// done (round 2026-11-03: no overview tab; the tabs show the steps).
export default async function CyclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  await requirePageRole(["events"], { executiveMayRead: true, hide: true });
  const supabase = await createSessionClient();
  const { data: row } = await supabase.from("planning_cycles").select("id, month, status, form_closes_at, description_deadline").eq("id", id).maybeSingle();
  if (!row) notFound();
  const [cycle] = await cyclesWithProgress(supabase, [row]);
  redirect(stepHref(id, cycle.progress.current ?? "done"));
}
