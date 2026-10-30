"use client";

import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { setEsncardPrices } from "@/app/actions/cash";
import { parseEuroToCents } from "@/lib/dates";

/** What an ESNcard costs (members / external): office hours take the prices when their cash box starts. */
export function EsncardPrices({ internal, external, disabled }: { internal: number | null; external: number | null; disabled: boolean }) {
  const { run, pending, error, setError } = useAction();
  const [saved, setSaved] = useState(false);
  const [f, setF] = useState({ internal: internal === null ? "" : (internal / 100).toFixed(2), external: external === null ? "" : (external / 100).toFixed(2) });
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const i = parseEuroToCents(f.internal);
        const x = parseEuroToCents(f.external);
        if (i === null || x === null) return setError("Enter both prices.");
        run(setEsncardPrices, { internal_cents: i, external_cents: x }, () => setSaved(true));
      }}
    >
      <Field label="Members (internal), €" htmlFor="price-internal">
        <Input id="price-internal" inputMode="decimal" className="w-28" value={f.internal} disabled={disabled} onChange={(e) => setF((v) => ({ ...v, internal: e.target.value }))} />
      </Field>
      <Field label="External, €" htmlFor="price-external">
        <Input id="price-external" inputMode="decimal" className="w-28" value={f.external} disabled={disabled} onChange={(e) => setF((v) => ({ ...v, external: e.target.value }))} />
      </Field>
      {!disabled && (
        <Button size="sm" disabled={pending}>
          Save prices
        </Button>
      )}
      {saved && <span className="text-sm text-emerald-700">Saved ✓ – office hours starting from now use them.</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
