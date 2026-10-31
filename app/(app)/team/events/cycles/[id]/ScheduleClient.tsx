"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Alert, Badge, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { ActionButton, useAction } from "@/components/ActionButton";
import { EVENT_STATUS_LABELS, EVENT_STATUS_TONES, EVENT_TYPE_LABELS, EVENT_TYPES, type EventStatus, type EventType } from "@/lib/labels";
import { acceptIdea, clearVolunteerResponse, createEvent, dropEvent, mergeIdea, moveIdea, rejectIdea, updateEvent } from "@/app/actions/planning";
import { plural } from "@/lib/plural";

interface RowEvent {
  id: string;
  title: string;
  type: EventType;
  startsAt: string;
  startsLabel: string;
  endsAt: string;
  location: string;
  helpersNeeded: number;
  status: EventStatus;
  proposer: string | null;
  signups: number;
}

export function ScheduleRow({ event, canEdit }: { event: RowEvent; canEdit: boolean }) {
  const cycleParam = useParams<{ id: string }>().id;
  const [editing, setEditing] = useState(false);
  const { run, pending, error } = useAction();
  const [v, setV] = useState(event);

  if (editing) {
    return (
      <li className="py-3">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              updateEvent,
              {
                id: event.id,
                title: v.title,
                type: v.type,
                starts_at: v.startsAt,
                ends_at: v.endsAt || null,
                location: v.location || null,
                helpers_needed: Number(v.helpersNeeded),
              },
              () => setEditing(false)
            );
          }}
        >
          <Field label="Title" htmlFor={`t-${event.id}`}>
            <Input id={`t-${event.id}`} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
          </Field>
          <Field label="Type" htmlFor={`ty-${event.id}`}>
            <Select id={`ty-${event.id}`} value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as EventType })}>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EVENT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Starts" htmlFor={`s-${event.id}`}>
            <Input id={`s-${event.id}`} type="datetime-local" value={v.startsAt} onChange={(e) => setV({ ...v, startsAt: e.target.value })} />
          </Field>
          <Field label="Ends (optional)" htmlFor={`e-${event.id}`}>
            <Input id={`e-${event.id}`} type="datetime-local" value={v.endsAt} onChange={(e) => setV({ ...v, endsAt: e.target.value })} />
          </Field>
          <Field label="Location name" htmlFor={`l-${event.id}`} hint="The full address is entered on the event page">
            <Input id={`l-${event.id}`} value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} />
          </Field>
          <Field label="Helpers needed" htmlFor={`h-${event.id}`}>
            <Input id={`h-${event.id}`} type="number" min={0} max={50} value={v.helpersNeeded} onChange={(e) => setV({ ...v, helpersNeeded: Number(e.target.value) })} />
          </Field>
          <div className="sm:col-span-2 flex gap-2">
            <Button disabled={pending}>Save</Button>
            <Button type="button" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            {error && <span className="text-xs text-red-600 self-center">{error}</span>}
          </div>
        </form>
      </li>
    );
  }

  // One grid for every row, so dates, titles and labels line up in columns.
  return (
    <li
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[10.5rem_minmax(0,1fr)_7.5rem_7.5rem_9rem_auto]"
      data-testid={`schedule-${event.title}`}
    >
      <span className="col-span-2 text-sm tabular-nums text-gray-600 sm:col-span-1">{event.startsLabel}</span>
      <a href={`/events/${event.id}?from=cycle:${cycleParam}`} className="min-w-0 truncate font-medium text-gray-900 hover:text-esn">
        {event.title}
      </a>
      <span className="hidden sm:block">
        <Badge>{EVENT_TYPE_LABELS[event.type]}</Badge>
      </span>
      <span className="justify-self-end sm:justify-self-start">
        <Badge tone={EVENT_STATUS_TONES[event.status]}>{EVENT_STATUS_LABELS[event.status]}</Badge>
      </span>
      <span className="col-span-2 text-xs text-gray-500 sm:col-span-1" title={event.proposer ? `idea by ${event.proposer}` : undefined}>
        {plural(event.helpersNeeded, "helper")} · {plural(event.signups, "sign-up")}
      </span>
      {canEdit ? (
        <span className="col-span-2 flex gap-1 sm:col-span-1 sm:justify-self-end">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <ActionButton
            action={dropEvent}
            input={{ id: event.id }}
            variant="ghost"
            confirm={{ title: `Remove ${event.title} (${event.startsLabel}) from the schedule?`, body: `${plural(event.signups, "sign-up")} so far. It is dropped from the month and the volunteer form.`, confirmLabel: "Remove", danger: true }}
            done={`${event.title} removed from the schedule.`}
          >
            Remove
          </ActionButton>
        </span>
      ) : (
        <span className="hidden sm:block" />
      )}
    </li>
  );
}

export function AddEventForm({ cycleId, defaultStart }: { cycleId: string; defaultStart: string }) {
  const { run, pending, error } = useAction();
  const blank = { title: "", type: "standard" as EventType, starts_at: defaultStart, location: "", helpers_needed: 2 };
  const [v, setV] = useState(blank);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        + Add an event
      </Button>
    );
  }
  return (
    <form
      className="grid gap-3 sm:grid-cols-2 rounded-lg border border-dashed border-gray-300 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(createEvent, { cycle_id: cycleId, ...v, location: v.location || null, helpers_needed: Number(v.helpers_needed) }, () => {
          setV(blank);
          setOpen(false);
        });
      }}
    >
      <Field label="Title" htmlFor="new-title">
        <Input id="new-title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} required />
      </Field>
      <Field label="Type" htmlFor="new-type">
        <Select id="new-type" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as EventType })}>
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {EVENT_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Starts" htmlFor="new-start">
        <Input id="new-start" type="datetime-local" value={v.starts_at} onChange={(e) => setV({ ...v, starts_at: e.target.value })} required />
      </Field>
      <Field label="Helpers needed" htmlFor="new-helpers">
        <Input id="new-helpers" type="number" min={0} max={50} value={v.helpers_needed} onChange={(e) => setV({ ...v, helpers_needed: Number(e.target.value) })} />
      </Field>
      <Field label="Location name" htmlFor="new-location" hint="The full address is entered on the event page">
        <Input id="new-location" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} />
      </Field>
      <div className="flex items-end gap-2">
        <Button disabled={pending}>Add event</Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && <Alert tone="error" className="sm:col-span-2">{error}</Alert>}
    </form>
  );
}

export function IdeaCard({
  idea,
  cycleId,
  events,
  canEdit,
}: {
  idea: { id: string; title: string; date: string; pitch: string; helpers: number; wantsToOc: boolean; proposer: string; typeSuggestion?: EventType | null };
  cycleId: string;
  events: Array<{ id: string; title: string }>;
  canEdit: boolean;
}) {
  const { run, pending, error } = useAction();
  const [mode, setMode] = useState<"none" | "accept" | "merge" | "reject" | "move">("none");
  // "Propose this again" on /ideas suggests the earlier event's type.
  const [type, setType] = useState<EventType>(idea.typeSuggestion ?? "standard");
  const [start, setStart] = useState(`${idea.date}T19:00`);
  const [helpers, setHelpers] = useState(idea.helpers);
  const [mergeInto, setMergeInto] = useState(events[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(idea.date);

  return (
    <div className="rounded-lg border border-gray-200 p-3 space-y-2" data-testid={`idea-${idea.title}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium text-gray-900">{idea.title}</span>
        <span className="text-xs text-gray-500 ml-auto">{idea.date}</span>
      </div>
      <p className="text-xs text-gray-500">
        by {idea.proposer} · {plural(idea.helpers, "helper")} · {idea.wantsToOc ? "wants to OC" : "not OC"}
      </p>
      {idea.pitch && <p className="text-sm text-gray-700 whitespace-pre-line">{idea.pitch}</p>}
      {canEdit && mode === "none" && (
        <div className="flex flex-wrap gap-1">
          <Button size="sm" onClick={() => setMode("accept")}>
            Accept
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMode("merge")} disabled={!events.length}>
            Merge
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMode("move")}>
            Move
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode("reject")}>
            Reject
          </Button>
        </div>
      )}
      {mode === "accept" && (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(acceptIdea, { idea_id: idea.id, cycle_id: cycleId, type, starts_at: start, helpers_needed: Number(helpers) });
          }}
        >
          <Field label="Event type" htmlFor={`type-${idea.id}`}>
            <Select id={`type-${idea.id}`} value={type} onChange={(e) => setType(e.target.value as EventType)}>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EVENT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Starts" htmlFor={`start-${idea.id}`}>
            <Input id={`start-${idea.id}`} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Helpers" htmlFor={`helpers-${idea.id}`}>
            <Input id={`helpers-${idea.id}`} type="number" min={0} value={helpers} onChange={(e) => setHelpers(Number(e.target.value))} />
          </Field>
          <div className="flex gap-2">
            <Button size="sm" disabled={pending}>
              Add to schedule
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setMode("none")}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {mode === "merge" && (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(mergeIdea, { idea_id: idea.id, event_id: mergeInto, note: note || undefined });
          }}
        >
          <Select aria-label="Merge into" value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.title}
              </option>
            ))}
          </Select>
          <Input aria-label="Note" placeholder="Note to the proposer (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" disabled={pending}>
              Merge
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setMode("none")}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {mode === "move" && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(moveIdea, { idea_id: idea.id, proposed_date: date });
          }}
        >
          <Input aria-label="New date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
          <Button size="sm" disabled={pending}>
            Move
          </Button>
          <Button size="sm" type="button" variant="ghost" onClick={() => setMode("none")}>
            Cancel
          </Button>
        </form>
      )}
      {mode === "reject" && (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(rejectIdea, { idea_id: idea.id, note: note || undefined });
          }}
        >
          <Textarea aria-label="Reason" placeholder="A short reason for the proposer (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={pending}>
              Reject
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setMode("none")}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

/** Events clears one volunteer's locked answers (with a reason) so they can submit again. */
export function ClearResponseButton({ cycleId, profileId, name }: { cycleId: string; profileId: string; name: string }) {
  const { run, pending, error } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Clear
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2 w-full"
      onSubmit={(e) => {
        e.preventDefault();
        run(clearVolunteerResponse, { cycle_id: cycleId, profile_id: profileId, reason }, () => setOpen(false), `${name}'s answers cleared – they can submit again.`);
      }}
    >
      <Input aria-label={`Reason for clearing ${name}'s answers`} placeholder="Reason (logged)" value={reason} onChange={(e) => setReason(e.target.value)} className="h-8 grow w-48" required />
      <Button size="sm" variant="destructive" disabled={pending || !reason.trim()}>
        Clear answers
      </Button>
      <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
