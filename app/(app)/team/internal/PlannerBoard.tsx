"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { ArrowRight, CalendarDays, Eye, MousePointerClick, Plus, Repeat2, Settings2, Users } from "lucide-react";
import { Alert, Badge, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { createInternalEvent, createInternalSeries, deleteInternalEvent, updateInternalEvent, updateKindSettings } from "@/app/actions/internal";
import { monthLabel } from "@/lib/dates";
import { calendarWeeks, moveToDay } from "@/lib/month";
import {
  INTERNAL_KINDS,
  INTERNAL_KIND_DOTS,
  INTERNAL_KIND_LABELS,
  OCCURRENCE_LABELS,
  WEEKDAY_NAMES,
  defaultTimes,
  formatMinutes,
  hasPresentation,
  internalPath,
  isStaffed,
  repeatDates,
  takesSignUps,
  type InternalKind,
  type Occurrence,
} from "@/lib/internal";
import { plural } from "@/lib/plural";
import { cn } from "@/lib/utils";
import type { KindSetting, PlannerEvent } from "./planner";
import { CHIP, GHOST, SHORT, STAFFING_DOT, STAFFING_TEXT, WEEKDAYS, dayLabel, staffingOf } from "./plannerFormat";
import { Draggable, Drop, SidePanel } from "./plannerUi";

type DragData = { type: "event"; event: PlannerEvent };

/** The add menu: on a day (right-click, double-click, double-tap), or with a date field ("+ Add date"). */
interface AddAt {
  day: string | null;
  x: number;
  y: number;
}

/** What the side panel shows: a date, "Repeat dates" or the defaults per kind. */
type Panel = { type: "event"; id: string } | { type: "repeat" } | { type: "defaults" } | null;

/** The dates "Repeat" would add, drawn dashed on the calendar while its panel is open. */
interface Preview {
  kind: InternalKind;
  days: string[];
  start: string;
}

const OCCURRENCES: Occurrence[] = ["every", 1, 2, 3, 4, "last"];

/**
 * The Calendar tab of the internal planning (redesign 2026-11-11): the months
 * across the full width (a whole semester, or one month) under a toolbar with
 * "+ Add date", "Repeat dates", "Defaults" and which kinds to show. A
 * right-click, double-click or double-tap on a day offers the kinds to add
 * there (it replaced dragging kinds onto days); dates move by drag and drop. A
 * date, the repeat form or the defaults open in a panel that slides in from
 * the right. Who is on duty is the Duty roster tab.
 */
export function PlannerBoard({
  months,
  compact,
  today,
  period,
  events,
  kinds,
  canEdit,
  openId,
  rosterHref,
}: {
  months: string[];
  compact: boolean;
  today: string;
  period: { label: string; from: string; to: string };
  events: PlannerEvent[];
  kinds: KindSetting[];
  canEdit: boolean;
  /** ?date=: the date to open (the "Next up" figure, a date on the roster). */
  openId: string | null;
  /** The Duty roster tab for this period. */
  rosterHref: string;
}) {
  const { run, pending, error } = useAction();
  const [active, setActive] = useState<DragData | null>(null);
  const [panel, setPanel] = useState<Panel>(openId ? { type: "event", id: openId } : null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [shown, setShown] = useState<Set<InternalKind>>(new Set(INTERNAL_KINDS));
  const [menu, setMenu] = useState<AddAt | null>(null);
  const lastTap = useRef<{ day: string; t: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  // A new ?date= (a link on this page) opens that date.
  const [seenOpen, setSeenOpen] = useState(openId);
  if (openId !== seenOpen) {
    setSeenOpen(openId);
    if (openId) setPanel({ type: "event", id: openId });
  }
  const close = useCallback(() => setPanel(null), []);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  const kindOf = useMemo(() => new Map(kinds.map((k) => [k.kind, k])), [kinds]);
  const visible = events.filter((e) => shown.has(e.kind));
  const onDay = (day: string) => visible.filter((e) => e.start.slice(0, 10) === day);
  const selected = panel?.type === "event" ? panel.id : null;
  const current = events.find((e) => e.id === selected) ?? null;
  const ghosts = panel?.type === "repeat" && preview ? new Set(preview.days) : null;

  function onDragStart(e: DragStartEvent) {
    setActive((e.active.data.current as DragData) ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    setActive(null);
    const data = e.active.data.current as DragData | undefined;
    const target = e.over?.id ? String(e.over.id) : null;
    if (!data || !target || !/^m?day:/.test(target)) return;
    const day = target.slice(target.indexOf(":") + 1);
    if (data.event.start.slice(0, 10) !== day) {
      const moved = moveToDay(data.event.start, data.event.end, day);
      run(updateInternalEvent, { id: data.event.id, starts_at: moved.start, ends_at: moved.end });
    }
  }

  /** A date of `kind` on `day` at the kind's default time; it opens in the panel. */
  function add(kind: InternalKind, day: string) {
    const k = kindOf.get(kind)!;
    const t = defaultTimes(day, k.start, k.minutes);
    setMenu(null);
    run(createInternalEvent, { kind, starts_at: t.start, ends_at: t.end }, (r) => setPanel({ type: "event", id: r.id }));
  }

  /** Right-click, double-click or double-tap on a coming day offers the kinds to add (not on a date itself: that opens it). */
  const onChip = (e: React.SyntheticEvent) => !!(e.target as Element).closest("button");
  const dayHandlers = (day: string) =>
    canEdit && day >= today
      ? {
          onContextMenu: (e: React.MouseEvent) => {
            e.preventDefault();
            setMenu({ day, x: e.clientX, y: e.clientY });
          },
          onDoubleClick: (e: React.MouseEvent) => {
            if (!onChip(e)) setMenu({ day, x: e.clientX, y: e.clientY });
          },
          onPointerUp: (e: React.PointerEvent) => {
            if (e.pointerType !== "touch" || onChip(e)) return;
            const last = lastTap.current;
            if (last && last.day === day && e.timeStamp - last.t < 400) {
              lastTap.current = null;
              setMenu({ day, x: e.clientX, y: e.clientY });
            } else lastTap.current = { day, t: e.timeStamp };
          },
        }
      : undefined;

  function toggleKind(k: InternalKind) {
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  const chip = (ev: PlannerEvent) => {
    const staffing = isStaffed(ev.kind) && !ev.cancelled ? staffingOf(ev) : "staffed";
    return (
      <Draggable key={ev.id} id={`event:${ev.id}`} data={{ type: "event", event: ev }} disabled={!canEdit || ev.past || pending}>
        <button
          type="button"
          onClick={() => setPanel({ type: "event", id: ev.id })}
          className={cn(
            "relative block w-full rounded-md border-0 border-l-[3px] py-0.5 pl-1.5 pr-1 text-left leading-tight transition-colors",
            compact ? "text-[10.5px]" : "text-xs",
            ev.cancelled ? "border-gray-300 bg-gray-50 text-gray-400 line-through" : CHIP[ev.kind],
            ev.past && !ev.cancelled && "opacity-60",
            selected === ev.id && "ring-2 ring-esn ring-offset-1"
          )}
          data-testid={`plan-${ev.kind}-${ev.start.slice(0, 10)}`}
          title={`${ev.title} – ${ev.start.slice(11)}${staffing !== "staffed" ? ` (${STAFFING_TEXT[staffing]})` : ""}`}
        >
          {compact ? (
            <>
              <span className="block font-semibold tabular-nums">{ev.start.slice(11)}</span>
              <span className="block truncate">{ev.title}</span>
            </>
          ) : (
            <span className="flex min-w-0 items-baseline gap-1">
              <span className="shrink-0 font-semibold tabular-nums">{ev.start.slice(11)}</span>
              <span className="truncate">{ev.title}</span>
            </span>
          )}
          {staffing !== "staffed" && <span className={cn("absolute right-1 top-1 size-1.5 rounded-full", STAFFING_DOT[staffing])} aria-label={STAFFING_TEXT[staffing]} />}
        </button>
      </Draggable>
    );
  };

  /** A date "Repeat" would add (not a date yet: no test id, not clickable). */
  const ghost = (day: string) =>
    ghosts?.has(day) && preview ? (
      <div aria-hidden="true" className={cn("rounded-md border border-dashed bg-white/70 px-1.5 py-0.5 leading-tight", compact ? "text-[10.5px]" : "text-xs", GHOST[preview.kind])}>
        <span className="font-semibold tabular-nums">+ {preview.start}</span>
        {!compact && <span> {SHORT[preview.kind]}</span>}
      </div>
    ) : null;

  const monthGrid = (month: string) => {
    const count = visible.filter((e) => e.start.slice(0, 7) === month.slice(0, 7) && !e.cancelled).length;
    return (
      <section key={month} aria-label={monthLabel(month)} data-testid={`plan-month-${month.slice(0, 7)}`}>
        <div className="mb-2 flex items-baseline gap-2">
          <h3 className="text-sm font-semibold text-gray-900">{monthLabel(month)}</h3>
          <span className="text-xs text-gray-400">{count ? plural(count, "date") : "nothing planned"}</span>
        </div>
        <div className="hidden sm:block">
          <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            {WEEKDAYS.map((d) => (
              <span key={d}>{compact ? d.slice(0, 2) : d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {calendarWeeks(month)
              .flat()
              .map((day, i) => {
                if (!day) return <div key={`blank-${month}-${i}`} aria-hidden="true" />;
                const past = day < today;
                const weekend = i % 7 >= 5;
                return (
                  <Drop
                    key={day}
                    id={`day:${day}`}
                    disabled={!canEdit || past}
                    label={day}
                    testId={`plan-day-${day}`}
                    handlers={dayHandlers(day)}
                    over="border-esn bg-esn/10 ring-1 ring-esn"
                    className={cn(
                      "select-none space-y-0.5 rounded-lg border p-1 transition-colors",
                      compact ? "min-h-[4.5rem]" : "min-h-28",
                      past ? "border-transparent bg-gray-50" : weekend ? "border-gray-200 bg-gray-50/60" : "border-gray-200 bg-white",
                      active && !past && canEdit && "border-dashed border-esn/40",
                      menu?.day === day && "border-esn ring-1 ring-esn"
                    )}
                  >
                    <p className="flex">
                      <span
                        className={cn(
                          "inline-flex size-5 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums",
                          day === today ? "bg-esn text-white" : past ? "text-gray-300" : "text-gray-500"
                        )}
                      >
                        {Number(day.slice(8))}
                      </span>
                    </p>
                    {onDay(day).map(chip)}
                    {ghost(day)}
                  </Drop>
                );
              })}
          </div>
        </div>
        {/* Phones: the days with dates, plus drop targets while dragging (their own ids – a hidden twin of a grid day would take the drop). */}
        <ol className="space-y-1.5 sm:hidden">
          {calendarWeeks(month)
            .flat()
            .filter((d): d is string => !!d && (onDay(d).length > 0 || !!ghosts?.has(d) || (!!active && d >= today)))
            .map((day) => (
              <li key={day}>
                <Drop id={`mday:${day}`} disabled={!canEdit || day < today} handlers={dayHandlers(day)} over="border-esn bg-esn/10" className={cn("flex gap-3 rounded-lg border border-gray-200 p-2", day < today ? "bg-gray-50" : "bg-white")}>
                  <span className={cn("w-20 shrink-0 pt-0.5 text-xs font-medium tabular-nums", day === today ? "text-esn" : "text-gray-500")}>{dayLabel(day)}</span>
                  <div className="min-w-0 flex-1 space-y-1">
                    {onDay(day).map(chip)}
                    {ghost(day)}
                  </div>
                </Drop>
              </li>
            ))}
          {!visible.some((e) => e.start.slice(0, 7) === month.slice(0, 7)) && !active && !ghosts?.size && <li className="text-xs text-gray-400">Nothing planned.</li>}
        </ol>
      </section>
    );
  };

  const toolButton = (type: "repeat" | "defaults", icon: React.ReactNode, label: string) => (
    <button
      type="button"
      aria-pressed={panel?.type === type}
      onClick={() => setPanel(panel?.type === type ? null : { type })}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
        panel?.type === type ? "border-esn bg-esn text-white" : "border-gray-300 bg-white text-gray-700 hover:border-esn/40 hover:text-esn"
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <DndContext id="internal-planner" sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      {error && (
        <Alert tone="error" className="mb-4" role="alert">
          {error}
        </Alert>
      )}

      <div className="relative rounded-2xl border border-gray-200 bg-white shadow-sm">
        {/* Toolbar: sticks while the semester scrolls by (not on phones, where it would take a quarter of the screen). */}
        <div className="z-20 flex flex-col gap-2 rounded-t-2xl border-b border-gray-100 bg-white/95 px-4 py-3 backdrop-blur sm:sticky sm:top-0" data-testid="planner-toolbar">
          {canEdit && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-auto flex items-center gap-1.5 text-xs text-gray-500">
                <MousePointerClick className="size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  <span className="hidden sm:inline">Right-click or double-click a day to add a date</span>
                  <span className="sm:hidden">Double-tap a day to add a date</span>
                  <span className="hidden md:inline"> · drag a date to move it</span>
                </span>
              </span>
              <span className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu(menu?.day === null ? null : { day: null, x: r.left, y: r.bottom + 4 });
                  }}
                  aria-expanded={menu?.day === null}
                  className="inline-flex items-center gap-1.5 rounded-md border border-esn bg-esn px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-esn-dark"
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  Add date
                </button>
                {toolButton("repeat", <Repeat2 className="size-3.5" aria-hidden="true" />, "Repeat dates")}
                {toolButton("defaults", <Settings2 className="size-3.5" aria-hidden="true" />, "Defaults")}
              </span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show kinds">
            <span className="mr-1 flex items-center gap-1 text-xs font-medium text-gray-500">
              <Eye className="size-3.5" aria-hidden="true" />
              Show
            </span>
            {INTERNAL_KINDS.map((k) => {
              const on = shown.has(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  aria-label={`Show ${INTERNAL_KIND_LABELS[k]}`}
                  onClick={() => toggleKind(k)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    on ? "border-gray-200 bg-white text-gray-700 hover:bg-gray-50" : "border-dashed border-gray-300 bg-transparent text-gray-400 hover:text-gray-600"
                  )}
                >
                  <span className={cn("size-2 rounded-full", on ? INTERNAL_KIND_DOTS[k] : "bg-gray-300")} aria-hidden="true" />
                  {SHORT[k]}
                </button>
              );
            })}
            <span className="ml-auto hidden items-center gap-3 text-[11px] text-gray-500 md:flex">
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-red-500" /> no OC
              </span>
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-amber-500" /> helpers missing
              </span>
            </span>
          </div>
        </div>
        <div className={cn("grid grid-cols-1 gap-x-8 gap-y-8 p-4", compact && "lg:grid-cols-2")} data-testid="planner-calendar">
          {months.map(monthGrid)}
        </div>
        {canEdit && (
          <p className="border-t border-gray-100 px-4 py-3 text-xs text-gray-500">
            Right-click or double-click a day (double-tap on a phone) to add a date at its kind&apos;s default time; drag a date to another day to move it; click it to edit it.
          </p>
        )}
      </div>

      {menu && <AddMenu key={`${menu.day}-${menu.x}-${menu.y}`} at={menu} kinds={kinds} today={today} onPick={add} onClose={closeMenu} />}
      {current && <Editor key={`${current.id}-${current.start}-${current.cancelled}`} ev={current} canEdit={canEdit} onClose={close} rosterHref={rosterHref} />}
      {canEdit && panel?.type === "repeat" && <RepeatPanel key={period.label} kinds={kinds} events={events} period={period} onPreview={setPreview} onClose={close} />}
      {canEdit && panel?.type === "defaults" && <DefaultsPanel kinds={kinds} onClose={close} />}

      <DragOverlay>
        {active && <Badge tone="blue">{active.event.title}</Badge>}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * The kinds to add on a day, each at its default time – where the day was
 * right-clicked, double-clicked or double-tapped; with a date field from
 * "+ Add date". Arrow keys move, Esc or a click elsewhere closes it.
 */
function AddMenu({ at, kinds, today, onPick, onClose }: { at: AddAt; kinds: KindSetting[]; today: string; onPick: (kind: InternalKind, day: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [day, setDay] = useState(at.day ?? today);
  // Inside the window, where the pointer was.
  const [pos] = useState(() => ({ left: Math.max(8, Math.min(at.x, window.innerWidth - 248)), top: Math.max(8, Math.min(at.y, window.innerHeight - (at.day ? 290 : 340))) }));

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(at.day ? "[role=menuitem]" : "input")?.focus();
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", away);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
    };
  }, [at.day, onClose]);

  function move(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Add a date on ${dayLabel(day)}`}
      onKeyDown={move}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[60] w-60 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl ring-1 ring-black/5"
      style={pos}
      data-testid="add-menu"
    >
      {at.day ? (
        <p className="px-2 pb-1.5 pt-1 text-xs font-semibold text-gray-500">Add on {dayLabel(day)}</p>
      ) : (
        <label className="block px-2 pb-2 pt-1 text-xs font-semibold text-gray-500">
          Add on
          <Input type="date" min={today} value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="mt-1 h-8 py-1" />
        </label>
      )}
      {kinds.map((k) => (
        <button
          key={k.kind}
          type="button"
          role="menuitem"
          disabled={day < today}
          onClick={() => onPick(k.kind, day)}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-gray-800 hover:bg-gray-100 focus:bg-esn/10 focus:outline-none disabled:opacity-40"
        >
          <span className={cn("size-2.5 shrink-0 rounded-full", INTERNAL_KIND_DOTS[k.kind])} aria-hidden="true" />
          <span className="flex-1">{SHORT[k.kind]}</span>
          <span className="text-xs tabular-nums text-gray-400">{k.start}</span>
        </button>
      ))}
    </div>
  );
}

/** One date, in the side panel: details, who is on it, cancel or restore, delete (also the rest of its series). */
function Editor({ ev, canEdit, onClose, rosterHref }: { ev: PlannerEvent; canEdit: boolean; onClose: () => void; rosterHref: string }) {
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
  const oc = ev.people.find((p) => p.role === "oc");
  const helpers = ev.people.filter((p) => p.role === "helper");
  const staffing = isStaffed(ev.kind) && !ev.cancelled ? staffingOf(ev) : null;
  return (
    <SidePanel
      label={`${ev.title} on ${dayLabel(ev.start.slice(0, 10))}`}
      testId="planner-editor"
      onClose={onClose}
      icon={<span className={cn("mt-1 size-3 shrink-0 rounded-full", INTERNAL_KIND_DOTS[ev.kind])} aria-hidden="true" />}
      eyebrow={INTERNAL_KIND_LABELS[ev.kind]}
      title={ev.title}
      meta={
        <p className="flex flex-wrap items-center gap-2">
          <CalendarDays className="size-4 text-gray-400" aria-hidden="true" />
          <span className="tabular-nums">
            {dayLabel(ev.start.slice(0, 10))} · {ev.start.slice(11)}
            {ev.end && ev.end.slice(0, 10) === ev.start.slice(0, 10) ? `–${ev.end.slice(11)}` : ""}
          </span>
          {ev.cancelled && <Badge tone="red">Cancelled</Badge>}
          {ev.past && !ev.cancelled && <Badge>Past</Badge>}
        </p>
      }
      footer={
        canEdit && (
          <>
            <Button type="submit" form={`ie-form-${ev.id}`} size="sm" disabled={pending}>
              Save
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(updateInternalEvent, { id: ev.id, status: ev.cancelled ? "scheduled" : "cancelled" })}>
              {ev.cancelled ? "Restore" : "Cancel date"}
            </Button>
            <span className="ml-auto flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="text-red-600 hover:bg-red-50 hover:text-red-700"
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
                  variant="ghost"
                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
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
            </span>
          </>
        )
      }
    >
      {staffing && (
        <div className="rounded-xl border border-gray-200 p-3 text-sm">
          <p className="mb-2 flex items-center gap-2 font-medium text-gray-900">
            <span className={cn("size-2 rounded-full", STAFFING_DOT[staffing])} aria-hidden="true" />
            {STAFFING_TEXT[staffing]}
          </p>
          <dl className="grid grid-cols-[5rem_1fr] gap-y-1 text-gray-600">
            <dt className="text-gray-500">OC</dt>
            <dd>{oc ? oc.name : <span className="text-red-600">nobody yet</span>}</dd>
            <dt className="text-gray-500">
              Helpers {helpers.length}/{ev.helpersNeeded}
            </dt>
            <dd>{helpers.length ? helpers.map((h) => h.name).join(", ") : <span className={ev.helpersNeeded ? "text-amber-700" : ""}>none yet</span>}</dd>
          </dl>
          {!ev.past && (
            <Link href={`${rosterHref}#roster-${ev.id}`} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-esn hover:underline">
              Assign in the duty roster <ArrowRight className="size-3" aria-hidden="true" />
            </Link>
          )}
        </div>
      )}

      <form
        id={`ie-form-${ev.id}`}
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            updateInternalEvent,
            {
              id: ev.id,
              title: f.title,
              starts_at: f.start,
              ends_at: f.end || null,
              location: f.location,
              note: f.note,
              ...(hasPresentation(ev.kind) ? { presentation_url: f.presentation_url } : {}),
              ...(takesSignUps(ev.kind) ? { capacity: f.capacity ? Number(f.capacity) : null } : {}),
              ...(isStaffed(ev.kind) ? { helpers_needed: Number(f.helpers) } : {}),
            },
            undefined,
            "Saved."
          );
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
        {(takesSignUps(ev.kind) || isStaffed(ev.kind)) && (
          <div className="grid grid-cols-2 gap-2">
            {takesSignUps(ev.kind) && (
              <Field label="Places" htmlFor="ie-cap" hint="Empty: no limit">
                <Input id="ie-cap" type="number" min={1} value={f.capacity} onChange={set("capacity")} disabled={disabled} />
              </Field>
            )}
            {isStaffed(ev.kind) && (
              <Field label="Helpers needed" htmlFor="ie-helpers">
                <Input id="ie-helpers" type="number" min={0} max={20} value={f.helpers} onChange={set("helpers")} disabled={disabled} />
              </Field>
            )}
          </div>
        )}
        <Field label="Note (optional)" htmlFor="ie-note">
          <Textarea id="ie-note" rows={3} value={f.note} onChange={set("note")} disabled={disabled} maxLength={2000} />
        </Field>
      </form>

      {takesSignUps(ev.kind) && (
        <div className="text-sm">
          <p className="mb-1 flex items-center gap-1.5 font-medium text-gray-900">
            <Users className="size-4 text-gray-400" aria-hidden="true" />
            Signed up ({attendees.length}
            {ev.capacity ? ` of ${ev.capacity}` : ""})
          </p>
          <p className="text-gray-600">{attendees.length ? attendees.map((a) => a.name).join(", ") : "Nobody yet."}</p>
        </div>
      )}

      <Link href={internalPath(ev.kind, ev.id)} className="inline-flex items-center gap-1 text-sm font-medium text-esn hover:underline">
        Open its page <ArrowRight className="size-3.5" aria-hidden="true" />
      </Link>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </SidePanel>
  );
}

/**
 * "Repeat dates", in the side panel: the same kind on a weekday across the
 * period – every week, or selected weeks of each month. The dates it would add
 * show dashed on the calendar beside it.
 */
function RepeatPanel({
  kinds,
  events,
  period,
  onPreview,
  onClose,
}: {
  kinds: KindSetting[];
  events: PlannerEvent[];
  period: { label: string; from: string; to: string };
  onPreview: (p: Preview | null) => void;
  onClose: () => void;
}) {
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

  // The calendar draws what would be added; nothing once the panel closes.
  const pickedKey = picked.join(",");
  useEffect(() => {
    onPreview({ kind, days: pickedKey ? pickedKey.split(",") : [], start: f.start });
  }, [kind, pickedKey, f.start, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);

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
    <SidePanel
      label="Repeat dates"
      testId="repeat"
      onClose={onClose}
      icon={<Repeat2 className="mt-1 size-5 shrink-0 text-esn" aria-hidden="true" />}
      eyebrow={`Repeat over ${period.label}`}
      title="Repeat dates"
      meta="The same kind on a weekday – every week, or chosen weeks of each month."
      footer={
        <>
          <Button type="submit" form="repeat-form" disabled={pending || !picked.length || !f.title.trim()}>
            Add {plural(picked.length, "date")}
          </Button>
          {done && <span className="text-sm text-emerald-700">{done}</span>}
        </>
      }
    >
      <form
        id="repeat-form"
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
        <div className="grid grid-cols-2 gap-2">
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
        <div className="grid grid-cols-3 gap-2">
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
          <div className="flex flex-wrap gap-1.5 text-sm">
            {OCCURRENCES.map((o) => (
              <label key={String(o)} className={cn("flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5", which.includes(o) ? "border-esn/40 bg-esn/5 text-esn-dark" : "border-gray-200 text-gray-600")}>
                <input type="checkbox" checked={which.includes(o)} onChange={() => toggleOccurrence(o)} />
                {OCCURRENCE_LABELS[String(o)]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-2">
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
          <div className="flex flex-wrap gap-1.5" data-testid="repeat-dates">
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
          {!!picked.length && <p className="mt-2 text-xs text-gray-500">Dashed on the calendar: the dates this adds.</p>}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </SidePanel>
  );
}

/** The defaults per kind, in the side panel: title, time, length, helpers and the fixed text (office hours). */
function DefaultsPanel({ kinds, onClose }: { kinds: KindSetting[]; onClose: () => void }) {
  const [kind, setKind] = useState<InternalKind>("office_hour");
  const k = kinds.find((x) => x.kind === kind)!;
  return (
    <SidePanel
      label="Defaults per kind"
      testId="kind-settings"
      onClose={onClose}
      icon={<Settings2 className="mt-1 size-5 shrink-0 text-esn" aria-hidden="true" />}
      title="Defaults per kind"
      meta="What a new date of each kind starts with, dragged in or repeated."
    >
      <Field label="Kind" htmlFor="ks-kind">
        <Select id="ks-kind" value={kind} onChange={(e) => setKind(e.target.value as InternalKind)}>
          {INTERNAL_KINDS.map((x) => (
            <option key={x} value={x}>
              {INTERNAL_KIND_LABELS[x]}
            </option>
          ))}
        </Select>
      </Field>
      <SettingsForm key={kind} k={k} />
    </SidePanel>
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
      className="space-y-3 border-t border-gray-100 pt-4"
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
        <Textarea id="ks-description" rows={5} value={f.description} onChange={set("description")} maxLength={4000} />
      </Field>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          Save defaults
        </Button>
        {saved && <span className="text-sm text-emerald-700">Saved ✓</span>}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}
