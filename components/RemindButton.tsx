"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { remindOc } from "@/app/actions/descriptions";

/** "Remind OC": a Chat reminder through the jobs queue, at most once a day. */
export function RemindButton({ eventId, about, title }: { eventId: string; about: "description" | "report"; title?: string }) {
  const { run, pending, error } = useAction();
  const [done, setDone] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending || !!done}
        onClick={() =>
          run(
            remindOc,
            { event_id: eventId, about },
            (d) => setDone(d.sent ? "Reminded ✓" : "Reminded today already"),
            (d) => (d.sent ? `Reminder sent to the OC${title ? ` of ${title}` : ""} in Chat.` : null)
          )
        }
      >
        {pending ? "…" : (done ?? "Remind OC")}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-red-600 max-w-xs">
          {error}
        </span>
      )}
    </span>
  );
}
