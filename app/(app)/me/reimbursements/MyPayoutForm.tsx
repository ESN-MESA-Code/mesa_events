"use client";

import { useState } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { deleteMyPayoutDetails, setMyPayoutDetails } from "@/app/actions/handin";
import { isValidIban } from "@/lib/reimbursement";

/** Save (or replace) the profile's IBAN or PayPal; delete them. */
export function MyPayoutForm({ saved }: { saved: boolean }) {
  const { run, pending, error, setError, confirm } = useAction();
  const [open, setOpen] = useState(!saved);
  const [method, setMethod] = useState<"bank" | "paypal">("bank");
  const [holder, setHolder] = useState("");
  const [iban, setIban] = useState("");
  const [paypal, setPaypal] = useState("");
  const [done, setDone] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {!open ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Change
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-red-700 hover:bg-red-50 hover:text-red-800"
            disabled={pending}
            onClick={async () => {
              if (
                await confirm({
                  title: "Delete your saved IBAN / PayPal?",
                  body: "Claims Finance has not checked yet lose them too – Finance can't pay those until you add details again. Checked claims keep theirs until they are paid.",
                  confirmLabel: "Delete",
                  danger: true,
                })
              )
                run(deleteMyPayoutDetails, {}, () => setDone("Deleted."));
            }}
          >
            Delete
          </Button>
        </div>
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setDone(null);
            if (method === "bank" && !isValidIban(iban)) return setError("This IBAN is not valid.");
            run(setMyPayoutDetails, method === "bank" ? { payout_method: "bank", account_holder: holder, iban } : { payout_method: "paypal", paypal_email: paypal }, (d) => {
              const n = (d as { claims: number }).claims;
              setDone(`Saved${n ? ` – also on your ${n === 1 ? "open claim" : `${n} open claims`}` : ""}.`);
              setOpen(false);
            });
          }}
        >
          <Field label="Paid by" htmlFor="p-method">
            <Select id="p-method" value={method} onChange={(e) => setMethod(e.target.value as "bank" | "paypal")}>
              <option value="bank">Bank transfer (IBAN)</option>
              <option value="paypal">PayPal</option>
            </Select>
          </Field>
          {method === "bank" ? (
            <>
              <Field label="Account holder" htmlFor="p-holder">
                <Input id="p-holder" value={holder} onChange={(e) => setHolder(e.target.value)} required autoComplete="name" />
              </Field>
              <Field label="IBAN" htmlFor="p-iban">
                <Input id="p-iban" value={iban} onChange={(e) => setIban(e.target.value)} required autoComplete="off" placeholder="DE89 3704 0044 0532 0130 00" />
              </Field>
            </>
          ) : (
            <Field label="PayPal email" htmlFor="p-paypal">
              <Input id="p-paypal" type="email" value={paypal} onChange={(e) => setPaypal(e.target.value)} required />
            </Field>
          )}
          <div className="flex gap-2">
            <Button disabled={pending}>Save</Button>
            {saved && (
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
      {done && <Alert tone="success">{done}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
