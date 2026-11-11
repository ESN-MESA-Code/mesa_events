"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, QrCode } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { createLinkHere, setLinkActive } from "@/app/actions/payments";
import { formatCents, parseEuroToCents } from "@/lib/dates";
import { paypalMeUrl } from "@/lib/payments/links";
import { PaymentQr } from "@/components/finance/PaymentQr";
import { cn } from "@/lib/utils";

export type LinkKind = "drinks" | "ticket" | "other" | "esncard_internal" | "esncard_external";

export interface PanelLink {
  id: string;
  reference: string;
  title: string;
  amount: number | null;
  active: boolean;
  preset?: string | null;
}

const KIND_LABELS: Record<LinkKind, string> = {
  esncard_internal: "ESNcard (member)",
  esncard_external: "ESNcard",
  drinks: "Drinks and snacks",
  ticket: "Ticket",
  other: "Something else",
};

/** "New QR code": what is sold, its name and the amount (the OC decides). */
function NewQr({ target, kinds, prices, onDone }: { target: { event_id: string } | { internal_event_id: string }; kinds: LinkKind[]; prices: Partial<Record<LinkKind, number | null>>; onDone: () => void }) {
  const { run, pending, error, setError } = useAction();
  const [kind, setKind] = useState<LinkKind>(kinds[0]);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState(prices[kinds[0]] ? (prices[kinds[0]]! / 100).toFixed(2) : "");
  const pick = (k: LinkKind) => {
    setKind(k);
    setAmount(prices[k] ? (prices[k]! / 100).toFixed(2) : "");
  };
  return (
    <form
      className="space-y-3 rounded-xl border border-esn/20 bg-esn/5 p-3"
      data-testid="new-qr"
      onSubmit={(e) => {
        e.preventDefault();
        const cents = amount.trim() ? parseEuroToCents(amount) : null;
        if (amount.trim() && !cents) return setError("Enter an amount like 3 or 2.50 – or leave it empty so people type it.");
        run(createLinkHere, { ...target, kind, title, amount_cents: cents }, onDone, (d: { reference: string; existing: boolean }) => (d.existing ? `${d.reference} updated.` : `QR code ${d.reference} ready.`));
      }}
    >
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What do you sell">
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => pick(k)}
            className={cn("rounded-full border px-3 py-1 text-sm", kind === k ? "border-esn bg-esn text-white" : "border-gray-300 bg-white text-gray-700 hover:border-esn")}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {!kind.startsWith("esncard") && (
          <label className="min-w-0 flex-1 basis-40 text-xs font-medium text-gray-600">
            Name (optional)
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={kind === "drinks" ? "e.g. Beer and soft drinks" : KIND_LABELS[kind]} className="mt-1" />
          </label>
        )}
        <label className="w-28 text-xs font-medium text-gray-600">
          Amount (€)
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="any" className="mt-1" aria-label="Amount in euros" />
        </label>
        <Button size="sm" disabled={pending} className="h-9">
          <QrCode className="mr-1 h-4 w-4" aria-hidden="true" /> Make QR code
        </Button>
      </div>
      <p className="text-xs text-gray-500">Several prices? Make one QR code each (e.g. € 2 soft drinks, € 3 beer). Empty amount: people type it in PayPal.</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}

/** The automatic codes (an office hour's ESNcards) when they are missing – a cash box started before they existed. */
function MakeAutomatic({ target, missing }: { target: { event_id: string } | { internal_event_id: string }; missing: LinkKind[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <span className="flex-1">The ESNcard QR codes are missing.</span>
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            for (const kind of missing) {
              const r = await createLinkHere({ ...target, kind, title: "", amount_cents: null });
              if (!r.ok) return setError(r.message);
            }
            router.refresh();
          })
        }
      >
        Make them
      </Button>
      {error && <span className="w-full text-xs text-red-600">{error}</span>}
    </div>
  );
}

function SwitchOff({ link }: { link: PanelLink }) {
  const { run, pending } = useAction();
  return (
    <button type="button" disabled={pending} onClick={() => run(setLinkActive, { id: link.id, active: !link.active }, undefined, link.active ? "QR code switched off." : "QR code switched on.")} className="text-xs text-gray-500 hover:text-red-600 hover:underline">
      {link.active ? "Switch off" : "Switch on"}
    </button>
  );
}

/**
 * The PayPal QR codes of an event or office hour (round 2026-11-11 (2)):
 * the people on duty make them here with their own amounts and show them
 * at the counter; switched-off ones stay listed for the record.
 */
export function PaymentLinksPanel({
  links,
  target,
  kinds,
  prices,
  canCreate,
  handle,
  accountName,
  context,
  automatic = [],
}: {
  links: PanelLink[];
  /** Kinds made automatically (an office hour's ESNcards): no form for them, a button when missing. */
  automatic?: LinkKind[];
  target: { event_id: string } | { internal_event_id: string };
  kinds: LinkKind[];
  prices: Partial<Record<LinkKind, number | null>>;
  canCreate: boolean;
  handle: string;
  accountName: string;
  context: string;
}) {
  const active = links.filter((l) => l.active);
  const off = links.filter((l) => !l.active);
  const [adding, setAdding] = useState(canCreate && !active.length && !automatic.length);
  const missing = automatic.filter((k) => !links.some((l) => l.preset === k));
  if (!handle) return <p className="text-sm text-gray-500">Finance has not set MESA&apos;s PayPal account yet – no QR codes until then.</p>;
  return (
    <div className="space-y-4" data-testid="payment-panel">
      {active.length > 0 && (
        <>
          <p className="text-sm text-gray-600">People scan the code, pay with PayPal and write the reference in the note – then Finance knows what it was for.</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {active.map((l) => (
              <li key={l.id} className="rounded-xl border border-gray-200 bg-white p-3" data-testid={`panel-link-${l.reference}`}>
                <p className="mb-2 flex items-baseline justify-between gap-2">
                  <span className="font-medium">{l.title}</span>
                  <span className="font-semibold tabular-nums text-esn">{l.amount ? formatCents(l.amount) : "any amount"}</span>
                </p>
                <PaymentQr link={{ reference: l.reference, title: l.title, amount: l.amount, url: paypalMeUrl(handle, l.amount), accountName, context }} size={128} compact />
                {canCreate && (
                  <p className="mt-2 text-right">
                    <SwitchOff link={l} />
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {canCreate && missing.length > 0 && <MakeAutomatic target={target} missing={missing} />}
      {canCreate &&
        (adding ? (
          <NewQr target={target} kinds={kinds} prices={prices} onDone={() => setAdding(false)} />
        ) : (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> {automatic.length ? "Another QR code (drinks …)" : "New QR code"}
          </Button>
        ))}
      {!canCreate && !active.length && <p className="text-sm text-gray-500">No PayPal QR codes yet – the OC makes them here.</p>}
      {off.length > 0 && (
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer">{off.length} switched off</summary>
          <ul className="mt-1 space-y-1">
            {off.map((l) => (
              <li key={l.id} className="flex items-center gap-2">
                <span className="font-mono">{l.reference}</span> {l.title} · {l.amount ? formatCents(l.amount) : "any amount"}
                {canCreate && <SwitchOff link={l} />}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
