"use client";

import { useState } from "react";
import { Badge, Button, Input, buttonVariants } from "@/components/ui";
import { ActionButton, useAction } from "@/components/ActionButton";
import { markEsnUploaded, unmarkEsnUploaded } from "@/app/actions/esn";
import { ESN_STATUS_LABEL, esnUploadUrl, isEsnActivityUrl, type EsnStatus } from "@/lib/esn/formData";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

export const ESN_TONE: Record<EsnStatus["state"], "gray" | "blue" | "green"> = { not_ready: "gray", ready: "blue", uploaded: "green" };

/**
 * An event's ESN Activities status (brief 2026-10-29, B) with Comms'
 * actions: open the ESN form (the browser script fills it), or paste the
 * saved activity's link by hand. `compact`: one line for the Comms page.
 */
export function EsnUpload({ eventId, status, canSet, compact = false }: { eventId: string; status: EsnStatus; canSet: boolean; compact?: boolean }) {
  const [pasting, setPasting] = useState(false);
  const [url, setUrl] = useState("");
  const { run, pending, error, setError } = useAction();

  if (status.state === "uploaded") {
    return (
      <div className={cn("flex flex-wrap items-center gap-2 text-sm", compact && "text-xs")} data-testid="esn-status">
        <Badge tone="green">{ESN_STATUS_LABEL.uploaded}</Badge>
        <a href={status.url} target="_blank" rel="noopener noreferrer" className="text-esn hover:underline">
          View on ESN Activities
        </a>
        <span className="text-xs text-gray-500">
          {status.by} · {formatDateTime(status.at)}
          {status.via === "manual" ? " · linked by hand" : ""}
        </span>
        {canSet && !compact && (
          <ActionButton action={unmarkEsnUploaded} input={{ event_id: eventId }} variant="ghost" confirm="Take the ESN Activities link back? (The Chat message stays.)">
            Take back
          </ActionButton>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="esn-status">
      <div className={cn("flex flex-wrap items-center gap-2", compact ? "text-xs" : "text-sm")}>
        <Badge tone={status.state === "ready" ? "blue" : "gray"}>{ESN_STATUS_LABEL[status.state]}</Badge>
        {canSet && (
          <>
            <a
              href={esnUploadUrl(eventId)}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ size: "sm", variant: status.state === "ready" ? "default" : "outline" })}
              data-testid="open-esn-form"
            >
              Open ESN form
            </a>
            {!pasting && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setPasting(true)}>
                Paste link
              </Button>
            )}
          </>
        )}
      </div>
      {status.state === "not_ready" && !compact && (
        <ul className="list-disc pl-5 text-xs text-gray-600" data-testid="esn-missing">
          {status.missing.map((m) => (
            <li key={m}>Missing: {m}</li>
          ))}
        </ul>
      )}
      {status.state === "not_ready" && compact && <p className="text-xs text-gray-500">Missing: {status.missing.join(" · ")}</p>}
      {pasting && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isEsnActivityUrl(url)) return setError("Paste the link of the saved activity (https://activities.esn.org/activity/…).");
            run(markEsnUploaded, { event_id: eventId, url }, () => {
              setPasting(false);
              setUrl("");
            });
          }}
        >
          <Input aria-label="ESN activity link" placeholder="https://activities.esn.org/activity/…" value={url} onChange={(e) => setUrl(e.target.value)} className="grow min-w-0 w-64" />
          <Button size="sm" disabled={pending}>
            Mark uploaded
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setPasting(false)}>
            Cancel
          </Button>
        </form>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
