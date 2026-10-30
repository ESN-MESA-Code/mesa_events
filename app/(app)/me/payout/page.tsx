import type { Metadata } from "next";
import Link from "next/link";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { formatDateTime } from "@/lib/dates";
import { maskEmail, maskIban } from "@/lib/reimbursement";
import { Alert, Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { MyPayoutForm } from "./MyPayoutForm";

export const metadata: Metadata = { title: "Payout details" };

// The member's IBAN or PayPal, saved once on the profile (round
// 2026-10-30): used for every reimbursement, changeable and deletable here.
export default async function PayoutPage() {
  const viewer = (await getViewer())!;
  const supabase = await createSessionClient();
  const [{ data: saved }, { data: open }] = await Promise.all([
    supabase.from("profile_payout_details").select("account_holder, iban, paypal_email, updated_at").eq("profile_id", viewer.id).maybeSingle(),
    supabase.from("reimbursements").select("id, payout_method").eq("claimant_id", viewer.id).not("status", "in", "(paid,rejected)"),
  ]);
  const missing = (open ?? []).filter((c) => !c.payout_method).length;

  return (
    <>
      <PageHeader title="Payout details" description="Where Finance pays your reimbursements: a bank account (IBAN) or PayPal. Saved once, used for every receipt you register.">
        <Link href="/me" className="self-center text-sm text-esn hover:underline">
          ← My events and reimbursements
        </Link>
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{saved ? "Saved" : "Not saved yet"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {saved ? (
              <p data-testid="saved-payout">
                {saved.iban ? (
                  <>
                    🏦 Bank transfer to <strong>{maskIban(saved.iban)}</strong> ({saved.account_holder})
                  </>
                ) : (
                  <>
                    💙 PayPal <strong>{maskEmail(saved.paypal_email ?? "")}</strong>
                  </>
                )}
                <span className="block text-xs text-gray-500">updated {formatDateTime(saved.updated_at)}</span>
              </p>
            ) : (
              <Alert tone="warning" data-testid="payout-missing">
                No IBAN or PayPal yet – Finance cannot pay your reimbursements{missing ? ` (${missing} open)` : ""} until you add one.
              </Alert>
            )}
            <MyPayoutForm saved={!!saved} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>How they are used</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-gray-600">
            <p>Only you and the Finance team see them; Finance sees them on each of your claims.</p>
            <p>Saving copies them onto your claims that are not paid yet. A claim keeps its copy until it is paid – then it is deleted.</p>
            <p>Deleting removes them from your profile and from the claims Finance has not checked yet. Checked claims keep theirs until they are paid.</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
