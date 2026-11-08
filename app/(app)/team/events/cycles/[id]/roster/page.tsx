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
import { Users as UsersIcon } from "lucide-react";
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

  const staffed = boardEvents.filter((e) => e.assignments.filter((a) => a.role === "oc").length >= e.ocsNeeded && e.assignments.filter((a) => a.role === "helper").length >= e.helpersNeeded).length;
  const showBoard = !["planning", "form_open", "form_closed"].includes(cycle.status);

  return (
    <>
      <section aria-label="Roster" className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
          <div className="mr-auto flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-esn/5 text-esn" aria-hidden="true">
              <UsersIcon className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <h2 className="flex flex-wrap items-center gap-2 text-base font-bold text-gray-900">
                Roster
                <Badge tone={cycle.status === "confirmed" ? "green" : "blue"}>{CYCLE_STATUS_LABELS[cycle.status]}</Badge>
              </h2>
              <p className="text-sm text-gray-500">
                {showBoard ? `${staffed} of ${boardEvents.length} events fully staffed · ${plural(people.size, "volunteer")}` : "The allocation runs once the volunteer form is closed."}
                {editable && ` · drag people between events and roles${cycle.status === "confirmed" ? "" : ", changes save at once"}`}
              </p>
            </div>
          </div>
          {canEdit && <AllocationControls cycleId={id} month={cycleLabel(cycle.month)} status={cycle.status} />}
        </div>
        {showBoard && boardEvents.length > 0 && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
            <div className={staffed === boardEvents.length ? "h-full rounded-full bg-emerald-500" : "h-full rounded-full bg-esn"} style={{ width: `${Math.round((staffed / boardEvents.length) * 100)}%` }} />
          </div>
        )}
      </section>
      <div className="mb-4 space-y-2 empty:hidden">
        {["planning", "form_open"].includes(cycle.status) && (
          <Alert tone="info" className="rounded-xl px-4 py-3">
            The allocation runs once the volunteer form is closed.{" "}
            <Link href={`/team/events/cycles/${id}/form`} className="font-semibold underline">
              Go to the volunteer form
            </Link>
          </Alert>
        )}
        {blacklisted.size > 0 && people.size > 0 && [...people.keys()].some((p) => blacklisted.has(p)) && (
          <Alert tone="info" className="rounded-xl px-4 py-3" data-testid="blacklist-note">
            People marked <Badge tone="red">Blacklisted</Badge> are left out of the automatic allocation. Add them by hand, only as helpers on events marked non-crucial.{" "}
            <Link href="/team/reliability" className="font-semibold underline">
              Reliability and blacklist
            </Link>
          </Alert>
        )}
        {conflicts.length > 0 && (
          <Alert tone="warning" className="rounded-xl px-4 py-3">
            {plural(conflicts.length, "time conflict")}:{" "}
            {conflicts
              .map((c) => `${people.get(c.profileId)?.name} on ${c.eventIds.map((e) => boardEvents.find((b) => b.id === e)?.title).join(" and ")}`)
              .join("; ")}
          </Alert>
        )}
        {cycle.status === "confirmed" && editable && (
          <Alert tone="info" className="rounded-xl px-4 py-3">
            The roster is confirmed: changes here update the Chat spaces and are announced to the OC – each waits 10 seconds for Undo first.
          </Alert>
        )}
      </div>
      {showBoard && <RosterBoard events={boardEvents} people={[...people.values()].sort((a, b) => a.name.localeCompare(b.name))} editable={editable} confirmed={cycle.status === "confirmed"} canMarkCrucial={canEdit} />}
    </>
  );
}
