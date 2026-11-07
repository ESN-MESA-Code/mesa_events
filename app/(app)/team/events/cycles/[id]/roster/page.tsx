import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { cycleLabel, formatDateTime } from "@/lib/dates";
import { CYCLE_STATUS_LABELS } from "@/lib/labels";
import { hasRole } from "@/lib/roles";
import { findConflicts } from "@/lib/allocation";
import { Alert, Badge } from "@/components/ui";
import { AllocationControls } from "../CycleControls";
import { RosterBoard, type BoardEvent, type BoardPerson } from "./RosterBoard";
import { plural } from "@/lib/plural";

export const metadata: Metadata = { title: "Roster" };

export default async function RosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const viewer = await requirePageRole(["events"], { executiveMayRead: true, hide: true });
  const supabase = await createSessionClient();
  const { data: cycle } = await supabase.from("planning_cycles").select("*").eq("id", id).maybeSingle();
  if (!cycle) notFound();

  const [{ data: events }, { data: signups }, { data: blacklist }] = await Promise.all([
    supabase
      .from("events")
      .select("id, title, type, starts_at, ends_at, helpers_needed, ocs_needed, status, non_crucial, assignments(id, profile_id, role, source, status, profiles(full_name, email))")
      .eq("cycle_id", id)
      .neq("status", "draft")
      .order("starts_at"),
    supabase.rpc("cycle_signups", { cycle: id }),
    // The blacklist (2026-11-07): marked on the board, never placed automatically.
    supabase.from("volunteer_blacklist").select("profile_id, reason").is("removed_at", null),
  ]);
  const blacklisted = new Map((blacklist ?? []).map((b) => [b.profile_id, b.reason]));

  // Volunteers: everyone who answered the form, with their wishes per event.
  const people = new Map<string, BoardPerson>();
  for (const s of signups ?? []) {
    const p = people.get(s.profile_id) ?? { id: s.profile_id, name: s.full_name, email: s.email, wishes: {}, maxEvents: s.max_events, blacklisted: blacklisted.get(s.profile_id) ?? null };
    p.wishes[s.event_id] = { oc: s.oc_rank, helper: s.helper_rank };
    people.set(s.profile_id, p);
  }
  const boardEvents: BoardEvent[] = (events ?? []).map((e) => {
    const active = (e.assignments ?? []).filter((a) => a.status === "active");
    for (const a of active) {
      const prof = a.profiles as { full_name: string; email: string } | null;
      if (!people.has(a.profile_id)) people.set(a.profile_id, { id: a.profile_id, name: prof?.full_name ?? "?", email: prof?.email ?? "", wishes: {}, blacklisted: blacklisted.get(a.profile_id) ?? null });
    }
    return {
      id: e.id,
      title: e.title,
      startsAt: e.starts_at,
      when: formatDateTime(e.starts_at),
      helpersNeeded: e.helpers_needed,
      ocsNeeded: e.ocs_needed,
      status: e.status,
      nonCrucial: e.non_crucial,
      assignments: active.map((a) => ({ id: a.id, profileId: a.profile_id, role: a.role as "oc" | "helper", source: a.source })),
    };
  });
  const conflicts = findConflicts(
    (events ?? []).map((e) => ({ id: e.id, startsAt: e.starts_at, endsAt: e.ends_at, helpersNeeded: e.helpers_needed })),
    boardEvents.flatMap((e) => e.assignments.map((a) => ({ eventId: e.id, profileId: a.profileId })))
  );
  const editable = hasRole(viewer.roles, "events") && ["allocated", "confirmed"].includes(cycle.status);

  const canEdit = hasRole(viewer.roles, "events");

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-lg font-semibold text-gray-900">Roster</h2>
        <Badge tone={cycle.status === "confirmed" ? "green" : "blue"}>{CYCLE_STATUS_LABELS[cycle.status]}</Badge>
        {canEdit && <AllocationControls cycleId={id} month={cycleLabel(cycle.month)} status={cycle.status} />}
      </div>
      {["planning", "form_open"].includes(cycle.status) && (
        <Alert tone="info" className="mb-4">
          The allocation runs once the volunteer form is closed.{" "}
          <Link href={`/team/events/cycles/${id}/form`} className="underline">
            Go to the volunteer form
          </Link>
        </Alert>
      )}
      {editable && <p className="mb-4 text-sm text-gray-500">Drag people between events and roles.{cycle.status === "confirmed" ? "" : " Changes save at once."}</p>}
      {blacklisted.size > 0 && people.size > 0 && [...people.keys()].some((p) => blacklisted.has(p)) && (
        <Alert tone="info" className="mb-4" data-testid="blacklist-note">
          People marked <Badge tone="red">Blacklisted</Badge> are left out of the automatic allocation. Add them by hand, only as helpers on events marked non-crucial.{" "}
          <Link href="/team/reliability" className="underline">
            Reliability and blacklist
          </Link>
        </Alert>
      )}
      {conflicts.length > 0 && (
        <Alert tone="warning" className="mb-4">
          {plural(conflicts.length, "time conflict")}:{" "}
          {conflicts
            .map((c) => `${people.get(c.profileId)?.name} on ${c.eventIds.map((e) => boardEvents.find((b) => b.id === e)?.title).join(" and ")}`)
            .join("; ")}
        </Alert>
      )}
      {cycle.status === "confirmed" && editable && (
        <Alert tone="info" className="mb-4">
          The roster is confirmed: changes here update the Chat spaces and are announced to the OC – each waits 10 seconds for Undo first.
        </Alert>
      )}
      {cycle.status !== "planning" && cycle.status !== "form_open" && cycle.status !== "form_closed" && <RosterBoard events={boardEvents} people={[...people.values()].sort((a, b) => a.name.localeCompare(b.name))} editable={editable} confirmed={cycle.status === "confirmed"} canMarkCrucial={canEdit} />}
    </>
  );
}
