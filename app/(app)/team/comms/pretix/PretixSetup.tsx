"use client";

import { useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { setPretixReady } from "@/app/actions/publishing";

/**
 * One event's pretix page (round 2026-11-09): its link and "Mark set up";
 * once set up, the link can be changed or the tick taken back. The link
 * goes under the event's Telegram message ("Sign up") and is required
 * (round 2026-11-11): Finance matches the ticket sales to the event by it.
 */
export function PretixSetup({ event, state, editable }: { event: { id: string; title: string }; state: { link: string | null } | null; editable: boolean }) {
  const { run, pending, error } = useAction();
  const [link, setLink] = useState(state?.link ?? "");
  const done = !!state;
  const changed = link.trim() !== (state?.link ?? "");

  if (!editable)
    return done ? (
      <span className="inline-flex items-center gap-1 text-emerald-700">
        <Check className="h-4 w-4" aria-hidden="true" /> Set up
      </span>
    ) : (
      <span className="text-gray-500">Not set up yet</span>
    );

  return (
    <form
      className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:flex-nowrap"
      onSubmit={(e) => (e.preventDefault(), run(setPretixReady, { event_id: event.id, ready: true, link: link.trim() }, undefined, done ? "pretix link saved." : `pretix page of ${event.title} set up.`))}
      data-testid={`pretix-${event.id}`}
    >
      <Input
        aria-label={`pretix link of ${event.title}`}
        placeholder="https://pretix.eu/esnmesa/<event>/"
        required
        className="h-8 min-w-0 flex-1 text-xs sm:w-64"
        value={link}
        onChange={(e) => setLink(e.target.value)}
      />
      {!done ? (
        <Button size="sm" disabled={pending || !link.trim()} className="h-8 shrink-0" title={link.trim() ? undefined : "Paste the pretix link first – Finance matches the ticket sales by it"}>
          <Check className="mr-1 h-4 w-4" aria-hidden="true" />
          Mark set up
        </Button>
      ) : changed ? (
        <Button size="sm" variant="outline" disabled={pending} className="h-8 shrink-0">
          Save link
        </Button>
      ) : (
        <>
          {state?.link && (
            <a href={state.link} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 px-1 text-xs font-medium text-esn hover:underline">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> open
            </a>
          )}
          <button
            type="button"
            className="shrink-0 px-1 text-xs text-gray-500 hover:text-red-600 hover:underline"
            disabled={pending}
            onClick={() => run(setPretixReady, { event_id: event.id, ready: false, link: "" }, () => setLink(""), "pretix tick taken back.")}
          >
            Undo
          </button>
        </>
      )}
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </form>
  );
}
