"use client";

import { useState } from "react";
import { Alert, Button, Field, Input, Textarea } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { saveEventReport } from "@/app/actions/esn";
import type { EventReport } from "@/lib/esn/formData";

/**
 * The event report after the event (brief 2026-10-29, B; the bot's report
 * dialog): what ESN Activities asks about the outcome. Prefilled from the
 * attendance list (headcount, German nationality = local) and the roster.
 */
export function EventReportForm({
  eventId,
  report,
  prefill,
}: {
  eventId: string;
  report: EventReport | null;
  prefill: { headcount: number | null; local: number; organizers: number };
}) {
  const { run, pending, error, setError } = useAction();
  const [saved, setSaved] = useState(false);
  const intlDefault = prefill.headcount !== null ? Math.max(prefill.headcount - prefill.local, 0) : null;
  const [v, setV] = useState({
    intl: String(report?.intl_participants ?? intlDefault ?? ""),
    local: String(report?.local_participants ?? (prefill.headcount !== null ? prefill.local : "")),
    organizers: String(report?.organizers ?? prefill.organizers),
    reached: report?.goals_reached ?? true,
    wentWell: report?.went_well ?? "",
    better: report?.could_be_better ?? "",
    accessNeeds: report?.access_needs ?? false,
    accessNote: report?.access_note ?? "",
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setV((x) => ({ ...x, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));
  const num = (s: string) => (/^\d{1,5}$/.test(s.trim()) ? Number(s.trim()) : NaN);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    const intl = num(v.intl);
    const local = v.local.trim() ? num(v.local) : 0;
    const organizers = num(v.organizers);
    const problems = [
      Number.isNaN(intl) && "International participants: please enter a number.",
      Number.isNaN(local) && "Local participants: please enter a number.",
      Number.isNaN(organizers) && "Organizers / volunteers: please enter a number.",
      !v.wentWell.trim() && "Tell us in 1–2 sentences what went well.",
    ].filter(Boolean);
    if (problems.length) return setError(problems.join(" "));
    run(
      saveEventReport,
      {
        event_id: eventId,
        intl_participants: intl,
        local_participants: local,
        organizers,
        goals_reached: v.reached,
        went_well: v.wentWell,
        could_be_better: v.better,
        access_needs: v.accessNeeds,
        access_note: v.accessNeeds ? v.accessNote : "",
      },
      () => setSaved(true)
    );
  }

  return (
    <form className="grid gap-3 sm:grid-cols-3" onSubmit={submit} data-testid="event-report-form">
      <Field label="International participants" htmlFor="rep-intl" hint={intlDefault !== null && !report ? "From the attendance list" : undefined}>
        <Input id="rep-intl" inputMode="numeric" value={v.intl} onChange={set("intl")} required />
      </Field>
      <Field label="Local participants" htmlFor="rep-local" hint="0 if none">
        <Input id="rep-local" inputMode="numeric" value={v.local} onChange={set("local")} />
      </Field>
      <Field label="Organizers / volunteers" htmlFor="rep-org">
        <Input id="rep-org" inputMode="numeric" value={v.organizers} onChange={set("organizers")} required />
      </Field>
      <label className="sm:col-span-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.reached} onChange={set("reached")} /> The goals of the event were reached
      </label>
      <div className="sm:col-span-3">
        <Field label="What went well?" htmlFor="rep-well" hint="1–2 sentences – shown publicly on ESN Activities as the outcome">
          <Textarea id="rep-well" rows={2} value={v.wentWell} onChange={set("wentWell")} maxLength={1000} required />
        </Field>
      </div>
      <div className="sm:col-span-3">
        <Field label="What could be better? (optional)" htmlFor="rep-better">
          <Textarea id="rep-better" rows={2} value={v.better} onChange={set("better")} maxLength={1000} />
        </Field>
      </div>
      <label className="sm:col-span-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.accessNeeds} onChange={set("accessNeeds")} /> People with accessibility needs took part
      </label>
      {v.accessNeeds && (
        <div className="sm:col-span-3">
          <Field label="How many, and what did you do for them?" htmlFor="rep-access" hint="No names or health details.">
            <Input id="rep-access" value={v.accessNote} onChange={set("accessNote")} maxLength={1000} />
          </Field>
        </div>
      )}
      {error && (
        <Alert tone="error" className="sm:col-span-3">
          {error}
        </Alert>
      )}
      {saved && (
        <Alert tone="success" className="sm:col-span-3">
          Thanks! Report saved.
        </Alert>
      )}
      <div className="sm:col-span-3">
        <Button disabled={pending}>{pending ? "Saving…" : report ? "Update the report" : "Save the report"}</Button>
      </div>
    </form>
  );
}
