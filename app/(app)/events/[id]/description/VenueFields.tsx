"use client";

import { useEffect, useRef, useState } from "react";
import { AddressFields } from "@/components/AddressFields";
import { MeetingFields } from "@/components/MeetingFields";
import { useAction } from "@/components/ActionButton";
import { updateEvent } from "@/app/actions/planning";
import {
  DEFAULT_ADDRESS,
  formatVenue,
  validateAddress,
  type EventAddress,
} from "@/lib/address";
import {
  draftPlace,
  meetingDraft,
  meetingInput,
  placeMismatch,
  type EventMeeting,
  type MeetingDraft,
} from "@/lib/meeting";
import { normalizeTime } from "@/lib/description/template";

/**
 * The description's venue as location name, street, postal code, city and
 * country with the address search (round 2026-10-30) instead of one text
 * box. Every change writes the venue line of the post ("Shamrock
 * (Trautenwolfstraße 6, 80802 München)"); for the OC and the Events team a
 * complete address is also saved on the event (checked against the address
 * lookup), so ESN Activities and the event page have it too.
 *
 * Where people meet, when that is not the venue (round 2026-11-02), has its
 * own fields: they write the post's meeting line and are saved on the event
 * the same way.
 *
 * The post's lines can still differ from the fields (an older draft, a
 * template, Comms' wording): that is said, with a button that takes the
 * fields into the post (usability review #3). The venue line is compared
 * with the location only (lib/meeting.ts placeMismatch).
 */
export function VenueFields({
  eventId,
  initial,
  canSaveEvent,
  postVenue,
  onVenue,
  post,
  onMeeting,
}: {
  eventId: string;
  initial: { location: string; address: EventAddress | null; meeting: EventMeeting | null };
  canSaveEvent: boolean;
  /** The venue line the post shows now (the description's own field). */
  postVenue: string;
  onVenue: (venue: string) => void;
  /** The post's meeting point and time now (the description's own fields). */
  post: { meeting: string; meetingTime: string };
  onMeeting: (meeting: string, time: string) => void;
}) {
  const [location, setLocation] = useState(initial.location);
  const [address, setAddress] = useState<EventAddress>(
    initial.address ?? DEFAULT_ADDRESS,
  );
  const [touched, setTouched] = useState(false);
  const { run, error } = useAction();
  const lastSaved = useRef(
    JSON.stringify({ location: initial.location, address: initial.address }),
  );
  // The newest run(): the effects below must not restart on every render.
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });

  // The latest values: a picked suggestion sets the address and then the name in one go.
  const current = useRef({
    location: initial.location,
    address: initial.address ?? DEFAULT_ADDRESS,
  });
  function update(patch: Partial<{ location: string; address: EventAddress }>) {
    const next = { ...current.current, ...patch };
    current.current = next;
    setLocation(next.location);
    setAddress(next.address);
    setTouched(true);
    const complete = !Object.keys(validateAddress(next.address)).length;
    onVenue(
      complete ? formatVenue(next.location, next.address) : next.location,
    );
  }

  // A complete address goes onto the event (debounced; the server verifies it).
  useEffect(() => {
    if (
      !canSaveEvent ||
      !touched ||
      Object.keys(validateAddress(address)).length
    )
      return;
    const key = JSON.stringify({ location, address });
    if (key === lastSaved.current) return;
    const t = setTimeout(() => {
      lastSaved.current = key;
      runRef.current(updateEvent, {
        id: eventId,
        location: location.trim() || null,
        address: {
          country: address.country,
          street: address.street.trim(),
          postal_code: address.postalCode.trim(),
          city: address.city.trim(),
        },
      });
    }, 800);
    return () => clearTimeout(t);
  }, [address, location, touched, canSaveEvent, eventId]);

  // ── The meeting point ──────────────────────────────────────────────────
  const [meets, setMeets] = useState(!!initial.meeting || !!post.meeting.trim());
  const [meeting, setMeeting] = useState<MeetingDraft>(meetingDraft(initial.meeting));
  const [meetingTouched, setMeetingTouched] = useState(false);
  const meetingCurrent = useRef(meeting);
  const meetingSaved = useRef(JSON.stringify(meetingInput(meetingDraft(initial.meeting)).value ?? null));
  function updateMeeting(patch: Partial<MeetingDraft>) {
    const next = { ...meetingCurrent.current, ...patch };
    meetingCurrent.current = next;
    setMeeting(next);
    setMeetingTouched(true);
    onMeeting(draftPlace(next), next.time);
  }
  function toggleMeeting(on: boolean) {
    setMeets(on);
    setMeetingTouched(true);
    if (on) onMeeting(draftPlace(meetingCurrent.current), meetingCurrent.current.time);
    else onMeeting("", "");
  }

  // A usable meeting point (or none) goes onto the event, like the address.
  useEffect(() => {
    if (!canSaveEvent || !meetingTouched) return;
    const input = meets ? meetingInput(meeting) : { value: null };
    if (input.error !== undefined) return;
    const key = JSON.stringify(input.value);
    if (key === meetingSaved.current) return;
    const t = setTimeout(() => {
      meetingSaved.current = key;
      runRef.current(updateEvent, { id: eventId, meeting: input.value });
    }, 800);
    return () => clearTimeout(t);
  }, [meeting, meets, meetingTouched, canSaveEvent, eventId]);

  const fieldsLine = Object.keys(validateAddress(address)).length ? location.trim() : formatVenue(location, address);
  const meetingLine = meets ? draftPlace(meeting) : "";
  const differs = placeMismatch({ venue: postVenue, meeting: post.meeting }, { venue: fieldsLine, meeting: meetingLine });
  const timeDiffers = meets && !!meetingLine && (normalizeTime(post.meetingTime).value ?? post.meetingTime.trim()) !== meeting.time;

  return (
    <div className="space-y-1" data-testid="venue-fields">
      <p className="text-xs text-gray-500">
        The venue {canSaveEvent ? "is saved on the event too (Overview, ESN Activities) and " : ""}writes the post&apos;s venue line.
      </p>
      <AddressFields
        value={address}
        onChange={(a) => update({ address: a })}
        showErrors={touched}
        idPrefix="f-venue"
        venue={{ value: location, onChange: (l) => update({ location: l }) }}
      />
      {differs.venue && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status" data-testid="venue-mismatch">
          The post shows <strong>“{postVenue.trim() || "no venue"}”</strong>, the fields above say <strong>“{fieldsLine}”</strong>.{" "}
          <button type="button" className="font-semibold underline" onClick={() => onVenue(fieldsLine)}>
            Use the fields in the post
          </button>
        </div>
      )}
      <label className="flex items-center gap-2 pt-2 text-sm">
        <input type="checkbox" checked={meets} onChange={(e) => toggleMeeting(e.target.checked)} data-testid="meets-elsewhere" />
        People meet somewhere else first (e.g. at the station for a hike)
      </label>
      {meets && (
        <>
          <MeetingFields value={meeting} onChange={updateMeeting} showErrors={meetingTouched} idPrefix="f-meet" />
          {(differs.meeting || timeDiffers) && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status" data-testid="meeting-mismatch">
              The post&apos;s meeting point is <strong>“{[post.meeting.trim() || "none", post.meetingTime.trim()].filter(Boolean).join(" at ")}”</strong>, the fields say{" "}
              <strong>“{[meetingLine, meeting.time].filter(Boolean).join(" at ")}”</strong>.{" "}
              <button type="button" className="font-semibold underline" onClick={() => onMeeting(meetingLine, meeting.time)}>
                Use the fields in the post
              </button>
            </div>
          )}
        </>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
