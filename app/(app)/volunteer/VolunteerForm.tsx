"use client";

import { useState } from "react";
import { Alert, Button, Select, Textarea } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { submitVolunteerForm } from "@/app/actions/planning";
import { RANK_LABELS } from "@/lib/volunteer";
import { plural } from "@/lib/plural";

type Wish = { oc: number | null; helper: number | null };

const OPTIONS = [{ value: "", label: "No" }, ...[1, 2, 3].map((r) => ({ value: String(r), label: RANK_LABELS[r] }))];

export function VolunteerForm({
  cycleId,
  events,
}: {
  cycleId: string;
  events: Array<{ id: string; title: string; type: string; when: string; location: string; helpers: number }>;
}) {
  const { run, pending, error } = useAction();
  const [wishes, setWishes] = useState<Record<string, Wish>>({});
  const [note, setNote] = useState("");

  const set = (id: string, key: keyof Wish, value: string) =>
    setWishes((w) => ({ ...w, [id]: { oc: w[id]?.oc ?? null, helper: w[id]?.helper ?? null, [key]: value ? Number(value) : null } }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const choices = Object.entries(wishes).map(([event_id, w]) => ({ event_id, oc_rank: w.oc, helper_rank: w.helper }));
        const count = choices.filter((c) => c.oc_rank !== null || c.helper_rank !== null).length;
        if (!window.confirm(`Submit your answers (${plural(count, "event")})? You can submit only once – afterwards ask the Events team to change anything.`)) return;
        run(submitVolunteerForm, { cycle_id: cycleId, choices, note });
      }}
      className="space-y-4"
    >
      <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_9rem_9rem] gap-2 text-xs font-medium uppercase text-gray-500">
        <span>Event</span>
        <span>OC</span>
        <span>Helper</span>
      </div>
      <ul className="divide-y divide-gray-100">
        {events.map((e) => (
          <li key={e.id} data-testid={`volunteer-${e.title}`} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_9rem_9rem] sm:items-center">
            <div className="min-w-0">
              <p className="font-medium text-gray-900 break-words">{e.title}</p>
              <p className="text-xs text-gray-500">
                {e.when} · {e.type}
                {e.location && ` · ${e.location}`} · {plural(e.helpers, "helper")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:contents">
              <label className="text-xs text-gray-500">
                <span className="sm:hidden">OC</span>
                <Select aria-label={`OC for ${e.title}`} value={wishes[e.id]?.oc ?? ""} onChange={(ev) => set(e.id, "oc", ev.target.value)}>
                  {OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="text-xs text-gray-500">
                <span className="sm:hidden">Helper</span>
                <Select aria-label={`Helper for ${e.title}`} value={wishes[e.id]?.helper ?? ""} onChange={(ev) => set(e.id, "helper", ev.target.value)}>
                  {OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          </li>
        ))}
      </ul>
      <Textarea aria-label="Note for the Events team" placeholder="Anything the Events team should know (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <Alert tone="error">{error}</Alert>}
      <p className="text-xs text-gray-500">You submit once: afterwards your answers are locked. Ties are decided by submission time.</p>
      <Button disabled={pending}>{pending ? "Submitting…" : "Submit my answers"}</Button>
    </form>
  );
}
