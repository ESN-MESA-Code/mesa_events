"use client";

import { useRef, useState } from "react";
import { CheckCircle2, FileUp, Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { addPaypalRows, finishImport, importPretixOrders, linkPretixEvent, matchPayments, startImport, syncPretix, bookPretixOrders } from "@/app/actions/payments";
import { parsePaypalCsv, type PaypalParse } from "@/lib/payments/paypal";
import { parsePretixCsv, type PretixParse } from "@/lib/payments/pretix";
import type { DateOrder } from "@/lib/payments/csv";
import { formatCents } from "@/lib/dates";
import { plural } from "@/lib/plural";

type Result<T> = { ok: true; data: T } | { ok: false; message: string; issues?: string[] };
const fail = (r: { ok: false; message: string; issues?: string[] }) => [r.message, ...(r.issues ?? []).slice(0, 3)].join(" ");

interface MatchTotals {
  booked: number;
  ignored: number;
  suggested: number;
  open: number;
  errors: string[];
}

/** Runs the matching batch by batch until nothing is left, reporting progress. */
async function matchAll(importId: string | undefined, again: boolean, progress: (done: number, left: number) => void): Promise<MatchTotals> {
  const sum: MatchTotals = { booked: 0, ignored: 0, suggested: 0, open: 0, errors: [] };
  let done = 0;
  for (let round = 0; round < 100; round++) {
    const r = (await matchPayments({ import_id: importId, again: again && round === 0 })) as Result<MatchTotals & { checked: number; remaining: number }>;
    if (!r.ok) throw new Error(fail(r));
    sum.booked += r.data.booked;
    sum.ignored += r.data.ignored;
    sum.suggested += r.data.suggested;
    sum.open += r.data.open;
    sum.errors.push(...r.data.errors);
    done += r.data.checked;
    progress(done, r.data.remaining);
    if (!r.data.remaining || !r.data.checked) break;
  }
  return sum;
}

function Summary({ s }: { s: MatchTotals }) {
  return (
    <Alert tone="success" className="space-y-1" data-testid="import-summary">
      <p className="flex items-center gap-1.5 font-medium">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {plural(s.booked, "payment")} booked automatically, {plural(s.ignored, "transfer")} ignored.
      </p>
      <p>
        {s.suggested + s.open > 0 ? (
          <>
            {plural(s.suggested + s.open, "payment")} wait in{" "}
            <Link href="/team/finance/inbox" className="font-medium underline">
              To label
            </Link>{" "}
            ({s.suggested} with a suggestion).
          </>
        ) : (
          "Nothing left to label."
        )}
      </p>
      {s.errors.length > 0 && <p className="text-red-700">Problems: {[...new Set(s.errors)].slice(0, 3).join(" · ")}</p>}
    </Alert>
  );
}

/** PayPal: choose the file, check what was read, import (in chunks) and match. */
export function PaypalImport({ lastTo }: { lastTo: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [order, setOrder] = useState<DateOrder | "auto">("auto");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<MatchTotals & { added: number; known: number } | null>(null);
  const parsed: PaypalParse | null = file ? parsePaypalCsv(file.text, order === "auto" ? undefined : order) : null;
  const incoming = parsed?.rows.filter((r) => r.gross > 0) ?? [];
  const outgoing = parsed?.rows.filter((r) => r.gross < 0) ?? [];

  async function go() {
    if (!parsed || !file) return;
    setError(null);
    setDone(null);
    try {
      setBusy("Starting the import…");
      const started = (await startImport({ source: "paypal", filename: file.name.slice(0, 200) })) as Result<{ id: string }>;
      if (!started.ok) throw new Error(fail(started));
      const s = started;
      let added = 0;
      let known = 0;
      for (let i = 0; i < parsed.rows.length; i += 250) {
        setBusy(`Saving transactions ${i + 1}–${Math.min(i + 250, parsed.rows.length)} of ${parsed.rows.length}…`);
        const r = (await addPaypalRows({ import_id: s.data.id, rows: parsed.rows.slice(i, i + 250) })) as Result<{ added: number; known: number }>;
        if (!r.ok) throw new Error(fail(r));
        added += r.data.added;
        known += r.data.known;
      }
      const f = (await finishImport({
        import_id: s.data.id,
        period_from: parsed.from,
        period_to: parsed.to,
        rows_total: parsed.rows.length + parsed.skipped.length,
        rows_new: added,
        rows_skipped: parsed.skipped.length,
        balance_cents: parsed.balance?.cents ?? null,
        balance_on: parsed.balance?.day ?? null,
      })) as Result<unknown>;
      if (!f.ok) throw new Error(fail(f));
      setBusy("Matching references, pretix orders and links…");
      const m = await matchAll(s.data.id, false, (n, left) => setBusy(`Matching… ${n} checked, ${left} to go`));
      setDone({ ...m, added, known });
      setFile(null);
      if (input.current) input.current.value = "";
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The import failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3" data-testid="paypal-import">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 p-6 text-center hover:border-esn">
        <FileUp className="h-6 w-6 text-gray-400" aria-hidden="true" />
        <span className="text-sm font-medium text-gray-700">{file ? file.name : "Choose the PayPal CSV"}</span>
        <span className="text-xs text-gray-500">{lastTo ? `Last import went until ${lastTo} – overlapping is fine, known transactions are skipped.` : "Activity download, CSV, any period."}</span>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          data-testid="paypal-file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            setDone(null);
            setError(null);
            if (!f) return setFile(null);
            if (f.size > 20_000_000) return setError("This file is larger than 20 MB – download a shorter period.");
            setFile({ name: f.name, text: await f.text() });
          }}
        />
      </label>
      {parsed && parsed.missing.length > 0 && (
        <Alert tone="error">
          This does not look like a PayPal activity download – missing columns: {parsed.missing.join(", ")}. Download “Activity download” as CSV (see the guide).
        </Alert>
      )}
      {parsed && !parsed.missing.length && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm" data-testid="paypal-preview">
          <p className="font-medium text-gray-900">
            {plural(parsed.rows.length, "transaction")} from {parsed.from ?? "–"} to {parsed.to ?? "–"}
          </p>
          <p className="text-gray-600">
            {incoming.length} incoming ({formatCents(incoming.reduce((s, r) => s + r.gross, 0))}) · {outgoing.length} outgoing ({formatCents(-outgoing.reduce((s, r) => s + r.gross, 0))}) · fees {formatCents(-parsed.rows.reduce((s, r) => s + r.fee, 0))}
            {parsed.balance && ` · balance ${formatCents(parsed.balance.cents)} on ${parsed.balance.day}`}
          </p>
          {parsed.skipped.length > 0 && (
            <details className="mt-1 text-xs text-gray-500">
              <summary className="cursor-pointer">{plural(parsed.skipped.length, "line")} left out (pending, other currencies …)</summary>
              <ul className="mt-1 list-disc pl-5">
                {parsed.skipped.slice(0, 20).map((s) => (
                  <li key={s.line}>
                    line {s.line}: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Field label="Dates are written" htmlFor="date-order">
              <Select id="date-order" className="h-9 w-56" value={order} onChange={(e) => setOrder(e.target.value as DateOrder | "auto")}>
                <option value="auto">Automatic ({parsed.dateOrder === "dmy" ? "day first" : "month first"})</option>
                <option value="dmy">Day first (31.12. / 31/12)</option>
                <option value="mdy">Month first (12/31, US)</option>
              </Select>
            </Field>
            <Button onClick={go} disabled={!!busy || !parsed.rows.length} data-testid="paypal-go">
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Import {plural(parsed.rows.length, "transaction")}
            </Button>
          </div>
        </div>
      )}
      {busy && (
        <p className="flex items-center gap-2 text-sm text-gray-600" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {busy}
        </p>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {done && (
        <>
          <p className="text-sm text-gray-600">
            {plural(done.added, "new transaction")}
            {done.known ? `, ${done.known} imported before` : ""}.
          </p>
          <Summary s={done} />
        </>
      )}
    </div>
  );
}

/** Matches every open payment again (after new links, pretix orders or linked events). */
export function MatchAgain() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<MatchTotals | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        disabled={!!busy}
        onClick={async () => {
          setError(null);
          setDone(null);
          setBusy("Matching…");
          try {
            setDone(await matchAll(undefined, true, (n, left) => setBusy(`Matching… ${n} checked, ${left} to go`)));
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Failed.");
          } finally {
            setBusy(null);
          }
        }}
      >
        <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" /> Match open payments again
      </Button>
      {busy && <p className="text-xs text-gray-600">{busy}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {done && <Summary s={done} />}
    </div>
  );
}

/** pretix: the "Order data" CSV, of all events (with the event column) or of one event (chosen here). */
export function PretixCsvImport({ events }: { events: Array<{ id: string; label: string; slug: string | null }> }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [eventId, setEventId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ added: number; updated: number; unlinked: string[] } | null>(null);
  const chosen = events.find((e) => e.id === eventId);
  const parsed: PretixParse | null = file ? parsePretixCsv(file.text, chosen?.slug ?? undefined) : null;
  const paid = parsed?.orders.filter((o) => o.status === "paid") ?? [];

  return (
    <div className="space-y-3" data-testid="pretix-import">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="pretix “Order data” CSV" htmlFor="pretix-file">
          <Input
            ref={input}
            id="pretix-file"
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              setDone(null);
              setError(null);
              setFile(f ? { name: f.name, text: await f.text() } : null);
            }}
          />
        </Field>
        {parsed && !parsed.hasSlug && !parsed.missing.length && (
          <Field label="Export of one event – which?" htmlFor="pretix-event">
            <Select id="pretix-event" className="w-72" value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">Choose the event…</option>
              {events
                .filter((e) => e.slug)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
            </Select>
          </Field>
        )}
      </div>
      {parsed && parsed.missing.length > 0 && <Alert tone="error">This is not pretix&apos;s “Order data” export – missing columns: {parsed.missing.join(", ")}.</Alert>}
      {parsed && !parsed.missing.length && (parsed.hasSlug || chosen) && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>
            {plural(parsed.orders.length, "order")} ({paid.length} paid, {formatCents(paid.reduce((s, o) => s + o.total, 0))}) of {plural(new Set(parsed.orders.map((o) => o.slug)).size, "pretix event")}
            {parsed.skipped.length ? ` · ${parsed.skipped.length} lines left out` : ""}
          </span>
          <Button
            size="sm"
            disabled={busy || !parsed.orders.length}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const started = (await startImport({ source: "pretix_csv", filename: file!.name.slice(0, 200) })) as Result<{ id: string }>;
                if (!started.ok) throw new Error(fail(started));
                const s = started;
                const sum = { added: 0, updated: 0, unlinked: [] as string[] };
                for (let i = 0; i < parsed.orders.length; i += 400) {
                  const r = (await importPretixOrders({ import_id: s.data.id, orders: parsed.orders.slice(i, i + 400) })) as Result<typeof sum>;
                  if (!r.ok) throw new Error(fail(r));
                  sum.added += r.data.added;
                  sum.updated += r.data.updated;
                  sum.unlinked = [...new Set([...sum.unlinked, ...r.data.unlinked])];
                }
                setDone(sum);
                setFile(null);
                if (input.current) input.current.value = "";
                router.refresh();
              } catch (e) {
                setError(e instanceof Error ? e.message : "The import failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Import orders
          </Button>
        </div>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {done && (
        <Alert tone="success">
          {plural(done.added, "new order")}, {done.updated} updated.
          {done.unlinked.length > 0 && ` Not linked to an event yet: ${done.unlinked.join(", ")} – link them below.`} Then match the open PayPal payments again.
        </Alert>
      )}
    </div>
  );
}

export function PretixSync({ from, to, configured }: { from: string; to: string; configured: boolean }) {
  const { run, pending, error } = useAction();
  const [range, setRange] = useState({ from, to });
  const [result, setResult] = useState<{ events: number; added: number; updated: number; errors: string[] } | null>(null);
  if (!configured)
    return (
      <p className="text-sm text-gray-600">
        Not set up – the server needs <code className="rounded bg-gray-100 px-1">PRETIX_ORGANIZER</code> and <code className="rounded bg-gray-100 px-1">PRETIX_API_TOKEN</code> (see the guide). Until then, import the CSV.
      </p>
    );
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(syncPretix, range, (d: typeof result) => setResult(d), "pretix orders fetched.");
      }}
    >
      <Field label="Events from" htmlFor="sync-from">
        <Input id="sync-from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
      </Field>
      <Field label="to" htmlFor="sync-to">
        <Input id="sync-to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
      </Field>
      <Button size="sm" disabled={pending}>
        {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />}
        Fetch from pretix
      </Button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
      {result && (
        <p className="w-full text-sm text-gray-700">
          {plural(result.events, "event")}: {result.added} new orders, {result.updated} updated.
          {result.errors.length > 0 && <span className="text-red-700"> {result.errors.join(" · ")}</span>}
        </p>
      )}
    </form>
  );
}

/** Links a pretix event slug to one of our events. */
export function LinkSlug({ slug, events }: { slug: string; events: Array<{ id: string; label: string; slug: string | null }> }) {
  const { run, pending, error } = useAction();
  const [eventId, setEventId] = useState("");
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Select aria-label={`Event of pretix “${slug}”`} className="h-8 w-72" value={eventId} onChange={(e) => setEventId(e.target.value)}>
        <option value="">Which event is it?</option>
        {events
          .filter((e) => !e.slug)
          .map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
      </Select>
      <Button size="sm" variant="outline" disabled={pending || !eventId} onClick={() => run(linkPretixEvent, { event_id: eventId, slug }, undefined, `pretix “${slug}” linked.`)}>
        Link
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function BookPretix({ eventId, categoryId, cents }: { eventId: string; categoryId: string; cents: number }) {
  const { run, pending, error } = useAction();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(bookPretixOrders, { event_id: eventId, category_id: categoryId }, undefined, (d: { orders: number }) => `${d.orders} orders booked.`)}>
        Book {formatCents(cents)}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
