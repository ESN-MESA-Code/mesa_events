"use client";

// After the event (2026-11-07): the OC reports who of the team was missing
// and why. No report = was there. HR and the Events team see it on the
// Reliability page (/team/reliability).
import { useState } from "react";
import { Badge, Button, Select, Textarea } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { clearAttendanceReport, reportAttendance } from "@/app/actions/reliability";
import { ATTENDANCE_OUTCOMES, OUTCOME_LABELS, OUTCOME_SHORT, type AttendanceOutcome } from "@/lib/reliability";

export interface ReportMember {
  assignmentId: string;
  name: string;
  role: "oc" | "helper";
  report: { outcome: AttendanceOutcome; note: string | null } | null;
}

export function AttendanceReport({ eventId, members }: { eventId: string; members: ReportMember[] }) {
  const missing = members.filter((m) => m.report).length;
  return (
    <div data-testid="attendance-report">
      <p className="mb-3 text-sm text-gray-600">
        Was anyone of the team missing? Mark only who wasn&apos;t there – everyone else counts as present. HR and the Events team see this, the person does not.
      </p>
      <ul className="divide-y divide-gray-100">
        {members.map((m) => (
          <Row key={m.assignmentId} eventId={eventId} member={m} />
        ))}
      </ul>
      <p className="mt-3 text-xs text-gray-500">{missing === 0 ? "Everyone was there." : `${missing} of ${members.length} reported missing.`}</p>
    </div>
  );
}

function Row({ eventId, member: m }: { eventId: string; member: ReportMember }) {
  const { run, pending, error } = useAction();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<AttendanceOutcome>(m.report?.outcome ?? "no_show");
  const [note, setNote] = useState(m.report?.note ?? "");

  return (
    <li className="py-2.5 first:pt-0 last:pb-0" data-testid={`attendance-${m.name}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-gray-900">{m.name}</span>
        <span className="text-xs text-gray-500">{m.role === "oc" ? "OC" : "Helper"}</span>
        {m.report ? (
          <Badge tone={m.report.outcome === "excused" ? "gray" : "red"}>{OUTCOME_SHORT[m.report.outcome]}</Badge>
        ) : (
          <Badge tone="green">Was there</Badge>
        )}
        {!open && (
          <span className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              {m.report ? "Change" : "Report missing"}
            </Button>
            {m.report && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(clearAttendanceReport, { event_id: eventId, assignment_id: m.assignmentId }, undefined, `${m.name} marked as there.`)}>
                Was there after all
              </Button>
            )}
          </span>
        )}
      </div>
      {m.report?.note && !open && <p className="mt-1 text-xs text-gray-600">“{m.report.note}”</p>}
      {open && (
        <form
          className="mt-2 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(reportAttendance, { event_id: eventId, assignment_id: m.assignmentId, outcome, note: note || undefined }, () => setOpen(false), `Saved for ${m.name}.`);
          }}
        >
          <Select aria-label={`What happened with ${m.name}`} value={outcome} onChange={(e) => setOutcome(e.target.value as AttendanceOutcome)}>
            {ATTENDANCE_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {OUTCOME_LABELS[o]}
              </option>
            ))}
          </Select>
          <Textarea
            aria-label="Cause or details (optional)"
            placeholder="Cause or details (optional) – e.g. “didn't answer in the Chat”, “told me 2 hours before”"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={2}
          />
          <p className="text-xs text-gray-500">Please no health details – “was ill” is enough.</p>
          <div className="flex gap-2">
            <Button size="sm" disabled={pending}>
              Save
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </li>
  );
}
