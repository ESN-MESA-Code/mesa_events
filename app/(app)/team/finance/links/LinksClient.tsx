"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { createLink, deleteLink, savePaypalSettings, setLinkActive, updateLink } from "@/app/actions/payments";
import { parseEuroToCents } from "@/lib/dates";

export function PaypalSettings({ handle, accountName }: { handle: string; accountName: string }) {
  const { run, pending, error } = useAction();
  const [h, setH] = useState(handle);
  const [n, setN] = useState(accountName);
  return (
    <form
      className="space-y-3"
      data-testid="paypal-settings"
      onSubmit={(e) => {
        e.preventDefault();
        run(savePaypalSettings, { handle: h, account_name: n }, undefined, "PayPal account saved.");
      }}
    >
      <Field label="PayPal.me name" htmlFor="pp-handle" hint="@mesamunich, paypal.me/mesamunich or the whole link">
        <div className="flex items-center rounded-md border border-gray-300 bg-white pl-2 text-sm">
          <span className="text-gray-500">paypal.me/</span>
          <input id="pp-handle" className="h-9 min-w-0 flex-1 rounded-r-md px-1 outline-none" value={h} onChange={(e) => setH(e.target.value)} maxLength={200} />
        </div>
      </Field>
      <Field label="Name payers see" htmlFor="pp-name">
        <Input id="pp-name" value={n} onChange={(e) => setN(e.target.value)} maxLength={120} placeholder="ESN MESA e.V." />
      </Field>
      <Button size="sm" variant="outline" disabled={pending || (h === handle && n === accountName)}>
        Save
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}

/** A link of Finance's own: merch, memberships … – not tied to an event (those are made on the event's Cash tab). */
export function NewLinkForm({ categories, disabled }: { categories: Array<{ id: string; name: string }>; disabled: boolean }) {
  const { run, pending, error, setError } = useAction();
  const blank = { title: "", amount: "", category: categories.find((c) => c.name === "Merchandise sales")?.id ?? categories[0]?.id ?? "", note: "" };
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof blank, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <form
      className="space-y-3"
      data-testid="new-link"
      onSubmit={(e) => {
        e.preventDefault();
        const cents = f.amount.trim() ? parseEuroToCents(f.amount) : null;
        if (f.amount.trim() && !cents) return setError("Enter an amount like 25 or 12.50 – or leave it empty.");
        run(createLink, { title: f.title, amount_cents: cents, category_id: f.category, note: f.note }, () => setF(blank), (d: { reference: string }) => `Link ${d.reference} created.`);
      }}
    >
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
        <Field label="What is it for" htmlFor="nl-title">
          <Input id="nl-title" value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={120} placeholder="e.g. Hoodie (navy, members)" />
        </Field>
        <Field label="Amount (€)" htmlFor="nl-amount" hint="Empty: the payer enters it">
          <Input id="nl-amount" inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} placeholder="25" />
        </Field>
      </div>
      <Field label="Booked as" htmlFor="nl-cat">
        <Select id="nl-cat" value={f.category} onChange={(e) => set("category", e.target.value)}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Note (optional)" htmlFor="nl-note">
        <Textarea id="nl-note" rows={2} value={f.note} onChange={(e) => set("note", e.target.value)} maxLength={500} placeholder="e.g. sizes S–XL, pick-up at the office hour" />
      </Field>
      <Button size="sm" disabled={pending || disabled || !f.title.trim() || !f.category}>
        <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Create link
      </Button>
      {disabled && <p className="text-xs text-amber-700">Save the PayPal.me name first.</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}

/** Finance's actions on a link: edit (its own links), switch off and on, delete while unused. */
export function LinkActions({
  link,
  categories,
  editable,
}: {
  link: { id: string; title: string; amount: number | null; categoryId: string; active: boolean; note: string; used: boolean };
  categories: Array<{ id: string; name: string }>;
  /** Links of events and office hours are the OC's: Finance switches them off but does not change them. */
  editable: boolean;
}) {
  const { run, pending, error, confirm, setError } = useAction();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(link.amount ? (link.amount / 100).toFixed(2) : "");
  const [title, setTitle] = useState(link.title);
  const [category, setCategory] = useState(link.categoryId);
  if (editing)
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <Input aria-label="Title" className="h-8 w-44" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Input aria-label="Amount (€)" className="h-8 w-20" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="open" />
        <Select aria-label="Category" className="h-8 w-40" value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          disabled={pending}
          onClick={() => {
            const cents = amount.trim() ? parseEuroToCents(amount) : null;
            if (amount.trim() && !cents) return setError("Enter an amount.");
            run(updateLink, { id: link.id, title, amount_cents: cents, category_id: category, active: link.active, note: link.note }, () => setEditing(false), "Link saved.");
          }}
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </span>
    );
  return (
    <span className="flex flex-wrap items-center gap-1">
      {editable && (
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Edit
        </Button>
      )}
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(setLinkActive, { id: link.id, active: !link.active }, undefined, link.active ? "Link switched off." : "Link switched on.")}>
        {link.active ? "Switch off" : "Switch on"}
      </Button>
      {!link.used && (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={async () => {
            if (await confirm({ title: `Delete the link “${link.title}”?`, body: "Payments that name its reference later go to “To label”.", confirmLabel: "Delete", danger: true })) run(deleteLink, { id: link.id }, undefined, "Link deleted.");
          }}
        >
          Delete
        </Button>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
