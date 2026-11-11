"use client";

import { useState } from "react";
import Link from "next/link";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { GripVertical, Search, UserX, X } from "lucide-react";
import { Alert, Badge } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { assignInternal, moveInternalPerson, unassignInternal } from "@/app/actions/internal";
import { INTERNAL_KIND_DOTS, STAFFED_KINDS, type InternalKind } from "@/lib/internal";
import { plural } from "@/lib/plural";
import { cn } from "@/lib/utils";
import type { PlannerEvent } from "../planner";
import { SHORT, STAFFING_DOT, STAFFING_TEXT, dayLabel, staffingOf } from "../plannerFormat";
import { Draggable, Drop } from "../plannerUi";

type DragData = { type: "member"; profileId: string; name: string } | { type: "person"; personId: string; name: string };

/**
 * The Duty roster tab (split 2026-11-11): the OC and helper slots of the
 * coming Stammtisch and office hours. Drag a member onto a slot, or pick one
 * from the slot's list (phones, keyboards); × or dropping the name back on the
 * members takes it off.
 */
export function RosterBoard({
  events,
  members,
  canEdit,
  period,
  openOnly: initialOpenOnly,
  calendarHref,
}: {
  events: PlannerEvent[];
  members: Array<{ id: string; name: string }>;
  canEdit: boolean;
  period: string;
  /** ?only=open, from the figures on top and on Home. */
  openOnly: boolean;
  /** The Calendar tab for this period (?date= is added to open a date). */
  calendarHref: string;
}) {
  const { run, pending, error } = useAction();
  const [active, setActive] = useState<DragData | null>(null);
  const [filter, setFilter] = useState("");
  const [openOnly, setOpenOnly] = useState(initialOpenOnly);
  const [kinds, setKinds] = useState<Set<InternalKind>>(new Set(STAFFED_KINDS));
  const [byLoad, setByLoad] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));

  const duties = new Map<string, number>();
  for (const e of events) for (const p of e.people) if (p.role !== "attendee") duties.set(p.profileId, (duties.get(p.profileId) ?? 0) + 1);
  const shown = members.filter((m) => m.name.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => (byLoad ? (duties.get(a.id) ?? 0) - (duties.get(b.id) ?? 0) : 0));
  const missing = events.filter((e) => staffingOf(e) !== "staffed").length;
  const rows = events.filter((e) => kinds.has(e.kind) && (!openOnly || staffingOf(e) !== "staffed"));

  function onDragStart(e: DragStartEvent) {
    setActive((e.active.data.current as DragData) ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    setActive(null);
    const data = e.active.data.current as DragData | undefined;
    const target = e.over?.id ? String(e.over.id) : null;
    if (!data || !target) return;
    if (target === "pool") {
      if (data.type === "person") run(unassignInternal, { person_id: data.personId });
      return;
    }
    if (target.startsWith("slot:")) {
      const [, eventId, role] = target.split(":");
      if (data.type === "member") run(assignInternal, { internal_event_id: eventId, profile_id: data.profileId, role });
      else run(moveInternalPerson, { person_id: data.personId, internal_event_id: eventId, role });
    }
  }

  function toggleKind(k: InternalKind) {
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  const slot = (ev: PlannerEvent, role: "oc" | "helper") => {
    const people = ev.people.filter((p) => p.role === role);
    const taken = new Set(ev.people.filter((p) => p.role !== "attendee").map((p) => p.profileId));
    const wants = role === "oc" ? people.length === 0 : people.length < ev.helpersNeeded;
    return (
      <Drop
        id={`slot:${ev.id}:${role}`}
        disabled={!canEdit}
        label={`${ev.title} ${ev.start.slice(0, 10)} ${role}`}
        over="border-esn bg-esn/5 ring-1 ring-esn"
        className={cn("flex min-h-9 min-w-0 flex-1 flex-wrap items-center gap-1 rounded-lg border border-dashed p-1", wants ? (role === "oc" ? "border-red-300" : "border-amber-300") : "border-gray-200")}
      >
        {people.map((p) => (
          <Draggable
            key={p.id}
            id={`person:${p.id}`}
            data={{ type: "person", personId: p.id, name: p.name }}
            disabled={!canEdit}
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-gray-200 bg-white py-0.5 pl-2 pr-1 text-xs font-medium shadow-sm"
          >
            <span className="truncate">{p.name}</span>
            {canEdit && (
              <button
                type="button"
                className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-900"
                aria-label={`Take ${p.name} off`}
                disabled={pending}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => run(unassignInternal, { person_id: p.id })}
              >
                <X className="size-3" />
              </button>
            )}
          </Draggable>
        ))}
        {canEdit && wants && (
          <select
            aria-label={`Add ${role === "oc" ? "the OC" : "a helper"} to the ${SHORT[ev.kind]} of ${dayLabel(ev.start.slice(0, 10))}`}
            value=""
            disabled={pending}
            onChange={(e) => e.target.value && run(assignInternal, { internal_event_id: ev.id, profile_id: e.target.value, role })}
            className="h-7 min-w-0 max-w-full cursor-pointer rounded-md border-0 bg-transparent pl-1.5 pr-6 text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-esn-accent"
          >
            <option value="">{role === "oc" ? "+ Pick the OC" : "+ Pick a helper"}</option>
            {members
              .filter((m) => !taken.has(m.id))
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {duties.get(m.id) ? ` (${duties.get(m.id)} on duty)` : ""}
                </option>
              ))}
          </select>
        )}
        {!canEdit && !people.length && <span className="px-1 text-xs text-gray-400">–</span>}
      </Drop>
    );
  };

  return (
    <DndContext id="internal-roster" sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <section aria-label="Roster">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone={missing ? "amber" : "green"}>{missing ? `${missing} of ${events.length} not fully staffed` : events.length ? "all staffed" : "nothing to staff"}</Badge>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {STAFFED_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kinds.has(k)}
                onClick={() => toggleKind(k)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                  kinds.has(k) ? "border-gray-200 bg-white text-gray-700 hover:bg-gray-50" : "border-dashed border-gray-300 text-gray-400 hover:text-gray-600"
                )}
              >
                <span className={cn("size-2 rounded-full", kinds.has(k) ? INTERNAL_KIND_DOTS[k] : "bg-gray-300")} aria-hidden="true" />
                {SHORT[k]}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={openOnly}
              onClick={() => setOpenOnly((x) => !x)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                openOnly ? "border-esn bg-esn text-white" : "border-gray-300 bg-white text-gray-700 hover:border-esn/40"
              )}
            >
              <UserX className="size-3.5" aria-hidden="true" />
              Only open slots
            </button>
          </div>
        </div>
        {error && (
          <Alert tone="error" className="mb-3" role="alert">
            {error}
          </Alert>
        )}
        <div className={cn("grid items-start gap-4", canEdit && "lg:grid-cols-[16rem_minmax(0,1fr)]")}>
          {canEdit && (
            <div className="hidden rounded-2xl border border-gray-200 bg-white p-3 shadow-sm lg:sticky lg:top-4 lg:block">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">Members</h2>
                <button type="button" onClick={() => setByLoad((x) => !x)} aria-pressed={byLoad} className="text-[11px] font-medium text-esn hover:underline">
                  {byLoad ? "A–Z" : "Fewest duties first"}
                </button>
              </div>
              <label className="relative mb-2 block">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                <input
                  aria-label="Filter members"
                  placeholder="Search…"
                  className="w-full rounded-md border border-gray-200 py-1.5 pl-7 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-esn-accent"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </label>
              <Drop id="pool" disabled={!canEdit} over="border-esn bg-esn/5" className="max-h-[calc(100vh-14rem)] min-h-40 space-y-1 overflow-y-auto rounded-lg border border-dashed border-gray-200 p-1">
                {shown.map((m) => (
                  <Draggable
                    key={m.id}
                    id={`member:${m.id}`}
                    data={{ type: "member", profileId: m.id, name: m.name }}
                    disabled={!canEdit}
                    className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm shadow-sm hover:border-esn/40"
                  >
                    <GripVertical className="size-3.5 shrink-0 text-gray-300" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate font-medium" data-testid={`member-${m.id}`}>
                      {m.name}
                    </span>
                    {duties.get(m.id) ? (
                      <span className="shrink-0 rounded-full bg-esn/10 px-1.5 text-[11px] font-semibold tabular-nums text-esn" title={`${plural(duties.get(m.id)!, "duty", "duties")} in ${period}`}>
                        {duties.get(m.id)}
                      </span>
                    ) : null}
                  </Draggable>
                ))}
                {!shown.length && <p className="p-2 text-xs text-gray-500">Nobody by that name.</p>}
              </Drop>
              <p className="mt-2 text-xs text-gray-500">Drag a name onto a slot, or pick from a slot&apos;s list. Drop a name back here to take it off.</p>
            </div>
          )}
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            {!rows.length ? (
              <p className="p-6 text-center text-sm text-gray-500">
                {events.length ? (openOnly ? "Every slot is filled. 🎉" : "No dates of the kinds shown.") : `No coming Stammtisch or office hours in ${period}.`}
              </p>
            ) : (
              <ul className="divide-y divide-gray-100" data-testid="internal-roster">
                {rows.map((ev) => {
                  const staffing = staffingOf(ev);
                  const helpers = ev.people.filter((p) => p.role === "helper").length;
                  return (
                    <li
                      key={ev.id}
                      id={`roster-${ev.id}`}
                      className="grid scroll-mt-4 items-start gap-2 px-4 py-3 transition-colors target:bg-esn/5 md:grid-cols-[11rem_minmax(0,1fr)_minmax(0,1.3fr)] md:items-center md:gap-4"
                      data-testid={`roster-${ev.kind}-${ev.start.slice(0, 10)}`}
                    >
                      <Link href={`${calendarHref}&date=${ev.id}`} className="group flex min-w-0 items-center gap-2.5" title="Open in the calendar">
                        <span className={cn("size-2.5 shrink-0 rounded-full", STAFFING_DOT[staffing])} title={STAFFING_TEXT[staffing]} aria-label={STAFFING_TEXT[staffing]} />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium tabular-nums text-gray-900 group-hover:text-esn">
                            {dayLabel(ev.start.slice(0, 10))} · {ev.start.slice(11)}
                          </span>
                          <span className="flex items-center gap-1 text-xs text-gray-500">
                            <span className={cn("size-1.5 rounded-full", INTERNAL_KIND_DOTS[ev.kind])} aria-hidden="true" />
                            <span className="truncate">{ev.title}</span>
                          </span>
                        </span>
                      </Link>
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={cn("w-14 shrink-0 text-[11px] font-semibold uppercase tracking-wide", staffing === "no_oc" ? "text-red-600" : "text-gray-500")}>OC</span>
                        {slot(ev, "oc")}
                      </div>
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={cn("w-14 shrink-0 text-[11px] font-semibold uppercase tracking-wide tabular-nums", helpers < ev.helpersNeeded ? "text-amber-700" : "text-gray-500")}>
                          Help {helpers}/{ev.helpersNeeded}
                        </span>
                        {slot(ev, "helper")}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </section>
      <DragOverlay>{active && <Badge tone="blue">{active.name}</Badge>}</DragOverlay>
    </DndContext>
  );
}
