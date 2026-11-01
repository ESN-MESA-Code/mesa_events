"use client";

import { useState } from "react";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { addCashBox, adjustCashBox, removeCashBox, setCashBoxDefault } from "@/app/actions/cash";
import { DENOMINATIONS, countTotal, denominationLabel, isNote, type CashCounts } from "@/lib/cash";
import type { CashBoxOption } from "@/components/CashBox";
import { formatCents } from "@/lib/dates";
import { cn } from "@/lib/utils";

export interface BoxChange {
  id: string;
  kind: "in" | "out" | "recount" | "report";
  centsBefore: number;
  centsAfter: number;
  note: string;
  /** "Hana HR, Thu, 5 Nov 2026, 14:02" */
  stamp: string;
  /** For a signed-off office hour or event: what it was. */
  report: string | null;
}

export interface ManagedBox extends CashBoxOption {
  changes: BoxChange[];
  /** Office hours and events counting with it right now. */
  openReports: number;
}

const MODES = {
  in: { label: "Put money in", button: "Put it in", hint: "The notes and coins you put in (change, new coins …)." },
  out: { label: "Take money out", button: "Take it out", hint: "The notes and coins you take out (to the bank …)." },
  recount: { label: "Recount", button: "Save the count", hint: "Everything in the box now – it replaces what the box held." },
} as const;
type Mode = keyof typeof MODES;

const KIND_LABEL: Record<BoxChange["kind"], string> = { in: "Money in", out: "Money out", recount: "Recounted", report: "Counted after" };

/** "2 × € 20 · 5 × € 2" */
const breakdown = (counts: CashCounts) =>
  DENOMINATIONS.filter((d) => (counts[String(d)] ?? 0) > 0)
    .map((d) => `${counts[String(d)]} × ${denominationLabel(d)}`)
    .join(" · ");

/**
 * The physical cash boxes (round 2026-10-31): what each holds, note by note
 * and coin by coin. Finance adds and removes boxes, picks the box office
 * hours and events start with, and puts money in, takes it out or recounts
 * a box; a signed-off office hour or event sets its box to what was counted
 * at the end.
 */
export function CashBoxes({ boxes, canAct }: { boxes: ManagedBox[]; canAct: boolean }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="cash-box-list">
        {boxes.map((b) => (
          <BoxCard key={b.id} box={b} canAct={canAct} />
        ))}
      </div>
      {canAct && <AddBox />}
    </div>
  );
}

function BoxCard({ box, canAct }: { box: ManagedBox; canAct: boolean }) {
  const { run, pending, error, confirm } = useAction();
  const [mode, setMode] = useState<Mode | null>(null);
  const [showAll, setShowAll] = useState(false);
  const changes = showAll ? box.changes : box.changes.slice(0, 3);
  return (
    <Card className="space-y-3 p-4" data-testid={`box-${box.name}`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="mr-auto">
          <h3 className="font-semibold text-gray-900">{box.name}</h3>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {box.defaultFor === "office_hour" && <Badge tone="blue">Office hours take it</Badge>}
            {box.defaultFor === "event" && <Badge tone="purple">Events take it</Badge>}
            {box.openReports > 0 && <Badge tone="amber">In use ({box.openReports})</Badge>}
          </div>
        </div>
        <p className="text-2xl font-semibold tabular-nums" data-testid="box-total">
          {formatCents(box.cents)}
        </p>
      </div>
      <p className="text-xs text-gray-600" data-testid="box-counts">
        {breakdown(box.counts) || "Empty"}
      </p>

      {canAct && (
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(MODES) as Mode[]).map((m) => (
            <Button key={m} type="button" size="sm" variant={mode === m ? "default" : "outline"} onClick={() => setMode(mode === m ? null : m)}>
              {MODES[m].label}
            </Button>
          ))}
        </div>
      )}
      {mode && <AdjustForm key={mode} box={box} mode={mode} onDone={() => setMode(null)} />}

      {box.changes.length > 0 && (
        <div className="border-t border-gray-100 pt-2">
          <p className="mb-1 text-xs font-semibold uppercase text-gray-500">History</p>
          <ul className="space-y-1 text-xs" data-testid="box-history">
            {changes.map((c) => {
              const delta = c.centsAfter - c.centsBefore;
              return (
                <li key={c.id} className="flex gap-2">
                  <span className={cn("w-20 shrink-0 text-right font-medium tabular-nums", delta < 0 && "text-red-700", delta > 0 && "text-emerald-700")}>
                    {delta > 0 ? "+" : ""}
                    {formatCents(delta)}
                  </span>
                  <span className="min-w-0 text-gray-600">
                    <span className="font-medium text-gray-800">{KIND_LABEL[c.kind]}</span>
                    {c.report && ` · ${c.report}`}
                    {c.note && ` · ${c.note}`} · {formatCents(c.centsAfter)} after
                    <span className="block text-gray-400">{c.stamp}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          {box.changes.length > 3 && (
            <button type="button" className="mt-1 text-xs text-esn hover:underline" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Less" : `All ${box.changes.length}`}
            </button>
          )}
        </div>
      )}

      {canAct && (
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2 text-xs">
          <label className="flex items-center gap-1 text-gray-600">
            Default for
            <Select
              aria-label={`${box.name} is the default for`}
              className="h-7 w-36 text-xs"
              value={box.defaultFor ?? ""}
              disabled={pending}
              onChange={(e) => e.target.value && run(setCashBoxDefault, { box_id: box.id, kind: e.target.value as "office_hour" | "event" })}
            >
              <option value="">–</option>
              <option value="office_hour">Office hours</option>
              <option value="event">Events</option>
            </Select>
          </label>
          <button
            type="button"
            className="ml-auto text-gray-600 hover:text-red-700 hover:underline"
            disabled={pending}
            onClick={async () => {
              if (await confirm({ title: `Remove the ${box.name}?`, body: "Only an empty box is removed. Its history stays with the office hours and events that counted it.", confirmLabel: "Remove", danger: true }))
                run(removeCashBox, { box_id: box.id }, undefined, "Cash box removed.");
            }}
          >
            Remove
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </Card>
  );
}

/** Notes and coins in, out, or the whole box counted. */
function AdjustForm({ box, mode, onDone }: { box: ManagedBox; mode: Mode; onDone: () => void }) {
  const { run, pending, error } = useAction();
  const [counts, setCounts] = useState<Record<string, string>>(() => (mode === "recount" ? Object.fromEntries(Object.entries(box.counts).map(([k, v]) => [k, String(v)])) : {}));
  const [note, setNote] = useState("");
  const numbers: CashCounts = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v === "" ? 0 : Number(v)]));
  const total = countTotal(numbers);
  const after = total === null ? null : mode === "in" ? box.cents + total : mode === "out" ? box.cents - total : total;
  const field = (d: number) => (
    <label key={d} className="flex items-center gap-1.5 text-xs">
      <span className="w-11 shrink-0 text-right tabular-nums text-gray-600">{denominationLabel(d)}</span>
      <span className="text-gray-400">×</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={100000}
        aria-label={`${MODES[mode].label}: ${denominationLabel(d)}`}
        className="h-7 w-14 rounded border border-gray-300 px-1.5 text-right tabular-nums"
        value={counts[String(d)] ?? ""}
        onChange={(e) => setCounts((c) => ({ ...c, [String(d)]: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
      />
      {mode === "out" && (box.counts[String(d)] ?? 0) > 0 && <span className="text-[10px] text-gray-400">/{box.counts[String(d)]}</span>}
    </label>
  );
  return (
    <form
      className="space-y-2 rounded-md border border-esn/30 bg-esn/5 p-3"
      data-testid={`adjust-${mode}`}
      onSubmit={(e) => {
        e.preventDefault();
        run(adjustCashBox, { box_id: box.id, mode, counts: Object.fromEntries(Object.entries(numbers).filter(([, n]) => n > 0)), note }, onDone);
      }}
    >
      <p className="text-xs text-gray-600">{MODES[mode].hint}</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <div className="space-y-1">{DENOMINATIONS.filter(isNote).map(field)}</div>
        <div className="space-y-1">{DENOMINATIONS.filter((d) => !isNote(d)).map(field)}</div>
      </div>
      <Input aria-label="Note" placeholder={mode === "out" ? "e.g. paid into the bank account" : mode === "in" ? "e.g. change from the bank" : "e.g. counted at the semester's end"} className="h-8 text-xs" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="tabular-nums">
          {mode === "recount" ? "In the box" : mode === "in" ? "In" : "Out"}: <b>{formatCents(total)}</b>
        </span>
        <span className={cn("tabular-nums text-gray-600", after !== null && after < 0 && "text-red-700")}>→ the box then holds {formatCents(after)}</span>
        <Button size="sm" className="ml-auto" disabled={pending || total === null || (mode !== "recount" && total === 0)}>
          {MODES[mode].button}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}

function AddBox() {
  const { run, pending, error } = useAction();
  const [name, setName] = useState("");
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => (e.preventDefault(), run(addCashBox, { name }, () => setName(""), "Cash box added."))}>
      <Input aria-label="Name of the new cash box" placeholder="e.g. Merch cash box" className="h-9 w-64" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      <Button size="sm" variant="outline" disabled={pending || !name.trim()}>
        Add a cash box
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
