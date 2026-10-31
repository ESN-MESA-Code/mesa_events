"use client";

import { useEffect, useRef, useState } from "react";
import { AddressFields } from "@/components/AddressFields";
import { useAction } from "@/components/ActionButton";
import { updateEvent } from "@/app/actions/planning";
import {
  DEFAULT_ADDRESS,
  formatVenue,
  validateAddress,
  type EventAddress,
} from "@/lib/address";

/**
 * The description's venue as location name, street, postal code, city and
 * country with the address search (round 2026-10-30) instead of one text
 * box. Every change writes the venue line of the post ("Shamrock
 * (Trautenwolfstraße 6, 80802 München)"); for the OC and the Events team a
 * complete address is also saved on the event (checked against the address
 * lookup), so ESN Activities and the event page have it too.
 *
 * The post's venue line can still differ from the fields (an older draft, a
 * template, Comms' wording): that is said, with a button that takes the
 * fields into the post (usability review #3).
 */
export function VenueFields({
  eventId,
  initial,
  canSaveEvent,
  postVenue,
  onVenue,
}: {
  eventId: string;
  initial: { location: string; address: EventAddress | null };
  canSaveEvent: boolean;
  /** The venue line the post shows now (the description's own field). */
  postVenue: string;
  onVenue: (venue: string) => void;
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
  // The newest run(): the effect below must not restart on every render.
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

  const fieldsLine = Object.keys(validateAddress(address)).length ? location.trim() : formatVenue(location, address);
  const differs = !!fieldsLine && postVenue.trim() !== fieldsLine;

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
      {differs && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status" data-testid="venue-mismatch">
          The post shows <strong>“{postVenue.trim() || "no venue"}”</strong>, the fields above say <strong>“{fieldsLine}”</strong>.{" "}
          <button type="button" className="font-semibold underline" onClick={() => onVenue(fieldsLine)}>
            Use the fields in the post
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
