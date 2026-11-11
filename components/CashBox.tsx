"use client";

import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, CircleCheck, ClipboardCheck, CreditCard, Equal, PiggyBank, Play, Scale, Square, TrendingUp, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge, Button, Select, Textarea } from "@/components/ui";
import { ProgressTrack, Stat, type TrackStep } from "@/components/EventKit";
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
  /** The physical box counted (round 2026-10-31). */
  box: CashBoxOption | null;
}

/** A physical cash box with what Finance knows is in it. */
export interface CashBoxOption {
  id: string;
  name: string;
  defaultFor: "office_hour" | "event" | null;
  cents: number;
  counts: CashCounts;
}

export interface CashFinance {
  canAct: boolean;
  booked: boolean;
  categories: Array<{ id: string; name: string }>;
  /** The category to suggest for booking ("ESNcard sales" / "Cash box takings"). */
  suggested: string | null;
}

function Figure({ icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone?: "red" | "green" }) {
  return <Stat icon={icon} label={label} value={value} tone={tone ?? "default"} />;
}

/** The white card of the cash box (redesign 2026-11-08): an icon, the title, its badge. */
function Shell({ title, badge, children }: { title: React.ReactNode; badge: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id="cash-box" aria-label="Cash box" className="scroll-mt-4 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm" data-testid="cash-box">
      <div className="flex flex-wrap items-center gap-3 p-4 sm:p-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-esn/5 text-esn" aria-hidden="true">
          <Wallet className="h-[18px] w-[18px]" />
        </span>
        <h2 className="mr-auto min-w-0 text-base font-bold text-gray-900">{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

/** Notes and coins of one count, with the running total. */
function CountForm({
  reportId,
  phase,
  saved,
  savedBy,
  disabled,
  suggested,
  submitLabel,
  onSaved,
}: {
  reportId: string;
  phase: "opening" | "closing";
  /** The button: "Confirm the start count" … */
  submitLabel?: string;
  /** After the count is saved (the cash box moves on to its next screen). */
  onSaved?: () => void;
  saved: CashCounts;
  savedBy: string | null;
  disabled: boolean;
  /** Not counted yet: what the box should hold (Finance's record), filled in to check. */
  suggested?: { counts: CashCounts; label: string } | null;
}) {
  const { run, pending, error } = useAction();
  const [counts, setCounts] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(savedBy || !suggested ? saved : suggested.counts).map(([k, v]) => [k, String(v)])));
  const numbers: CashCounts = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v === "" ? 0 : Number(v)]));
  const total = countTotal(numbers);
  const dirty = JSON.stringify(Object.entries(numbers).filter(([, n]) => n > 0).sort()) !== JSON.stringify(Object.entries(saved).sort());
  const label = phase === "opening" ? "Start (before selling)" : "End (after selling)";
  const PhaseIcon = phase === "opening" ? ArrowDownToLine : ArrowUpFromLine;
  const field = (d: number) => {
    const n = numbers[String(d)] ?? 0;
    return (
      <label key={d} className="flex items-center gap-2 text-sm">
        <span className={cn("w-14 shrink-0 rounded-md px-1.5 py-0.5 text-right text-xs font-semibold tabular-nums", isNote(d) ? "bg-esn/5 text-esn-dark" : "bg-amber-50 text-amber-800")}>{denominationLabel(d)}</span>
        <span className="text-gray-300" aria-hidden="true">
          ×
        </span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={100000}
          aria-label={`${label}: ${denominationLabel(d)}`}
          className="h-8 w-16 rounded-md border border-gray-300 px-2 text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-esn-accent disabled:bg-gray-50"
          value={counts[String(d)] ?? ""}
          disabled={disabled}
          onChange={(e) => setCounts((c) => ({ ...c, [String(d)]: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
        />
        <span className={cn("ml-auto hidden text-xs tabular-nums sm:inline", n > 0 ? "text-gray-600" : "text-gray-300")}>{formatCents(n * d)}</span>
      </label>
    );
  };
  return (
    <form
      className="space-y-3 rounded-xl border border-gray-200 p-4"
      data-testid={`count-${phase}`}
      onSubmit={(e) => {
        e.preventDefault();
        run(saveCashCount, { report_id: reportId, phase, counts: Object.fromEntries(Object.entries(numbers).filter(([, n]) => n > 0)) }, () => onSaved?.());
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", savedBy ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500")} aria-hidden="true">
          {savedBy ? <CircleCheck className="h-4 w-4" /> : <PhaseIcon className="h-4 w-4" />}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-gray-900">{label}</h3>
          {savedBy ? (
            <p className="text-xs text-gray-500">Counted by {savedBy}</p>
          ) : (
            <p className="text-xs text-amber-700">Not counted yet{suggested && !disabled ? ` – filled in from ${suggested.label}; count and correct it` : ""}</p>
          )}
        </div>
        <span className="ml-auto text-xl font-bold tabular-nums text-gray-900" data-testid={`total-${phase}`}>
          {total === null ? "–" : formatCents(total)}
        </span>
      </div>
      <div className="grid gap-x-5 gap-y-1.5 border-t border-gray-100 pt-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Notes</p>
          {DENOMINATIONS.filter(isNote).map(field)}
        </div>
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Coins</p>
          {DENOMINATIONS.filter((d) => !isNote(d)).map(field)}
        </div>
      </div>
      {!disabled && (
        <Button type="submit" size="sm" variant={dirty || !savedBy ? "default" : "outline"} disabled={pending || total === null}>
          {pending ? "…" : (submitLabel ?? (savedBy ? "Save the count again" : "Save the count"))}{total !== null && submitLabel ? ` · ${formatCents(total)}` : ""}
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

/** Which box: the default of office hours or events, unless the staff pick another. */
function StartForm({ target, boxes, officeHour }: { target: { event_id: string } | { internal_event_id: string }; boxes: CashBoxOption[]; officeHour: boolean }) {
  const [box, setBox] = useState(boxes.find((b) => b.defaultFor === (officeHour ? "office_hour" : "event"))?.id ?? boxes[0]?.id ?? "");
  if (!boxes.length) return <p className="text-amber-700">There is no cash box yet – Finance adds one first.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Which cash box" className="h-9 w-56" value={box} onChange={(e) => setBox(e.target.value)}>
        {boxes.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>
      <ActionButton action={startCashBox} input={{ ...target, box_id: box }} size="default">
        Start the cash box
      </ActionButton>
    </div>
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

/** Where the cash box is: count at the start → running → count at the end → sign off → done. */
export type CashPhase = "start" | "running" | "end" | "signoff" | "closed";

export function cashPhase(report: Pick<CashReportView, "opening_cents" | "closing_cents" | "closed_at">): CashPhase {
  if (report.closed_at) return "closed";
  if (report.opening_cents === null) return "start";
  if (report.closing_cents === null) return "running";
  return "signoff";
}

/** A screen of the cash box: what it is about and what to do. */
function Step({ icon: Icon, title, text, children, testId }: { icon: LucideIcon; title: string; text?: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <div className="space-y-4" data-testid={testId}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-esn text-white" aria-hidden="true">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-gray-900">{title}</h3>
          {text && <p className="text-sm text-gray-600">{text}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

/** Before, after, takings – and for office hours the cards and the difference. */
function Summary({ report, officeHour }: { report: CashReportView; officeHour: boolean }) {
  const take = takings(report);
  const cards = officeHour ? cardRevenue(report) : null;
  const expected = officeHour ? expectedClosing(report) : null;
  const diff = officeHour ? difference(report) : null;
  return (
    <div className={cn("grid grid-cols-2 gap-2", officeHour ? "lg:grid-cols-4" : "sm:grid-cols-3")} data-testid="cash-figures">
      <Figure icon={ArrowDownToLine} label="Start" value={formatCents(report.opening_cents)} />
      <Figure icon={ArrowUpFromLine} label="End" value={formatCents(report.closing_cents)} />
      <Figure icon={TrendingUp} label="Takings (end − start)" value={formatCents(take)} tone={take !== null && take < 0 ? "red" : take !== null && take > 0 ? "green" : undefined} />
      {officeHour && (
        <>
          <Figure icon={CreditCard} label="ESNcards sold" value={`${report.esncards_internal} internal · ${report.esncards_external} external`} />
          <Figure icon={CreditCard} label="Cards should bring" value={formatCents(cards)} />
          <Figure icon={Equal} label="Expected at the end (all cash)" value={formatCents(expected)} />
          <Figure icon={Scale} label="Difference" value={diff === null ? "–" : `${diff > 0 ? "+" : ""}${formatCents(diff)}`} tone={diff === null || diff === 0 ? undefined : diff < 0 ? "red" : "green"} />
        </>
      )}
    </div>
  );
}

/**
 * The cash box of an office hour or an event, one step at a time (round
 * 2026-11-11 (2)): count the box at the start and confirm it; while it
 * runs, count the ESNcards sold, show the PayPal QR codes and note what
 * was sold; count it at the end; the OC signs it off on a summary.
 * Finance checks, reopens or books it. Earlier steps can be corrected
 * until the sign-off.
 */
export function CashBox({
  report,
  target,
  officeHour,
  canCount,
  isOc,
  finance,
  boxes,
  payments,
}: {
  report: CashReportView | null;
  target: { event_id: string } | { internal_event_id: string };
  officeHour: boolean;
  canCount: boolean;
  isOc: boolean;
  finance: CashFinance | null;
  /** The cash boxes to pick from (round 2026-10-31). */
  boxes: CashBoxOption[];
  /** The PayPal QR codes, shown while the box runs (round 2026-11-11 (2)). */
  payments?: React.ReactNode;
}) {
  const [ending, setEnding] = useState(false);
  const [correcting, setCorrecting] = useState<"opening" | "closing" | null>(null);

  if (!report) {
    return (
      <Shell title="Cash box" badge={<Badge tone="gray">Not started</Badge>}>
        <div className="space-y-5 px-4 pb-5 text-sm text-gray-600 sm:px-5">
          <p>
            {officeHour
              ? "Count the cash box when the office hour starts, count the ESNcards you sell, and count the box again at the end. The OC signs it off."
              : "Using the cash box (selling drinks or the like)? Count it at the start and at the end; the OC signs it off and Finance sees the takings."}
          </p>
          <div className="rounded-xl bg-gray-50/70 px-2 py-4">
            <ProgressTrack label="How the cash box works" steps={trackSteps(null, false, false)} className="mx-auto max-w-2xl" />
          </div>
          {canCount ? (
            <StartForm target={target} boxes={boxes} officeHour={officeHour} />
          ) : (
            <p className="flex items-center gap-2 text-gray-500">
              <PiggyBank className="h-4 w-4 text-gray-400" aria-hidden="true" />
              The OC and helpers start it.
            </p>
          )}
          {/* Office hours show their QR codes only while the box runs (round 2026-11-11 (3)); events may sell without a cash box. */}
          {payments && !officeHour && (
            <div className="border-t border-gray-100 pt-4">
              <p className="mb-2 text-sm font-semibold text-gray-900">PayPal QR codes</p>
              {payments}
            </div>
          )}
        </div>
      </Shell>
    );
  }

  const status = cashStatus(report, finance?.booked ?? false);
  const phase = cashPhase(report);
  const editable = canCount && phase !== "closed";
  // What is on screen: the phase, or a step the staff went back to.
  const screen: CashPhase | "correct" = correcting && editable ? "correct" : phase === "running" && ending && editable ? "end" : phase;
  const opening = (
    <CountForm
      key={`o-${report.opening_counted}`}
      reportId={report.id}
      phase="opening"
      saved={report.opening_counts}
      savedBy={report.opening_counted}
      disabled={!editable}
      submitLabel={report.opening_counted ? "Save the corrected start count" : "Confirm the start count"}
      onSaved={() => setCorrecting(null)}
      suggested={report.box && report.box.cents > 0 ? { counts: report.box.counts, label: `what Finance knows is in the ${report.box.name} (${formatCents(report.box.cents)})` } : null}
    />
  );
  const closing = (
    <CountForm
      key={`c-${report.closing_counted}`}
      reportId={report.id}
      phase="closing"
      saved={report.closing_counts}
      savedBy={report.closing_counted}
      disabled={!editable}
      submitLabel={report.closing_counted ? "Save the corrected end count" : "Confirm the end count"}
      onSaved={() => {
        setCorrecting(null);
        setEnding(false);
      }}
    />
  );

  return (
    <Shell
      title={
        <>
          Cash box
          {report.box && (
            <span className="font-normal text-gray-500" data-testid="cash-box-name">
              {" "}
              · {report.box.name}
            </span>
          )}
        </>
      }
      badge={
        <Badge tone={CASH_STATUS_TONES[status]} data-testid="cash-status">
          {phase === "running" ? "Running" : CASH_STATUS_LABELS[status]}
        </Badge>
      }
    >
      <div className="border-y border-gray-100 bg-gray-50/60 px-2 py-4 sm:px-6">
        <ProgressTrack label="Cash box steps" steps={trackSteps(report, finance?.booked ?? false, screen === "end")} className="mx-auto max-w-2xl" />
      </div>
      <div className="space-y-5 p-4 sm:p-5" data-phase={screen}>
        {screen === "correct" && (
          <Step icon={correcting === "opening" ? ArrowDownToLine : ArrowUpFromLine} title={correcting === "opening" ? "Correct the start count" : "Correct the end count"} testId="cash-correct">
            {correcting === "opening" ? opening : closing}
            <Button variant="ghost" size="sm" onClick={() => setCorrecting(null)}>
              Back
            </Button>
          </Step>
        )}

        {screen === "start" && (
          <Step
            icon={ArrowDownToLine}
            title="1 · Count the box at the start"
            text={editable ? "Count every note and coin before you sell anything, then confirm. The next screen is for while it runs." : "The OC and helpers count the box at the start."}
            testId="cash-start"
          >
            {opening}
          </Step>
        )}

        {screen === "running" && (
          <Step
            icon={Play}
            title="2 · Running"
            text={
              <>
                Started with <strong className="tabular-nums">{formatCents(report.opening_cents)}</strong>
                {report.opening_counted ? `, counted by ${report.opening_counted}` : ""}.
                {editable && (
                  <>
                    {" "}
                    <button type="button" className="text-esn hover:underline" onClick={() => setCorrecting("opening")}>
                      Correct
                    </button>
                  </>
                )}
              </>
            }
            testId="cash-running"
          >
            {officeHour && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <CardCounter reportId={report.id} card="internal" value={report.esncards_internal} price={report.card_price_internal_cents} disabled={!editable} />
                  <CardCounter reportId={report.id} card="external" value={report.esncards_external} price={report.card_price_external_cents} disabled={!editable} />
                </div>
                <p className="text-sm text-gray-600" data-testid="cash-expected-now">
                  Cash that should be in the box now (if every card was paid in cash): <strong className="tabular-nums">{formatCents(expectedClosing({ ...report, closing_cents: null }))}</strong>
                </p>
              </>
            )}
            {payments && (
              <div className="rounded-xl border border-gray-200 p-3 sm:p-4">
                <p className="mb-2 text-sm font-semibold text-gray-900">PayPal QR codes</p>
                {payments}
              </div>
            )}
            <NoteForm reportId={report.id} note={report.note} disabled={!editable} />
            {editable && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-esn/20 bg-esn/5 p-4">
                <p className="min-w-0 flex-1 basis-64 text-sm text-esn-dark">Done selling? Count the box once more.</p>
                <Button size="default" onClick={() => setEnding(true)} data-testid="cash-end">
                  <Square className="mr-1.5 h-4 w-4" aria-hidden="true" /> End and count the box
                </Button>
              </div>
            )}
          </Step>
        )}

        {screen === "end" && (
          <Step icon={ArrowUpFromLine} title="3 · Count the box at the end" text="Count every note and coin now, then confirm. You see the summary and the sign-off next." testId="cash-ending">
            {closing}
            <Button variant="ghost" size="sm" onClick={() => setEnding(false)}>
              Back – still selling
            </Button>
          </Step>
        )}

        {screen === "signoff" && (
          <Step icon={ClipboardCheck} title="4 · Check and sign off" text="Everything at a glance. Correct a count if something is off, then the OC signs it off." testId="cash-summary">
            <Summary report={report} officeHour={officeHour} />
            {report.note && <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">“{report.note}”</p>}
            {editable && (
              <p className="flex flex-wrap gap-3 text-sm">
                <button type="button" className="text-esn hover:underline" onClick={() => setCorrecting("opening")}>
                  Correct the start count
                </button>
                <button type="button" className="text-esn hover:underline" onClick={() => setCorrecting("closing")}>
                  Correct the end count
                </button>
              </p>
            )}
            {editable && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-esn/20 bg-esn/5 p-4" data-testid="sign-off">
                <p className="min-w-0 flex-1 basis-64 text-sm text-esn-dark">
                  {isOc ? "Signing off fixes the counts and sales (Finance can reopen it)." : "The OC signs the cash box off."}
                </p>
                {isOc && (
                  <ActionButton
                    action={closeCashBox}
                    input={{ report_id: report.id }}
                    size="default"
                    confirm={{
                      title: "Sign off the cash box?",
                      body: `Start: ${formatCents(report.opening_cents)}\nEnd: ${formatCents(report.closing_cents)}${officeHour ? `\nESNcards: ${report.esncards_internal} internal, ${report.esncards_external} external` : ""}\n\n${report.box ? `The ${report.box.name} then holds ${formatCents(report.closing_cents)}. ` : ""}Finance checks and books it next; only Finance can reopen it.`,
                      confirmLabel: "Sign off",
                    }}
                    done="Cash box signed off – Finance checks it next."
                  >
                    Close and sign off
                  </ActionButton>
                )}
              </div>
            )}
          </Step>
        )}

        {screen === "closed" && (
          <Step icon={CircleCheck} title="Signed off" text={`By ${report.closed}. ${report.checked ? `Checked by ${report.checked}.` : "Finance checks it."}`} testId="cash-closed">
            <Summary report={report} officeHour={officeHour} />
            {report.note && <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">“{report.note}”</p>}
            {officeHour && (
              <div className="grid gap-3 sm:grid-cols-2">
                <CardCounter reportId={report.id} card="internal" value={report.esncards_internal} price={report.card_price_internal_cents} disabled />
                <CardCounter reportId={report.id} card="external" value={report.esncards_external} price={report.card_price_external_cents} disabled />
              </div>
            )}
            {finance?.canAct && (
              <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4" data-testid="cash-finance">
                {!report.checked_at && (
                  <ActionButton action={checkCashBox} input={{ report_id: report.id }} variant="success">
                    Mark checked
                  </ActionButton>
                )}
                {!finance.booked && (takings(report) ?? 0) > 0 && <BookForm reportId={report.id} finance={finance} />}
                {!finance.booked && (
                  <ActionButton action={reopenCashBox} input={{ report_id: report.id }} variant="outline" confirm="Reopen the cash box? The OC has to sign it off again.">
                    Reopen
                  </ActionButton>
                )}
                {finance.booked && <span className="text-sm text-gray-600">The takings are in the ledger.</span>}
              </div>
            )}
          </Step>
        )}
      </div>
    </Shell>
  );
}

/** Start count → running → end count → signed off → checked by Finance (or booked). */
function trackSteps(report: CashReportView | null, booked: boolean, ending: boolean): TrackStep[] {
  const before = report?.opening_cents != null;
  const after = report?.closing_cents != null;
  const closed = !!report?.closed_at;
  const checked = !!report?.checked_at;
  const current = !before ? 0 : !after ? (ending ? 2 : 1) : !closed ? 3 : !checked ? 4 : 5;
  const state = (i: number): TrackStep["state"] => (!report ? "todo" : i < current ? "done" : i === current ? "current" : "todo");
  return [
    { label: "Start count", note: report?.opening_counted ?? "before selling", state: state(0) },
    { label: "Running", note: "cards, QR codes", state: state(1) },
    { label: "End count", note: report?.closing_counted ?? "at the end", state: state(2) },
    { label: "Signed off", note: report?.closed ?? "by the OC", state: state(3) },
    { label: booked ? "Booked" : "Checked", note: report?.checked ?? "by Finance", state: checked || booked ? "done" : state(4) },
  ];
}
