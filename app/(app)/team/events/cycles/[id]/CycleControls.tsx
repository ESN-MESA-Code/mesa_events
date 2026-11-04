"use client";

import { useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { ActionButton, useAction } from "@/components/ActionButton";
import type { CycleStatus } from "@/lib/labels";
import { closeForm, confirmAllocation, openForm, runAllocation } from "@/app/actions/planning";
import { setDescriptionDeadline } from "@/app/actions/descriptions";
import { plural } from "@/lib/plural";

/** Volunteer form page: open (with its deadline), close early, reopen. */
export function FormControls({
  cycleId,
  month,
  answers,
  status,
  formLatest,
  standard,
}: {
  cycleId: string;
  /** "December 2026" and the answers so far – named in the confirm dialog. */
  month: string;
  answers: number;
  status: CycleStatus;
  /** The latest allowed deadline (review 2026-10-29 A5): Berlin input value and label. */
  formLatest: { input: string; label: string };
  /** The timeline's closing day (round 2026-11-02) while still ahead: the field starts with it. */
  standard: { input: string; label: string } | null;
}) {
  const { run, pending, error } = useAction();
  const [closes, setCloses] = useState(standard?.input ?? "");
  return (
    <div className="space-y-3">
      {(status === "planning" || status === "form_closed") && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(openForm, { cycle_id: cycleId, closes_at: closes }, undefined, `The volunteer form for ${month} is open – members see it on Home.`);
          }}
        >
          <Field label="Form deadline" htmlFor="form-deadline" hint={`${standard ? `Standard: ${standard.label}. ` : ""}At the latest ${formLatest.label} (the month's first day)`}>
            <Input id="form-deadline" type="datetime-local" value={closes} max={formLatest.input} onChange={(e) => setCloses(e.target.value)} required />
          </Field>
          <Button disabled={pending || !closes}>{status === "planning" ? "Open volunteer form" : "Reopen form"}</Button>
          <OffStandard value={closes} standard={standard} what="Members expect sign-up to close" />
        </form>
      )}
      {status === "form_open" && (
        <ActionButton
          action={closeForm}
          input={{ cycle_id: cycleId }}
          variant="outline"
          size="default"
          confirm={{
            title: `Close the volunteer form for ${month} now?`,
            body: `${plural(answers, "member")} answered so far. Nobody can answer after closing; you can reopen it until the allocation runs.`,
            confirmLabel: "Close the form",
          }}
          done="Volunteer form closed – the allocation is next."
        >
          Close form now
        </ActionButton>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

/** Roster page: run (or re-run) the allocation, confirm the roster. */
export function AllocationControls({ cycleId, month, status }: { cycleId: string; month: string; status: CycleStatus }) {
  const { run, pending, error, confirm } = useAction();
  const [summary, setSummary] = useState<string | null>(null);
  if (status !== "form_closed" && status !== "allocated") return null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={status === "form_closed" ? "default" : "outline"}
          disabled={pending}
          onClick={async () => {
            if (
              status === "allocated" &&
              !(await confirm({ title: `Run the allocation for ${month} again?`, body: "Manual roster changes are replaced by a fresh allocation.", confirmLabel: "Re-run allocation", danger: true }))
            )
              return;
            run(runAllocation, { cycle_id: cycleId }, (d) => {
              const r = d as { assignments: number; events: Record<string, { status: string }>; issues: unknown[]; unplaced: number; topChoices: { wished: number; met: number } };
              const st = Object.values(r.events).map((e) => e.status);
              setSummary(
                [
                  `${r.assignments} assignments`,
                  `${st.filter((s) => s === "staffed").length} staffed`,
                  `${st.filter((s) => s === "understaffed" || s === "no_oc").length} short`,
                  `${st.filter((s) => s === "dropped").length} dropped`,
                  r.topChoices.wished > 0 && `${r.topChoices.met} of ${r.topChoices.wished} top choices met`,
                  `${plural(r.unplaced, "volunteer")} without an event`,
                  r.issues.length > 0 && `${plural(r.issues.length, "person", "people")} from an idea on two overlapping events – place them by hand`,
                ]
                  .filter(Boolean)
                  .join(" · ")
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
            confirm={{
              title: `Confirm the roster for ${month}?`,
              body: "Events without anybody are dropped, Chat spaces are created and everyone sees the roster. Changes afterwards are announced in the Chat spaces.",
              confirmLabel: "Confirm roster",
            }}
            done="Roster confirmed – Chat spaces are being created."
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
 * The month's description deadline while it is ahead: set once the roster
 * is confirmed (events whose description is not submitted by then are
 * cancelled). Once passed, the Descriptions tab shows it as a line.
 */
export function DeadlineControl({
  cycleId,
  status,
  deadline,
  deadlineLabel,
  latest,
  standard,
  canEdit,
}: {
  cycleId: string;
  status: CycleStatus;
  /** Berlin input value ("" when not set). */
  deadline: string;
  deadlineLabel: string | null;
  latest: { input: string; label: string } | null;
  /** The timeline's description day (round 2026-11-02) while still ahead: the field starts with it when no deadline is set. */
  standard: { input: string; label: string } | null;
  canEdit: boolean;
}) {
  const { run, pending, error } = useAction();
  const [value, setValue] = useState(deadline || standard?.input || "");
  if (status !== "confirmed") {
    return (
      <p className="text-sm text-gray-600" data-testid="deadline-not-yet">
        The description deadline is set once the roster is confirmed.
      </p>
    );
  }
  if (!canEdit) return <p className="text-sm text-gray-700">{deadlineLabel ? `Deadline: ${deadlineLabel}` : "No deadline set yet."}</p>;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(setDescriptionDeadline, { cycle_id: cycleId, deadline: value || null }, undefined, value ? "Description deadline saved." : "Description deadline removed.");
      }}
    >
      <Field
        label="Description deadline (all events of the month)"
        htmlFor="desc-deadline"
        hint={`${standard ? `Standard: ${standard.label}. ` : ""}${latest ? `At the latest ${latest.label} (when the first event starts). ` : ""}Events whose description is not submitted by then are cancelled automatically.`}
      >
        <Input id="desc-deadline" type="datetime-local" value={value} max={latest?.input} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <Button variant="outline" disabled={pending}>
        Save deadline
      </Button>
      <OffStandard value={value} standard={standard} what="OCs expect the descriptions to be due" />
      {error && <Alert tone="error" className="w-full">{error}</Alert>}
    </form>
  );
}

/** A note when a deadline field differs from the timeline's standard date (round 2026-11-02). */
function OffStandard({ value, standard, what }: { value: string; standard: { input: string; label: string } | null; what: string }) {
  if (!standard || !value || value === standard.input) return null;
  return (
    <p className="w-full text-xs text-amber-800" data-testid="off-standard">
      Not the standard date – {what.charAt(0).toLowerCase()}{what.slice(1)} on {standard.label}.
    </p>
  );
}
