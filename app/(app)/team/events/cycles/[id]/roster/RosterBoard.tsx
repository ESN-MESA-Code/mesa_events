"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Alert, Badge, Card } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { assign, moveAssignment, unassign } from "@/app/actions/planning";
import { EVENT_STATUS_LABELS, EVENT_STATUS_TONES, type EventStatus } from "@/lib/labels";
import { staffingStatus } from "@/lib/allocation";
import { cn } from "@/lib/utils";

export interface BoardPerson {
  id: string;
  name: string;
  email: string;
  wishes: Record<string, { oc: number | null; helper: number | null }>;
}

export interface BoardEvent {
  id: string;
  title: string;
  /** ISO start, for the order. */
  startsAt: string;
  when: string;
  helpersNeeded: number;
  status: EventStatus;
  assignments: Array<{ id: string; profileId: string; role: "oc" | "helper"; source: string }>;
}

type DragData = { kind: "assignment"; assignmentId: string } | { kind: "person"; profileId: string };
const RANK = ["", "top choice", "happy to", "if needed"];

const STAFFING = {
  staffed: { label: "Staffed", tone: "green" },
  understaffed: { label: "Short of helpers", tone: "amber" },
  no_oc: { label: "No OC", tone: "amber" },
  dropped: { label: "Nobody – will be dropped", tone: "red" },
} as const;

function Chip({ id, data, children, disabled }: { id: string; data: DragData; children: React.ReactNode; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, data, disabled });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn(
        "rounded-md border border-gray-200 bg-white px-2 py-1 text-sm shadow-sm",
        !disabled && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-60 ring-2 ring-esn-accent relative z-10"
      )}
    >
      {children}
    </div>
  );
}

function Slot({ id, label, children, disabled }: { id: string; label: string; children: React.ReactNode; disabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });
  return (
    <div ref={setNodeRef} aria-label={label} className={cn("rounded-md border border-dashed p-2 min-h-11 space-y-1", isOver ? "border-esn bg-esn/5" : "border-gray-200")}>
      {children}
    </div>
  );
}

export function RosterBoard({ events, people, editable }: { events: BoardEvent[]; people: BoardPerson[]; editable: boolean }) {
  const cycleParam = useParams<{ id: string }>().id;
  const { run, error } = useAction();
  const [filter, setFilter] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  const byId = new Map(people.map((p) => [p.id, p]));

  function onDragEnd(e: DragEndEvent) {
    const data = e.active.data.current as DragData | undefined;
    const target = e.over?.id ? String(e.over.id) : null;
    if (!data || !target) return;
    if (target === "pool") {
      if (data.kind === "assignment") run(unassign, { assignment_id: data.assignmentId });
      return;
    }
    const [eventId, role] = target.split(":");
    if (data.kind === "assignment") run(moveAssignment, { assignment_id: data.assignmentId, event_id: eventId, role });
    else run(assign, { event_id: eventId, profile_id: data.profileId, role });
  }

  const wishLabel = (p: BoardPerson, eventId: string) => {
    const w = p.wishes[eventId];
    if (!w) return null;
    return [w.oc && `OC: ${RANK[w.oc]}`, w.helper && `helper: ${RANK[w.helper]}`].filter(Boolean).join(", ");
  };

  // Drag and drop only (the "Move to…" menu is gone, round 2026-10-30); the keyboard sensor still moves chips without a mouse.
  const PersonLine = ({ person, eventId, assignment }: { person: BoardPerson; eventId?: string; assignment?: BoardEvent["assignments"][number] }) => (
    <div className="flex items-center gap-1.5">
      <span className="font-medium text-gray-900 truncate">{person.name}</span>
      {eventId && wishLabel(person, eventId) && <span className="text-[11px] text-gray-500 truncate">({wishLabel(person, eventId)})</span>}
      {assignment?.source === "proposer" && <Badge tone="purple">idea</Badge>}
    </div>
  );

  const shown = people.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <DndContext id="roster-board" sensors={sensors} onDragEnd={onDragEnd}>
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <Card className="p-3 h-fit lg:sticky lg:top-4">
          <h2 className="text-sm font-semibold mb-2">Volunteers ({people.length})</h2>
          <input
            aria-label="Filter volunteers"
            placeholder="Filter…"
            className="w-full mb-2 rounded border border-gray-200 px-2 py-1 text-sm"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <Slot id="pool" label="Volunteers" disabled={!editable}>
            {shown.map((p) => {
              const count = events.reduce((n, e) => n + e.assignments.filter((a) => a.profileId === p.id).length, 0);
              return (
                <Chip key={p.id} id={`person:${p.id}`} data={{ kind: "person", profileId: p.id }} disabled={!editable}>
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-gray-500"> · {Object.keys(p.wishes).length} wishes · {count} assigned</span>
                </Chip>
              );
            })}
          </Slot>
          <p className="text-xs text-gray-500 mt-2">Drag a name onto an OC or helper slot, or a chip to another event. Drop an assigned person here to remove them. Keyboard: focus a chip, Space to pick it up, arrows to move, Space to drop.</p>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" data-testid="roster-board">
          {[...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((ev) => {
            const oc = ev.assignments.filter((a) => a.role === "oc");
            const helpers = ev.assignments.filter((a) => a.role === "helper");
            const staffing = STAFFING[staffingStatus(oc.length > 0, helpers.length, ev.helpersNeeded)];
            const wishers = people.filter((p) => p.wishes[ev.id] && !ev.assignments.some((a) => a.profileId === p.id));
            return (
              <Card key={ev.id} className="p-3 space-y-2" data-testid={`roster-${ev.title}`}>
                <p className="text-xs font-semibold tabular-nums text-esn-dark">{ev.when}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <a href={`/events/${ev.id}?from=cycle:${cycleParam}`} className="font-semibold text-gray-900 hover:text-esn mr-auto">
                    {ev.title}
                  </a>
                  {ev.status !== "scheduled" && <Badge tone={EVENT_STATUS_TONES[ev.status]}>{EVENT_STATUS_LABELS[ev.status]}</Badge>}
                  <Badge tone={staffing.tone}>{staffing.label}</Badge>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-gray-500 mb-1">OC</p>
                  <Slot id={`${ev.id}:oc`} label={`${ev.title} OC`} disabled={!editable}>
                    {oc.map((a) => (
                      <Chip key={a.id} id={`a:${a.id}`} data={{ kind: "assignment", assignmentId: a.id }} disabled={!editable}>
                        <PersonLine person={byId.get(a.profileId)!} eventId={ev.id} assignment={a} />
                      </Chip>
                    ))}
                  </Slot>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-gray-500 mb-1">
                    Helpers {helpers.length}/{ev.helpersNeeded}
                  </p>
                  <Slot id={`${ev.id}:helper`} label={`${ev.title} helpers`} disabled={!editable}>
                    {helpers.map((a) => (
                      <Chip key={a.id} id={`a:${a.id}`} data={{ kind: "assignment", assignmentId: a.id }} disabled={!editable}>
                        <PersonLine person={byId.get(a.profileId)!} eventId={ev.id} assignment={a} />
                      </Chip>
                    ))}
                  </Slot>
                </div>
                {wishers.length > 0 && (
                  <p className="text-xs text-gray-500">
                    Also wanted: {wishers.map((p) => `${p.name} (${wishLabel(p, ev.id)})`).join("; ")}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </DndContext>
  );
}
