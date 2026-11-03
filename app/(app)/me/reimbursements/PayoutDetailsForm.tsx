"use client";

import { useState } from "react";
import { Button, Input, Select } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { setPayoutDetails } from "@/app/actions/handin";

export function PayoutDetailsForm({ claimId, hasDetails }: { claimId: string; hasDetails: boolean }) {
  const { run, pending, error } = useAction();
  const [open, setOpen] = useState(!hasDetails);
  const [method, setMethod] = useState<"bank" | "paypal">("bank");
  const [holder, setHolder] = useState("");
  const [iban, setIban] = useState("");
  const [paypal, setPaypal] = useState("");
  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Change payout details
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          setPayoutDetails,
          method === "bank" ? { claim_id: claimId, payout_method: "bank", account_holder: holder, iban } : { claim_id: claimId, payout_method: "paypal", paypal_email: paypal },
          () => setOpen(false)
        );
      }}
    >
      <Select aria-label="Payout method" value={method} onChange={(e) => setMethod(e.target.value as "bank" | "paypal")} className="h-8 w-36 py-1">
        <option value="bank">Bank transfer</option>
        <option value="paypal">PayPal</option>
      </Select>
      {method === "bank" ? (
        <>
          <Input aria-label="Account holder" placeholder="Account holder" value={holder} onChange={(e) => setHolder(e.target.value)} className="h-8 w-40" required />
          <Input aria-label="IBAN" placeholder="IBAN" value={iban} onChange={(e) => setIban(e.target.value)} className="h-8 w-56" required autoComplete="off" />
        </>
      ) : (
        <Input aria-label="PayPal email" type="email" placeholder="PayPal email" value={paypal} onChange={(e) => setPaypal(e.target.value)} className="h-8 w-56" required />
      )}
      <Button size="sm" disabled={pending}>
        Save
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
