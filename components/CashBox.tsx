"use client";

import { useState } from "react";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Select, Textarea } from "@/components/ui";
import { ActionButton, useAction } from "@/components/ActionButton";
import { bookCashBox, bumpEsncards, checkCashBox, closeCashBox, reopenCashBox, saveCashCount, setCashNote, startCashBox } from "@/app/actions/cash";
import { CASH_STATUS_LABELS, CASH_STATUS_TONES, DENOMINATIONS, cardRevenue, cashStatus, countTotal, denominationLabel, difference, expectedClosing, isNote, takings, type CashCounts } from "@/lib/cash";
import { formatCents } from "@/lib/dates";
import { cn } from "@/lib/utils";

export interface CashReportView {
  id: string;
  opening_counts: CashCounts;
  opening_cents: number | null;
  opening_counted: string | null;
  closing_counts: CashCounts;
  closing_cents: number | null;
  closing_counted: string | null;
  esncards_internal: number;
  esncards_external: number;
  card_price_internal_cents: number | null;
  card_price_external_cents: number | null;
  note: string;
  closed: string | null;
  closed_at: string | null;
  checked: string | null;
  checked_at: string | null;
}

export interface CashFinance {
  canAct: boolean;
  booked: boolean;
  categories: Array<{ id: string; name: string }>;
  /** The category to suggest for booking ("ESNcard sales" / "Cash box takings"). */
  suggested: string | null;
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "red" | "green" }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", tone === "red" && "text-red-700", tone === "green" && "text-emerald-700")}>{value}</p>
    </div>
  );
}

/** Notes and coins of one count, with the running total. */
function CountForm({ reportId, phase, saved, savedBy, disabled }: { reportId: string; phase: "opening" | "closing"; saved: CashCounts; savedBy: string | null; disabled: boolean }) {
  const { run, pending, error } = useAction();
  const [counts, setCounts] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, String(v)])));
  const numbers: CashCounts = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v === "" ? 0 : Number(v)]));
  const total = countTotal(numbers);
  const dirty = JSON.stringify(Object.entries(numbers).filter(([, n]) => n > 0).sort()) !== JSON.stringify(Object.entries(saved).sort());
  const label = phase === "opening" ? "Before (opening)" : "After (closing)";
  const field = (d: number) => (
    <label key={d} className="flex items-center gap-2 text-sm">
      <span className="w-14 shrink-0 text-right tabular-nums text-gray-600">{denominationLabel(d)}</span>
      <span className="text-gray-400">×</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={100000}
        aria-label={`${label}: ${denominationLabel(d)}`}
        className="h-8 w-16 rounded border border-gray-300 px-2 text-right tabular-nums disabled:bg-gray-50"
        value={counts[String(d)] ?? ""}
        disabled={disabled}
        onChange={(e) => setCounts((c) => ({ ...c, [String(d)]: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
      />
    </label>
  );
  return (
    <form
      className="space-y-3"
      data-testid={`count-${phase}`}
      onSubmit={(e) => {
        e.preventDefault();
        run(saveCashCount, { report_id: reportId, phase, counts: Object.fromEntries(Object.entries(numbers).filter(([, n]) => n > 0)) });
      }}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="font-semibold">{label}</h3>
        <span className="ml-auto text-lg font-semibold tabular-nums" data-testid={`total-${phase}`}>
          {total === null ? "–" : formatCents(total)}
        </span>
      </div>
      {savedBy ? <p className="text-xs text-gray-500">Counted by {savedBy}</p> : <p className="text-xs text-amber-700">Not counted yet</p>}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <div className="space-y-1.5">{DENOMINATIONS.filter(isNote).map(field)}</div>
        <div className="space-y-1.5">{DENOMINATIONS.filter((d) => !isNote(d)).map(field)}</div>
      </div>
      {!disabled && (
        <Button type="submit" size="sm" variant={dirty || !savedBy ? "default" : "outline"} disabled={pending || total === null}>
          {pending ? "…" : savedBy ? "Save the count again" : "Save the count"}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}

function CardCounter({ reportId, card, value, price, disabled }: { reportId: string; card: "internal" | "external"; value: number; price: number | null; disabled: boolean }) {
  const { run, pending, error } = useAction();
  const [shown, setShown] = useState(value);
  const bump = (delta: number) =>
    run(bumpEsncards, { report_id: reportId, card, delta }, (r) => setShown(r[card]));
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 text-center" data-testid={`esncards-${card}`}>
      <p className="text-sm font-semibold">{card === "internal" ? "ESNcards – members (internal)" : "ESNcards – external"}</p>
      <p className="text-xs text-gray-500">{price === null ? "no price set" : `${formatCents(price)} each`}</p>
      <div className="mt-2 flex items-center justify-center gap-3">
        <Button type="button" variant="outline" size="lg" aria-label={`One ${card} ESNcard less`} disabled={disabled || pending || shown === 0} onClick={() => bump(-1)}>
          −
        </Button>
        <span className="w-14 text-3xl font-bold tabular-nums" aria-live="polite">
          {shown}
        </span>
        <Button type="button" size="lg" aria-label={`One ${card} ESNcard sold`} disabled={disabled || pending} onClick={() => bump(1)}>
          +
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

function NoteForm({ reportId, note, disabled }: { reportId: string; note: string; disabled: boolean }) {
  const { run, pending, error } = useAction();
  const [value, setValue] = useState(note);
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(setCashNote, { report_id: reportId, note: value });
      }}
    >
      <label htmlFor={`note-${reportId}`} className="text-sm font-semibold">
        Note
      </label>
      <Textarea id={`note-${reportId}`} rows={2} maxLength={1000} placeholder="What was sold or paid from the box (e.g. 30 drinks at € 2, € 5 change borrowed)" value={value} disabled={disabled} onChange={(e) => setValue(e.target.value)} />
      {!disabled && (
        <Button type="submit" size="sm" variant="outline" disabled={pending || value === note}>
          Save the note
        </Button>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}

function BookForm({ reportId, finance }: { reportId: string; finance: CashFinance }) {
  const { run, pending, error } = useAction();
  const [category, setCategory] = useState(finance.categories.find((c) => c.name === finance.suggested)?.id ?? finance.categories[0]?.id ?? "");
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Select aria-label="Book as" className="h-8 w-48" value={category} onChange={(e) => setCategory(e.target.value)}>
        {finance.categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Button size="sm" variant="success" disabled={pending || !category} onClick={() => run(bookCashBox, { report_id: reportId, category_id: category })}>
        Book takings into the ledger
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

/**
 * The cash box of an office hour or an event: count it before and after,
 * count ESNcards sold (office hours), and the OC signs off. Finance checks,
 * reopens or books it.
 */
export function CashBox({
  report,
  target,
  officeHour,
  canCount,
  isOc,
  finance,
}: {
  report: CashReportView | null;
  target: { event_id: string } | { internal_event_id: string };
  officeHour: boolean;
  canCount: boolean;
  isOc: boolean;
  finance: CashFinance | null;
}) {
  if (!report) {
    return (
      <Card data-testid="cash-box">
        <CardHeader>
          <CardTitle>Cash box</CardTitle>
          <Badge tone="gray">Not started</Badge>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-600">
          <p>
            {officeHour
              ? "Count the cash box when the office hour starts, count the ESNcards you sell, and count the box again at the end. The OC signs it off."
              : "Using the cash box (selling drinks or the like)? Count it before and after; the OC signs it off and Finance sees the takings."}
          </p>
          {canCount ? (
            <ActionButton action={startCashBox} input={target} size="default">
              Start the cash box
            </ActionButton>
          ) : (
            <p>The OC and helpers start it.</p>
          )}
        </CardContent>
      </Card>
    );
  }

  const status = cashStatus(report, finance?.booked ?? false);
  const closed = !!report.closed_at;
  const editable = canCount && !closed;
  const take = takings(report);
  const cards = officeHour ? cardRevenue(report) : null;
  const expected = officeHour ? expectedClosing(report) : null;
  const diff = officeHour ? difference(report) : null;

  return (
    <Card data-testid="cash-box">
      <CardHeader>
        <CardTitle>Cash box</CardTitle>
        <Badge tone={CASH_STATUS_TONES[status]} data-testid="cash-status">
          {CASH_STATUS_LABELS[status]}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        {closed && (
          <Alert tone="success">
            Signed off by {report.closed}. {report.checked ? `Checked by ${report.checked}.` : "Finance checks it."}
          </Alert>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="cash-figures">
          <Figure label="Before" value={formatCents(report.opening_cents)} />
          <Figure label="After" value={formatCents(report.closing_cents)} />
          <Figure label="Takings (after − before)" value={formatCents(take)} tone={take !== null && take < 0 ? "red" : undefined} />
          {officeHour ? (
            <Figure label="ESNcards sold" value={`${report.esncards_internal} internal · ${report.esncards_external} external`} />
          ) : (
            <Figure label="Status" value={CASH_STATUS_LABELS[status]} />
          )}
          {officeHour && (
            <>
              <Figure label="Cards should bring" value={formatCents(cards)} />
              <Figure label="Expected after (all cash)" value={formatCents(expected)} />
              <Figure label="Difference" value={diff === null ? "–" : `${diff > 0 ? "+" : ""}${formatCents(diff)}`} tone={diff === null || diff === 0 ? undefined : diff < 0 ? "red" : "green"} />
            </>
          )}
        </div>

        {officeHour && (
          <div className="grid gap-3 sm:grid-cols-2">
            <CardCounter reportId={report.id} card="internal" value={report.esncards_internal} price={report.card_price_internal_cents} disabled={!editable} />
            <CardCounter reportId={report.id} card="external" value={report.esncards_external} price={report.card_price_external_cents} disabled={!editable} />
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <CountForm key={`o-${report.opening_counted}`} reportId={report.id} phase="opening" saved={report.opening_counts} savedBy={report.opening_counted} disabled={!editable} />
          <CountForm key={`c-${report.closing_counted}`} reportId={report.id} phase="closing" saved={report.closing_counts} savedBy={report.closing_counted} disabled={!editable} />
        </div>

        <NoteForm reportId={report.id} note={report.note} disabled={!editable} />

        {editable && (
          <div className="rounded-lg border border-esn/30 bg-esn/5 p-3 space-y-2" data-testid="sign-off">
            <p className="text-sm">
              {isOc
                ? "When the box is counted after the end, sign it off: the counts and sales are then fixed (Finance can reopen it)."
                : "The OC signs the cash box off once it is counted before and after."}
            </p>
            {isOc && (
              <ActionButton
                action={closeCashBox}
                input={{ report_id: report.id }}
                size="default"
                disabled={report.opening_cents === null || report.closing_cents === null}
                confirm={{
                  title: "Sign off the cash box?",
                  body: `Before: ${formatCents(report.opening_cents)}\nAfter: ${formatCents(report.closing_cents)}${officeHour ? `\nESNcards: ${report.esncards_internal} internal, ${report.esncards_external} external` : ""}\n\nFinance checks and books it next; only Finance can reopen it.`,
                  confirmLabel: "Sign off",
                }}
                done="Cash box signed off – Finance checks it next."
              >
                Close and sign off
              </ActionButton>
            )}
          </div>
        )}

        {finance?.canAct && closed && (
          <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4" data-testid="cash-finance">
            {!report.checked_at && (
              <ActionButton action={checkCashBox} input={{ report_id: report.id }} variant="success">
                Mark checked
              </ActionButton>
            )}
            {!finance.booked && take !== null && take > 0 && <BookForm reportId={report.id} finance={finance} />}
            {!finance.booked && (
              <ActionButton action={reopenCashBox} input={{ report_id: report.id }} variant="outline" confirm="Reopen the cash box? The OC has to sign it off again.">
                Reopen
              </ActionButton>
            )}
            {finance.booked && <span className="text-sm text-gray-600">The takings are in the ledger.</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
