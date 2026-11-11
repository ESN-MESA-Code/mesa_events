"use client";

import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, Sparkles, Undo2 } from "lucide-react";
import { Button, EmptyState, Input, Select } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { acceptSuggestions, bookPayment, bookPayments, ignorePayments, unbookPayment } from "@/app/actions/payments";
import { formatCents } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { plural } from "@/lib/plural";

export interface Option {
  id: string;
  label: string;
  day: string;
}

export interface InboxPayment {
  id: string;
  externalId: string;
  day: string;
  type: string;
  name: string;
  email: string;
  gross: number;
  fee: number;
  text: string;
  status: "open" | "booked" | "ignored";
  suggestion: string;
  suggested: { linkId: string | null; categoryId: string | null; eventId: string | null; internalEventId: string | null };
  booked: { category: string; target: string | null; description: string; by: string | null } | null;
  ignoreReason: string;
}

interface Category {
  id: string;
  name: string;
  direction: "income" | "expense";
  active: boolean;
}

interface LinkOption {
  id: string;
  label: string;
  categoryId: string;
  eventId: string | null;
  internalEventId: string | null;
  amount: number | null;
  active: boolean;
}

const IGNORE_REASONS = ["Transfer between MESA's own accounts", "Private payment by mistake (sent back)", "Listed twice", "Not MESA's money (passed on)"];

/** "event:<id>" / "internal:<id>" / "" */
type Target = string;
const targetOf = (eventId: string | null, internalId: string | null): Target => (eventId ? `event:${eventId}` : internalId ? `internal:${internalId}` : "");
const splitTarget = (t: Target) => ({ event_id: t.startsWith("event:") ? t.slice(6) : null, internal_event_id: t.startsWith("internal:") ? t.slice(9) : null });

function TargetSelect({ value, onChange, events, internals, day, id }: { value: Target; onChange: (v: Target) => void; events: Option[]; internals: Option[]; day?: string; id: string }) {
  // Events around the payment's day first.
  const near = (o: Option) => (day ? Math.abs(Date.parse(o.day) - Date.parse(day)) : 0);
  const ev = [...events].sort((a, b) => near(a) - near(b)).slice(0, 40);
  const ie = [...internals].sort((a, b) => near(a) - near(b)).slice(0, 30);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Event or office hour">
      <option value="">– no event –</option>
      <optgroup label="Events (nearest first)">
        {ev.map((o) => (
          <option key={o.id} value={`event:${o.id}`}>
            {o.label}
          </option>
        ))}
      </optgroup>
      <optgroup label="Office hours and internal events">
        {ie.map((o) => (
          <option key={o.id} value={`internal:${o.id}`}>
            {o.label}
          </option>
        ))}
      </optgroup>
    </Select>
  );
}

function LabelForm({ p, categories, events, internals, links, onDone }: { p: InboxPayment; categories: Category[]; events: Option[]; internals: Option[]; links: LinkOption[]; onDone: () => void }) {
  const { run, pending, error } = useAction();
  const dir = p.gross > 0 ? "income" : "expense";
  const choices = categories.filter((c) => c.direction === dir && (c.active || c.id === p.suggested.categoryId));
  const [category, setCategory] = useState(p.suggested.categoryId && choices.some((c) => c.id === p.suggested.categoryId) ? p.suggested.categoryId : (choices[0]?.id ?? ""));
  const [target, setTarget] = useState<Target>(targetOf(p.suggested.eventId, p.suggested.internalEventId));
  const [link, setLink] = useState(dir === "income" ? (p.suggested.linkId ?? "") : "");
  const [description, setDescription] = useState("");
  const usable = links.filter((l) => l.active || l.id === link);
  return (
    <form
      className="mt-3 grid gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.4fr_1fr_1fr_auto]"
      data-testid={`label-form-${p.id}`}
      onSubmit={(e) => {
        e.preventDefault();
        run(bookPayment, { id: p.id, category_id: category, ...splitTarget(target), link_id: link || null, description, suggested: false }, onDone, "Payment booked.");
      }}
    >
      <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <TargetSelect id={`target-${p.id}`} value={target} onChange={setTarget} events={events} internals={internals} day={p.day} />
      {dir === "income" ? (
        <Select
          aria-label="Payment link"
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            const l = links.find((x) => x.id === e.target.value);
            if (l) {
              setCategory(l.categoryId);
              setTarget(targetOf(l.eventId, l.internalEventId));
            }
          }}
        >
          <option value="">– no PayPal link –</option>
          {usable.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
              {l.amount ? ` (${formatCents(l.amount)})` : ""}
            </option>
          ))}
        </Select>
      ) : (
        <span className="hidden lg:block" />
      )}
      <Input aria-label="Description (optional)" placeholder="What (optional)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
      <div className="flex gap-1">
        <Button size="sm" disabled={pending || !category}>
          Book
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-red-600 sm:col-span-full">{error}</p>}
    </form>
  );
}

function Row({ p, selected, onSelect, canAct, categories, events, internals, links }: { p: InboxPayment; selected: boolean; onSelect: (v: boolean) => void; canAct: boolean; categories: Category[]; events: Option[]; internals: Option[]; links: LinkOption[] }) {
  const { run, pending, error } = useAction();
  const [open, setOpen] = useState(false);
  const [ignoring, setIgnoring] = useState(false);
  const incoming = p.gross > 0;
  const catName = categories.find((c) => c.id === p.suggested.categoryId)?.name;
  const target = p.suggested.eventId ? events.find((e) => e.id === p.suggested.eventId)?.label : p.suggested.internalEventId ? internals.find((e) => e.id === p.suggested.internalEventId)?.label : null;
  return (
    <li className={cn("px-4 py-3", selected && "bg-blue-50/50")} data-testid={`payment-${p.externalId}`}>
      <div className="flex items-start gap-3">
        {canAct && p.status === "open" && <input type="checkbox" className="mt-1.5" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`Select payment from ${p.name || p.email}`} />}
        <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", incoming ? "bg-blue-50 text-blue-700" : "bg-orange-50 text-orange-700")} aria-hidden="true">
          {incoming ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-gray-900">{p.name || p.email || "PayPal"}</span>
            {p.name && p.email && <span className="text-xs text-gray-500">{p.email}</span>}
            <span className="text-xs text-gray-500">
              {p.day} · {p.type}
            </span>
          </div>
          {p.text && <p className="mt-0.5 break-words text-sm text-gray-700">“{p.text}”</p>}
          {p.status === "open" && p.suggestion && (
            <p className={cn("mt-1 inline-flex flex-wrap items-center gap-1 rounded-md px-2 py-0.5 text-xs", p.suggestion.startsWith("Could not") ? "bg-red-50 text-red-800" : "bg-violet-50 text-violet-800")} data-testid="suggestion">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {p.suggestion}
              {catName && (
                <strong className="font-semibold">
                  → {catName}
                  {target ? ` · ${target}` : ""}
                </strong>
              )}
            </p>
          )}
          {p.status === "booked" && p.booked && (
            <p className="mt-1 text-xs text-gray-600">
              <Check className="mr-1 inline h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              {p.booked.category}
              {p.booked.target ? ` · ${p.booked.target}` : ""}
              {p.booked.by ? ` · ${p.booked.by === "reference" ? "by its reference" : p.booked.by === "pretix" ? "by its pretix order" : p.booked.by === "suggestion" ? "suggestion confirmed" : "labelled by hand"}` : ""}
            </p>
          )}
          {p.status === "ignored" && <p className="mt-1 text-xs text-gray-500">Ignored: {p.ignoreReason}</p>}
        </div>
        <div className="shrink-0 text-right">
          <p className={cn("font-semibold tabular-nums", incoming ? "text-emerald-700" : "text-gray-900")}>
            {incoming ? "+" : "−"}
            {formatCents(Math.abs(p.gross))}
          </p>
          {p.fee !== 0 && <p className="text-xs tabular-nums text-gray-500">fee {formatCents(Math.abs(p.fee))}</p>}
        </div>
      </div>
      {canAct && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-10 sm:pl-[4.25rem]">
          {p.status === "open" && !open && !ignoring && (
            <>
              {p.suggested.categoryId && (
                <Button size="sm" variant="success" disabled={pending} onClick={() => run(acceptSuggestions, { ids: [p.id] }, undefined, "Booked as suggested.")}>
                  <Check className="mr-1 h-4 w-4" aria-hidden="true" /> Accept
                </Button>
              )}
              <Button size="sm" variant={p.suggested.categoryId ? "outline" : "default"} onClick={() => setOpen(true)}>
                Label…
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setIgnoring(true)}>
                Ignore…
              </Button>
            </>
          )}
          {ignoring && (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-gray-500">Ignore because:</span>
              {IGNORE_REASONS.map((r) => (
                <Button key={r} size="sm" variant="outline" disabled={pending} onClick={() => run(ignorePayments, { ids: [p.id], reason: r }, undefined, "Payment ignored.")}>
                  {r}
                </Button>
              ))}
              <Button size="sm" variant="ghost" onClick={() => setIgnoring(false)}>
                Cancel
              </Button>
            </span>
          )}
          {p.status !== "open" && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(unbookPayment, { id: p.id }, undefined, "Back in the queue.")}>
              <Undo2 className="mr-1 h-4 w-4" aria-hidden="true" />
              {p.status === "booked" ? "Unbook" : "Back to the queue"}
            </Button>
          )}
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      )}
      {open && <LabelForm p={p} categories={categories} events={events} internals={internals} links={links} onDone={() => setOpen(false)} />}
    </li>
  );
}

function BulkBar({ ids, rows, categories, events, internals, onDone }: { ids: string[]; rows: InboxPayment[]; categories: Category[]; events: Option[]; internals: Option[]; onDone: () => void }) {
  const { run, pending, error, toast } = useAction();
  const chosen = rows.filter((r) => ids.includes(r.id));
  const dirs = new Set(chosen.map((r) => (r.gross > 0 ? "income" : "expense")));
  const dir = dirs.size === 1 ? [...dirs][0] : null;
  const choices = categories.filter((c) => c.active && c.direction === dir);
  const [category, setCategory] = useState("");
  const [target, setTarget] = useState<Target>("");
  const withSuggestion = chosen.filter((r) => r.suggested.categoryId).length;
  const total = chosen.reduce((s, r) => s + r.gross, 0);
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-blue-200 bg-blue-50 px-4 py-2 text-sm" data-testid="bulk-bar">
      <span className="font-medium">
        {chosen.length} selected · {formatCents(total)}
      </span>
      {withSuggestion > 0 && (
        <Button size="sm" variant="success" disabled={pending} onClick={() => run(acceptSuggestions, { ids }, onDone, (d: { booked: number }) => `${d.booked} booked as suggested.`)}>
          Accept {plural(withSuggestion, "suggestion")}
        </Button>
      )}
      {dir ? (
        <span className="flex flex-wrap items-center gap-1.5">
          <Select aria-label="Category for the selected" className="h-8 w-48" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Category…</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <span className="w-56">
            <TargetSelect id="bulk-target" value={target} onChange={setTarget} events={events} internals={internals} day={chosen[0]?.day} />
          </span>
          <Button
            size="sm"
            disabled={pending || !category}
            onClick={() =>
              run(bookPayments, { ids, category_id: category, ...splitTarget(target) }, (d: { booked: number; errors: string[] }) => {
                if (d.errors.length) toast(`Some could not be booked: ${d.errors[0]}`);
                onDone();
              }, (d: { booked: number }) => `${d.booked} booked.`)
            }
          >
            Book selected
          </Button>
        </span>
      ) : (
        <span className="text-xs text-gray-600">Income and spending mixed – select one kind to book them together.</span>
      )}
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(ignorePayments, { ids, reason: IGNORE_REASONS[0] }, onDone, "Ignored as transfers.")}>
        Ignore as transfers
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

export function InboxList({
  rows,
  show,
  canAct,
  categories,
  events,
  internals,
  links,
  emptyHint,
}: {
  rows: InboxPayment[];
  show: "open" | "booked" | "ignored";
  canAct: boolean;
  categories: Category[];
  events: Option[];
  internals: Option[];
  links: LinkOption[];
  emptyHint: React.ReactNode;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [kind, setKind] = useState<"all" | "in" | "out" | "suggested">("all");
  const visible = useMemo(
    () => rows.filter((r) => (kind === "in" ? r.gross > 0 : kind === "out" ? r.gross < 0 : kind === "suggested" ? !!r.suggested.categoryId : true)),
    [rows, kind]
  );
  if (!rows.length) return <EmptyState>{emptyHint}</EmptyState>;
  const allVisible = visible.length > 0 && visible.every((r) => selected.includes(r.id));
  return (
    <div>
      {canAct && show === "open" && selected.length > 0 && <BulkBar ids={selected} rows={rows} categories={categories} events={events} internals={internals} onDone={() => setSelected([])} />}
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-2 text-xs text-gray-600">
        {canAct && show === "open" && (
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={allVisible} onChange={(e) => setSelected(e.target.checked ? visible.map((r) => r.id) : [])} /> Select all shown
          </label>
        )}
        <span className="ml-auto inline-flex gap-1" role="group" aria-label="Show">
          {(
            [
              ["all", `All (${rows.length})`],
              ["in", "Incoming"],
              ["out", "Outgoing"],
              ...(show === "open" ? [["suggested", "With suggestion"]] : []),
            ] as Array<[typeof kind, string]>
          ).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={cn("rounded px-2 py-1", kind === k ? "bg-gray-900 text-white" : "hover:bg-gray-100")}>
              {label}
            </button>
          ))}
        </span>
      </div>
      <ul className="divide-y divide-gray-100">
        {visible.map((p) => (
          <Row
            key={p.id}
            p={p}
            selected={selected.includes(p.id)}
            onSelect={(v) => setSelected((s) => (v ? [...s, p.id] : s.filter((x) => x !== p.id)))}
            canAct={canAct}
            categories={categories}
            events={events}
            internals={internals}
            links={links}
          />
        ))}
      </ul>
    </div>
  );
}
