"use client";

import { useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { cancelEvent, decideCancellation, dropOut, requestCancellation } from "@/app/actions/roster";
import { updateEvent } from "@/app/actions/planning";
import { parseEuroToCents } from "@/lib/dates";
import { CANCEL_CONSEQUENCES } from "@/lib/labels";
import { AddressFields } from "@/components/AddressFields";
import { DEFAULT_ADDRESS, validateAddress, type EventAddress } from "@/lib/address";
import { MeetingFields } from "@/components/MeetingFields";
import { meetingDraft, meetingInput, type EventMeeting, type MeetingDraft } from "@/lib/meeting";

export function DropOutButton({ assignmentId, role, title }: { assignmentId: string; role: "oc" | "helper"; title: string }) {
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
        run(dropOut, { assignment_id: assignmentId, reason: reason || undefined }, () => setOpen(false), `You dropped out of ${title}. Your slot is open for others now.`);
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

/** The Events team cancels a running event, with an optional reason for the Chat message. */
export function CancelEventForm({ eventId, title, when }: { eventId: string; title: string; when: string }) {
  const { run, pending, error, confirm } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Cancel the event…
      </Button>
    );
  }
  return (
    <form
      className="space-y-2"
      data-testid="cancel-event-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!(await confirm({ title: `Cancel ${title} on ${when}?`, body: CANCEL_CONSEQUENCES, confirmLabel: "Cancel the event", cancelLabel: "Keep it", danger: true }))) return;
        run(cancelEvent, { event_id: eventId, reason: reason.trim() || undefined }, () => setOpen(false), "Event cancelled.");
      }}
    >
      <Input aria-label="Reason for the team (optional)" placeholder="Reason for the team (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
      <p className="text-xs text-gray-500">{CANCEL_CONSEQUENCES} The reason is posted in the Chat space.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="destructive" disabled={pending}>
          Cancel the event
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>
          Keep it
        </Button>
      </div>
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
    </form>
  );
}

/** The OC asks the Events team to cancel (round 2026-11-03): a reason, posted in Chat; the event runs until they decide. */
export function RequestCancellationForm({ eventId, title, when }: { eventId: string; title: string; when: string }) {
  const { run, pending, error, confirm } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="request-cancellation">
        Ask the Events team to cancel…
      </Button>
    );
  }
  return (
    <form
      className="space-y-2"
      data-testid="request-cancellation-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!reason.trim()) return;
        if (!(await confirm({ title: `Ask to cancel ${title} on ${when}?`, body: "The Events team is told in Chat and decides. Until then the event stays on.", confirmLabel: "Send the request", cancelLabel: "Back" }))) return;
        run(requestCancellation, { event_id: eventId, reason: reason.trim() }, () => setOpen(false), "Request sent – the Events team decides.");
      }}
    >
      <Input aria-label="Why should it be cancelled?" placeholder="Why should it be cancelled?" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required />
      <p className="text-xs text-gray-500">The Events team is mentioned in the event&apos;s Chat space with your reason. The event stays on until they decide.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending || !reason.trim()}>
          Send the request
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>
          Back
        </Button>
      </div>
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
    </form>
  );
}

/**
 * An open cancellation request: the Events team cancels the event or keeps
 * it on (with a note for the OC); the OC can withdraw it.
 */
export function CancellationDecision({ requestId, title, when, canDecide, canWithdraw }: { requestId: string; title: string; when: string; canDecide: boolean; canWithdraw: boolean }) {
  const { run, pending, error, confirm } = useAction();
  const [keeping, setKeeping] = useState(false);
  const [note, setNote] = useState("");
  return (
    <div className="mt-2 space-y-2" data-testid="cancellation-decision">
      {canDecide && !keeping && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              if (!(await confirm({ title: `Cancel ${title} on ${when}?`, body: CANCEL_CONSEQUENCES, confirmLabel: "Cancel the event", cancelLabel: "Back", danger: true }))) return;
              run(decideCancellation, { request_id: requestId, decision: "cancelled" }, undefined, "Event cancelled.");
            }}
          >
            Cancel the event
          </Button>
          <Button size="sm" variant="outline" onClick={() => setKeeping(true)}>
            Keep it on…
          </Button>
        </div>
      )}
      {canDecide && keeping && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) run(decideCancellation, { request_id: requestId, decision: "declined", note: note.trim() }, () => setKeeping(false), "The event stays on – the OC is told why.");
          }}
        >
          <Input aria-label="Why does it stay on? (for the OC)" placeholder="Why does it stay on? (for the OC)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} required />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending || !note.trim()}>
              Keep it on
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setKeeping(false)}>
              Back
            </Button>
          </div>
        </form>
      )}
      {canWithdraw && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(decideCancellation, { request_id: requestId, decision: "withdrawn" }, undefined, "Request withdrawn.")}>
          Withdraw my request
        </Button>
      )}
      {error && <span role="alert" className="block text-xs text-red-600">{error}</span>}
    </div>
  );
}

export function EventDetailsForm({
  event,
  eventsTeam,
}: {
  event: { id: string; startsAt: string; endsAt: string; location: string; price: string; capacity: string; address: EventAddress | null; meeting: EventMeeting | null };
  eventsTeam: boolean;
}) {
  const { run, pending, error, setError } = useAction();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(event);
  const [address, setAddress] = useState<EventAddress>(event.address ?? DEFAULT_ADDRESS);
  const [checked, setChecked] = useState(false);
  const [saved, setSaved] = useState(false);
  // Meeting somewhere else than the location (round 2026-11-02).
  const [meets, setMeets] = useState(!!event.meeting);
  const [meeting, setMeeting] = useState<MeetingDraft>(meetingDraft(event.meeting));
  const [meetChecked, setMeetChecked] = useState(false);
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
        // With a venue, the address is needed (ESN Activities); an empty one is fine while the place is open.
        const withAddress = !!(v.location.trim() || address.street.trim() || address.postalCode.trim());
        setChecked(withAddress);
        if (withAddress && Object.keys(validateAddress(address)).length) {
          setError("Please check the address.");
          return;
        }
        setMeetChecked(meets);
        const meet = meets ? meetingInput(meeting) : { value: null };
        if (meet.error !== undefined) {
          setError(meet.error);
          return;
        }
        run(
          updateEvent,
          {
            id: event.id,
            ...(eventsTeam ? { starts_at: v.startsAt, ends_at: v.endsAt || null } : {}),
            location: v.location || null,
            address: withAddress ? { country: address.country, street: address.street.trim(), postal_code: address.postalCode.trim(), city: address.city.trim() } : null,
            meeting: meet.value,
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
      {eventsTeam && (
        <>
          <Field label="Starts" htmlFor="d-start">
            <Input id="d-start" type="datetime-local" value={v.startsAt} onChange={(e) => setV({ ...v, startsAt: e.target.value })} />
          </Field>
          <Field label="Ends" htmlFor="d-end">
            <Input id="d-end" type="datetime-local" value={v.endsAt} onChange={(e) => setV({ ...v, endsAt: e.target.value })} />
          </Field>
        </>
      )}
      <AddressFields value={address} onChange={setAddress} showErrors={checked} idPrefix="d-addr" venue={{ value: v.location, onChange: (location) => setV((x) => ({ ...x, location })) }} />
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={meets} onChange={(e) => setMeets(e.target.checked)} />
        People meet somewhere else first (e.g. at the station for a hike)
      </label>
      {meets && <MeetingFields value={meeting} onChange={(patch) => setMeeting((m) => ({ ...m, ...patch }))} showErrors={meetChecked} idPrefix="d-meet" />}
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
      {!eventsTeam && <p className="sm:col-span-2 text-xs text-gray-500">The date, title, type and number of helpers are changed by the Events team.</p>}
      {error && <Alert tone="error" className="sm:col-span-2">{error}</Alert>}
      {saved && <Alert tone="success" className="sm:col-span-2">Saved.</Alert>}
    </form>
  );
}
