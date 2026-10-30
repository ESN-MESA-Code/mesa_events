"use client";

import { useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { createCalendarFeed, revokeCalendarFeed } from "@/app/actions/calendar";

/** The same feed for calendar apps that want webcal:// (Apple, Outlook). */
const webcalUrl = (url: string) => url.replace(/^https?:\/\//, "webcal://");

/**
 * Subscribe in Google Calendar, Apple Calendar or Outlook (round 2026-10-30):
 * a personal secret link, shown once (only its hash is stored); a new link
 * stops the old one.
 */
export function CalendarSubscribe({ feed }: { feed: { since: string; lastUsed: string | null } | null }) {
  const { run, pending, error } = useAction();
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const google = url ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl(url))}` : null;
  return (
    <Card data-testid="calendar-subscribe">
      <CardHeader>
        <CardTitle>Subscribe to the calendar</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
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
              onClick={() => {
                if (window.confirm("Turn off your calendar link? Calendar apps using it stop updating.")) run(revokeCalendarFeed, {}, () => setUrl(null));
              }}
            >
              Turn off
            </Button>
          )}
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
