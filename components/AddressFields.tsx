"use client";

import { Field, Input, Select } from "@/components/ui";
import { COUNTRIES, cityForPostalCode, validateAddress, type AddressErrors, type EventAddress } from "@/lib/address";

/**
 * Country, street address, postal code and city – what ESN Activities asks
 * for. Germany and München by default; typing a known postal code fills in
 * the city (lib/address.ts). `showErrors`: after a save attempt.
 */
export function AddressFields({
  value,
  onChange,
  showErrors,
  idPrefix = "addr",
}: {
  value: EventAddress;
  onChange: (a: EventAddress) => void;
  showErrors: boolean;
  idPrefix?: string;
}) {
  const errors: AddressErrors = showErrors ? validateAddress(value) : {};
  const known = cityForPostalCode(value.country, value.postalCode);
  const country = COUNTRIES.find((c) => c.code === value.country);

  function setPostal(postalCode: string) {
    const city = cityForPostalCode(value.country, postalCode);
    onChange({ ...value, postalCode, city: city ?? value.city });
  }

  return (
    <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-2" data-testid="address-fields">
      <legend className="mb-1 text-sm font-medium text-gray-700">Address (as ESN Activities needs it)</legend>
      <Field label="Country" htmlFor={`${idPrefix}-country`} error={errors.country}>
        <Select id={`${idPrefix}-country`} value={value.country} onChange={(e) => onChange({ ...value, country: e.target.value })}>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Street and house number" htmlFor={`${idPrefix}-street`} error={errors.street}>
        <Input id={`${idPrefix}-street`} value={value.street} onChange={(e) => onChange({ ...value, street: e.target.value })} placeholder="e.g. Trautenwolfstraße 6" autoComplete="street-address" />
      </Field>
      <Field
        label="Postal code"
        htmlFor={`${idPrefix}-postal`}
        error={errors.postalCode}
        hint={known ? `✓ ${known}` : value.postalCode.trim() && country?.postal.test(value.postalCode.trim()) ? "Not in the list – check the city." : `e.g. ${country?.example ?? ""}`}
      >
        <Input id={`${idPrefix}-postal`} inputMode={value.country === "DE" ? "numeric" : "text"} value={value.postalCode} onChange={(e) => setPostal(e.target.value)} autoComplete="postal-code" />
      </Field>
      <Field label="City" htmlFor={`${idPrefix}-city`} error={errors.city}>
        <Input id={`${idPrefix}-city`} value={value.city} onChange={(e) => onChange({ ...value, city: e.target.value })} autoComplete="address-level2" />
      </Field>
    </fieldset>
  );
}
