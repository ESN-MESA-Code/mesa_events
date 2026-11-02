"use client";

import { AddressFields } from "@/components/AddressFields";
import { Field, Input } from "@/components/ui";
import { addressStarted, type MeetingDraft } from "@/lib/meeting";

/**
 * Where people meet when it is not the location (round 2026-11-02): the
 * meeting point's name and address with the same search as the location (the
 * address is optional) and the time to be there. `onChange` gets a patch: a
 * picked suggestion sets the address and then the name in one go.
 */
export function MeetingFields({
  value,
  onChange,
  showErrors,
  idPrefix,
}: {
  value: MeetingDraft;
  onChange: (patch: Partial<MeetingDraft>) => void;
  showErrors: boolean;
  idPrefix: string;
}) {
  return (
    <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2" data-testid="meeting-fields">
      <AddressFields
        label="Meeting point"
        placeholderHint="e.g. München Hauptbahnhof – the address is optional"
        value={value.address}
        onChange={(address) => onChange({ address })}
        // An address is optional: checked once someone started one.
        showErrors={showErrors && addressStarted(value.address)}
        idPrefix={idPrefix}
        venue={{ value: value.point, onChange: (point) => onChange({ point }) }}
      />
      <Field label="Meeting time" htmlFor={`${idPrefix}-time`} hint="Optional · on the event's day">
        <Input id={`${idPrefix}-time`} type="time" value={value.time} onChange={(e) => onChange({ time: e.target.value })} />
      </Field>
    </div>
  );
}
