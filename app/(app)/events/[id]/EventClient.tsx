"use client";

import { useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { dropOut } from "@/app/actions/roster";
import { updateEvent } from "@/app/actions/planning";
import { parseEuroToCents } from "@/lib/dates";

export function DropOutButton({ assignmentId, role }: { assignmentId: string; role: "oc" | "helper" }) {
  const { run, pending, error } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Drop out
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(dropOut, { assignment_id: assignmentId, reason: reason || undefined }, () => setOpen(false));
      }}
    >
      <Input aria-label="Reason (optional)" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} className="h-8 w-48" maxLength={500} />
      <Button size="sm" variant="destructive" disabled={pending}>
        Drop out as {role === "oc" ? "OC" : "helper"}
      </Button>
      <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      <p className="w-full text-xs text-gray-500">Only the OC and the Events team see the reason. Please no health details – “can’t make it” is enough.</p>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}

export function EventDetailsForm({
  event,
  eventsTeam,
}: {
  event: { id: string; startsAt: string; endsAt: string; location: string; price: string; capacity: string };
  eventsTeam: boolean;
}) {
  const { run, pending, error, setError } = useAction();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(event);
  const [saved, setSaved] = useState(false);
  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Edit details
      </Button>
    );
  }
  return (
    <form
      className="grid gap-3 sm:grid-cols-2 border-t border-gray-100 pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        const price = v.price.trim() === "" ? null : parseEuroToCents(v.price);
        if (v.price.trim() !== "" && price === null) {
          setError("The price is not a valid amount.");
          return;
        }
        run(
          updateEvent,
          {
            id: event.id,
            starts_at: v.startsAt,
            ends_at: v.endsAt || null,
            location: v.location || null,
            price_cents: price,
            capacity: v.capacity ? Number(v.capacity) : null,
          },
          () => {
            setSaved(true);
            setOpen(false);
          }
        );
      }}
    >
      <Field label="Starts" htmlFor="d-start">
        <Input id="d-start" type="datetime-local" value={v.startsAt} onChange={(e) => setV({ ...v, startsAt: e.target.value })} />
      </Field>
      <Field label="Ends" htmlFor="d-end">
        <Input id="d-end" type="datetime-local" value={v.endsAt} onChange={(e) => setV({ ...v, endsAt: e.target.value })} />
      </Field>
      <Field label="Location" htmlFor="d-location">
        <Input id="d-location" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} />
      </Field>
      <Field label="Price in € (empty = TBA)" htmlFor="d-price">
        <Input id="d-price" inputMode="decimal" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} />
      </Field>
      <Field label="Capacity" htmlFor="d-capacity">
        <Input id="d-capacity" type="number" min={1} value={v.capacity} onChange={(e) => setV({ ...v, capacity: e.target.value })} />
      </Field>
      <div className="flex items-end gap-2">
        <Button disabled={pending}>Save</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {!eventsTeam && <p className="sm:col-span-2 text-xs text-gray-500">Title, type and number of helpers are changed by the Events team.</p>}
      {error && <Alert tone="error" className="sm:col-span-2">{error}</Alert>}
      {saved && <Alert tone="success" className="sm:col-span-2">Saved.</Alert>}
    </form>
  );
}
