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
 */
export function VenueFields({
  eventId,
  initial,
  canSaveEvent,
  onVenue,
}: {
  eventId: string;
  initial: { location: string; address: EventAddress | null };
  canSaveEvent: boolean;
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

  return (
    <div className="space-y-1" data-testid="venue-fields">
      <AddressFields
        value={address}
        onChange={(a) => update({ address: a })}
        showErrors={touched}
        idPrefix="f-venue"
        venue={{ value: location, onChange: (l) => update({ location: l }) }}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
