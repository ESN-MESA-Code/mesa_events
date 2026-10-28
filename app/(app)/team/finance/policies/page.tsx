import type { Metadata } from "next";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { formatCents, formatDate } from "@/lib/dates";
import { CATEGORY_LABELS, EXPENSE_KIND_LABELS, type Category, type ExpenseKind, type Rule } from "@/lib/reimbursement";
import { EVENT_TYPE_LABELS, type EventType } from "@/lib/labels";
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { PolicyEditor } from "./PolicyEditor";

export const metadata: Metadata = { title: "Reimbursement rules" };

const typeLabel = (t: string) => (t === "any" ? "Any" : EVENT_TYPE_LABELS[t as EventType]);
const pct = (bp: number) => `${bp / 100} %`;
const cap = (c: number | null, perDay: boolean) => (c === null ? "no cap" : `max ${formatCents(c)}${perDay ? " per day" : ""}`);

// The reimbursement rules as versioned data: every member can read them;
// only the Treasurer publishes a new version (claims keep theirs).
export default async function PoliciesPage() {
  const viewer = (await getViewer())!;
  const supabase = await createSessionClient();
  const { data: policies } = await supabase.from("reimbursement_policies").select("*, reimbursement_rules(*)").order("version", { ascending: false });
  const latest = policies?.[0];
  const isTreasurer = viewer.roles.includes("treasurer");

  return (
    <>
      <PageHeader title="Reimbursement rules" description="Suggested amount = min(amount × rate, cap) – per day where noted. Finance confirms or overrides." />
      <div className="space-y-6">
        {(policies ?? []).map((p, i) => (
          <Card key={p.id}>
            <CardHeader>
              <CardTitle>Version {p.version}</CardTitle>
              {i === 0 && <Badge tone="green">newest</Badge>}
              <span className="text-xs text-gray-500">
                in force from {formatDate(`${p.effective_from}T12:00:00Z`)} · by {p.created_by}
              </span>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {p.notes && <p className="text-sm text-gray-600 mb-2">{p.notes}</p>}
              <table className="w-full text-sm" data-testid={`policy-v${p.version}`}>
                <thead>
                  <tr className="text-left text-xs uppercase text-gray-500">
                    <th className="py-1">Event type</th>
                    <th>Expense</th>
                    <th>OC</th>
                    <th>Helper</th>
                    <th>Category</th>
                    <th>Condition</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(p.reimbursement_rules as Rule[]).map((r) => (
                    <tr key={`${r.event_type}${r.expense_kind}`}>
                      <td className="py-1.5">{typeLabel(r.event_type)}</td>
                      <td>{EXPENSE_KIND_LABELS[r.expense_kind as ExpenseKind]}</td>
                      <td>
                        {pct(r.oc_rate_bp)}, {cap(r.oc_cap_cents, r.per_day)}
                      </td>
                      <td>
                        {pct(r.helper_rate_bp)}, {cap(r.helper_cap_cents, r.per_day)}
                      </td>
                      <td>{CATEGORY_LABELS[r.category as Category]}</td>
                      <td className="text-xs text-gray-600">
                        {[r.requires_preapproval && "pre-approval", r.within_trip_budget && "within trip budget", r.condition_note].filter(Boolean).join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))}
        {isTreasurer && latest && (
          <Card>
            <CardHeader>
              <CardTitle>Publish a new version</CardTitle>
            </CardHeader>
            <CardContent>
              <PolicyEditor rules={latest.reimbursement_rules as Rule[]} />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
