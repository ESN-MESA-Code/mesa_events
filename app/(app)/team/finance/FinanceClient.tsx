"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { decidePreapproval, setTripBudget } from "@/app/actions/handin";
import { formatCents, parseEuroToCents } from "@/lib/dates";

export function PreapprovalDecision({ id }: { id: string }) {
  const { run, pending, error } = useAction();
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="h-8 w-48" />
      <Button size="sm" variant="success" disabled={pending} onClick={() => run(decidePreapproval, { id, approve: true, note })}>
        Approve
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(decidePreapproval, { id, approve: false, note })}>
        Decline
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

export function TripBudgetForm({ eventId, current, disabled }: { eventId: string; current: number | null; disabled: boolean }) {
  const { run, pending, error, setError } = useAction();
  const [value, setValue] = useState(current === null ? "" : (current / 100).toFixed(2));
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const cents = parseEuroToCents(value);
        if (cents === null) return setError("Enter an amount.");
        run(setTripBudget, { event_id: eventId, amount_cents: cents });
      }}
    >
      <span className="text-xs text-gray-500">{current === null ? "no budget" : `budget ${formatCents(current)}`}</span>
      <Input aria-label="Trip budget in €" value={value} onChange={(e) => setValue(e.target.value)} className="h-8 w-24" disabled={disabled} />
      <Button size="sm" variant="outline" disabled={pending || disabled}>
        Set
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
