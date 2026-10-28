"use client";

import { useId, useRef, useState } from "react";
import { countryName, isCountryCode, matchCountry, searchCountries } from "@/lib/countries";

interface Props {
  /** ISO country code, or the raw text while it matches no country */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  name?: string;
  className?: string;
  placeholder?: string;
}

/**
 * Type-to-search country picker that shows English names but reports ISO
 * codes. Replaces <datalist>, which many mobile browsers render poorly or not
 * at all (e.g. Firefox for Android).
 */
export default function CountryCombobox({
  value,
  onChange,
  onBlur,
  name,
  className,
  placeholder,
}: Props) {
  const toText = (v: string) => (isCountryCode(v) ? countryName(v) : v);
  const [text, setText] = useState(() => toText(value));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  // Last value we reported. A different incoming value is an external change
  // (e.g. the form being reset or pre-filled), so the text follows it.
  const [emitted, setEmitted] = useState(value);
  if (value !== emitted) {
    setEmitted(value);
    setText(toText(value));
  }
  const options = searchCountries(text, text.trim() ? 8 : Infinity);

  function emit(next: string) {
    setEmitted(next);
    onChange(next);
  }

  function pick(code: string) {
    setText(countryName(code));
    emit(code);
    setOpen(false);
  }

  function moveActive(next: number) {
    setActive(next);
    listRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div className="relative">
      <input
        name={name}
        type="text"
        value={text}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        className={className}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          emit(matchCountry(e.target.value) ?? e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
          // Show the proper name for typed names and aliases ("germany", "UK").
          if (isCountryCode(value)) setText(countryName(value));
          onBlur?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            moveActive(Math.min(active + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            moveActive(Math.max(active - 1, 0));
          } else if (e.key === "Enter" && open && options[active]) {
            e.preventDefault();
            pick(options[active].code);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && options.length > 0 && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-60 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg text-sm"
        >
          {options.map((country, i) => (
            <li
              key={country.code}
              role="option"
              aria-selected={i === active}
              // preventDefault keeps focus in the input so the tap isn't lost to blur.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(country.code)}
              onMouseEnter={() => setActive(i)}
              className={`px-3 py-2.5 cursor-pointer ${
                i === active ? "bg-esn text-white" : "text-gray-700"
              }`}
            >
              {country.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
