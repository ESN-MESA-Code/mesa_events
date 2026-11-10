"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { searchEarlier, type EarlierEvent } from "@/lib/inspiration";
import type { Category } from "@/lib/formats";
import { Input } from "@/components/ui";
import { berlinDate, monthLabel } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** "ran 3× · last Oct 2025" for a row of the list. */
export function runsNote(g: EarlierEvent): string {
  if (!g.runs.length) return "not run yet";
  const last = monthLabel(`${berlinDate(g.runs[0].starts_at).slice(0, 7)}-01`);
  return g.runs.length > 1 ? `ran ${g.runs.length}× · last ${last}` : `ran once · ${last}`;
}

/**
 * The idea's title, which searches the earlier events as you type (round
 * 2026-11-10): one field for "what is it called" and "is it a new run of …".
 * Typing a new name is fine – the list only offers; picking a row hands the
 * earlier event to `onPick`. The input stays a plain registered field
 * (`field`), so validation and focus on error work as before.
 */
export function TitleSearch({
  id,
  field,
  text,
  options,
  categories,
  onPick,
  placeholder,
  invalid,
}: {
  id: string;
  field: UseFormRegisterReturn;
  /** The title as typed (watched), for the search. */
  text: string;
  options: EarlierEvent[];
  categories: Category[];
  onPick: (g: EarlierEvent) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  const emojiOf = useMemo(() => new Map(categories.map((c) => [c.id, c.emoji])), [categories]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const hits = useMemo(() => searchEarlier(options, text, text.trim() ? 12 : 6), [options, text]);
  const shown = open && hits.length > 0;

  // A click or tap anywhere else closes the list (touch browsers do not always send blur).
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  function pick(g: EarlierEvent) {
    onPick(g);
    setOpen(false);
    setActive(-1);
  }
  function move(next: number) {
    setActive(next);
    listRef.current?.querySelectorAll('[role="option"]')[next]?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div ref={boxRef} className="relative">
      <Input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        {...field}
        onChange={(e) => {
          void field.onChange(e);
          setOpen(true);
          setActive(-1);
        }}
        onBlur={(e) => {
          void field.onBlur(e);
          setOpen(false);
        }}
        onFocus={() => options.length > 0 && setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) return setOpen(true);
            move(Math.min(active + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            move(Math.max(active - 1, -1));
          } else if (e.key === "Enter" && shown) {
            // Enter takes the highlighted row, or keeps the typed name (and does not send the form yet).
            e.preventDefault();
            if (active >= 0 && hits[active]) pick(hits[active]);
            else setOpen(false);
          } else if (e.key === "Escape" && shown) {
            e.preventDefault();
            setOpen(false);
          }
        }}
      />
      {shown && (
        <ul ref={listRef} id={listId} role="listbox" aria-label="Earlier events" className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg" data-testid="title-suggestions">
          <li role="presentation" className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            {text.trim() ? "Run an earlier event again?" : "Earlier events – or type a new name"}
          </li>
          {hits.map((g, i) => (
            <li
              key={g.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Keeps the focus in the input, so the tap is not lost to blur.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(g)}
              onMouseEnter={() => setActive(i)}
              className={cn("flex cursor-pointer items-center gap-2 px-3 py-2", i === active ? "bg-esn/10 text-esn-dark" : "text-gray-800")}
            >
              <span className="w-5 shrink-0 text-center" aria-hidden>
                {(g.category_id && emojiOf.get(g.category_id)) || "↻"}
              </span>
              <span className="min-w-0 flex-1 truncate">{g.name}</span>
              <span className="shrink-0 text-xs text-gray-400">{runsNote(g)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
