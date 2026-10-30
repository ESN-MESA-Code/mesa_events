"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { Alert, Badge } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { acceptIdea, updateEvent } from "@/app/actions/planning";
import type { EventType } from "@/lib/labels";
import { calendarWeeks, moveToDay } from "@/lib/month";
import { cn } from "@/lib/utils";

export interface CalendarEvent {
  id: string;
  title: string;
  type: EventType;
  /** Berlin datetime-local values. */
  start: string;
  end: string | null;
  /** Can be moved (not started, not cancelled). */
  movable: boolean;
  muted?: boolean;
}

export interface CalendarIdea {
  id: string;
  title: string;
  date: string;
  helpers: number;
  type: EventType | null;
}

type DragData = { kind: "event"; event: CalendarEvent } | { kind: "idea"; idea: CalendarIdea };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Draggable({ id, data, disabled, children, className }: { id: string; data: DragData; disabled: boolean; children: React.ReactNode; className?: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data, disabled });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={cn(className, !disabled && "cursor-grab active:cursor-grabbing touch-none", isDragging && "opacity-40")}>
      {children}
    </div>
  );
}

function Day({ day, today, children, disabled }: { day: string; today: string; children: React.ReactNode; disabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}`, disabled });
  return (
    <div
      ref={setNodeRef}
      aria-label={day}
      data-testid={`cal-day-${day}`}
      className={cn("min-h-24 rounded-md border p-1 space-y-1", isOver ? "border-esn bg-esn/10" : "border-gray-200 bg-white", day < today && "bg-gray-50")}
    >
      <p className={cn("text-[11px] font-semibold tabular-nums", day === today ? "text-esn" : "text-gray-500")}>{Number(day.slice(8))}</p>
      {children}
    </div>
  );
}

/**
 * The month schedule as a calendar (round 2026-10-30): drag an event to
 * another day to move it (times kept), or drag an idea from the tray onto a
 * day to add it to the schedule (its suggested type, 19:00). On phones the
 * days stack as a list.
 */
export function ScheduleCalendar({
  month,
  today,
  events,
  ideas,
  canEdit,
  canAddIdeas,
}: {
  month: string;
  today: string;
  events: CalendarEvent[];
  ideas: CalendarIdea[];
  canEdit: boolean;
  canAddIdeas: boolean;
}) {
  const cycleId = useParams<{ id: string }>().id;
  const { run, pending, error } = useAction();
  const [active, setActive] = useState<DragData | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  const weeks = calendarWeeks(month);
  const onDay = (day: string) => events.filter((e) => e.start.slice(0, 10) === day).sort((a, b) => a.start.localeCompare(b.start));

  function onDragStart(e: DragStartEvent) {
    setActive((e.active.data.current as DragData) ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    setActive(null);
    const data = e.active.data.current as DragData | undefined;
    const target = e.over?.id ? String(e.over.id) : null;
    if (!data || !target?.startsWith("day:")) return;
    const day = target.slice(4);
    if (data.kind === "event") {
      if (data.event.start.slice(0, 10) === day) return;
      const moved = moveToDay(data.event.start, data.event.end, day);
      run(updateEvent, { id: data.event.id, starts_at: moved.start, ends_at: moved.end });
    } else {
      run(acceptIdea, { idea_id: data.idea.id, cycle_id: cycleId, type: data.idea.type ?? "standard", starts_at: `${day}T19:00`, helpers_needed: data.idea.helpers });
    }
  }

  const chip = (ev: CalendarEvent) => (
    <Draggable key={ev.id} id={`event:${ev.id}`} data={{ kind: "event", event: ev }} disabled={!canEdit || !ev.movable || pending}>
      <a
        href={`/events/${ev.id}?from=cycle:${cycleId}`}
        className={cn("block rounded border px-1.5 py-1 text-[11px] leading-tight", ev.muted ? "border-gray-200 bg-gray-100 text-gray-500 line-through" : "border-esn/30 bg-esn/10 text-esn-dark hover:bg-esn/20")}
        data-testid={`cal-event-${ev.title}`}
        onClick={(e) => active && e.preventDefault()}
      >
        <span className="tabular-nums font-semibold">{ev.start.slice(11)}</span> <span className="break-words">{ev.title}</span>
      </a>
    </Draggable>
  );

  return (
    <DndContext id="schedule-calendar" sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      {error && (
        <Alert tone="error" className="mb-3">
          {error}
        </Alert>
      )}
      {canAddIdeas && ideas.length > 0 && (
        <div className="mb-3 rounded-md border border-dashed border-gray-300 p-2" data-testid="idea-tray">
          <p className="mb-1 text-xs text-gray-600">Ideas – drag one onto a day to add it to the schedule:</p>
          <div className="flex flex-wrap gap-1.5">
            {ideas.map((i) => (
              <Draggable key={i.id} id={`idea:${i.id}`} data={{ kind: "idea", idea: i }} disabled={pending} className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                <span data-testid={`tray-idea-${i.title}`}>
                  💡 {i.title} <span className="text-amber-700">· {i.date.slice(8)}.</span>
                </span>
              </Draggable>
            ))}
          </div>
        </div>
      )}
      {/* Desktop and tablet: the grid. */}
      <div className="hidden sm:block" data-testid="schedule-calendar">
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-gray-500">
          {WEEKDAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {weeks.flat().map((day, i) =>
            day ? (
              <Day key={day} day={day} today={today} disabled={!canEdit}>
                {onDay(day).map(chip)}
              </Day>
            ) : (
              <div key={`blank-${i}`} aria-hidden="true" />
            )
          )}
        </div>
      </div>
      {/* Phones: only the days with events, plus drop targets while dragging. */}
      <ol className="sm:hidden space-y-1">
        {weeks
          .flat()
          .filter((d): d is string => !!d && (onDay(d).length > 0 || !!active))
          .map((day) => (
            <li key={day}>
              <Day day={day} today={today} disabled={!canEdit}>
                {onDay(day).map(chip)}
              </Day>
            </li>
          ))}
      </ol>
      <DragOverlay>
        {active?.kind === "event" && <Badge tone="blue">{active.event.title}</Badge>}
        {active?.kind === "idea" && <Badge tone="amber">💡 {active.idea.title}</Badge>}
      </DragOverlay>
      {canEdit && <p className="mt-2 text-xs text-gray-500">Drag an event to another day to move it (its times stay). Keyboard: focus an event, Space, arrow keys, Space.</p>}
    </DndContext>
  );
}
