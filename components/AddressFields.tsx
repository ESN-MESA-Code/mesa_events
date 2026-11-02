"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { COUNTRIES, cityForPostalCode, validateAddress, type AddressErrors, type EventAddress } from "@/lib/address";
import type { AddressSuggestion, Verification } from "@/lib/geocode";
import { cn } from "@/lib/utils";

/**
 * Where the event takes place, the way delivery forms do it (round
 * 2026-10-30): one search box that shows the chosen place ("Shamrock,
 * Trautenwolfstraße 6, 80802 München ✓ verified"); typing searches places
 * and addresses, picking one fills in the venue name, street, postal code,
 * city and country. The separate fields are folded away once the address is
 * complete ("Edit by hand") and open while it is not. The lookup runs on the
 * server (/api/address). Germany and München by default; a known postal code
 * fills in the city. `showErrors`: after a save attempt.
 */
export function AddressFields({
  value,
  onChange,
  showErrors,
  idPrefix = "addr",
  venue,
  label = "Location",
  placeholderHint = "e.g. Shamrock München",
}: {
  value: EventAddress;
  onChange: (a: EventAddress) => void;
  showErrors: boolean;
  idPrefix?: string;
  /** The venue's name (events.location), filled in by a suggestion too. */
  venue?: { value: string; onChange: (v: string) => void };
  /** The search box's label ("Meeting point" for the meeting point, round 2026-11-02). */
  label?: string;
  placeholderHint?: string;
}) {
  const errors: AddressErrors = showErrors ? validateAddress(value) : {};
  const meeting = label !== "Location";
  const searchLabel = meeting ? `Search the ${label.toLowerCase()}` : "Search a place or address";
  const known = cityForPostalCode(value.country, value.postalCode);
  const key = `${value.country}|${value.street}|${value.postalCode}|${value.city}`;
  const complete = !Object.keys(validateAddress(value)).length;
  // null: not typing – the box shows the chosen place.
  const [query, setQuery] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  // A saved address was checked when it was saved.
  const [checked, setChecked] = useState<{ for: string; result: Verification | "checking" } | null>(complete ? { for: key, result: "verified" } : null);
  const [details, setDetails] = useState(!complete);
  const verification = checked?.for === key ? checked.result : null;
  const seq = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  const summary = [venue?.value.trim(), value.street.trim(), [value.postalCode.trim(), value.city.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const showDetails = details || !complete || Object.keys(errors).length > 0;

  // Suggestions while typing (debounced; the newest answer wins).
  useEffect(() => {
    const q = (query ?? "").trim();
    if (q.length < 3) return;
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/address?q=${encodeURIComponent(q)}`).catch(() => null);
      const body = res?.ok ? ((await res.json()) as { suggestions: AddressSuggestion[] }) : { suggestions: [] };
      if (n === seq.current) {
        setSuggestions(body.suggestions);
        setOpen(true);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  function pick(s: AddressSuggestion) {
    onChange({ country: s.country, street: s.street, postalCode: s.postalCode, city: s.city });
    if (venue && s.name) venue.onChange(s.name);
    setChecked({ for: `${s.country}|${s.street}|${s.postalCode}|${s.city}`, result: "verified" });
    setQuery(null);
    setSuggestions([]);
    setOpen(false);
    setDetails(false);
  }

  function clear() {
    onChange({ country: value.country, street: "", postalCode: "", city: "" });
    venue?.onChange("");
    setQuery("");
    setDetails(true);
    input.current?.focus();
  }

  async function check() {
    setChecked({ for: key, result: "checking" });
    const p = new URLSearchParams({ country: value.country, street: value.street, postal: value.postalCode, city: value.city });
    const res = await fetch(`/api/address?${p}`).catch(() => null);
    const body = res?.ok ? ((await res.json()) as { verification: Verification }) : { verification: "unavailable" as const };
    setChecked({ for: key, result: body.verification });
  }

  function setPostal(postalCode: string) {
    const city = cityForPostalCode(value.country, postalCode);
    onChange({ ...value, postalCode, city: city ?? value.city });
  }

  return (
    <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-2" data-testid={meeting ? "meeting-address-fields" : "address-fields"}>
      <legend className="sr-only">{label} and address</legend>
      <div className="relative sm:col-span-2">
        <Field label={label} htmlFor={`${idPrefix}-search`} hint={query === null && summary ? undefined : placeholderHint}>
          <div className="relative">
            <Input
              ref={input}
              id={`${idPrefix}-search`}
              role="combobox"
              aria-label={searchLabel}
              aria-expanded={open && suggestions.length > 0}
              aria-controls={`${idPrefix}-suggestions`}
              aria-autocomplete="list"
              autoComplete="off"
              placeholder="Search a place or address"
              className={cn(query === null && summary && (verification === "verified" ? "pr-32" : "pr-10"))}
              value={query ?? summary}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => {
                setQuery(e.target.value);
                if (e.target.value.trim().length < 3) setOpen(false);
              }}
              onBlur={() => {
                // Back to the chosen place when nothing was picked.
                setQuery(null);
                setOpen(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && open && suggestions[0]) {
                  e.preventDefault();
                  pick(suggestions[0]);
                }
                if (e.key === "Escape") {
                  setQuery(null);
                  setOpen(false);
                }
              }}
            />
            {query === null && summary && (
              <span className="absolute inset-y-0 right-2 flex items-center gap-1">
                {verification === "verified" && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800" data-testid="address-verified-chip">
                    ✓ verified
                  </span>
                )}
                <button type="button" aria-label={`Clear the ${label.toLowerCase()}`} className="rounded px-1.5 text-gray-400 hover:text-gray-700" onClick={clear}>
                  ✕
                </button>
              </span>
            )}
          </div>
        </Field>
        {open && (
          <ul id={`${idPrefix}-suggestions`} role="listbox" className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-gray-200 bg-white text-sm shadow-lg" data-testid="address-suggestions">
            {!suggestions.length && <li className="px-3 py-2 text-gray-500">Nothing found</li>}
            {suggestions.map((hit) => (
              <li key={hit.label} role="option" aria-selected={false}>
                {/* mousedown would blur the box (and reset it) before the click lands */}
                <button type="button" className="block w-full px-3 py-2 text-left hover:bg-esn/5" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(hit)}>
                  {hit.name && <span className="font-medium text-gray-900">{hit.name} · </span>}
                  <span className="text-gray-700">
                    {hit.street}, {hit.postalCode} {hit.city}
                    {hit.country !== "DE" ? `, ${COUNTRIES.find((c) => c.code === hit.country)?.name ?? hit.country}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {complete && (
          <button type="button" className="mt-1 text-xs text-esn hover:underline" aria-expanded={showDetails} onClick={() => setDetails((d) => !d)}>
            {showDetails ? "Hide the fields" : "Edit by hand"}
          </button>
        )}
      </div>
      {showDetails && (
        <>
          {venue && (
            <Field label={`${label} name`} htmlFor={`${idPrefix}-venue`}>
              <Input id={`${idPrefix}-venue`} value={venue.value} onChange={(e) => venue.onChange(e.target.value)} autoComplete="organization" />
            </Field>
          )}
          <Field label="Street and house number" htmlFor={`${idPrefix}-street`} error={errors.street}>
            <Input id={`${idPrefix}-street`} value={value.street} onChange={(e) => onChange({ ...value, street: e.target.value })} placeholder="e.g. Trautenwolfstraße 6" autoComplete="address-line1" />
          </Field>
          <Field
            label="Postal code"
            htmlFor={`${idPrefix}-postal`}
            error={errors.postalCode}
            hint={known ? `✓ ${known}` : undefined}
          >
            <Input id={`${idPrefix}-postal`} inputMode={value.country === "DE" ? "numeric" : "text"} value={value.postalCode} onChange={(e) => setPostal(e.target.value)} autoComplete="postal-code" />
          </Field>
          <Field label="City" htmlFor={`${idPrefix}-city`} error={errors.city}>
            <Input id={`${idPrefix}-city`} value={value.city} onChange={(e) => onChange({ ...value, city: e.target.value })} autoComplete="address-level2" />
          </Field>
          <Field label="Country" htmlFor={`${idPrefix}-country`} error={errors.country}>
            <Select id={`${idPrefix}-country`} value={value.country} onChange={(e) => onChange({ ...value, country: e.target.value })} autoComplete="country">
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          {verification !== "verified" && (
            <div className="flex flex-wrap items-center gap-2 text-xs sm:col-span-2" data-testid="address-verification" aria-live="polite">
              {verification === "not_found" ? (
                <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">✕ Address not found</span>
              ) : verification === "unavailable" ? (
                <span className="text-gray-600">Check unavailable</span>
              ) : (
                <span className="text-gray-500">Not verified</span>
              )}
              <Button type="button" size="sm" variant="outline" disabled={!complete || verification === "checking"} onClick={check} className={cn(!complete && "opacity-60")}>
                {verification === "checking" ? "Checking…" : "Check address"}
              </Button>
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}
