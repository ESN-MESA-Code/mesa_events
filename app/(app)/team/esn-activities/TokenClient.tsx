"use client";

import { useState } from "react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { createEsnToken } from "@/app/actions/esn";

/** Creates a token and shows it once, with the script carrying it. */
export function NewTokenForm({ baseUrl }: { baseUrl: string }) {
  const { run, pending, error } = useAction();
  const [label, setLabel] = useState("");
  const [days, setDays] = useState("180");
  const [token, setToken] = useState<string | null>(null);
  const [script, setScript] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(createEsnToken, { label, valid_days: Number(days) }, async (data) => {
            setToken(data.token);
            setLabel("");
            // The script for this platform; the token is put in here, in the browser (it never goes back to the server).
            const res = await fetch("/team/esn-activities/script");
            if (res.ok) setScript((await res.text()).replace(/const EMBEDDED_TOKEN = '[^']*';/, `const EMBEDDED_TOKEN = '${data.token}';`));
          });
        }}
      >
        <div className="grow min-w-40">
          <Field label="Name" htmlFor="tok-label">
            <Input id="tok-label" placeholder="e.g. My laptop" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} required />
          </Field>
        </div>
        <Field label="Valid for" htmlFor="tok-days">
          <Select id="tok-days" value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days</option>
            <option value="365">1 year</option>
          </Select>
        </Field>
        <Button disabled={pending}>{pending ? "Creating…" : "Create token"}</Button>
      </form>
      {error && <Alert tone="error">{error}</Alert>}
      {token && (
        <Alert tone="success" className="space-y-2" data-testid="new-token">
          <p className="font-medium">Your new token – copy it now, it is not shown again:</p>
          <code className="block break-all rounded bg-white px-2 py-1 text-xs" data-testid="new-token-value">
            {token}
          </code>
          {script && <CopyScript script={script} label="Copy script with this token" />}
          <p className="text-xs">The script talks to {baseUrl}.</p>
        </Alert>
      )}
    </div>
  );
}

export function CopyScript({ script, label }: { script: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(script);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied ✓" : label}
      </Button>
      <Textarea readOnly rows={6} value={script} className="font-mono text-xs" aria-label="Browser script" onFocus={(e) => e.currentTarget.select()} />
    </div>
  );
}
