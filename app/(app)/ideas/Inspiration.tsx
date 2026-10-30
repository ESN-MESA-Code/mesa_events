"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, Select } from "@/components/ui";
import { EVENT_TYPES, EVENT_TYPE_LABELS, type EventType } from "@/lib/labels";
import { BIG_TURNOUT, SEASONS, ideaFromEvent, searchInspiration, teaser, type IdeaPrefill, type PastEvent } from "@/lib/inspiration";
import { formatDate, monthLabel } from "@/lib/dates";
import { plural } from "@/lib/plural";
import { IdeaForm } from "./IdeaForm";

/** Events per "page" of the infinite scroll. */
const PAGE = 12;

const MONTHS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthLabel(`2000-${String(i + 1).padStart(2, "0")}-01`).replace(" 2000", "") }));

/**
 * /ideas with "Get inspired" (brief 2026-10-29, D): the idea form, the
 * member's ideas (children), and the search over previous events; "Propose
 * this again" fills the form with a fresh date.
 */
export function IdeasWorkspace({ pool, today, children }: { pool: PastEvent[]; today: string; children: React.ReactNode }) {
  const [prefill, setPrefill] = useState<(IdeaPrefill & { nonce: number }) | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<EventType | "">("");
  const [when, setWhen] = useState("");
  const [bigTurnout, setBigTurnout] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  // How far the member scrolled, for the current search (a new search or filter starts at the first page).
  const filterKey = JSON.stringify([query, type, when, bigTurnout]);
  const [page, setPage] = useState({ key: filterKey, limit: PAGE });
  const limit = page.key === filterKey ? page.limit : PAGE;
  const loadMore = () => setPage((p) => ({ key: filterKey, limit: (p.key === filterKey ? p.limit : PAGE) + PAGE }));
  const { results, total, groups } = useMemo(() => searchInspiration(pool, { query, type, when, bigTurnout }, limit), [pool, query, type, when, bigTurnout, limit]);
  const more = results.length < groups;
  const sentinel = useRef<HTMLDivElement>(null);

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

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card id="propose" className="scroll-mt-4">
          <CardHeader>
            <CardTitle>Propose an idea</CardTitle>
          </CardHeader>
          <CardContent>
            {prefill && <p className="mb-3 text-xs text-esn-dark">Filled in from “{prefill.title}” – change anything you like.</p>}
            <IdeaForm prefill={prefill} />
          </CardContent>
        </Card>
        {children}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Get inspired</CardTitle>
          <span className="text-xs text-gray-500">{plural(pool.length, "previous event")}</span>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))_auto] sm:items-center">
            <Input aria-label="Search previous events" placeholder="e.g. hike, quiz, dinner, museum" value={query} onChange={(e) => setQuery(e.target.value)} />
            <Select aria-label="Event type" value={type} onChange={(e) => setType(e.target.value as EventType | "")}>
              <option value="">Any type</option>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EVENT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
            <Select aria-label="Time of year" value={when} onChange={(e) => setWhen(e.target.value)}>
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
            <label className="flex items-center gap-2 whitespace-nowrap text-sm text-gray-700">
              <input type="checkbox" checked={bigTurnout} onChange={(e) => setBigTurnout(e.target.checked)} /> Big turnout ({BIG_TURNOUT}+)
            </label>
          </div>
          <p className="text-xs text-gray-500" data-testid="inspiration-count">
            {query ? `${plural(total, "match", "matches")}` : "The most recent events first"}
            {results.length ? ` – ${results.length} of ${plural(groups, "event")} shown, repeats grouped` : ""}
          </p>
          {!results.length ? (
            <EmptyState>Nothing found – try another word or fewer filters.</EmptyState>
          ) : (
            <ul className="divide-y divide-gray-100" data-testid="inspiration-results">
              {results.map(({ event: e, earlier, times }) => (
                <li key={e.event_id} className="space-y-1.5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{e.title}</span>
                    <Badge>{EVENT_TYPE_LABELS[e.type]}</Badge>
                    {times > 1 && (
                      <button type="button" className="text-xs text-esn hover:underline" onClick={() => setOpen(open === e.event_id ? null : e.event_id)} aria-expanded={open === e.event_id}>
                        +{times - 1} earlier
                      </button>
                    )}
                    <span className="ml-auto text-xs text-gray-500">
                      {formatDate(e.starts_at)}
                      {e.ends_at && formatDate(e.ends_at) !== formatDate(e.starts_at) ? ` – ${formatDate(e.ends_at)}` : ""}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 break-words">{teaser({ hook: e.hook, intro: e.intro }) || e.venue}</p>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                    {e.venue && <span>📍 {e.venue}</span>}
                    <span>{e.headcount !== null ? `👥 ${plural(e.headcount, "person", "people")}` : "👥 no headcount"}</span>
                    <span>{times > 1 ? `ran ${times} times` : "ran once"}</span>
                    {e.photo_folder_url && (
                      <a href={e.photo_folder_url} target="_blank" rel="noopener noreferrer" className="text-esn hover:underline">
                        📁 Photos
                      </a>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      onClick={() => {
                        setPrefill({ ...ideaFromEvent(e, earlier, today), nonce: Date.now() });
                        document.getElementById("propose")?.scrollIntoView({ behavior: "smooth" });
                      }}
                    >
                      Propose this again
                    </Button>
                  </p>
                  {open === e.event_id && (
                    <ul className="ml-4 list-disc pl-4 text-xs text-gray-500" data-testid="earlier-runs">
                      {earlier.map((x) => (
                        <li key={x.event_id}>
                          {formatDate(x.starts_at)} · {x.title}
                          {x.headcount !== null ? ` · ${plural(x.headcount, "person", "people")}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          {more && (
            <div ref={sentinel} className="flex justify-center pt-2" data-testid="inspiration-more">
              <Button type="button" variant="outline" size="sm" onClick={loadMore}>
                Load more
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
