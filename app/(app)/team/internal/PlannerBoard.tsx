"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select, Textarea } from "@/components/ui";
import { FoldCard } from "@/components/Fold";
import { useAction } from "@/components/ActionButton";
import {
  assignInternal,
  createInternalEvent,
  createInternalSeries,
  deleteInternalEvent,
  moveInternalPerson,
  unassignInternal,
  updateInternalEvent,
  updateKindSettings,
} from "@/app/actions/internal";
import { monthLabel } from "@/lib/dates";
import { calendarWeeks, moveToDay } from "@/lib/month";
import {
  INTERNAL_KINDS,
  INTERNAL_KIND_CHIPS,
  INTERNAL_KIND_LABELS,
  OCCURRENCE_LABELS,
  WEEKDAY_NAMES,
  defaultTimes,
  formatMinutes,
  hasPresentation,
  internalPath,
  internalStaffing,
  isStaffed,
  repeatDates,
  takesSignUps,
  type InternalKind,
  type Occurrence,
} from "@/lib/internal";
import type { InternalPerson } from "@/lib/internalEvents";
import { plural } from "@/lib/plural";
import { cn } from "@/lib/utils";

export interface PlannerEvent {
  id: string;
  kind: InternalKind;
  title: string;
  /** Berlin datetime-local values. */
  start: string;
  end: string | null;
  location: string;
  note: string;
  presentationUrl: string | null;
  capacity: number | null;
  helpersNeeded: number;
  cancelled: boolean;
  past: boolean;
  seriesId: string | null;
  people: InternalPerson[];
}

export interface KindSetting {
  kind: InternalKind;
  title: string;
  /** "19:00" */
  start: string;
  minutes: number;
  helpers: number;
  description: string;
}

type DragData =
  | { type: "kind"; kind: InternalKind }
  | { type: "event"; event: PlannerEvent }
  | { type: "member"; profileId: string; name: string }
  | { type: "person"; personId: string; name: string };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const OCCURRENCES: Occurrence[] = ["every", 1, 2, 3, 4, "last"];

function Draggable({ id, data, disabled, children, className }: { id: string; data: DragData; disabled: boolean; children: React.ReactNode; className?: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data, disabled });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={cn(className, !disabled && "cursor-grab touch-none active:cursor-grabbing", isDragging && "opacity-40")}>
      {children}
    </div>
  );
}

function Drop({ id, disabled, className, over, children, label, testId }: { id: string; disabled: boolean; className?: string; over: string; children: React.ReactNode; label?: string; testId?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });
  return (
    <div ref={setNodeRef} aria-label={label} data-testid={testId} className={cn(className, isOver && over)}>
      {children}
    </div>
  );
}

/**
 * The internal planner: months as calendars (a whole semester, or one month),
 * a palette of kinds to drag onto days, dates to drag to other days, the
 * OC and helper slots of Stammtisch and office hours to drag members onto,
 * "Repeat" over the semester and the defaults per kind.
 */
export function PlannerBoard({
  months,
  compact,
  today,
  period,
  events,
  kinds,
  members,
  canEdit,
}: {
  months: string[];
  compact: boolean;
  today: string;
  period: { label: string; from: string; to: string };
  events: PlannerEvent[];
  kinds: KindSetting[];
  members: Array<{ id: string; name: string }>;
  canEdit: boolean;
}) {
  const { run, pending, error } = useAction();
  const [active, setActive] = useState<DragData | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [shown, setShown] = useState<Set<InternalKind>>(new Set(INTERNAL_KINDS));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  const kindOf = useMemo(() => new Map(kinds.map((k) => [k.kind, k])), [kinds]);
  const visible = events.filter((e) => shown.has(e.kind));
  const onDay = (day: string) => visible.filter((e) => e.start.slice(0, 10) === day);
  const current = events.find((e) => e.id === selected) ?? null;

  function onDragStart(e: DragStartEvent) {
    setActive((e.active.data.current as DragData) ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    setActive(null);
    const data = e.active.data.current as DragData | undefined;
    const target = e.over?.id ? String(e.over.id) : null;
    if (!data || !target) return;
    if (/^m?day:/.test(target)) {
      const day = target.slice(target.indexOf(":") + 1);
      if (data.type === "kind") {
        const k = kindOf.get(data.kind)!;
        const t = defaultTimes(day, k.start, k.minutes);
        run(createInternalEvent, { kind: data.kind, starts_at: t.start, ends_at: t.end }, (r) => setSelected(r.id));
      } else if (data.type === "event" && data.event.start.slice(0, 10) !== day) {
        const moved = moveToDay(data.event.start, data.event.end, day);
        run(updateInternalEvent, { id: data.event.id, starts_at: moved.start, ends_at: moved.end });
      }
      return;
    }
    if (target === "pool") {
      if (data.type === "person") run(unassignInternal, { person_id: data.personId });
      return;
    }
    if (target.startsWith("slot:")) {
      const [, eventId, role] = target.split(":");
      if (data.type === "member") run(assignInternal, { internal_event_id: eventId, profile_id: data.profileId, role });
      else if (data.type === "person") run(moveInternalPerson, { person_id: data.personId, internal_event_id: eventId, role });
    }
  }

  const chip = (ev: PlannerEvent) => (
    <Draggable key={ev.id} id={`event:${ev.id}`} data={{ type: "event", event: ev }} disabled={!canEdit || ev.past || pending}>
      <button
        type="button"
        onClick={() => setSelected(ev.id)}
        className={cn(
          "block w-full rounded border px-1 py-0.5 text-left leading-tight",
          compact ? "text-[10px]" : "text-[11px]",
          ev.cancelled ? "border-gray-200 bg-gray-50 text-gray-400 line-through" : INTERNAL_KIND_CHIPS[ev.kind],
          selected === ev.id && "ring-2 ring-esn"
        )}
        data-testid={`plan-${ev.kind}-${ev.start.slice(0, 10)}`}
        title={`${ev.title} – ${ev.start.slice(11)}`}
      >
        <span className="font-semibold tabular-nums">{ev.start.slice(11)}</span> <span className="break-words">{compact ? ev.title.slice(0, 18) : ev.title}</span>
        {isStaffed(ev.kind) && !ev.cancelled && internalStaffing(ev.people.some((p) => p.role === "oc"), ev.people.filter((p) => p.role === "helper").length, ev.helpersNeeded) !== "staffed" && (
          <span className="ml-0.5 text-amber-700" aria-label="Not fully staffed">
            ●
          </span>
        )}
      </button>
    </Draggable>
  );

  const monthGrid = (month: string) => (
    <section key={month} aria-label={monthLabel(month)} data-testid={`plan-month-${month.slice(0, 7)}`}>
      <h2 className="mb-1 text-sm font-semibold text-gray-800">{monthLabel(month)}</h2>
      <div className="hidden sm:block">
        <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold uppercase text-gray-500">
          {WEEKDAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="mt-0.5 grid grid-cols-7 gap-0.5">
          {calendarWeeks(month)
            .flat()
            .map((day, i) =>
              day ? (
                <Drop
                  key={day}
                  id={`day:${day}`}
                  disabled={!canEdit || day < today}
                  label={day}
                  testId={`plan-day-${day}`}
                  over="border-esn bg-esn/10"
                  className={cn("rounded border p-0.5 space-y-0.5", compact ? "min-h-14" : "min-h-24", day < today ? "border-gray-100 bg-gray-50" : "border-gray-200 bg-white")}
                >
                  <p className={cn("text-[10px] font-semibold tabular-nums", day === today ? "text-esn" : "text-gray-400")}>{Number(day.slice(8))}</p>
                  {onDay(day).map(chip)}
                </Drop>
              ) : (
                <div key={`blank-${month}-${i}`} aria-hidden="true" />
              )
            )}
        </div>
      </div>
      {/* Phones: the days with dates, plus drop targets while dragging (their own ids – a hidden twin of a grid day would take the drop). */}
      <ol className="space-y-1 sm:hidden">
        {calendarWeeks(month)
          .flat()
          .filter((d): d is string => !!d && (onDay(d).length > 0 || (!!active && d >= today)))
          .map((day) => (
            <li key={day}>
              <Drop id={`mday:${day}`} disabled={!canEdit || day < today} over="border-esn bg-esn/10" className="flex gap-2 rounded border border-gray-200 bg-white p-1">
                <span className="w-16 shrink-0 text-xs tabular-nums text-gray-500">{day.slice(8)}.{day.slice(5, 7)}.</span>
                <div className="flex-1 space-y-0.5">{onDay(day).map(chip)}</div>
              </Drop>
            </li>
          ))}
      </ol>
    </section>
  );

  return (
    <DndContext id="internal-planner" sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      {error && (
        <Alert tone="error" className="mb-3" role="alert">
          {error}
        </Alert>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="kind-palette">
        {canEdit && <span className="text-xs text-gray-600">Drag onto a day:</span>}
        {INTERNAL_KINDS.map((k) => (
          <div key={k} className="flex items-center gap-1">
            {canEdit && (
              <Draggable id={`kind:${k}`} data={{ type: "kind", kind: k }} disabled={pending} className={cn("rounded border px-2 py-1 text-xs font-medium", INTERNAL_KIND_CHIPS[k])}>
                <span data-testid={`palette-${k}`}>+ {INTERNAL_KIND_LABELS[k]}</span>
              </Draggable>
            )}
            <label className="flex items-center gap-1 text-[11px] text-gray-500" title={`Show ${INTERNAL_KIND_LABELS[k]}`}>
              <input
                type="checkbox"
                checked={shown.has(k)}
                aria-label={`Show ${INTERNAL_KIND_LABELS[k]}`}
                onChange={(e) =>
                  setShown((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(k);
                    else next.delete(k);
                    return next;
                  })
                }
              />
              {!canEdit && INTERNAL_KIND_LABELS[k]}
            </label>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="p-3">
          <div className={cn("grid gap-5", compact && "xl:grid-cols-2")} data-testid="planner-calendar">
            {months.map(monthGrid)}
          </div>
          {canEdit && <p className="mt-3 text-xs text-gray-500">Drag a kind from above onto a day to add it (its default time), a date to another day to move it. Click a date to edit it. ● = OC or helpers missing.</p>}
        </Card>
        <div className="space-y-4 lg:sticky lg:top-4 lg:h-fit">
          {current ? (
            <Editor key={`${current.id}-${current.start}-${current.cancelled}`} ev={current} canEdit={canEdit} onClose={() => setSelected(null)} />
          ) : (
            <Card className="p-4 text-sm text-gray-500">Click a date in the calendar to see and edit it.</Card>
          )}
        </div>
      </div>

      <Roster events={events.filter((e) => isStaffed(e.kind) && !e.cancelled && !e.past && shown.has(e.kind))} members={members} canEdit={canEdit} period={period.label} />

      {canEdit && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Repeat kinds={kinds} events={events} period={period} />
          <Settings kinds={kinds} />
        </div>
      )}

      <DragOverlay>
        {active?.type === "kind" && <Badge tone="blue">+ {INTERNAL_KIND_LABELS[active.kind]}</Badge>}
        {active?.type === "event" && <Badge tone="blue">{active.event.title}</Badge>}
        {(active?.type === "member" || active?.type === "person") && <Badge tone="blue">{active.name}</Badge>}
      </DragOverlay>
    </DndContext>
  );
}

/** One date: details, cancel or restore, delete (also the rest of its series). */
function Editor({ ev, canEdit, onClose }: { ev: PlannerEvent; canEdit: boolean; onClose: () => void }) {
  const { run, pending, error, confirm } = useAction();
  const [f, setF] = useState({
    title: ev.title,
    start: ev.start,
    end: ev.end ?? "",
    location: ev.location,
    note: ev.note,
    presentation_url: ev.presentationUrl ?? "",
    capacity: ev.capacity === null ? "" : String(ev.capacity),
    helpers: String(ev.helpersNeeded),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const disabled = !canEdit || pending;
  const attendees = ev.people.filter((p) => p.role === "attendee");
  return (
    <Card data-testid="planner-editor">
      <CardHeader>
        <CardTitle className="text-base">{INTERNAL_KIND_LABELS[ev.kind]}</CardTitle>
        <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-900" aria-label="Close">
          ✕
        </button>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(updateInternalEvent, {
              id: ev.id,
              title: f.title,
              starts_at: f.start,
              ends_at: f.end || null,
              location: f.location,
              note: f.note,
              ...(hasPresentation(ev.kind) ? { presentation_url: f.presentation_url } : {}),
              ...(takesSignUps(ev.kind) ? { capacity: f.capacity ? Number(f.capacity) : null } : {}),
              ...(isStaffed(ev.kind) ? { helpers_needed: Number(f.helpers) } : {}),
            });
          }}
        >
          <Field label="Title" htmlFor="ie-title">
            <Input id="ie-title" value={f.title} onChange={set("title")} disabled={disabled} maxLength={200} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Starts" htmlFor="ie-start">
              <Input id="ie-start" type="datetime-local" value={f.start} onChange={set("start")} disabled={disabled} />
            </Field>
            <Field label="Ends" htmlFor="ie-end">
              <Input id="ie-end" type="datetime-local" value={f.end} onChange={set("end")} disabled={disabled} />
            </Field>
          </div>
          <Field label="Where" htmlFor="ie-location">
            <Input id="ie-location" value={f.location} onChange={set("location")} disabled={disabled} maxLength={300} />
          </Field>
          {hasPresentation(ev.kind) && (
            <Field label="Presentation (link)" htmlFor="ie-pres" hint="Google Slides, Canva … (https://)">
              <Input id="ie-pres" type="url" value={f.presentation_url} onChange={set("presentation_url")} disabled={disabled} placeholder="https://" />
            </Field>
          )}
          {takesSignUps(ev.kind) && (
            <Field label="Places (empty: no limit)" htmlFor="ie-cap">
              <Input id="ie-cap" type="number" min={1} value={f.capacity} onChange={set("capacity")} disabled={disabled} />
            </Field>
          )}
          {isStaffed(ev.kind) && (
            <Field label="Helpers needed" htmlFor="ie-helpers">
              <Input id="ie-helpers" type="number" min={0} max={20} value={f.helpers} onChange={set("helpers")} disabled={disabled} />
            </Field>
          )}
          <Field label="Note (optional)" htmlFor="ie-note">
            <Textarea id="ie-note" rows={2} value={f.note} onChange={set("note")} disabled={disabled} maxLength={2000} />
          </Field>
          {canEdit && (
            <Button type="submit" size="sm" disabled={pending}>
              Save
            </Button>
          )}
        </form>
        {takesSignUps(ev.kind) && (
          <p className="mt-3 text-xs text-gray-600">
            {attendees.length ? `Signed up: ${attendees.map((a) => a.name).join(", ")}` : "Nobody signed up yet."}
          </p>
        )}
        {isStaffed(ev.kind) && <p className="mt-3 text-xs text-gray-600">Assign the OC and helpers in the roster below.</p>}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
          <Link href={internalPath(ev.kind, ev.id)} className="text-sm text-esn hover:underline">
            Open its page →
          </Link>
          {canEdit && (
            <>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(updateInternalEvent, { id: ev.id, status: ev.cancelled ? "scheduled" : "cancelled" })}>
                {ev.cancelled ? "Restore" : "Cancel date"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={async () => {
                  if (await confirm({ title: `Delete ${ev.title} on ${ev.start.slice(0, 10)}?`, body: "Its OC and helpers are removed with it. To keep it visible as cancelled, use “Cancel date”.", confirmLabel: "Delete", danger: true }))
                    run(deleteInternalEvent, { id: ev.id }, onClose, `${ev.title} deleted.`);
                }}
              >
                Delete
              </Button>
              {ev.seriesId && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={pending}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: `Delete ${ev.title} on ${ev.start.slice(0, 10)} and all later dates of its series?`,
                        body: "Every later date of the series goes, with its OC and helpers. Earlier dates stay.",
                        confirmLabel: "Delete this and later",
                        danger: true,
                      })
                    )
                      run(deleteInternalEvent, { id: ev.id, following: true }, onClose, `${ev.title}: this and later dates deleted.`);
                  }}
                >
                  Delete this and later
                </Button>
              )}
            </>
          )}
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}

/** The OC and helper slots of the coming Stammtisch and office hours: drag members onto them. */
function Roster({ events, members, canEdit, period }: { events: PlannerEvent[]; members: Array<{ id: string; name: string }>; canEdit: boolean; period: string }) {
  const [filter, setFilter] = useState("");
  const duties = new Map<string, number>();
  for (const e of events) for (const p of e.people) if (p.role !== "attendee") duties.set(p.profileId, (duties.get(p.profileId) ?? 0) + 1);
  const shown = members.filter((m) => m.name.toLowerCase().includes(filter.toLowerCase()));
  const missing = events.filter((e) => internalStaffing(e.people.some((p) => p.role === "oc"), e.people.filter((p) => p.role === "helper").length, e.helpersNeeded) !== "staffed").length;
  const slot = (ev: PlannerEvent, role: "oc" | "helper") => (
    <Drop id={`slot:${ev.id}:${role}`} disabled={!canEdit} label={`${ev.title} ${ev.start.slice(0, 10)} ${role}`} over="border-esn bg-esn/5" className="min-h-9 flex-1 space-y-1 rounded border border-dashed border-gray-200 p-1">
      {ev.people
        .filter((p) => p.role === role)
        .map((p) => (
          <Draggable key={p.id} id={`person:${p.id}`} data={{ type: "person", personId: p.id, name: p.name }} disabled={!canEdit} className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs shadow-sm">
            {p.name}
          </Draggable>
        ))}
    </Drop>
  );
  return (
    <section className="mt-6" aria-label="Roster">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h2 className="text-lg font-semibold">Who is on duty – {period}</h2>
        <Badge tone={missing ? "amber" : "green"}>{missing ? `${missing} not fully staffed` : "all staffed"}</Badge>
      </div>
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        {canEdit && (
          <Card className="h-fit p-3 lg:sticky lg:top-4">
            <h3 className="mb-2 text-sm font-semibold">Members</h3>
            <input aria-label="Filter members" placeholder="Filter…" className="mb-2 w-full rounded border border-gray-200 px-2 py-1 text-sm" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <Drop id="pool" disabled={!canEdit} over="border-esn bg-esn/5" className="max-h-[28rem] space-y-1 overflow-y-auto rounded border border-dashed border-gray-200 p-1">
              {shown.map((m) => (
                <Draggable key={m.id} id={`member:${m.id}`} data={{ type: "member", profileId: m.id, name: m.name }} disabled={!canEdit} className="rounded border border-gray-200 bg-white px-2 py-1 text-sm shadow-sm">
                  <span className="font-medium" data-testid={`member-${m.id}`}>
                    {m.name}
                  </span>
                  {duties.get(m.id) ? <span className="text-xs text-gray-500"> · {duties.get(m.id)} on duty</span> : null}
                </Draggable>
              ))}
            </Drop>
            <p className="mt-2 text-xs text-gray-500">Drag a name onto an OC or helper slot, or an assigned name to another date. Drop it here to take it off.</p>
          </Card>
        )}
        <Card className="p-0">
          {!events.length ? (
            <p className="p-4 text-sm text-gray-500">No coming Stammtisch or office hours in this period.</p>
          ) : (
            <ul className="divide-y divide-gray-100" data-testid="internal-roster">
              {events.map((ev) => {
                const helpers = ev.people.filter((p) => p.role === "helper").length;
                return (
                  <li key={ev.id} className="grid items-start gap-2 px-3 py-2 md:grid-cols-[12rem_minmax(0,1fr)_minmax(0,1.4fr)]" data-testid={`roster-${ev.kind}-${ev.start.slice(0, 10)}`}>
                    <div className="text-sm">
                      <span className={cn("mr-1 inline-block rounded border px-1 text-[10px]", INTERNAL_KIND_CHIPS[ev.kind])}>{INTERNAL_KIND_LABELS[ev.kind]}</span>
                      <span className="tabular-nums">
                        {ev.start.slice(8, 10)}.{ev.start.slice(5, 7)}. {ev.start.slice(11)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="w-8 text-[11px] font-semibold uppercase text-gray-500">OC</span>
                      {slot(ev, "oc")}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={cn("w-14 text-[11px] font-semibold uppercase", helpers < ev.helpersNeeded ? "text-amber-700" : "text-gray-500")}>
                        Help {helpers}/{ev.helpersNeeded}
                      </span>
                      {slot(ev, "helper")}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </section>
  );
}

/** "Repeat": the same kind on a weekday across the semester – every week, or selected weeks of each month. */
function Repeat({ kinds, events, period }: { kinds: KindSetting[]; events: PlannerEvent[]; period: { label: string; from: string; to: string } }) {
  const { run, pending, error } = useAction();
  const [kind, setKind] = useState<InternalKind>("stammtisch");
  const def = kinds.find((k) => k.kind === kind)!;
  const [f, setF] = useState({ title: def.title, weekday: 3, start: def.start, minutes: String(def.minutes), helpers: String(def.helpers), location: "", presentation_url: "", from: period.from, to: period.to });
  const [which, setWhich] = useState<Occurrence[]>(["every"]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<string | null>(null);
  const days = repeatDates(f.from, f.to, f.weekday, which);
  const taken = new Set(events.filter((e) => e.kind === kind && !e.cancelled).map((e) => e.start.slice(0, 10)));
  // Days that already have this kind are left out unless ticked again.
  const picked = days.filter((d) => (taken.has(d) ? skipped.has(d) : !skipped.has(d)));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: k === "weekday" ? Number(e.target.value) : e.target.value }));

  function chooseKind(k: InternalKind) {
    const d = kinds.find((x) => x.kind === k)!;
    setKind(k);
    setF((x) => ({ ...x, title: d.title, start: d.start, minutes: String(d.minutes), helpers: String(d.helpers), weekday: k === "tuesday_talk" ? 1 : x.weekday }));
    setWhich(k === "tuesday_talk" || k === "board_meeting" ? [1] : ["every"]);
    setSkipped(new Set());
  }

  function toggleOccurrence(o: Occurrence) {
    setWhich((w) => {
      if (o === "every") return w.includes("every") ? [] : ["every"];
      const rest = w.filter((x) => x !== "every");
      return rest.includes(o) ? rest.filter((x) => x !== o) : [...rest, o];
    });
  }

  return (
    <FoldCard title={`Repeat over ${period.label}`} testId="repeat">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setDone(null);
          run(
            createInternalSeries,
            {
              kind,
              title: f.title,
              days: picked,
              start: f.start,
              minutes: Number(f.minutes),
              location: f.location,
              ...(hasPresentation(kind) ? { presentation_url: f.presentation_url } : {}),
              ...(isStaffed(kind) ? { helpers_needed: Number(f.helpers) } : {}),
            },
            (r) => {
              setDone(`${plural(r.created, "date")} added.`);
              setSkipped(new Set());
            }
          );
        }}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Kind" htmlFor="rp-kind">
            <Select id="rp-kind" value={kind} onChange={(e) => chooseKind(e.target.value as InternalKind)}>
              {INTERNAL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {INTERNAL_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title" htmlFor="rp-title">
            <Input id="rp-title" value={f.title} onChange={set("title")} maxLength={200} />
          </Field>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Weekday" htmlFor="rp-weekday">
            <Select id="rp-weekday" value={f.weekday} onChange={set("weekday")}>
              {WEEKDAY_NAMES.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Time" htmlFor="rp-start">
            <Input id="rp-start" type="time" value={f.start} onChange={set("start")} />
          </Field>
          <Field label="Minutes" htmlFor="rp-minutes" hint={formatMinutes(Number(f.minutes) || 0)}>
            <Input id="rp-minutes" type="number" min={15} max={1440} step={15} value={f.minutes} onChange={set("minutes")} />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-gray-700">Which {WEEKDAY_NAMES[f.weekday]}s of each month</legend>
          <div className="flex flex-wrap gap-3 text-sm">
            {OCCURRENCES.map((o) => (
              <label key={String(o)} className="flex items-center gap-1">
                <input type="checkbox" checked={which.includes(o)} onChange={() => toggleOccurrence(o)} />
                {OCCURRENCE_LABELS[String(o)]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="From" htmlFor="rp-from">
            <Input id="rp-from" type="date" value={f.from} onChange={set("from")} />
          </Field>
          <Field label="Until" htmlFor="rp-to">
            <Input id="rp-to" type="date" value={f.to} onChange={set("to")} />
          </Field>
        </div>
        <Field label="Where" htmlFor="rp-location">
          <Input id="rp-location" value={f.location} onChange={set("location")} maxLength={300} />
        </Field>
        {hasPresentation(kind) && (
          <Field label="Presentation (link, optional)" htmlFor="rp-pres" hint="Each date can get its own link later.">
            <Input id="rp-pres" type="url" value={f.presentation_url} onChange={set("presentation_url")} placeholder="https://" />
          </Field>
        )}
        {isStaffed(kind) && (
          <Field label="Helpers needed" htmlFor="rp-helpers">
            <Input id="rp-helpers" type="number" min={0} max={20} value={f.helpers} onChange={set("helpers")} />
          </Field>
        )}
        <div>
          <p className="mb-1 text-sm font-medium text-gray-700">
            {picked.length} of {days.length} dates – untick holidays and breaks:
          </p>
          <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto" data-testid="repeat-dates">
            {days.map((d) => {
              const on = picked.includes(d);
              return (
                <label key={d} className={cn("flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs tabular-nums", on ? "border-esn/40 bg-esn/5" : "border-gray-200 text-gray-400")} title={taken.has(d) ? "Already planned" : undefined}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setSkipped((prev) => {
                        const next = new Set(prev);
                        if (next.has(d)) next.delete(d);
                        else next.add(d);
                        return next;
                      })
                    }
                  />
                  {d.slice(8)}.{d.slice(5, 7)}.{taken.has(d) && " (planned)"}
                </label>
              );
            })}
            {!days.length && <span className="text-xs text-gray-500">No dates – choose which weeks.</span>}
          </div>
        </div>
        <Button type="submit" disabled={pending || !picked.length || !f.title.trim()}>
          Add {plural(picked.length, "date")}
        </Button>
        {done && <p className="text-sm text-emerald-700">{done}</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </FoldCard>
  );
}

/** The defaults per kind: title, time, length, helpers and the fixed text (office hours). */
function Settings({ kinds }: { kinds: KindSetting[] }) {
  const [kind, setKind] = useState<InternalKind>("office_hour");
  const k = kinds.find((x) => x.kind === kind)!;
  return (
    <FoldCard title="Defaults per kind" testId="kind-settings">
      <Select aria-label="Kind" className="mb-3 h-8 w-56" value={kind} onChange={(e) => setKind(e.target.value as InternalKind)}>
        {INTERNAL_KINDS.map((x) => (
          <option key={x} value={x}>
            {INTERNAL_KIND_LABELS[x]}
          </option>
        ))}
      </Select>
      <SettingsForm key={kind} k={k} />
    </FoldCard>
  );
}

function SettingsForm({ k }: { k: KindSetting }) {
  const { run, pending, error } = useAction();
  const [f, setF] = useState({ title: k.title, start: k.start, minutes: String(k.minutes), helpers: String(k.helpers), description: k.description });
  const [saved, setSaved] = useState(false);
  const set = (key: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setSaved(false);
    setF((x) => ({ ...x, [key]: e.target.value }));
  };
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(updateKindSettings, { kind: k.kind, default_title: f.title, default_start: f.start, default_minutes: Number(f.minutes), helpers_needed: Number(f.helpers), description: f.description }, () => setSaved(true));
      }}
    >
      <Field label="Default title" htmlFor="ks-title">
        <Input id="ks-title" value={f.title} onChange={set("title")} maxLength={200} />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Time" htmlFor="ks-start">
          <Input id="ks-start" type="time" value={f.start} onChange={set("start")} />
        </Field>
        <Field label="Minutes" htmlFor="ks-minutes">
          <Input id="ks-minutes" type="number" min={15} max={1440} step={15} value={f.minutes} onChange={set("minutes")} />
        </Field>
        <Field label="Helpers" htmlFor="ks-helpers">
          <Input id="ks-helpers" type="number" min={0} max={20} value={f.helpers} onChange={set("helpers")} disabled={!isStaffed(k.kind)} />
        </Field>
      </div>
      <Field label={k.kind === "office_hour" ? "Office hour text (the same for every office hour)" : "Text (optional)"} htmlFor="ks-description">
        <Textarea id="ks-description" rows={4} value={f.description} onChange={set("description")} maxLength={4000} />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        Save defaults
      </Button>
      {saved && <span className="ml-2 text-sm text-emerald-700">Saved ✓</span>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}
