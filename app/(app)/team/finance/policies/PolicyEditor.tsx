"use client";

import { useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { publishPolicy } from "@/app/actions/handin";
import { EXPENSE_KIND_LABELS, type ExpenseKind, type Rule } from "@/lib/reimbursement";
import { parseEuroToCents } from "@/lib/dates";

type Editable = Rule & { ocCap: string; helperCap: string; ocRate: string; helperRate: string };

const euros = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));

// The Treasurer edits a copy of the newest rules and publishes them as a new
// version from a date on; existing claims keep their version.
export function PolicyEditor({ rules }: { rules: Rule[] }) {
  const { run, pending, error, setError } = useAction();
  const [rows, setRows] = useState<Editable[]>(
    rules.map((r) => ({ ...r, ocCap: euros(r.oc_cap_cents), helperCap: euros(r.helper_cap_cents), ocRate: String(r.oc_rate_bp / 100), helperRate: String(r.helper_rate_bp / 100) }))
  );
  const [from, setFrom] = useState("");
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState<number | null>(null);
  const set = (i: number, patch: Partial<Editable>) => setRows((rs) => rs.map((r, j) => (i === j ? { ...r, ...patch } : r)));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const out = [];
    for (const r of rows) {
      const ocCap = r.ocCap.trim() === "" ? null : parseEuroToCents(r.ocCap);
      const helperCap = r.helperCap.trim() === "" ? null : parseEuroToCents(r.helperCap);
      const ocRate = Math.round(Number(r.ocRate) * 100);
      const helperRate = Math.round(Number(r.helperRate) * 100);
      if ((r.ocCap.trim() && ocCap === null) || (r.helperCap.trim() && helperCap === null) || !(ocRate >= 0 && ocRate <= 10000) || !(helperRate >= 0 && helperRate <= 10000)) {
        return setError(`Check the numbers for ${EXPENSE_KIND_LABELS[r.expense_kind as ExpenseKind]} (${r.event_type}).`);
      }
      out.push({
        event_type: r.event_type,
        expense_kind: r.expense_kind,
        category: r.category,
        oc_rate_bp: ocRate,
        helper_rate_bp: helperRate,
        oc_cap_cents: ocCap,
        helper_cap_cents: helperCap,
        per_day: r.per_day,
        requires_preapproval: r.requires_preapproval,
        within_trip_budget: r.within_trip_budget,
        condition_note: r.condition_note,
      });
    }
    run(publishPolicy, { effective_from: from, notes, rules: out }, (d) => setDone((d as { version: number }).version));
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-500">
              <th className="py-1">Rule</th>
              <th>OC %</th>
              <th>OC cap €</th>
              <th>Helper %</th>
              <th>Helper cap €</th>
              <th>Condition</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r, i) => (
              <tr key={`${r.event_type}${r.expense_kind}`}>
                <td className="py-1.5 pr-2 text-xs">
                  {r.event_type} / {EXPENSE_KIND_LABELS[r.expense_kind as ExpenseKind].split(" (")[0]}
                  {r.per_day && " (per day)"}
                </td>
                <td className="pr-1">
                  <Input aria-label={`OC rate ${r.event_type} ${r.expense_kind}`} value={r.ocRate} onChange={(e) => set(i, { ocRate: e.target.value })} className="h-8 w-16" />
                </td>
                <td className="pr-1">
                  <Input aria-label={`OC cap ${r.event_type} ${r.expense_kind}`} placeholder="none" value={r.ocCap} onChange={(e) => set(i, { ocCap: e.target.value })} className="h-8 w-20" />
                </td>
                <td className="pr-1">
                  <Input aria-label={`Helper rate ${r.event_type} ${r.expense_kind}`} value={r.helperRate} onChange={(e) => set(i, { helperRate: e.target.value })} className="h-8 w-16" />
                </td>
                <td className="pr-1">
                  <Input aria-label={`Helper cap ${r.event_type} ${r.expense_kind}`} placeholder="none" value={r.helperCap} onChange={(e) => set(i, { helperCap: e.target.value })} className="h-8 w-20" />
                </td>
                <td>
                  <Input aria-label={`Condition ${r.event_type} ${r.expense_kind}`} value={r.condition_note} onChange={(e) => set(i, { condition_note: e.target.value })} className="h-8" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="In force from" htmlFor="p-from">
          <Input id="p-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </Field>
        <Field label="What changed" htmlFor="p-notes">
          <Input id="p-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {done && <Alert tone="success">Version {done} published.</Alert>}
      <Button disabled={pending || !from}>Publish new version</Button>
    </form>
  );
}
