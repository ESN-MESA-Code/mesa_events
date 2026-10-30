"use client";

import { useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { addCategory, addEntry, deleteEntry, setCategoryActive, updateEntry } from "@/app/actions/ledger";
import { formatCents, parseEuroToCents } from "@/lib/dates";
import { METHOD_LABELS } from "@/lib/finance";

export interface Category {
  id: string;
  name: string;
  direction: "income" | "expense";
  active: boolean;
}

export interface EntryValues {
  id?: string;
  direction: "income" | "expense";
  category_id: string;
  event_id: string | null;
  amount_cents: number;
  booked_on: string;
  description: string;
  counterparty: string;
  payment_method: "bank" | "cash" | "paypal" | "card" | "other";
  beleg_ref: string;
  beleg_received: boolean;
  note: string;
}


/** Add or correct a ledger entry: income or spending, its category, optionally an event, and the Beleg. */
export function EntryForm({ categories, events, today, initial, onDone }: { categories: Category[]; events: Array<{ id: string; label: string }>; today: string; initial?: EntryValues; onDone?: () => void }) {
  const { run, pending, error, setError } = useAction();
  const blank: EntryValues = { direction: "expense", category_id: "", event_id: null, amount_cents: 0, booked_on: today, description: "", counterparty: "", payment_method: "bank", beleg_ref: "", beleg_received: false, note: "" };
  const [f, setF] = useState<EntryValues>(initial ?? blank);
  const [amount, setAmount] = useState(initial ? (initial.amount_cents / 100).toFixed(2) : "");
  const choices = categories.filter((c) => c.direction === f.direction && (c.active || c.id === f.category_id));
  const category = choices.some((c) => c.id === f.category_id) ? f.category_id : (choices[0]?.id ?? "");
  const set = <K extends keyof EntryValues>(k: K, v: EntryValues[K]) => setF((x) => ({ ...x, [k]: v }));
  const id = initial?.id ?? "new";
  return (
    <form
      className="space-y-3"
      data-testid={initial ? "entry-edit" : "entry-form"}
      onSubmit={(e) => {
        e.preventDefault();
        const cents = parseEuroToCents(amount);
        if (!cents) return setError("Enter an amount.");
        const input = { ...f, category_id: category, amount_cents: cents };
        run<unknown>(initial ? updateEntry : addEntry, input, () => {
          if (!initial) {
            setF({ ...blank, direction: f.direction, booked_on: f.booked_on });
            setAmount("");
          }
          onDone?.();
        });
      }}
    >
      <div className="flex rounded-md border border-gray-300 text-sm w-fit" role="radiogroup" aria-label="Income or spending">
        {(["expense", "income"] as const).map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={f.direction === d}
            onClick={() => set("direction", d)}
            className={f.direction === d ? "bg-esn px-3 py-1.5 text-white first:rounded-l-md last:rounded-r-md" : "bg-white px-3 py-1.5 text-gray-700 first:rounded-l-md last:rounded-r-md"}
          >
            {d === "expense" ? "Spending" : "Income"}
          </button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Amount (€)" htmlFor={`le-amount-${id}`}>
          <Input id={`le-amount-${id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="12.50" />
        </Field>
        <Field label="Date" htmlFor={`le-date-${id}`}>
          <Input id={`le-date-${id}`} type="date" value={f.booked_on} onChange={(e) => set("booked_on", e.target.value)} />
        </Field>
        <Field label="Category" htmlFor={`le-cat-${id}`}>
          <Select id={`le-cat-${id}`} value={category} onChange={(e) => set("category_id", e.target.value)}>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="What" htmlFor={`le-desc-${id}`}>
        <Input id={`le-desc-${id}`} value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={300} placeholder={f.direction === "expense" ? "e.g. 50 hoodies" : "e.g. ticket sales"} />
      </Field>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Event (optional)" htmlFor={`le-event-${id}`}>
          <Select id={`le-event-${id}`} value={f.event_id ?? ""} onChange={(e) => set("event_id", e.target.value || null)}>
            <option value="">– none –</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={f.direction === "expense" ? "Paid to" : "From"} htmlFor={`le-cp-${id}`}>
          <Input id={`le-cp-${id}`} value={f.counterparty} onChange={(e) => set("counterparty", e.target.value)} maxLength={200} />
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Paid with" htmlFor={`le-method-${id}`}>
          <Select id={`le-method-${id}`} value={f.payment_method} onChange={(e) => set("payment_method", e.target.value as EntryValues["payment_method"])}>
            {Object.entries(METHOD_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Beleg no. / reference" htmlFor={`le-beleg-${id}`}>
          <Input id={`le-beleg-${id}`} value={f.beleg_ref} onChange={(e) => set("beleg_ref", e.target.value)} maxLength={100} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={f.beleg_received} onChange={(e) => set("beleg_received", e.target.checked)} />
          Paper Beleg filed
        </label>
      </div>
      <Field label="Note (optional)" htmlFor={`le-note-${id}`}>
        <Textarea id={`le-note-${id}`} rows={2} value={f.note} onChange={(e) => set("note", e.target.value)} maxLength={1000} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !category}>
          {initial ? "Save" : f.direction === "expense" ? "Add spending" : "Add income"}
        </Button>
        {initial && (
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}

/** A ledger line's actions: edit (inline) and delete. Booked cash boxes are corrected on the cash box. */
export function EntryActions({ entry, categories, events, today, fromCashBox }: { entry: EntryValues; categories: Category[]; events: Array<{ id: string; label: string }>; today: string; fromCashBox: boolean }) {
  const { run, pending, error } = useAction();
  const [editing, setEditing] = useState(false);
  if (editing) return <EntryForm categories={categories} events={events} today={today} initial={entry} onDone={() => setEditing(false)} />;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {!fromCashBox && (
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Edit
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (window.confirm(`Delete "${entry.description}" (${formatCents(entry.amount_cents)})?${fromCashBox ? " The cash box can then be booked again." : ""}`)) run(deleteEntry, { id: entry.id });
        }}
      >
        Delete
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function Categories({ categories }: { categories: Category[] }) {
  const { run, pending, error } = useAction();
  const [name, setName] = useState("");
  const [direction, setDirection] = useState<"income" | "expense">("expense");
  return (
    <div className="space-y-3 text-sm" data-testid="categories">
      {(["income", "expense"] as const).map((d) => (
        <div key={d}>
          <p className="mb-1 text-xs font-semibold uppercase text-gray-500">{d === "income" ? "Income" : "Spending"}</p>
          <ul className="flex flex-wrap gap-1.5">
            {categories
              .filter((c) => c.direction === d)
              .map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(setCategoryActive, { id: c.id, active: !c.active })}
                    title={c.active ? "Hide from the form" : "Show in the form again"}
                    className={c.active ? "rounded border border-gray-300 bg-white px-2 py-0.5" : "rounded border border-dashed border-gray-300 px-2 py-0.5 text-gray-400 line-through"}
                  >
                    {c.name}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      ))}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(addCategory, { direction, name }, () => setName(""));
        }}
      >
        <Select aria-label="Direction" className="h-8 w-32" value={direction} onChange={(e) => setDirection(e.target.value as "income" | "expense")}>
          <option value="expense">Spending</option>
          <option value="income">Income</option>
        </Select>
        <Input aria-label="New category" placeholder="New category" className="h-8 w-48" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <Button size="sm" variant="outline" disabled={pending || !name.trim()}>
          Add
        </Button>
      </form>
      <p className="text-xs text-gray-500">Click a category to hide it from the form (entries keep it).</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
