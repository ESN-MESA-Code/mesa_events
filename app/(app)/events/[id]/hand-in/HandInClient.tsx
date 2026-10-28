"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { describeError, useAction } from "@/components/ActionButton";
import { addEventPhoto, registerReceipt, requestPreapproval } from "@/app/actions/handin";
import { EXPENSE_KIND_LABELS, findRule, isValidIban, suggestAmount, type ExpenseKind, type Rule } from "@/lib/reimbursement";
import { formatCents, parseEuroToCents } from "@/lib/dates";
import { photoPath, receiptPath, validateUpload } from "@/lib/uploads";

export function ReceiptForm({
  eventId,
  claimantId,
  role,
  eventType,
  rules,
  kinds,
  tripDays,
  hasTripBudget,
  preapprovals,
  defaultDate,
}: {
  eventId: string;
  claimantId: string;
  role: "oc" | "helper";
  eventType: Exclude<Rule["event_type"], "any">;
  rules: Rule[];
  kinds: ExpenseKind[];
  tripDays: number;
  hasTripBudget: boolean;
  preapprovals: Array<{ id: string; label: string }>;
  defaultDate: string;
}) {
  const { run, pending, error, setError } = useAction();
  const [kind, setKind] = useState<ExpenseKind>(kinds[0]);
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [description, setDescription] = useState("");
  const [days, setDays] = useState(String(tripDays));
  const [file, setFile] = useState<File | null>(null);
  const [method, setMethod] = useState<"bank" | "paypal" | "">("");
  const [holder, setHolder] = useState("");
  const [iban, setIban] = useState("");
  const [paypal, setPaypal] = useState("");
  const [preapproval, setPreapproval] = useState("");
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);

  const rule = findRule(rules, eventType, kind);
  const cents = parseEuroToCents(amount);
  const preview = useMemo(() => {
    if (!rule || cents === null) return null;
    return suggestAmount({ rule, role, amountCents: cents, days: Number(days) || 1, preapproved: !!preapproval, budgetRemainingCents: hasTripBudget ? Number.MAX_SAFE_INTEGER : null });
  }, [rule, cents, role, days, preapproval, hasTripBudget]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setDone(false);
    if (cents === null || cents <= 0) return setError("Enter the amount you paid, e.g. 12.50.");
    if (method === "bank" && !isValidIban(iban)) return setError("This IBAN is not valid.");
    let reference_path: string | null = null;
    if (file) {
      const problem = validateUpload("receipt", file);
      if (problem) return setError(problem);
      setUploading(true);
      reference_path = receiptPath(eventId, claimantId, file.type);
      const { error: upErr } = await supabase.storage.from("receipts").upload(reference_path, file, { contentType: file.type });
      setUploading(false);
      if (upErr) return setError(`Upload failed: ${upErr.message}`);
    }
    const payout =
      method === "bank" ? { payout_method: "bank", account_holder: holder, iban } : method === "paypal" ? { payout_method: "paypal", paypal_email: paypal } : null;
    run(
      registerReceipt,
      {
        event_id: eventId,
        kind,
        vendor,
        amount_cents: cents,
        purchased_on: date,
        description,
        days: rule?.per_day ? Number(days) : null,
        reference_path,
        preapproval_id: preapproval || null,
        payout,
      },
      () => {
        setAmount("");
        setVendor("");
        setDescription("");
        setFile(null);
        setDone(true);
      }
    );
  }

  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit} data-testid="receipt-form">
      <Field label="What for" htmlFor="r-kind">
        <Select id="r-kind" value={kind} onChange={(e) => setKind(e.target.value as ExpenseKind)}>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {EXPENSE_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Amount paid (€)" htmlFor="r-amount">
        <Input id="r-amount" inputMode="decimal" placeholder="12.50" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </Field>
      <Field label="Paid to (shop, venue)" htmlFor="r-vendor">
        <Input id="r-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} required />
      </Field>
      <Field label="Date of purchase" htmlFor="r-date">
        <Input id="r-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </Field>
      {rule?.per_day && (
        <Field label="Days" htmlFor="r-days">
          <Input id="r-days" type="number" min={1} max={31} value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
      )}
      {rule?.requires_preapproval && (
        <Field label="Pre-approval" htmlFor="r-pre" hint={preapprovals.length ? undefined : "Ask the Treasurer first (below)."}>
          <Select id="r-pre" value={preapproval} onChange={(e) => setPreapproval(e.target.value)}>
            <option value="">None</option>
            {preapprovals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Note (optional)" htmlFor="r-desc">
        <Input id="r-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Photo of the receipt (optional)" htmlFor="r-file" hint="JPG, PNG, WebP or PDF, at most 5 MB. Only you and Finance see it.">
        <Input id="r-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
      <Field label="Pay me by" htmlFor="r-method">
        <Select id="r-method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
          <option value="">Decide later</option>
          <option value="bank">Bank transfer</option>
          <option value="paypal">PayPal</option>
        </Select>
      </Field>
      {method === "bank" && (
        <>
          <Field label="Account holder" htmlFor="r-holder">
            <Input id="r-holder" value={holder} onChange={(e) => setHolder(e.target.value)} required />
          </Field>
          <Field label="IBAN" htmlFor="r-iban" hint="Stored only until you are paid.">
            <Input id="r-iban" value={iban} onChange={(e) => setIban(e.target.value)} required autoComplete="off" />
          </Field>
        </>
      )}
      {method === "paypal" && (
        <Field label="PayPal email" htmlFor="r-paypal" hint="Stored only until you are paid.">
          <Input id="r-paypal" type="email" value={paypal} onChange={(e) => setPaypal(e.target.value)} required />
        </Field>
      )}
      <div className="sm:col-span-2 rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-sm" data-testid="suggestion">
        {rule ? (
          <>
            Suggested reimbursement: <strong>{preview ? formatCents(preview.suggestedCents) : "–"}</strong>{" "}
            <span className="text-gray-500">
              ({role === "oc" ? "OC" : "helper"}: {(role === "oc" ? rule.oc_rate_bp : rule.helper_rate_bp) / 100} %
              {(role === "oc" ? rule.oc_cap_cents : rule.helper_cap_cents) !== null &&
                `, max ${formatCents(role === "oc" ? rule.oc_cap_cents : rule.helper_cap_cents)}${rule.per_day ? " per day" : ""}`}
              {rule.condition_note && ` – ${rule.condition_note}`})
            </span>
            {preview?.flags.includes("needs_preapproval") && <p className="text-amber-800 text-xs mt-1">Needs the Treasurer&apos;s pre-approval.</p>}
            {preview?.flags.includes("no_trip_budget") && <p className="text-amber-800 text-xs mt-1">No trip budget set yet – Finance sets it before the trip.</p>}
            {rule.within_trip_budget && hasTripBudget && <p className="text-gray-500 text-xs mt-1">Limited to what is left of the trip budget.</p>}
            <p className="text-xs text-gray-500 mt-1">Finance confirms or adjusts the amount.</p>
          </>
        ) : (
          "Not reimbursed for this event type."
        )}
      </div>
      {error && (
        <Alert tone="error" className="sm:col-span-2">
          {error}
        </Alert>
      )}
      {done && (
        <Alert tone="success" className="sm:col-span-2">
          Registered. Now hand the paper Beleg to Finance.
        </Alert>
      )}
      <div className="sm:col-span-2">
        <Button disabled={pending || uploading}>{uploading ? "Uploading…" : pending ? "Saving…" : "Register receipt"}</Button>
      </div>
    </form>
  );
}

export function PreapprovalForm({ eventId }: { eventId: string }) {
  const { run, pending, error, setError } = useAction();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const cents = parseEuroToCents(amount);
        if (cents === null) return setError("Enter the estimated amount.");
        run(requestPreapproval, { event_id: eventId, description, estimated_cents: cents }, () => {
          setDescription("");
          setAmount("");
        });
      }}
    >
      <Input aria-label="What for" placeholder="e.g. Castle tickets" value={description} onChange={(e) => setDescription(e.target.value)} className="grow w-48" required />
      <Input aria-label="Estimated €" placeholder="€" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-24" required />
      <Button variant="outline" disabled={pending}>
        Ask the Treasurer
      </Button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </form>
  );
}

export function PhotoUploader({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setMessage(null);
    let ok = 0;
    const problems: string[] = [];
    for (const file of Array.from(files)) {
      const problem = validateUpload("photo", file);
      if (problem) {
        problems.push(`${file.name}: ${problem}`);
        continue;
      }
      const path = photoPath(eventId, file.type);
      const { error } = await supabase.storage.from("event-photos").upload(path, file, { contentType: file.type });
      if (error) {
        problems.push(`${file.name}: ${error.message}`);
        continue;
      }
      const r = await addEventPhoto({ event_id: eventId, path, file_name: file.name.slice(0, 200), mime_type: file.type, size_bytes: file.size });
      if (r.ok) ok++;
      else problems.push(`${file.name}: ${describeError(r)}`);
    }
    setBusy(false);
    setMessage(problems.length ? { tone: "error", text: problems.join(" · ") } : { tone: "success", text: `${ok} photo(s) handed in – they go to the event's Drive folder.` });
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <Input aria-label="Upload photos" type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic" disabled={busy} onChange={(e) => upload(e.target.files)} />
      <p className="text-xs text-gray-500">JPG, PNG, WebP or HEIC, at most 15 MB each.</p>
      {busy && <p className="text-xs text-gray-500">Uploading…</p>}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </div>
  );
}
