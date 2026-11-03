import { redirect } from "next/navigation";

// Payout details moved onto the Reimbursements page (round 2026-11-03 (2)).
export default function PayoutPage() {
  redirect("/me/reimbursements#payout");
}
