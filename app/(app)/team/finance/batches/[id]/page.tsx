import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePageRole } from "@/lib/access";
import { hasRole } from "@/lib/roles";
import { createSessionClient } from "@/lib/supabase/session";
import { formatCents, formatDate, monthLabel } from "@/lib/dates";
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { payBatch } from "@/app/actions/handin";

export const metadata: Metadata = { title: "Payout batch" };

// One month's payouts with the bank / PayPal details Finance transfers to
// (they are deleted once the batch is marked paid).
export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const viewer = await requirePageRole(["finance"], { executiveMayRead: true, hide: true });
  const canAct = hasRole(viewer.roles, "finance");
  const supabase = await createSessionClient();
  const { data: batch } = await supabase.from("payout_batches").select("*").eq("id", id).maybeSingle();
  if (!batch) notFound();
  const { data: claims } = await supabase
    .from("reimbursements")
    .select("id, approved_cents, status, payout_method, profiles:claimant_id(full_name, email), events(title), payout_details(account_holder, iban, paypal_email)")
    .eq("batch_id", id)
    .order("created_at");

  // One transfer per person and method.
  const people = new Map<string, { name: string; method: string; to: string; total: number; claims: number }>();
  for (const c of claims ?? []) {
    const p = c.profiles as { full_name: string; email: string } | null;
    const d = c.payout_details as { account_holder: string | null; iban: string | null; paypal_email: string | null } | null;
    const to = d?.iban ? `${d.account_holder ?? ""} · ${d.iban}` : (d?.paypal_email ?? "—");
    const key = `${p?.email}|${to}`;
    const cur = people.get(key) ?? { name: p?.full_name ?? "?", method: c.payout_method ?? "?", to, total: 0, claims: 0 };
    cur.total += c.approved_cents ?? 0;
    cur.claims += 1;
    people.set(key, cur);
  }
  const total = (claims ?? []).reduce((s, c) => s + (c.approved_cents ?? 0), 0);

  return (
    <>
      <PageHeader title={`Payouts – ${monthLabel(batch.month)}`} description={`${(claims ?? []).length} claims · ${formatCents(total)}`}>
        <div className="flex items-center gap-3 self-center">
          <Badge tone={batch.status === "paid" ? "purple" : "blue"}>{batch.status === "paid" ? `paid ${batch.paid_at ? formatDate(batch.paid_at) : ""}` : "open"}</Badge>
          <Link href="/team/finance" className="text-sm text-esn hover:underline">
            ← Finance
          </Link>
          {canAct && batch.status === "open" && (claims ?? []).length > 0 && (
            <ActionButton action={payBatch} input={{ batch_id: id }} variant="success" size="default" confirm="Mark every claim of this batch as paid? Bank details are deleted afterwards.">
              Mark batch paid
            </ActionButton>
          )}
        </div>
      </PageHeader>
      <Card>
        <CardHeader>
          <CardTitle>Transfers</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="transfers">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-500">
                <th className="py-1">Person</th>
                <th>Method</th>
                <th>To</th>
                <th className="text-right">Claims</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[...people.values()].map((p) => (
                <tr key={`${p.name}${p.to}`}>
                  <td className="py-1.5">{p.name}</td>
                  <td>{p.method}</td>
                  <td className="font-mono text-xs">{batch.status === "paid" ? "deleted after payout" : canAct ? p.to : "Finance only"}</td>
                  <td className="text-right tabular-nums">{p.claims}</td>
                  <td className="text-right tabular-nums">{formatCents(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}
