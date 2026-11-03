"use client";

import { useState } from "react";
import { Alert, Button, Textarea } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { submitVolunteerForm } from "@/app/actions/planning";
import { RANK_LABELS } from "@/lib/volunteer";
import { plural } from "@/lib/plural";
import { cn } from "@/lib/utils";

type Wish = { oc: number | null; helper: number | null };

/** From "no" up to "top choice", as segmented buttons (usability review #19). */
const OPTIONS = [{ value: null, label: "No" }, ...[3, 2, 1].map((r) => ({ value: r, label: RANK_LABELS[r] }))];

export function VolunteerForm({
  cycleId,
  month,
  events,
}: {
  cycleId: string;
  /** "December 2026" – named in the confirm dialog. */
  month: string;
  events: Array<{ id: string; title: string; type: string; when: string; location: string; helpers: number }>;
}) {
  const { run, pending, error, confirm } = useAction();
  const [wishes, setWishes] = useState<Record<string, Wish>>({});
  const [note, setNote] = useState("");

  const set = (id: string, key: keyof Wish, value: number | null) =>
    setWishes((w) => ({ ...w, [id]: { oc: w[id]?.oc ?? null, helper: w[id]?.helper ?? null, [key]: value } }));

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const choices = Object.entries(wishes).map(([event_id, w]) => ({ event_id, oc_rank: w.oc, helper_rank: w.helper }));
        const picked = events.filter((ev) => wishes[ev.id]?.oc || wishes[ev.id]?.helper);
        // Submitting locks the answers: the dialog lists them, and an empty form says what it means (usability review #8).
        const ok = await confirm(
          picked.length
            ? {
                title: `Submit your answers for ${month}?`,
                body: (
                  <>
                    <ul className="list-disc pl-5">
                      {picked.map((ev) => {
                        const w = wishes[ev.id]!;
                        return (
                          <li key={ev.id}>
                            {ev.title} ({ev.when}): {[w.oc && `OC – ${RANK_LABELS[w.oc]}`, w.helper && `helper – ${RANK_LABELS[w.helper]}`].filter(Boolean).join(", ")}
                          </li>
                        );
                      })}
                    </ul>
                    <p>You submit once – afterwards ask the Events team to change anything.</p>
                  </>
                ),
                confirmLabel: `Submit (${plural(picked.length, "event")})`,
              }
            : {
                title: `Submit without any event?`,
                body: `You'll be listed as unavailable for all ${plural(events.length, "event")} of ${month}, and your answers are locked. To volunteer, pick OC or helper for at least one event first.`,
                confirmLabel: "Submit – I can't help this month",
                cancelLabel: "Back to the form",
                danger: true,
              }
        );
        if (!ok) return;
        run(submitVolunteerForm, { cycle_id: cycleId, choices, note }, undefined, picked.length ? `Answers sent – you signed up for ${plural(picked.length, "event")}. The roster follows after the deadline.` : "Answers sent – you're unavailable this month.");
      }}
      className="space-y-4"
    >
      <ul className="divide-y divide-gray-100">
        {events.map((e) => (
          <li key={e.id} data-testid={`volunteer-${e.title}`} className="grid gap-2 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0">
              <p className="font-medium text-gray-900 break-words">{e.title}</p>
              <p className="text-xs text-gray-500">
                {e.when} · {e.type}
                {e.location && ` · ${e.location}`} · {plural(e.helpers, "helper")}
              </p>
            </div>
            <div className="space-y-1.5">
              {(["oc", "helper"] as const).map((key) => (
                <Segmented key={key} label={`${key === "oc" ? "OC" : "Helper"} for ${e.title}`} short={key === "oc" ? "OC" : "Helper"} value={wishes[e.id]?.[key] ?? null} onChange={(v) => set(e.id, key, v)} />
              ))}
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

/** One radio group as a row of buttons: No · If needed · Happy to · Top choice. */
function Segmented({ label, short, value, onChange }: { label: string; short: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-xs font-medium text-gray-500">{short}</span>
      <div className="inline-flex flex-wrap rounded-md border border-gray-300 bg-white text-xs">
        {OPTIONS.map((o) => {
          const checked = value === o.value;
          return (
            <label
              key={o.label}
              className={cn(
                // relative: the radio sits inside its own option, not under a neighbour.
                "relative cursor-pointer px-2.5 py-1.5 first:rounded-l-md last:rounded-r-md has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-esn-accent",
                checked ? (o.value ? "bg-esn text-white" : "bg-gray-200 text-gray-800") : "text-gray-600 hover:bg-gray-50"
              )}
            >
              {/* An invisible radio over the whole option (round 2026-11-03 (2)): a click lands on the radio itself –
                  a 1-pixel sr-only radio left the label on top, which automated clicks refuse. */}
              <input type="radio" className="absolute inset-0 m-0 cursor-pointer opacity-0" name={label} checked={checked} onChange={() => onChange(o.value)} />
              {o.label}
            </label>
          );
        })}
      </div>
    </div>
  );
}
