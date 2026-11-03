"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Alert, Badge, Card } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { assign, moveAssignment, unassign } from "@/app/actions/planning";
import { EVENT_STATUS_LABELS, EVENT_STATUS_TONES, type EventStatus } from "@/lib/labels";
import { staffingStatus } from "@/lib/allocation";
import { berlinDate, formatShortDate } from "@/lib/dates";
import { rosterLoad, HEAVY_LOAD } from "@/lib/rosterLoad";
import { cn } from "@/lib/utils";
import { plural } from "@/lib/plural";

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

function Chip({ id, data, children, disabled, highlight }: { id: string; data: DragData; children: React.ReactNode; disabled: boolean; highlight?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, data, disabled });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn(
        "rounded-md border border-gray-200 bg-white px-2 py-1 text-sm shadow-sm",
        highlight && "border-l-4 border-l-amber-400",
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

/** How long a change on a confirmed roster waits for Undo before it is saved and announced (usability review #20). */
const UNDO_MS = 10_000;

export function RosterBoard({ events, people, editable, confirmed }: { events: BoardEvent[]; people: BoardPerson[]; editable: boolean; confirmed: boolean }) {
  const cycleParam = useParams<{ id: string }>().id;
  const { run, error, toast } = useAction();
  const [filter, setFilter] = useState("");
  const [waiting, setWaiting] = useState(0);
  const waitingRef = useRef(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  const byId = new Map(people.map((p) => [p.id, p]));
  // Who carries a lot, and who is on two events the same day (usability review #20).
  const load = rosterLoad(events.map((e) => ({ id: e.id, day: berlinDate(e.startsAt), profileIds: e.assignments.map((a) => a.profileId) })));
  const titleOf = new Map(events.map((e) => [e.id, e.title]));

  // Leaving with a change still waiting would lose it.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (waitingRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  /** On a confirmed roster a change goes out to the OC and the Chat space: it waits for Undo first. */
  function save(what: string, apply: () => void) {
    if (!confirmed) {
      apply();
      return;
    }
    waitingRef.current++;
    setWaiting(waitingRef.current);
    const settle = () => {
      waitingRef.current--;
      setWaiting(waitingRef.current);
    };
    toast(`${what} – saved and announced in ${UNDO_MS / 1000} s.`, {
      tone: "info",
      duration: UNDO_MS,
      action: { label: "Undo", onClick: settle },
      onExpire: () => {
        settle();
        apply();
      },
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const data = e.active.data.current as DragData | undefined;
    const target = e.over?.id ? String(e.over.id) : null;
    if (!data || !target) return;
    const who = (assignmentId: string) => {
      for (const ev of events) {
        const a = ev.assignments.find((x) => x.id === assignmentId);
        if (a) return { name: byId.get(a.profileId)?.name ?? "Someone", from: ev };
      }
      return { name: "Someone", from: null };
    };
    if (target === "pool") {
      if (data.kind === "assignment") {
        const w = who(data.assignmentId);
        save(`${w.name} removed from ${w.from?.title ?? "the event"}`, () => run(unassign, { assignment_id: data.assignmentId }));
      }
      return;
    }
    const [eventId, role] = target.split(":");
    const label = `${titleOf.get(eventId) ?? "the event"} (${role === "oc" ? "OC" : "helper"})`;
    if (data.kind === "assignment") {
      const w = who(data.assignmentId);
      save(`${w.name} moved to ${label}`, () => run(moveAssignment, { assignment_id: data.assignmentId, event_id: eventId, role }));
    } else save(`${byId.get(data.profileId)?.name ?? "Someone"} added to ${label}`, () => run(assign, { event_id: eventId, profile_id: data.profileId, role }));
  }

  /** "⚠ same day as Pub Quiz" for a chip. */
  const clashNote = (profileId: string, eventId: string) => {
    const others = load.get(profileId)?.sameDay.get(eventId) ?? [];
    return others.length ? `same day as ${others.map((id) => titleOf.get(id)).join(", ")}` : null;
  };

  const wishLabel = (p: BoardPerson, eventId: string) => {
    const w = p.wishes[eventId];
    if (!w) return null;
    return [w.oc && `OC: ${RANK[w.oc]}`, w.helper && `helper: ${RANK[w.helper]}`].filter(Boolean).join(", ");
  };

  // Drag and drop only (the "Move to…" menu is gone, round 2026-10-30); the keyboard sensor still moves chips without a mouse.
  const PersonLine = ({ person, eventId, assignment }: { person: BoardPerson; eventId?: string; assignment?: BoardEvent["assignments"][number] }) => {
    const clash = eventId ? clashNote(person.id, eventId) : null;
    return (
      <div className="flex flex-wrap items-center gap-x-1.5">
        <span className="font-medium text-gray-900 truncate">{person.name}</span>
        {eventId && wishLabel(person, eventId) && <span className="text-[11px] text-gray-500 truncate">({wishLabel(person, eventId)})</span>}
        {assignment?.source === "proposer" && <Badge tone="purple">idea</Badge>}
        {clash && <span className="w-full text-[11px] font-medium text-red-700">⚠ {clash}</span>}
      </div>
    );
  };

  // Those without an event first, marked (review 2026-11-03 #15): they are who fills the gaps.
  const countOf = (id: string) => load.get(id)?.count ?? 0;
  const free = people.filter((p) => countOf(p.id) === 0);
  const shown = people.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => Number(countOf(a.id) > 0) - Number(countOf(b.id) > 0));

  return (
    <DndContext id="roster-board" sensors={sensors} onDragEnd={onDragEnd}>
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      {waiting > 0 && (
        <Alert tone="info" className="mb-4" data-testid="roster-waiting">
          {waiting === 1 ? "1 change waits" : `${waiting} changes wait`} for Undo – the board updates once {waiting === 1 ? "it is" : "they are"} saved.
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
            {shown.map((p, i) => {
              const l = load.get(p.id);
              const count = l?.count ?? 0;
              const heading =
                i === 0 && count === 0 ? (
                  <p key="h-free" className="text-[11px] font-semibold uppercase tracking-wide text-amber-800" data-testid="pool-free">
                    Not assigned yet ({free.length})
                  </p>
                ) : count > 0 && (i === 0 || countOf(shown[i - 1].id) === 0) ? (
                  <p key="h-assigned" className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Assigned
                  </p>
                ) : null;
              const days = [...new Set([...(l?.sameDay.keys() ?? [])].map((id) => events.find((e) => e.id === id)!.startsAt))].map((iso) => formatShortDate(iso));
              return [
                heading,
                <Chip key={p.id} id={`person:${p.id}`} data={{ kind: "person", profileId: p.id }} disabled={!editable} highlight={count === 0}>
                  <span className="font-medium">{p.name}</span>
                  <span className={cn("text-xs", count >= HEAVY_LOAD ? "font-semibold text-amber-700" : "text-gray-500")}>
                    {" "}
                    · {plural(Object.keys(p.wishes).length, "wish", "wishes")} · {count} assigned{count >= HEAVY_LOAD && " – a lot"}
                  </span>
                  {days.length > 0 && <span className="block text-[11px] font-medium text-red-700">⚠ two events on {[...new Set(days)].join(", ")}</span>}
                </Chip>,
              ];
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
                {editable && staffing !== STAFFING.staffed && free.some((p) => !wishers.includes(p)) && (
                  <p className="text-xs text-amber-800" data-testid="free-hint">
                    Not assigned anywhere yet: {free.filter((p) => !wishers.includes(p)).map((p) => p.name).join(", ")}
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
