"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, MapPin, Repeat, Search, Tag, Users, X } from "lucide-react";
import { Button, EmptyState, Input, Select } from "@/components/ui";
import { SectionHeader } from "@/components/home";
import { EVENT_TYPE_LABELS, EVENT_TYPES, type EventType } from "@/lib/labels";
import { BIG_TURNOUT, SEASONS, earlierEvents, ideaFromEvent, searchInspiration, teaser, type IdeaPrefill, type PastEvent } from "@/lib/inspiration";
import { formatDate, monthLabel } from "@/lib/dates";
import { plural } from "@/lib/plural";
import { categoryLabel, formatStats, sortedCategories, type Category, type Format } from "@/lib/formats";
import { venue } from "@/lib/calendarView";
import { cn } from "@/lib/utils";
import { IdeaForm } from "./IdeaForm";
import type { Member } from "./PartnerPicker";
import type { TimelineDays } from "@/lib/timeline";

/** Events per "page" of the infinite scroll. */
const PAGE = 12;

const MONTHS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthLabel(`2000-${String(i + 1).padStart(2, "0")}-01`).replace(" 2000", "") }));

/** A filter chip: a toggle that looks like a pill. */
const chip = (on: boolean) =>
  cn(
    "inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
    on ? "border-esn bg-esn text-white" : "border-gray-200 bg-white text-gray-700 hover:border-esn/40 hover:text-esn"
  );

/**
 * /ideas (redesign 2026-11-07): the member's own part of the page (children),
 * the idea form in a side panel (opened by any link to #propose, and by
 * "Propose this again" with the form prefilled), and "Get inspired", the
 * previous events as a gallery (brief 2026-10-29, D). Runs of one format are
 * one card; the category filters (round 2026-11-01).
 */
export function IdeasWorkspace({
  pool,
  earliest,
  days,
  categories,
  formats,
  members,
  children,
}: {
  pool: PastEvent[];
  /** Who can be named as partner on an idea. */
  members: Member[];
  /** The first day a new idea may be dated (round 2026-11-02). */
  earliest: string;
  days: TimelineDays;
  categories: Category[];
  formats: Format[];
  children: React.ReactNode;
}) {
  const [prefill, setPrefill] = useState<(IdeaPrefill & { nonce: number }) | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<EventType | "">("");
  const [category, setCategory] = useState("");
  const [when, setWhen] = useState("");
  const [bigTurnout, setBigTurnout] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  // How far the member scrolled, for the current search (a new search or filter starts at the first page).
  const filterKey = JSON.stringify([query, type, category, when, bigTurnout]);
  const [page, setPage] = useState({ key: filterKey, limit: PAGE });
  const limit = page.key === filterKey ? page.limit : PAGE;
  const loadMore = () => setPage((p) => ({ key: filterKey, limit: (p.key === filterKey ? p.limit : PAGE) + PAGE }));
  const { results, total, groups } = useMemo(() => searchInspiration(pool, { query, type, category, when, bigTurnout }, limit), [pool, query, type, category, when, bigTurnout, limit]);
  const categoryOf = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const formatOf = useMemo(() => new Map(formats.map((f) => [f.id, f])), [formats]);
  // What the idea form's title offers: the earlier events, runs of one event together.
  const earlier = useMemo(() => earlierEvents(pool, formats), [pool, formats]);
  const chips = useMemo(() => sortedCategories(categories).filter((c) => c.active), [categories]);
  const more = results.length < groups;
  const filtered = !!(query || type || category || when || bigTurnout);
  const sentinel = useRef<HTMLDivElement>(null);

  // The propose panel: a modal <dialog> (focus stays inside, Esc closes it).
  const dialog = useRef<HTMLDialogElement>(null);
  const openPanel = useCallback(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    document.documentElement.style.overflow = "hidden";
  }, []);
  const closePanel = () => dialog.current?.close();
  const onClosed = () => {
    document.documentElement.style.overflow = "";
    // So the next click on a #propose link opens it again.
    if (window.location.hash === "#propose") history.replaceState(null, "", window.location.pathname + window.location.search);
  };
  useEffect(() => {
    const check = () => window.location.hash === "#propose" && openPanel();
    check();
    window.addEventListener("hashchange", check);
    return () => {
      window.removeEventListener("hashchange", check);
      document.documentElement.style.overflow = "";
    };
  }, [openPanel]);

  // Infinite scroll: the next page loads when the end of the list comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => entries.some((x) => x.isIntersecting) && loadMore(), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
    // loadMore follows from filterKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [more, results.length, filterKey]);

  const reset = () => {
    setQuery("");
    setType("");
    setCategory("");
    setWhen("");
    setBigTurnout(false);
  };

  return (
    <>
      {children}

      <dialog
        ref={dialog}
        id="propose"
        aria-labelledby="propose-title"
        onClose={onClosed}
        onClick={(e) => e.target === e.currentTarget && closePanel()}
        className="m-0 ml-auto h-dvh max-h-none w-full max-w-xl border-0 bg-white p-0 shadow-2xl backdrop:bg-gray-900/40 open:flex open:flex-col"
      >
        <header className="flex items-start gap-3 border-b border-gray-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="propose-title" className="text-lg font-bold text-gray-900">
              Propose an idea
            </h2>
            <p className="text-sm text-gray-600">{prefill ? `Filled in from “${prefill.title}” – change anything you like.` : "By default you become its OC. You can propose for any month that is still open."}</p>
          </div>
          <button type="button" onClick={closePanel} className="-mr-2 rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900" aria-label="Close">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5">
          <IdeaForm key={prefill?.nonce ?? 0} prefill={prefill} categories={categories} earlier={earlier} earliest={earliest} days={days} members={members} onDone={closePanel} />
        </div>
      </dialog>

      <section aria-labelledby="inspired-heading" className="space-y-4">
        <SectionHeader id="inspired-heading" title="Get inspired" note={`${plural(pool.length, "previous event")} to borrow from`} />

        <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-2 lg:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
              <Input aria-label="Search previous events" type="search" className="pl-9" placeholder="Search: hike, quiz, dinner, museum …" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2 sm:flex">
              <Select aria-label="Event type" className="sm:w-40" value={type} onChange={(e) => setType(e.target.value as EventType | "")}>
                <option value="">Any type</option>
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {EVENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
              <Select aria-label="Time of year" className="sm:w-44" value={when} onChange={(e) => setWhen(e.target.value)}>
                <option value="">Any time of year</option>
                <optgroup label="Season">
                  {Object.entries(SEASONS).map(([k, s]) => (
                    <option key={k} value={k}>
                      {s.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Month">
                  {MONTHS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </optgroup>
              </Select>
              {/* The checkbox covers the whole pill, so a click lands on the input itself. */}
              <label className={cn(chip(bigTurnout), "relative col-span-2 justify-center py-2 sm:col-span-1")}>
                <input type="checkbox" className="absolute inset-0 m-0 cursor-pointer opacity-0" checked={bigTurnout} onChange={(e) => setBigTurnout(e.target.checked)} />
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                Big turnout ({BIG_TURNOUT}+)
              </label>
            </div>
          </div>
          {chips.length > 0 && (
            <div role="group" aria-label="Category" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
              <button type="button" className={chip(!category)} aria-pressed={!category} onClick={() => setCategory("")}>
                All
              </button>
              {chips.map((c) => (
                <button key={c.id} type="button" className={chip(category === c.id)} aria-pressed={category === c.id} onClick={() => setCategory(category === c.id ? "" : c.id)}>
                  {categoryLabel(c)}
                </button>
              ))}
            </div>
          )}
        </div>

        <p className="flex flex-wrap items-center gap-x-3 text-sm text-gray-600" data-testid="inspiration-count">
          <span>
            {query ? `${plural(total, "match", "matches")}` : "The most recent events first"}
            {results.length ? ` – ${results.length} of ${plural(groups, "event")} shown, repeats grouped` : ""}
          </span>
          {filtered && (
            <button type="button" className="font-semibold text-esn hover:underline" onClick={reset}>
              Clear filters
            </button>
          )}
        </p>

        {!results.length ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white">
            <EmptyState>Nothing found – try another word or fewer filters.</EmptyState>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="inspiration-results">
            {results.map(({ event: e, earlier, times }) => {
              const stats = formatStats([e, ...earlier]);
              const format = e.format_id ? formatOf.get(e.format_id) : undefined;
              const cat = e.category_id ? categoryOf.get(e.category_id) : undefined;
              const where = venue(e.venue);
              const ends = e.ends_at && formatDate(e.ends_at) !== formatDate(e.starts_at) ? ` – ${formatDate(e.ends_at)}` : "";
              return (
                <li key={e.event_id} className="flex flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
                  <h3 className="font-semibold leading-snug text-gray-900 break-words">{e.title}</h3>
                  <p className="text-xs text-gray-500">
                    {times > 1 ? "Last ran " : ""}
                    {formatDate(e.starts_at)}
                    {ends}
                  </p>
                  <p className="mt-2 line-clamp-3 text-sm text-gray-600 break-words">{teaser({ hook: e.hook, intro: e.intro }) || e.venue}</p>
                  <div className="mt-3 space-y-1 text-xs text-gray-600">
                    {/* The category (and a type other than standard) as a line like the others, so every card starts with its title. */}
                    <p className="flex min-w-0 items-center gap-1.5" data-testid="inspiration-category">
                      {cat?.emoji ? (
                        <span className="w-3.5 shrink-0 text-center leading-none" aria-hidden="true">
                          {cat.emoji}
                        </span>
                      ) : (
                        <Tag className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                      )}
                      <span className="truncate">
                        {cat ? cat.name : <span className="text-gray-400">No category</span>}
                        {e.type !== "standard" ? ` · ${EVENT_TYPE_LABELS[e.type]}` : ""}
                      </span>
                    </p>
                    <p className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                      {e.headcount !== null ? plural(e.headcount, "person", "people") : "no headcount"}
                    </p>
                    <p className="flex items-center gap-1.5">
                      <Repeat className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                      <span>
                        {times > 1 ? `ran ${times} times` : "ran once"}
                        {times > 1 && stats.avgHeadcount !== null ? `, about ${plural(stats.avgHeadcount, "person", "people")} each` : ""}
                        {format ? ` · ${format.name}` : ""}
                      </span>
                    </p>
                    {where && (
                      <p className="flex min-w-0 items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                        <span className="truncate" title={e.venue ?? undefined}>
                          {where}
                        </span>
                      </p>
                    )}
                  </div>
                  {open === e.event_id && (
                    <ul className="mt-3 space-y-0.5 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600" data-testid="earlier-runs">
                      {earlier.map((x) => (
                        <li key={x.event_id}>
                          {formatDate(x.starts_at)} · {x.title}
                          {x.headcount !== null ? ` · ${plural(x.headcount, "person", "people")}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-4">
                    {times > 1 && (
                      <button type="button" className="text-xs font-semibold text-esn hover:underline" onClick={() => setOpen(open === e.event_id ? null : e.event_id)} aria-expanded={open === e.event_id}>
                        +{times - 1} earlier
                      </button>
                    )}
                    {e.photo_folder_url && (
                      <a href={e.photo_folder_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-esn hover:underline">
                        <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                        Photos
                      </a>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      onClick={() => {
                        setPrefill({ ...ideaFromEvent(e, earlier, earliest, format?.name), nonce: Date.now() });
                        openPanel();
                      }}
                    >
                      Propose this again
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {more && (
          <div ref={sentinel} className="flex justify-center pt-2" data-testid="inspiration-more">
            <Button type="button" variant="outline" onClick={loadMore}>
              Load more
            </Button>
          </div>
        )}
      </section>
    </>
  );
}
