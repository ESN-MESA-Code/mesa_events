"use client";

import { useState } from "react";
import { Alert, Button, Select, Textarea } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { submitVolunteerForm } from "@/app/actions/planning";

type Wish = { oc: number | null; helper: number | null };

const OPTIONS = [
  { value: "", label: "No" },
  { value: "1", label: "Top choice" },
  { value: "2", label: "Happy to" },
  { value: "3", label: "If needed" },
];

export function VolunteerForm({
  cycleId,
  events,
  initial,
  note: initialNote,
}: {
  cycleId: string;
  events: Array<{ id: string; title: string; type: string; when: string; location: string; helpers: number }>;
  initial: Record<string, Wish>;
  note: string;
}) {
  const { run, pending, error } = useAction();
  const [wishes, setWishes] = useState<Record<string, Wish>>(initial);
  const [note, setNote] = useState(initialNote);
  const [saved, setSaved] = useState<number | null>(null);

  const set = (id: string, key: keyof Wish, value: string) =>
    setWishes((w) => ({ ...w, [id]: { oc: w[id]?.oc ?? null, helper: w[id]?.helper ?? null, [key]: value ? Number(value) : null } }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(null);
        const choices = Object.entries(wishes).map(([event_id, w]) => ({ event_id, oc_rank: w.oc, helper_rank: w.helper }));
        run(submitVolunteerForm, { cycle_id: cycleId, choices, note }, (d) => setSaved((d as { events: number }).events));
      }}
      className="space-y-4"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-500">
              <th className="py-2">Event</th>
              <th className="py-2 w-36">OC</th>
              <th className="py-2 w-36">Helper</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {events.map((e) => (
              <tr key={e.id} data-testid={`volunteer-${e.title}`}>
                <td className="py-2 pr-3">
                  <p className="font-medium text-gray-900">{e.title}</p>
                  <p className="text-xs text-gray-500">
                    {e.when} · {e.type}
                    {e.location && ` · ${e.location}`} · {e.helpers} helpers
                  </p>
                </td>
                <td className="py-2 pr-2">
                  <Select aria-label={`OC for ${e.title}`} value={wishes[e.id]?.oc ?? ""} onChange={(ev) => set(e.id, "oc", ev.target.value)}>
                    {OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="py-2">
                  <Select aria-label={`Helper for ${e.title}`} value={wishes[e.id]?.helper ?? ""} onChange={(ev) => set(e.id, "helper", ev.target.value)}>
                    {OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Textarea aria-label="Note for the Events team" placeholder="Anything the Events team should know (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <Alert tone="error">{error}</Alert>}
      {saved !== null && <Alert tone="success">Saved – you signed up for {saved} event{saved === 1 ? "" : "s"}.</Alert>}
      <Button disabled={pending}>{pending ? "Saving…" : "Submit my answers"}</Button>
    </form>
  );
}
