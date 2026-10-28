import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = { title: "Participation terms – MESAttendance" };

// The terms participants accept when signing in – the text is legal/terms.en.md,
// its short version on the form legal/form-terms.en.md. Bump terms_version in
// legal/details.json when either changes in substance.
export default function TermsPage() {
  return <LegalPage name="terms.en" lang="en" />;
}
