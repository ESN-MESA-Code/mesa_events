"use client";

// The month's roster (redesign 2026-11-08): the volunteers on the left, the
// events as cards on the right. Every card has the same build – date tile,
// title, staffing meter, one row per OC and helper slot (open ones say so),
// the others who asked for it folded at the foot – and every volunteer row
// the same shape. Two ways to change it:
//   - drag and drop: a volunteer or an assigned person onto a slot, back to
//     the list to remove (as before);
//   - clicks, for whoever drag and drop does not suit (touch screens,
//     keyboards, a trackpad): pick a volunteer, then "+ OC" / "+ Helper" on
//     an event; or "+ Add" on an open slot and pick from the people who asked
//     for it first; "Move" and "Remove" on everyone assigned.
// A confirmed roster's changes still wait 10 s for Undo (usability review #20).
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { AlertTriangle, ArrowRightLeft, Ban, Check, ChevronDown, GripVertical, Hand, Lightbulb, Plus, Search, UserPlus, X } from "lucide-react";
import { Alert, Badge, Button, Select } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { DateTile } from "@/components/DateTile";
import { assign, moveAssignment, unassign } from "@/app/actions/planning";
import { setNonCrucial } from "@/app/actions/reliability";
import { blacklistAllows } from "@/lib/reliability";
import { EVENT_STATUS_LABELS, EVENT_STATUS_TONES, type EventStatus } from "@/lib/labels";
import { staffingStatus } from "@/lib/allocation";
import { berlinDate } from "@/lib/dates";
import { rosterLoad, HEAVY_LOAD } from "@/lib/rosterLoad";
import { searchFold } from "@/lib/description/search";
import { cn } from "@/lib/utils";
import { plural } from "@/lib/plural";
import { RANK_LABELS } from "@/lib/volunteer";

export interface BoardPerson {
  id: string;
  name: string;
  email: string;
  wishes: Record<string, { oc: number | null; helper: number | null }>;
  /** From the volunteer form: at most this many events; null = no limit. */
  maxEvents?: number | null;
  /** On the blacklist (2026-11-07): the reason; null/absent = not on it. */
  blacklisted?: string | null;
}

export interface BoardEvent {
  id: string;
  title: string;
  /** ISO start, for the order. */
  startsAt: string;
  when: string;
  helpersNeeded: number;
  /** How many OCs (round 2026-11-04: an event can have several). */
  ocsNeeded: number;
  status: EventStatus;
  /** The Events team's call: people on the blacklist may help on it. */
  nonCrucial: boolean;
  assignments: Array<{ id: string; profileId: string; role: "oc" | "helper"; source: string }>;
}

type Role = "oc" | "helper";
type Assignment = BoardEvent["assignments"][number];
type DragData = { kind: "assignment"; assignmentId: string } | { kind: "person"; profileId: string };

const STAFFING = {
  staffed: { label: "Staffed", tone: "green" },
  understaffed: { label: "Short of helpers", tone: "amber" },
  no_oc: { label: "No OC", tone: "amber" },
  dropped: { label: "Nobody – will be dropped", tone: "red" },
} as const;

const ROLE_LABEL: Record<Role, string> = { oc: "OC", helper: "Helper" };

/** How long a change on a confirmed roster waits for Undo before it is saved and announced (usability review #20). */
const UNDO_MS = 10_000;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

function Avatar({ name, tone = "default" }: { name: string; tone?: "default" | "free" | "red" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
        tone === "free" ? "bg-amber-100 text-amber-900" : tone === "red" ? "bg-red-100 text-red-700" : "bg-esn/10 text-esn"
      )}
    >
      {initials(name)}
    </span>
  );
}

/** Keeps Space and Enter on a button inside a draggable row from starting anything else. */
const own = (e: React.KeyboardEvent) => e.stopPropagation();

/** A draggable row (pointer only – the keyboard uses the buttons). */
function DragRow({ id, data, disabled, className, children, testId }: { id: string; data: DragData; disabled: boolean; className?: string; children: React.ReactNode; testId?: string }) {
  const { listeners, setNodeRef, transform, isDragging } = useDraggable({ id, data, disabled });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn("group/row relative touch-pan-y", !disabled && "cursor-grab active:cursor-grabbing", isDragging && "z-20 opacity-80 shadow-lg ring-2 ring-esn-accent", className)}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

/** A drop target (a role's slots, or the volunteer list). */
function Drop({ id, label, disabled, className, children }: { id: string; label: string; disabled: boolean; className?: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });
  return (
    <div ref={setNodeRef} aria-label={label} role="group" className={cn("rounded-xl transition-colors", isOver && "bg-esn/5 ring-2 ring-esn/40", className)}>
      {children}
    </div>
  );
}

export function RosterBoard({
  events,
  people,
  editable,
  confirmed,
  canMarkCrucial = false,
}: {
  events: BoardEvent[];
  people: BoardPerson[];
  editable: boolean;
  confirmed: boolean;
  /** The Events team marks events non-crucial (also before the allocation). */
  canMarkCrucial?: boolean;
}) {
  const cycleParam = useParams<{ id: string }>().id;
  const { run, error, setError, toast } = useAction();
  const [query, setQuery] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(false);
  // The volunteer picked to place by clicks (instead of dragging).
  const [selected, setSelected] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(0);
  const waitingRef = useRef(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const sorted = useMemo(() => [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt)), [events]);
  // Who carries a lot, and who is on two events the same day (usability review #20).
  const load = rosterLoad(events.map((e) => ({ id: e.id, day: berlinDate(e.startsAt), profileIds: e.assignments.map((a) => a.profileId) })));
  const countOf = (id: string) => load.get(id)?.count ?? 0;
  const titleOf = new Map(events.map((e) => [e.id, e.title]));
  const dayOf = new Map(events.map((e) => [e.id, berlinDate(e.startsAt)]));
  const picked = selected ? byId.get(selected) ?? null : null;

  // Leaving with a change still waiting would lose it.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (waitingRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  // Escape ends picking.
  useEffect(() => {
    if (!selected) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [selected]);

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

  /** Why `person` cannot take `role` on `ev` (blacklist), or null. */
  const refusal = (person: BoardPerson | undefined, ev: BoardEvent, role: Role) =>
    person?.blacklisted && !blacklistAllows(role, ev.nonCrucial) ? `${person.name} is on the blacklist: only as a helper on an event marked non-crucial.` : null;

  function add(profileId: string, ev: BoardEvent, role: Role) {
    const person = byId.get(profileId);
    const no = refusal(person, ev, role);
    if (no) return setError(no);
    setError(null);
    save(`${person?.name ?? "Someone"} added to ${ev.title} (${ROLE_LABEL[role]})`, () => run(assign, { event_id: ev.id, profile_id: profileId, role }));
  }
  function move(a: Assignment, from: BoardEvent, to: BoardEvent, role: Role) {
    const person = byId.get(a.profileId);
    const no = refusal(person, to, role);
    if (no) return setError(no);
    setError(null);
    if (to.id === from.id && role === a.role) return;
    save(`${person?.name ?? "Someone"} moved to ${to.title} (${ROLE_LABEL[role]})`, () => run(moveAssignment, { assignment_id: a.id, event_id: to.id, role }));
  }
  function remove(a: Assignment, from: BoardEvent) {
    setError(null);
    save(`${byId.get(a.profileId)?.name ?? "Someone"} removed from ${from.title}`, () => run(unassign, { assignment_id: a.id }));
  }

  function onDragEnd(e: DragEndEvent) {
    const data = e.active.data.current as DragData | undefined;
    const target = e.over?.id ? String(e.over.id) : null;
    if (!data || !target) return;
    const found = data.kind === "assignment" ? events.flatMap((ev) => ev.assignments.map((a) => ({ a, ev }))).find((x) => x.a.id === data.assignmentId) : null;
    if (target === "pool") {
      if (found) remove(found.a, found.ev);
      return;
    }
    const [eventId, role] = target.split(":") as [string, Role];
    const ev = events.find((x) => x.id === eventId);
    if (!ev) return;
    if (found) move(found.a, found.ev, ev, role);
    else if (data.kind === "person") add(data.profileId, ev, role);
  }

  const wishText = (p: BoardPerson, eventId: string) => {
    const w = p.wishes[eventId];
    if (!w) return null;
    return [w.oc && `OC: ${RANK_LABELS[w.oc]}`, w.helper && `Helper: ${RANK_LABELS[w.helper]}`].filter(Boolean).join(" · ");
  };

  // The volunteer list: those without an event first (they fill the gaps, review 2026-11-03 #15).
  const words = searchFold(query, true).split(" ").filter(Boolean);
  const matches = (p: BoardPerson) => !words.length || words.every((w) => searchFold(p.name, true).includes(w));
  const free = people.filter((p) => countOf(p.id) === 0);
  const freeShown = free.filter(matches);
  const busyShown = people.filter((p) => countOf(p.id) > 0 && matches(p));

  const need = (ev: BoardEvent) => {
    const oc = ev.assignments.filter((a) => a.role === "oc").length;
    const helpers = ev.assignments.filter((a) => a.role === "helper").length;
    return { oc, helpers, openOc: Math.max(0, ev.ocsNeeded - oc), openHelpers: Math.max(0, ev.helpersNeeded - helpers) };
  };
  const open = sorted.filter((ev) => {
    const n = need(ev);
    return n.openOc + n.openHelpers > 0;
  });
  const shownEvents = onlyOpen ? open : sorted;
  const board: BoardState = { cycleParam, people, events, sorted, byId, load, countOf, titleOf, dayOf, picked, selected, setSelected, editable, canMarkCrucial, run, add, move, remove, refusal, wishText, need };

  return (
    <BoardContext.Provider value={board}>
    <DndContext id="roster-board" sensors={sensors} onDragEnd={onDragEnd} onDragStart={() => setError(null)}>
      <div className="mb-4 space-y-2 empty:hidden">
        {error && <Alert tone="error" className="rounded-xl px-4 py-3">{error}</Alert>}
        {waiting > 0 && (
          <Alert tone="info" className="rounded-xl px-4 py-3" data-testid="roster-waiting">
            {waiting === 1 ? "1 change waits" : `${waiting} changes wait`} for Undo – the board updates once {waiting === 1 ? "it is" : "they are"} saved.
          </Alert>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        {/* ── Volunteers ─────────────────────────────────────────── */}
        <aside className="flex h-fit flex-col rounded-2xl border border-gray-200 bg-white shadow-sm lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]">
          <div className="space-y-2 border-b border-gray-100 p-4">
            <h2 className="flex items-center gap-2 text-base font-bold text-gray-900">
              Volunteers
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gray-100 px-1.5 text-xs font-bold tabular-nums text-gray-700">{people.length}</span>
            </h2>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
              <input
                aria-label="Filter volunteers"
                placeholder="Find a volunteer"
                className="w-full rounded-lg border border-gray-200 py-1.5 pl-8 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-esn-accent"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {editable && <p className="text-xs text-gray-500">Drag a name onto a slot – or click it, then pick the slot.</p>}
          </div>
          <Drop id="pool" label="Volunteers" disabled={!editable} className="max-h-72 min-h-24 flex-1 overflow-y-auto rounded-t-none p-2 lg:max-h-none">
            {freeShown.length > 0 && (
              <p className="px-2 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wider text-amber-800" data-testid="pool-free">
                Not assigned yet ({free.length})
              </p>
            )}
            <ul className="space-y-1">
              {freeShown.map((p) => (
                <VolunteerRow key={p.id} p={p} count={0} />
              ))}
            </ul>
            {busyShown.length > 0 && <p className="px-2 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-gray-500">Assigned</p>}
            <ul className="space-y-1">
              {busyShown.map((p) => (
                <VolunteerRow key={p.id} p={p} count={countOf(p.id)} />
              ))}
            </ul>
            {!freeShown.length && !busyShown.length && <p className="px-2 py-6 text-center text-sm text-gray-500">{people.length ? "Nobody matches." : "Nobody answered the form."}</p>}
          </Drop>
        </aside>

        {/* ── Events ─────────────────────────────────────────────── */}
        <div className="min-w-0 space-y-3">
          {picked && editable && (
            <div className="sticky top-2 z-30 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-esn bg-esn px-4 py-3 text-white shadow-lg" role="status" data-testid="picking">
              <Hand className="h-5 w-5 shrink-0" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-sm">
                <strong>Placing {picked.name}</strong> – click a slot on an event.{" "}
                <span className="opacity-80">
                  {Object.keys(picked.wishes).length ? `Asked for ${plural(Object.keys(picked.wishes).length, "event")} (highlighted).` : "Did not answer the form."} {countOf(picked.id) ? `On ${plural(countOf(picked.id), "event")} already.` : ""}
                </span>
              </p>
              <button type="button" onClick={() => setSelected(null)} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25">
                Done
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1 shadow-sm" role="group" aria-label="Show events">
              {[
                { on: false, label: `All events`, n: sorted.length },
                { on: true, label: "Needs people", n: open.length },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  aria-pressed={onlyOpen === o.on}
                  onClick={() => setOnlyOpen(o.on)}
                  className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold", onlyOpen === o.on ? "bg-esn text-white" : "text-gray-600 hover:bg-gray-50")}
                >
                  {o.label}
                  <span className={cn("rounded-full px-1.5 text-xs tabular-nums", onlyOpen === o.on ? "bg-white/20" : o.on && o.n ? "bg-amber-100 text-amber-900" : "bg-gray-100")}>{o.n}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" data-testid="roster-board">
            {shownEvents.map((ev) => (
              <EventCard key={ev.id} ev={ev} />
            ))}
            {!shownEvents.length && <p className="col-span-full rounded-2xl border border-dashed border-gray-300 py-10 text-center text-sm text-gray-500">Every event has its people.</p>}
          </div>
        </div>
      </div>
    </DndContext>
    </BoardContext.Provider>
  );
}

// ── Pieces (they read the board's state from its context) ───────────────────

interface BoardState {
  cycleParam: string;
  people: BoardPerson[];
  events: BoardEvent[];
  sorted: BoardEvent[];
  byId: Map<string, BoardPerson>;
  load: ReturnType<typeof rosterLoad>;
  countOf: (id: string) => number;
  titleOf: Map<string, string>;
  dayOf: Map<string, string>;
  /** The volunteer being placed by clicks. */
  picked: BoardPerson | null;
  selected: string | null;
  setSelected: (id: string | null) => void;
  editable: boolean;
  canMarkCrucial: boolean;
  run: ReturnType<typeof useAction>["run"];
  add: (profileId: string, ev: BoardEvent, role: Role) => void;
  move: (a: Assignment, from: BoardEvent, to: BoardEvent, role: Role) => void;
  remove: (a: Assignment, from: BoardEvent) => void;
  refusal: (person: BoardPerson | undefined, ev: BoardEvent, role: Role) => string | null;
  wishText: (p: BoardPerson, eventId: string) => string | null;
  need: (ev: BoardEvent) => { oc: number; helpers: number; openOc: number; openHelpers: number };
}

const BoardContext = createContext<BoardState | null>(null);
const useBoard = () => useContext(BoardContext)!;

function VolunteerRow({ p, count }: { p: BoardPerson; count: number }) {
  const { load, dayOf, selected, setSelected, editable } = useBoard();
  const wishes = Object.keys(p.wishes).length;
  const over = (p.maxEvents && count > p.maxEvents) || count >= HEAVY_LOAD;
  const clashDays = [...new Set([...(load.get(p.id)?.sameDay.keys() ?? [])].map((id) => dayOf.get(id)))].length;
  const isPicked = selected === p.id;
  return (
    <li>
      <DragRow id={`person:${p.id}`} data={{ kind: "person", profileId: p.id }} disabled={!editable}>
        <button
          type="button"
          disabled={!editable}
          aria-pressed={isPicked}
          onKeyDown={own}
          onClick={() => setSelected(isPicked ? null : p.id)}
          title={editable ? (isPicked ? "Stop placing" : `Place ${p.name} by clicking a slot`) : undefined}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors disabled:cursor-default",
            isPicked ? "border-esn bg-esn/[0.07] ring-1 ring-esn" : "border-transparent hover:border-gray-200 hover:bg-gray-50"
          )}
        >
          <Avatar name={p.name} tone={p.blacklisted ? "red" : count === 0 ? "free" : "default"} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-gray-900">{p.name}</span>
            <span className="flex items-center gap-1.5 truncate text-xs text-gray-500">
              {p.blacklisted ? (
                <span className="inline-flex items-center gap-0.5 font-medium text-red-700" title={`On the blacklist: ${p.blacklisted}`} data-testid="blacklisted">
                  <Ban className="h-3 w-3" aria-hidden="true" />
                  Blacklisted
                </span>
              ) : (
                <span>{wishes ? plural(wishes, "wish", "wishes") : "no answers"}</span>
              )}
              {p.maxEvents ? <span>· max {p.maxEvents}</span> : null}
            </span>
          </span>
          {clashDays > 0 && (
            <span title={`Two events on the same day (${clashDays})`} className="text-red-600">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">two events on one day</span>
            </span>
          )}
          <span
            title={`${plural(count, "event")} assigned${over ? (p.maxEvents && count > p.maxEvents ? " – more than they can do" : " – a lot") : ""}`}
            className={cn("inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums", over ? "bg-amber-100 text-amber-900" : count ? "bg-gray-100 text-gray-700" : "bg-amber-50 text-amber-800")}
          >
            {count}
            <span className="sr-only"> assigned</span>
          </span>
        </button>
      </DragRow>
    </li>
  );
}


function EventCard({ ev }: { ev: BoardEvent }) {
  const { cycleParam, people, countOf, picked, editable, canMarkCrucial, run, wishText, need } = useBoard();
  const n = need(ev);
  const staffing = STAFFING[staffingStatus(n.oc, ev.ocsNeeded, n.helpers, ev.helpersNeeded)];
  const shortOfOcs = n.oc > 0 && n.oc < ev.ocsNeeded;
  const wishers = people.filter((p) => p.wishes[ev.id] && !ev.assignments.some((a) => a.profileId === p.id));
  const pickedWish = picked ? wishText(picked, ev.id) : null;
  const pickedOn = picked ? ev.assignments.some((a) => a.profileId === picked.id) : false;
  const total = ev.ocsNeeded + ev.helpersNeeded;
  const filled = Math.min(n.oc, ev.ocsNeeded) + Math.min(n.helpers, ev.helpersNeeded);
  return (
    <article
      className={cn("flex flex-col rounded-2xl border bg-white shadow-sm transition-shadow", picked && pickedWish && !pickedOn ? "border-esn ring-2 ring-esn/30" : "border-gray-200")}
      data-testid={`roster-${ev.title}`}
    >
      <header className="flex gap-3 p-4 pb-3">
        <DateTile iso={ev.startsAt} tone={ev.status === "cancelled" ? "muted" : "default"} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium tabular-nums text-gray-600">{ev.when}</p>
          <a href={`/events/${ev.id}?from=cycle:${cycleParam}`} className="line-clamp-2 min-h-[2lh] font-semibold leading-snug text-gray-900 hover:text-esn" title={ev.title}>
            {ev.title}
          </a>
        </div>
      </header>

      <div className="space-y-1.5 px-4 pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={staffing.tone}>{shortOfOcs ? "Short of OCs" : staffing.label}</Badge>
          {ev.status !== "scheduled" && <Badge tone={EVENT_STATUS_TONES[ev.status]}>{EVENT_STATUS_LABELS[ev.status]}</Badge>}
          {ev.nonCrucial && !canMarkCrucial && <Badge tone="gray">Non-crucial</Badge>}
        </div>
        <div className="flex gap-0.5" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={cn("h-1.5 flex-1 rounded-full", i < filled ? "bg-emerald-500" : "bg-gray-200")} />
          ))}
        </div>
      </div>

      {picked && editable && (
        <div className="mx-4 mb-3 rounded-xl bg-esn/5 px-3 py-2 text-xs" data-testid="pick-here">
          {pickedOn ? (
            <p className="flex items-center gap-1.5 font-medium text-esn-dark">
              <Check className="h-4 w-4" aria-hidden="true" />
              {picked.name} is on this event
            </p>
          ) : (
            <p className="text-gray-600">{pickedWish ? <span className="font-semibold text-esn-dark">Asked for it – {pickedWish}</span> : `${picked.name} did not ask for this event`}</p>
          )}
        </div>
      )}

      <div className="space-y-3 px-4 pb-4">
        <RoleSlots ev={ev} role="oc" />
        <RoleSlots ev={ev} role="helper" />
      </div>

      {(wishers.length > 0 || canMarkCrucial) && (
        <footer className="mt-auto space-y-2 border-t border-gray-100 px-4 py-3 text-xs">
          {wishers.length > 0 && (
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-gray-600 hover:text-gray-900 [&::-webkit-details-marker]:hidden">
                <ChevronDown className="h-3.5 w-3.5 -rotate-90 transition-transform group-open:rotate-0" aria-hidden="true" />
                {plural(wishers.length, "more volunteer", "more volunteers")} asked for it
              </summary>
              <ul className="mt-2 space-y-1">
                {wishers.map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <Avatar name={p.name} tone={p.blacklisted ? "red" : countOf(p.id) === 0 ? "free" : "default"} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-gray-900">{p.name}</span>
                      <span className="block truncate text-gray-500">
                        {wishText(p, ev.id)} · {countOf(p.id) ? `on ${countOf(p.id)}` : "free"}
                      </span>
                    </span>
                    {editable && <QuickAdd person={p} ev={ev} />}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {canMarkCrucial && (
            <label className="flex cursor-pointer items-center gap-2 text-gray-600" title="The event also runs if a helper does not show up: people on the blacklist may help on it.">
              <input type="checkbox" className="accent-esn" checked={ev.nonCrucial} onChange={(e) => run(setNonCrucial, { event_id: ev.id, non_crucial: e.target.checked })} data-testid={`non-crucial-${ev.title}`} />
              Non-crucial – blacklisted people may help
            </label>
          )}
        </footer>
      )}
    </article>
  );
}


/** "+ OC" / "+ Helper" for someone who asked for the event, as they asked. */

function QuickAdd({ person, ev }: { person: BoardPerson; ev: BoardEvent }) {
  const { add, refusal } = useBoard();
  const w = person.wishes[ev.id];
  const roles = (["oc", "helper"] as Role[]).filter((r) => (r === "oc" ? w?.oc : w?.helper));
  return (
    <span className="flex shrink-0 gap-1">
      {roles.map((role) => {
        const no = refusal(person, ev, role);
        return (
          <button
            key={role}
            type="button"
            disabled={!!no}
            title={no ?? `Add ${person.name} as ${ROLE_LABEL[role]}`}
            onClick={() => add(person.id, ev, role)}
            className="inline-flex items-center gap-0.5 rounded-md border border-gray-200 px-1.5 py-0.5 font-semibold text-esn hover:border-esn disabled:cursor-not-allowed disabled:text-gray-400"
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
            {ROLE_LABEL[role]}
            <span className="sr-only">: {person.name}</span>
          </button>
        );
      })}
    </span>
  );
}


/** A role's slots: the people on it, then one row per open slot. */

function RoleSlots({ ev, role }: { ev: BoardEvent; role: Role }) {
  const { picked, editable, add, refusal } = useBoard();
  const mine = ev.assignments.filter((a) => a.role === role);
  const needed = role === "oc" ? ev.ocsNeeded : ev.helpersNeeded;
  const openSlots = Math.max(0, needed - mine.length);
  const [adding, setAdding] = useState(false);
  const onIt = !!picked && ev.assignments.some((a) => a.profileId === picked.id);
  if (!needed && !mine.length) return null;
  return (
    <section>
      <h3 className="mb-1 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-gray-500">
        <span>{role === "oc" ? (ev.ocsNeeded > 1 ? "OCs" : "OC") : "Helpers"}</span>
        <span className={cn("tabular-nums", mine.length < needed ? "text-amber-700" : "text-emerald-700")}>
          {mine.length}/{needed}
        </span>
      </h3>
      <Drop id={`${ev.id}:${role}`} label={`${ev.title} ${role === "oc" ? "OC" : "helpers"}`} disabled={!editable} className="space-y-1">
        {mine.map((a) => (
          <AssignedRow key={a.id} a={a} ev={ev} />
        ))}
        {Array.from({ length: openSlots }, (_, i) =>
          editable && i === 0 && !onIt ? (
            <SlotButton key={i} label={picked ? `Add ${picked.name} here` : `Open ${role === "oc" ? "OC" : "helper"} slot – add someone`} refused={picked ? refusal(picked, ev, role) : null} onClick={() => (picked ? add(picked.id, ev, role) : setAdding(!adding))} expanded={picked ? undefined : adding} event={ev.title} />
          ) : (
            <div key={i} className="flex items-center gap-2 rounded-xl border border-dashed border-gray-200 px-2.5 py-1.5 text-sm text-gray-400">
              <span className="h-7 w-7 rounded-full bg-gray-50" aria-hidden="true" />
              Open slot
            </div>
          )
        )}
        {editable && !openSlots && picked && !onIt && (
          <SlotButton label={`Add ${picked.name} as an extra ${role === "oc" ? "OC" : "helper"}`} refused={refusal(picked, ev, role)} onClick={() => add(picked.id, ev, role)} event={ev.title} />
        )}
        {editable && !openSlots && !picked && (
          <button type="button" onClick={() => setAdding(!adding)} className="flex items-center gap-1 px-1 text-xs font-medium text-gray-500 hover:text-esn" aria-expanded={adding}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add one more {role === "oc" ? "OC" : "helper"}
            <span className="sr-only"> to {ev.title}</span>
          </button>
        )}
      </Drop>
      {adding && !picked && <AddPicker ev={ev} role={role} onClose={() => setAdding(false)} />}
    </section>
  );
}

/** The dashed "add someone" row of a slot; disabled with the reason when the blacklist rules it out. */
function SlotButton({ label, refused, onClick, expanded, event }: { label: string; refused: string | null; onClick: () => void; expanded?: boolean; event: string }) {
  return (
    <button
      type="button"
      disabled={!!refused}
      title={refused ?? undefined}
      onClick={onClick}
      aria-expanded={expanded}
      className="flex w-full items-center gap-2 rounded-xl border border-dashed border-gray-300 px-2.5 py-1.5 text-left text-sm text-gray-500 hover:border-esn hover:text-esn disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-gray-300 disabled:hover:text-gray-500"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-50" aria-hidden="true">
        {refused ? <Ban className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{refused ? "Not on this slot (blacklist)" : label}</span>
      <span className="sr-only"> – {event}</span>
    </button>
  );
}

/** The people to add to a slot: who asked for this role first (best rank first), then who is free, then the rest. */

function AddPicker({ ev, role, onClose }: { ev: BoardEvent; role: Role; onClose: () => void }) {
  const { people, events, countOf, dayOf, add, refusal } = useBoard();
  const [q, setQ] = useState("");
  const ws = searchFold(q, true).split(" ").filter(Boolean);
  const rankOf = (p: BoardPerson) => {
    const w = p.wishes[ev.id];
    const r = role === "oc" ? w?.oc : w?.helper;
    return r ?? (w ? 6 : 9);
  };
  const list = people
    .filter((p) => !ev.assignments.some((a) => a.profileId === p.id))
    .filter((p) => !ws.length || ws.every((w) => searchFold(p.name, true).includes(w)))
    .sort((a, b) => rankOf(a) - rankOf(b) || countOf(a.id) - countOf(b.id) || a.name.localeCompare(b.name));
  return (
    <div className="mt-2 rounded-xl border border-gray-200 bg-white p-2 shadow-md" data-testid="add-picker">
      <div className="mb-1.5 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input
            // The picker opens on a click: typing right away is what comes next.
            autoFocus
            aria-label={`Find someone to add as ${ROLE_LABEL[role]}`}
            placeholder="Find a volunteer"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            className="w-full rounded-lg border border-gray-200 py-1 pl-7 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-esn-accent"
          />
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
          <X className="h-4 w-4" />
        </button>
      </div>
      <ul className="max-h-56 space-y-0.5 overflow-y-auto">
        {list.map((p) => {
          const no = refusal(p, ev, role);
          const r = rankOf(p);
          const clash = events.some((o) => o.id !== ev.id && dayOf.get(o.id) === dayOf.get(ev.id) && o.assignments.some((a) => a.profileId === p.id));
          return (
            <li key={p.id}>
              <button
                type="button"
                disabled={!!no}
                title={no ?? undefined}
                onClick={() => {
                  add(p.id, ev, role);
                  onClose();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Avatar name={p.name} tone={p.blacklisted ? "red" : countOf(p.id) === 0 ? "free" : "default"} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900">{p.name}</span>
                  <span className="block truncate text-xs text-gray-500">
                    {r <= 5 ? `${ROLE_LABEL[role]}: ${RANK_LABELS[r]}` : r === 6 ? `asked as ${role === "oc" ? "helper" : "OC"}` : "did not ask"} · {countOf(p.id) ? `on ${countOf(p.id)}` : "free"}
                    {clash && " · same day as another of theirs"}
                  </span>
                </span>
                {r <= 5 && <span className="h-2 w-2 shrink-0 rounded-full bg-esn" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
        {!list.length && <li className="px-2 py-4 text-center text-xs text-gray-500">Nobody matches.</li>}
      </ul>
    </div>
  );
}


/** Someone on a slot: who, how they asked, warnings; Move and Remove. */

function AssignedRow({ a, ev }: { a: Assignment; ev: BoardEvent }) {
  const { events, sorted, byId, load, titleOf, editable, move, remove, refusal, wishText, need } = useBoard();
  const person = byId.get(a.profileId);
  const [moving, setMoving] = useState(false);
  const [target, setTarget] = useState("");
  if (!person) return null;
  const others = load.get(person.id)?.sameDay.get(ev.id) ?? [];
  const badRole = person.blacklisted && !blacklistAllows(a.role, ev.nonCrucial);
  const wish = wishText(person, ev.id);
  return (
    <div>
      <DragRow id={`a:${a.id}`} data={{ kind: "assignment", assignmentId: a.id }} disabled={!editable}>
        <div className={cn("flex items-center gap-2 rounded-xl border bg-white px-2.5 py-1.5", badRole || others.length ? "border-red-200 bg-red-50/40" : "border-gray-200")}>
          {editable && <GripVertical className="-ml-1 h-4 w-4 shrink-0 text-gray-300 group-hover/row:text-gray-400" aria-hidden="true" />}
          <Avatar name={person.name} tone={person.blacklisted ? "red" : "default"} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-gray-900">{person.name}</span>
              {a.source === "proposer" && (
                <span title="Brought the idea" className="text-fuchsia-600">
                  <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="sr-only">idea</span>
                </span>
              )}
              {person.blacklisted && (
                <span title={`On the blacklist: ${person.blacklisted}`} className="text-red-600" data-testid="blacklisted">
                  <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="sr-only">Blacklisted</span>
                </span>
              )}
            </span>
            <span className={cn("block truncate text-xs", badRole || others.length ? "font-medium text-red-700" : "text-gray-500")}>
              {badRole
                ? `On the blacklist – ${a.role === "oc" ? "should not be OC" : "event not marked non-crucial"}`
                : others.length
                  ? `Same day as ${others.map((id) => titleOf.get(id)).join(", ")}`
                  : wish ?? "Did not ask for it"}
            </span>
          </span>
          {editable && (
            <span className="flex shrink-0 items-center">
              <button
                type="button"
                onKeyDown={own}
                onClick={() => setMoving(!moving)}
                aria-expanded={moving}
                aria-label={`Move ${person.name}`}
                title="Move to another event or role"
                className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-esn"
              >
                <ArrowRightLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onKeyDown={own}
                onClick={() => remove(a, ev)}
                aria-label={`Remove ${person.name} from ${ev.title}`}
                title="Remove from this event"
                className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-700"
              >
                <X className="h-4 w-4" />
              </button>
            </span>
          )}
        </div>
      </DragRow>
      {moving && (
        <form
          className="mt-1 flex items-center gap-1.5 rounded-xl bg-gray-50 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            const [toId, role] = target.split(":") as [string, Role];
            const to = events.find((x) => x.id === toId);
            if (to) move(a, ev, to, role);
            setMoving(false);
          }}
        >
          <Select aria-label={`Move ${person.name} to`} value={target} onChange={(e) => setTarget(e.target.value)} className="h-8 min-w-0 flex-1 py-1 text-xs">
            <option value="">Move to…</option>
            <option value={`${ev.id}:${a.role === "oc" ? "helper" : "oc"}`}>This event, as {a.role === "oc" ? "helper" : "OC"}</option>
            {sorted
              .filter((o) => o.id !== ev.id)
              .flatMap((o) =>
                (["oc", "helper"] as Role[]).map((r) => {
                  const w = wishText(person, o.id);
                  const n = need(o);
                  const gap = r === "oc" ? n.openOc : n.openHelpers;
                  return (
                    <option key={`${o.id}:${r}`} value={`${o.id}:${r}`} disabled={!!refusal(person, o, r)}>
                      {o.title} – {ROLE_LABEL[r]}
                      {gap ? ` (${gap} open)` : ""}
                      {w ? " ★" : ""}
                    </option>
                  );
                })
              )}
          </Select>
          <Button size="sm" disabled={!target}>
            Move
          </Button>
          <Button size="sm" type="button" variant="ghost" onClick={() => setMoving(false)}>
            Cancel
          </Button>
        </form>
      )}
    </div>
  );
}
