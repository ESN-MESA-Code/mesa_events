"use client";

import { useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { ActionButton, useAction } from "@/components/ActionButton";
import type { CycleStatus } from "@/lib/labels";
import { closeForm, confirmAllocation, openForm, runAllocation } from "@/app/actions/planning";
import { setDescriptionDeadline } from "@/app/actions/descriptions";

/** Volunteer form page: open (with its deadline), close early, reopen. */
export function FormControls({
  cycleId,
  status,
  formLatest,
}: {
  cycleId: string;
  status: CycleStatus;
  /** The latest allowed deadline (review 2026-10-29 A5): Berlin input value and label. */
  formLatest: { input: string; label: string };
}) {
  const { run, pending, error } = useAction();
  const [closes, setCloses] = useState("");
  return (
    <div className="space-y-3">
      {(status === "planning" || status === "form_closed") && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(openForm, { cycle_id: cycleId, closes_at: closes });
          }}
        >
          <Field label="Form deadline" htmlFor="form-deadline" hint={`At the latest ${formLatest.label} (the month's first day)`}>
            <Input id="form-deadline" type="datetime-local" value={closes} max={formLatest.input} onChange={(e) => setCloses(e.target.value)} required />
          </Field>
          <Button disabled={pending || !closes}>{status === "planning" ? "Open volunteer form" : "Reopen form"}</Button>
        </form>
      )}
      {status === "form_open" && (
        <ActionButton action={closeForm} input={{ cycle_id: cycleId }} variant="outline" size="default" confirm="Close the volunteer form now?">
          Close form now
        </ActionButton>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

/** Roster page: run (or re-run) the allocation, confirm the roster. */
export function AllocationControls({ cycleId, status }: { cycleId: string; status: CycleStatus }) {
  const { run, pending, error } = useAction();
  const [summary, setSummary] = useState<string | null>(null);
  if (status !== "form_closed" && status !== "allocated") return null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={status === "form_closed" ? "default" : "outline"}
          disabled={pending}
          onClick={() => {
            if (status === "allocated" && !window.confirm("Run the allocation again? Manual roster changes are replaced.")) return;
            run(runAllocation, { cycle_id: cycleId }, (d) => {
              const r = d as { assignments: number; events: Record<string, { status: string }>; conflicts: unknown[] };
              const st = Object.values(r.events).map((e) => e.status);
              setSummary(
                `${r.assignments} assignments · ${st.filter((s) => s === "staffed").length} staffed · ${st.filter((s) => s === "understaffed" || s === "no_oc").length} short · ${st.filter((s) => s === "dropped").length} dropped · ${r.conflicts.length} time conflicts`
              );
            });
          }}
        >
          {status === "form_closed" ? "Run allocation" : "Re-run allocation"}
        </Button>
        {status === "allocated" && (
          <ActionButton
            action={confirmAllocation}
            input={{ cycle_id: cycleId }}
            size="default"
            variant="success"
            confirm="Confirm the roster? Events without anybody are dropped, Chat spaces are created and everyone sees the roster."
          >
            Confirm roster
          </ActionButton>
        )}
      </div>
      {summary && <Alert tone="success">Allocation done: {summary}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

/**
 * The month's description deadline: set once the roster is confirmed, to a
 * time ahead; locked once it has passed (events whose description was not
 * submitted by then are cancelled).
 */
export function DeadlineControl({
  cycleId,
  status,
  deadline,
  deadlineLabel,
  passed,
  latest,
  canEdit,
}: {
  cycleId: string;
  status: CycleStatus;
  /** Berlin input value ("" when not set). */
  deadline: string;
  deadlineLabel: string | null;
  passed: boolean;
  latest: { input: string; label: string } | null;
  canEdit: boolean;
}) {
  const { run, pending, error } = useAction();
  const [value, setValue] = useState(deadline);
  if (status !== "confirmed") {
    return (
      <p className="text-sm text-gray-600" data-testid="deadline-not-yet">
        The description deadline is set once the roster is confirmed.
      </p>
    );
  }
  if (passed) {
    return (
      <p className="text-sm text-gray-700" data-testid="deadline-locked">
        🔒 Deadline <strong>{deadlineLabel}</strong> has passed and can no longer be changed. Events whose description was not submitted by then were cancelled.
      </p>
    );
  }
  if (!canEdit) return <p className="text-sm text-gray-700">{deadlineLabel ? `Deadline: ${deadlineLabel}` : "No deadline set yet."}</p>;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(setDescriptionDeadline, { cycle_id: cycleId, deadline: value || null });
      }}
    >
      <Field
        label="Description deadline (all events of the month)"
        htmlFor="desc-deadline"
        hint={`${latest ? `At the latest ${latest.label} (when the first event starts). ` : ""}Events whose description is not submitted by then are cancelled automatically.`}
      >
        <Input id="desc-deadline" type="datetime-local" value={value} max={latest?.input} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <Button variant="outline" disabled={pending}>
        Save deadline
      </Button>
      {error && <Alert tone="error" className="w-full">{error}</Alert>}
    </form>
  );
}
