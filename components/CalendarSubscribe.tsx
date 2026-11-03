"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Input } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { createCalendarFeed, revokeCalendarFeed } from "@/app/actions/calendar";

/** The same feed for calendar apps that want webcal:// (Apple, Outlook). */
const webcalUrl = (url: string) => url.replace(/^https?:\/\//, "webcal://");

/**
 * Subscribe in Google Calendar, Apple Calendar or Outlook (round 2026-10-30):
 * a personal secret link, shown once (only its hash is stored); a new link
 * stops the old one. A button in the Calendar’s top row that opens a panel
 * (round 2026-11-03 (2)) instead of a card under the calendar.
 */
export function CalendarSubscribe({ feed }: { feed: { since: string; lastUsed: string | null } | null }) {
  const { run, pending, error, confirm } = useAction();
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const google = url ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl(url))}` : null;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Close on outside clicks and Escape – not while a confirm dialog is up (it sits outside the panel).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as Element).closest?.("[role=dialog],[role=alertdialog]")) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative" data-testid="calendar-subscribe">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:text-esn"
      >
        📅 Subscribe
      </button>
      {open && (
        <div role="region" aria-label="Subscribe to the calendar" className="absolute left-0 z-30 mt-2 w-[min(24rem,calc(100vw-2rem))] sm:left-auto sm:right-0 space-y-3 rounded-xl border border-gray-200 bg-white p-4 text-sm shadow-xl">
          <p className="font-semibold text-gray-900">Subscribe to the calendar</p>
          <p className="text-gray-600">
            All scheduled MESA events and the internal events, meetings and office hours you can see, in your own calendar app – it updates by itself. Your link is personal: don&apos;t share it.
          </p>
          {url ? (
            <div className="space-y-2">
              <p className="font-medium text-emerald-700">Your link – copy it now, it is shown only once:</p>
              <div className="flex flex-wrap gap-2">
                <Input readOnly value={url} aria-label="Calendar link" className="min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.target.select()} data-testid="feed-url" />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard?.writeText(url).then(() => setCopied(true), () => setCopied(false));
                  }}
                >
                  {copied ? "Copied ✓" : "Copy"}
                </Button>
              </div>
              <div className="flex flex-wrap gap-3">
                <a href={google!} target="_blank" rel="noopener noreferrer" className="text-esn hover:underline">
                  Add to Google Calendar ↗
                </a>
                <a href={webcalUrl(url)} className="text-esn hover:underline">
                  Open in Apple Calendar / Outlook
                </a>
                <a href={url} className="text-esn hover:underline" download="esn-mesa.ics">
                  Download .ics
                </a>
              </div>
            </div>
          ) : feed ? (
            <p className="text-gray-700" data-testid="feed-active">
              You have a calendar link since {feed.since}
              {feed.lastUsed ? ` (last fetched ${feed.lastUsed})` : " (not fetched yet)"}. Lost it? Make a new one – the old one stops working.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={() => run(createCalendarFeed, {}, (r) => setUrl(r.url))}>
              {feed || url ? "Make a new link" : "Get my calendar link"}
            </Button>
            {(feed || url) && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={async () => {
                  if (await confirm({ title: "Turn off your calendar link?", body: "Calendar apps using it stop updating. You can make a new link any time.", confirmLabel: "Turn off", danger: true }))
                    run(revokeCalendarFeed, {}, () => setUrl(null), "Calendar link turned off.");
                }}
              >
                Turn off
              </Button>
            )}
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
