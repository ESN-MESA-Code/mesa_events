"use client";

// Category badge and the category / format pickers of the idea, schedule and
// event forms (round 2026-11-01).
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Badge, Select } from "@/components/ui";
import { categoryLabel, sortedCategories, type Category, type Format } from "@/lib/formats";
import { searchFold } from "@/lib/description/search";
import { cn } from "@/lib/utils";

export function CategoryBadge({ category }: { category: Pick<Category, "emoji" | "name"> | null | undefined }) {
  if (!category) return null;
  return <Badge tone="purple">{categoryLabel(category)}</Badge>;
}

/** The categories to pick from: the active ones, plus the current one if it is hidden. */
export function CategorySelect({ categories, value, onChange, id, empty = "No category yet", ...rest }: { categories: Category[]; value: string; onChange: (id: string) => void; id?: string; empty?: string } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">) {
  const choices = sortedCategories(categories, true).filter((c) => c.active || c.id === value);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      <option value="">{empty}</option>
      {choices.map((c) => (
        <option key={c.id} value={c.id}>
          {categoryLabel(c)}
        </option>
      ))}
    </Select>
  );
}

/**
 * "Is this a new run of …?": the active formats by name, plus the current one
 * if it is hidden. Type to search (the list of formats keeps growing): the
 * name and the category match, accents and umlauts folded ("munchen" and
 * "muenchen" find "München"). The first row is always `empty` (no format).
 */
export function FormatSelect({
  formats,
  categories,
  value,
  onChange,
  id,
  empty = "No – something new",
  size = "default",
  className,
  disabled,
  "aria-label": ariaLabel,
}: {
  formats: Format[];
  categories: Category[];
  value: string;
  onChange: (id: string) => void;
  id?: string;
  empty?: string;
  /** "sm": the 32 px high inline bars (description, merge). */
  size?: "default" | "sm";
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const categoryOf = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const choices = useMemo(
    () =>
      formats
        .filter((f) => f.active || f.id === value)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => {
          const c = f.category_id ? categoryOf.get(f.category_id) : undefined;
          const text = `${f.name} ${c?.name ?? ""}`;
          // Both foldings: "muenchen" and "munchen" find "München".
          return { f, emoji: c?.emoji ?? "", category: c?.name ?? "", hay: `${searchFold(text)} ${searchFold(text, true)}` };
        }),
    [formats, value, categoryOf]
  );
  const selected = choices.find((c) => c.f.id === value);
  const labelOf = (c: (typeof choices)[number] | undefined) => (c ? [c.emoji, c.f.name].filter(Boolean).join(" ") : "");

  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // A click or tap anywhere else closes the list (besides blur, which touch browsers do not always send).
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  // While the list is open the input holds the query; closed, it shows the pick.
  const query = open ? text : "";
  const words = searchFold(query, true).split(" ").filter(Boolean);
  const hits = words.length ? choices.filter((c) => words.every((w) => c.hay.includes(w))) : choices;
  // Row 0 is "no format"; it stays out of a search that typed something.
  const rows: { id: string; label: string; emoji: string; category: string }[] = [
    ...(words.length ? [] : [{ id: "", label: empty, emoji: "", category: "" }]),
    ...hits.map((c) => ({ id: c.f.id, label: c.f.name, emoji: c.emoji, category: c.category })),
  ];

  function show() {
    if (disabled) return;
    setText("");
    setOpen(true);
    setActive(Math.max(0, rows.findIndex((r) => r.id === value)));
  }
  function pick(next: string) {
    onChange(next);
    setOpen(false);
    setText("");
  }
  function move(next: number) {
    setActive(next);
    listRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
  }

  const sm = size === "sm";
  return (
    <div ref={boxRef} className={cn("relative", sm ? "w-64 max-w-full" : "w-full", className)}>
      <svg aria-hidden viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className={cn("pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400", sm ? "h-3.5 w-3.5" : "h-4 w-4")}>
        <circle cx="9" cy="9" r="5.5" />
        <path d="m13.5 13.5 3.5 3.5" strokeLinecap="round" />
      </svg>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && rows[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={open ? text : labelOf(selected)}
        placeholder={open ? "Search earlier events…" : empty}
        className={cn(
          "w-full rounded-md border border-gray-300 bg-white pr-8 text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-esn-accent disabled:bg-gray-50",
          sm ? "h-8 pl-8 text-xs" : "py-2 pl-9",
          !open && !selected && "placeholder:text-gray-700"
        )}
        onFocus={show}
        onClick={() => !open && show()}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) return show();
            move(Math.min(active + 1, rows.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            move(Math.max(active - 1, 0));
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            if (rows[active]) pick(rows[active].id);
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            setOpen(false);
          }
        }}
      />
      {value && !open && !disabled ? (
        <button
          type="button"
          aria-label={`Clear – ${empty}`}
          title={empty}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          onClick={() => onChange("")}
        >
          <svg aria-hidden viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="m5 5 10 10M15 5 5 15" />
          </svg>
        </button>
      ) : (
        <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400">
          <path d="M5.2 7.7a.75.75 0 0 1 1.06.04L10 11.7l3.74-3.96a.75.75 0 1 1 1.1 1.02l-4.3 4.55a.75.75 0 0 1-1.08 0L5.16 8.76a.75.75 0 0 1 .04-1.06Z" />
        </svg>
      )}
      {open && (
        <ul ref={listRef} id={listId} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full min-w-64 overflow-auto rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg">
          {rows.map((r, i) => (
            <li
              key={r.id || "none"}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={r.id === value}
              // Keeps the focus in the input, so the tap is not lost to blur.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(r.id)}
              onMouseEnter={() => setActive(i)}
              className={cn("flex cursor-pointer items-center gap-2 px-3 py-2", i === active ? "bg-esn/10 text-esn-dark" : "text-gray-800", !r.id && "border-b border-gray-100 italic text-gray-600")}
            >
              <span className="w-5 shrink-0 text-center" aria-hidden>
                {r.emoji}
              </span>
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              {r.category && <span className="shrink-0 text-xs text-gray-400">{r.category}</span>}
              {r.id === value && (
                <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-esn" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m4.5 10.5 3.5 3.5 7.5-8" />
                </svg>
              )}
            </li>
          ))}
          {rows.length === 0 && <li className="px-3 py-3 text-center text-xs text-gray-500">Nothing matches “{query.trim()}” – clear the search for “{empty}”.</li>}
        </ul>
      )}
      {open && words.length > 0 && hits.length > 0 && (
        <span className="sr-only" aria-live="polite">
          {hits.length} matches
        </span>
      )}
    </div>
  );
}
