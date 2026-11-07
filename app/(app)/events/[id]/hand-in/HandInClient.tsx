"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input, Select, buttonVariants } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { checkPhotosAgain, declareNoPhotos, markPhotosUploaded, registerReceipt, requestPreapproval } from "@/app/actions/handin";
import { EXPENSE_KIND_LABELS, findRule, isValidIban, suggestAmount, type ExpenseKind, type Rule } from "@/lib/reimbursement";
import { formatCents, formatDateTime, parseEuroToCents } from "@/lib/dates";
import { plural } from "@/lib/plural";
import { cn } from "@/lib/utils";

export function ReceiptForm({
  eventId,
  role,
  eventType,
  rules,
  kinds,
  tripDays,
  hasTripBudget,
  preapprovals,
  defaultDate,
  profilePayout = null,
}: {
  eventId: string;
  role: "oc" | "helper";
  eventType: Exclude<Rule["event_type"], "any">;
  rules: Rule[];
  kinds: ExpenseKind[];
  tripDays: number;
  hasTripBudget: boolean;
  preapprovals: Array<{ id: string; label: string }>;
  defaultDate: string;
  /** The payout details saved on the member's profile ("bank account DE89 •••• 3000"), or null. */
  profilePayout?: string | null;
}) {
  const { run, pending, error, setError } = useAction();
  const [kind, setKind] = useState<ExpenseKind>(kinds[0]);
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [description, setDescription] = useState("");
  const [days, setDays] = useState(String(tripDays));
  const [method, setMethod] = useState<"bank" | "paypal" | "">("");
  const [holder, setHolder] = useState("");
  const [iban, setIban] = useState("");
  const [paypal, setPaypal] = useState("");
  const [preapproval, setPreapproval] = useState("");
  const [done, setDone] = useState(false);

  const rule = findRule(rules, eventType, kind);
  const cents = parseEuroToCents(amount);
  const preview = useMemo(() => {
    if (!rule || cents === null) return null;
    return suggestAmount({ rule, role, amountCents: cents, days: Number(days) || 1, preapproved: !!preapproval, budgetRemainingCents: hasTripBudget ? Number.MAX_SAFE_INTEGER : null });
  }, [rule, cents, role, days, preapproval, hasTripBudget]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setDone(false);
    if (cents === null || cents <= 0) return setError("Enter the amount you paid, e.g. 12.50.");
    if (method === "bank" && !isValidIban(iban)) return setError("This IBAN is not valid.");
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
        preapproval_id: preapproval || null,
        payout,
        // Saved on the profile: every open and later claim gets them (round 2026-11-07).
        remember: !!payout,
      },
      () => {
        setAmount("");
        setVendor("");
        setDescription("");
        setMethod("");
        setHolder("");
        setIban("");
        setPaypal("");
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
      {profilePayout ? (
        // One set of details per member (round 2026-11-07): changed on Expenses, used for every claim.
        <p className="self-end text-sm text-gray-700 sm:col-span-2" data-testid="receipt-payout">
          Paid to your {profilePayout} ·{" "}
          <Link href="/me/reimbursements#payout" className="font-medium text-esn hover:underline">
            Change
          </Link>
        </p>
      ) : (
        <Field label="Pay me by" htmlFor="r-method" hint="Saved to your profile – Finance uses it for all your claims, so you enter it only once.">
          <Select id="r-method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="">Decide later</option>
            <option value="bank">Bank transfer</option>
            <option value="paypal">PayPal</option>
          </Select>
        </Field>
      )}
      {method === "bank" && (
        <>
          <Field label="Account holder" htmlFor="r-holder">
            <Input id="r-holder" value={holder} onChange={(e) => setHolder(e.target.value)} required />
          </Field>
          <Field label="IBAN" htmlFor="r-iban">
            <Input id="r-iban" value={iban} onChange={(e) => setIban(e.target.value)} required autoComplete="off" />
          </Field>
        </>
      )}
      {method === "paypal" && (
        <Field label="PayPal email" htmlFor="r-paypal">
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
          Registered. Now hand the paper receipt to Finance.
        </Alert>
      )}
      <div className="sm:col-span-2">
        <Button disabled={pending}>{pending ? "Saving…" : "Register receipt"}</Button>
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


export interface PhotoFolderProps {
  eventId: string;
  folder: {
    folder_url: string | null;
    folder_path: string | null;
    photo_count: number | null;
    counted_at: string | null;
    count_error: string | null;
    marked_uploaded_at: string | null;
    marked_uploaded_by: string | null;
    no_photos_at: string | null;
    no_photos_by: string | null;
    no_photos_reason: string | null;
  } | null;
  /** The OC or the Events team: may tick "Photos are uploaded". */
  canTick: boolean;
  /** The OC, a helper or the Events team, once the event started: may say "No photos taken". */
  canDeclare: boolean;
  /** Read-only for teams who are not on the event. */
  canCheck: boolean;
}

/**
 * The event's Drive folder (brief 2026-10-29, A): the team uploads there
 * directly; the count comes from Drive. "Check again" asks a job to count
 * now and refreshes the page until the new count arrived (at most a minute).
 */
export function PhotoFolder({ eventId, folder, canTick, canCheck, canDeclare }: PhotoFolderProps) {
  const router = useRouter();
  const { run, pending, error } = useAction();
  const [waitingSince, setWaitingSince] = useState<string | null>(null);
  const [askingNoPhotos, setAskingNoPhotos] = useState(false);
  const counted = folder?.counted_at ?? null;
  // "No photos taken" (round 2026-11-07): offered while the folder is empty and nobody said so yet.
  const noPhotos = !!folder?.no_photos_at && !folder.photo_count;
  const offerNoPhotos = canDeclare && !folder?.no_photos_at && !folder?.photo_count;
  const noPhotosButton = offerNoPhotos && !askingNoPhotos && (
    <Button type="button" variant="outline" size="sm" onClick={() => setAskingNoPhotos(true)} data-testid="no-photos-open">
      No photos taken…
    </Button>
  );
  const noPhotosParts = (
    <>
      {offerNoPhotos && askingNoPhotos && <NoPhotosForm eventId={eventId} onClose={() => setAskingNoPhotos(false)} />}
      {noPhotos && <NoPhotosNote eventId={eventId} folder={folder!} canUndo={canDeclare} />}
    </>
  );
  // Until the job's new count arrived (counted after the click).
  const waiting = !!waitingSince && !(counted && counted > waitingSince);

  useEffect(() => {
    if (!waiting || !waitingSince) return;
    const started = Date.parse(waitingSince);
    const timer = window.setInterval(() => {
      if (Date.now() - started > 60_000) {
        setWaitingSince(null);
        return;
      }
      router.refresh();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [waiting, waitingSince, router]);

  if (!folder?.folder_url) {
    return (
      <div className="space-y-3" data-testid="photo-folder">
        <p className="text-sm text-gray-600">The photo folder in Drive is being created – it appears here within a few minutes.</p>
        {canTick && !folder?.no_photos_at && <TickPhotos eventId={eventId} marked={!!folder?.marked_uploaded_at} by={folder?.marked_uploaded_by ?? null} />}
        {noPhotosButton && <div>{noPhotosButton}</div>}
        {noPhotosParts}
      </div>
    );
  }
  const name = folder.folder_path?.split("/").at(-1) ?? "Photo folder";
  return (
    <div className="space-y-3" data-testid="photo-folder">
      <a
        href={folder.folder_url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(buttonVariants({ size: "lg" }), "w-full h-12 text-base")}
        data-testid="open-photo-folder"
      >
        📁 Open the photo folder in Drive
      </a>
      <p className="text-xs text-gray-500 break-words">
        {folder.folder_path ?? name} – upload your pictures and videos there with your @esnmesa.org account.
      </p>
      <p className="text-sm" data-testid="photo-count">
        {folder.photo_count === null ? (
          "Not counted yet."
        ) : (
          <>
            <strong>{plural(folder.photo_count, "file")}</strong> in the folder
            {folder.counted_at && <span className="text-gray-500"> (checked {formatDateTime(folder.counted_at)})</span>}
          </>
        )}
      </p>
      {folder.count_error && <Alert tone="warning">Drive could not be read the last time. {canTick ? "If the photos are there, tick them below." : ""}</Alert>}
      {(canCheck || noPhotosButton) && (
        <div className="flex flex-wrap items-center gap-2">
          {canCheck && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending || waiting}
              onClick={() => run(checkPhotosAgain, { event_id: eventId }, () => setWaitingSince(new Date().toISOString()))}
            >
              {waiting ? "Checking Drive…" : "Check again"}
            </Button>
          )}
          {noPhotosButton}
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      )}
      {noPhotosParts}
      {canTick && !folder.no_photos_at && <TickPhotos eventId={eventId} marked={!!folder.marked_uploaded_at} by={folder.marked_uploaded_by} />}
    </div>
  );
}

function TickPhotos({ eventId, marked, by }: { eventId: string; marked: boolean; by: string | null }) {
  const { run, pending, error } = useAction();
  return (
    <div className="rounded-md border border-gray-200 px-3 py-2 text-sm space-y-1">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={marked}
          disabled={pending}
          onChange={(e) => run(markPhotosUploaded, { event_id: eventId, uploaded: e.target.checked })}
          data-testid="photos-ticked"
        />
        Photos are uploaded
      </label>
      <p className="text-xs text-gray-500">{marked && by ? `Ticked by ${by}. ` : ""}Only if Drive cannot be read – the count above is enough otherwise.</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/**
 * "No photos taken…" (round 2026-11-07): photos are not a must – when nobody
 * took any, the OC or a helper says so and the photo step is done. Laid out
 * like the other inline requests (e.g. asking to cancel): a reason, a note on
 * what it means, the action and Back.
 */
function NoPhotosForm({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const { run, pending, error } = useAction();
  const [reason, setReason] = useState("");
  return (
    <form
      className="space-y-2"
      data-testid="no-photos-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(declareNoPhotos, { event_id: eventId, declared: true, reason: reason.trim() }, onClose, "Noted – no photos for this event.");
      }}
    >
      <Input aria-label="Why were no photos taken? (optional)" placeholder="Why not? (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus />
      <p className="text-xs text-gray-500">The photo step then counts as done. Everyone who sees the hand-in, the Events team too, sees who said it and why.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} data-testid="no-photos-confirm">
          No photos taken
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={onClose}>
          Back
        </Button>
      </div>
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </form>
  );
}

/** Said: who, when and why, in the same box as the manual tick; Undo for the event's team. */
function NoPhotosNote({ eventId, folder, canUndo }: { eventId: string; folder: NonNullable<PhotoFolderProps["folder"]>; canUndo: boolean }) {
  const { run, pending, error } = useAction();
  return (
    <div className="space-y-1 rounded-md border border-gray-200 px-3 py-2 text-sm" data-testid="no-photos">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-gray-900">No photos taken</p>
        {canUndo && (
          <Button type="button" variant="ghost" size="sm" className="-my-1 -mr-2 h-7" disabled={pending} onClick={() => run(declareNoPhotos, { event_id: eventId, declared: false }, undefined, "Undone – the photos are due again.")} data-testid="undo-no-photos">
            Undo
          </Button>
        )}
      </div>
      {folder.no_photos_reason && <p className="break-words text-gray-700">{folder.no_photos_reason}</p>}
      <p className="text-xs text-gray-500">
        Said by {folder.no_photos_by ?? "a team member"} on {formatDateTime(folder.no_photos_at!)}.
      </p>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
