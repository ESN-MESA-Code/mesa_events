"use client";

import { useState } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { addBalance, copyBudget, deleteBalance, deleteBudgetLine, saveBudgetLine } from "@/app/actions/payments";
import { formatCents, parseEuroToCents } from "@/lib/dates";

interface Cat {
  id: string;
  name: string;
  direction: "income" | "expense";
}

export function BudgetLineForm({ semester, categories, events, presetEvent }: { semester: string; categories: Cat[]; events: Array<{ id: string; label: string }>; presetEvent?: boolean }) {
  const { run, pending, error, setError } = useAction();
  const [direction, setDirection] = useState<"income" | "expense">("expense");
  const choices = categories.filter((c) => c.direction === direction);
  const [category, setCategory] = useState("");
  const [eventId, setEventId] = useState("");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const cat = choices.some((c) => c.id === category) ? category : (choices[0]?.id ?? "");
  return (
    <form
      className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[auto_1fr_1fr_1fr_7rem_auto] lg:items-end"
      data-testid={presetEvent ? "event-budget-form" : "budget-form"}
      onSubmit={(e) => {
        e.preventDefault();
        const cents = parseEuroToCents(amount);
        if (cents === null) return setError("Enter the planned amount.");
        run(saveBudgetLine, { semester, category_id: cat, event_id: eventId || null, label, planned_cents: cents }, () => {
          setAmount("");
          setLabel("");
        }, "Added to the plan.");
      }}
    >
      <Select aria-label="Income or spending" value={direction} onChange={(e) => setDirection(e.target.value as "income" | "expense")}>
        <option value="expense">Spending</option>
        <option value="income">Income</option>
      </Select>
      <Select aria-label="Category" value={cat} onChange={(e) => setCategory(e.target.value)}>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Select aria-label="Event (optional)" value={eventId} onChange={(e) => setEventId(e.target.value)}>
        <option value="">{presetEvent ? "Choose the event…" : "– whole semester –"}</option>
        {events.map((ev) => (
          <option key={ev.id} value={ev.id}>
            {ev.label}
          </option>
        ))}
      </Select>
      <Input aria-label="Label (optional)" placeholder="e.g. Welcome week" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} />
      <Input aria-label="Planned (€)" inputMode="decimal" placeholder="€" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Button size="sm" disabled={pending || !cat || (presetEvent && !eventId)}>
        Add
      </Button>
      {error && <p className="text-xs text-red-600 sm:col-span-full">{error}</p>}
    </form>
  );
}

export function BudgetLineActions({ line }: { line: { id: string; semester: string; category_id: string; event_id: string | null; label: string; planned_cents: number; note: string } }) {
  const { run, pending, error, setError } = useAction();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState((line.planned_cents / 100).toFixed(2));
  if (editing)
    return (
      <form
        className="inline-flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          const cents = parseEuroToCents(amount);
          if (cents === null) return setError("Amount?");
          run(saveBudgetLine, { ...line, planned_cents: cents }, () => setEditing(false), "Plan changed.");
        }}
      >
        <Input aria-label="Planned (€)" className="h-7 w-24" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        <Button size="sm" disabled={pending}>
          Save
        </Button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </form>
    );
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" className="text-xs text-esn hover:underline" onClick={() => setEditing(true)}>
        {formatCents(line.planned_cents)}
      </button>
      <button type="button" className="text-xs text-gray-400 hover:text-red-600" disabled={pending} onClick={() => run(deleteBudgetLine, { id: line.id }, undefined, "Removed from the plan.")} aria-label="Remove from the plan">
        ✕
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function CopyBudget({ from, fromName, to }: { from: string; fromName: string; to: string }) {
  const { run, pending, error } = useAction();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(copyBudget, { from, to }, undefined, (d: { copied: number }) => `${d.copied} lines copied.`)}>
        Start from {fromName}&apos;s plan
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function BalanceForm({ today }: { today: string }) {
  const { run, pending, error, setError } = useAction();
  const [f, setF] = useState({ account: "bank" as "bank" | "paypal" | "other", as_of: today, amount: "", note: "" });
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      data-testid="balance-form"
      onSubmit={(e) => {
        e.preventDefault();
        const neg = f.amount.trim().startsWith("-");
        const cents = parseEuroToCents(f.amount.replace(/^-/, ""));
        if (cents === null) return setError("Enter the balance.");
        run(addBalance, { account: f.account, as_of: f.as_of, cents: neg ? -cents : cents, note: f.note }, () => setF({ ...f, amount: "", note: "" }), "Balance noted.");
      }}
    >
      <Field label="Account" htmlFor="bal-acc">
        <Select id="bal-acc" className="w-36" value={f.account} onChange={(e) => setF({ ...f, account: e.target.value as typeof f.account })}>
          <option value="bank">Bank account</option>
          <option value="paypal">PayPal</option>
          <option value="other">Other</option>
        </Select>
      </Field>
      <Field label="On" htmlFor="bal-day">
        <Input id="bal-day" type="date" value={f.as_of} onChange={(e) => setF({ ...f, as_of: e.target.value })} />
      </Field>
      <Field label="Balance (€)" htmlFor="bal-amount">
        <Input id="bal-amount" className="w-32" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="4250.00" />
      </Field>
      <Field label="Note" htmlFor="bal-note">
        <Input id="bal-note" className="w-44" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} placeholder="statement no. …" />
      </Field>
      <Button size="sm" disabled={pending}>
        Note balance
      </Button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </form>
  );
}

export function DeleteBalance({ id }: { id: string }) {
  const { run, pending } = useAction();
  return (
    <button type="button" className="text-xs text-gray-400 hover:text-red-600" disabled={pending} onClick={() => run(deleteBalance, { id }, undefined, "Removed.")} aria-label="Remove this balance">
      ✕
    </button>
  );
}
