import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = { title: "Impressum – MESAttendance" };

// Legal notice under § 5 DDG – the text is legal/impressum.md.
export default function ImpressumPage() {
  return <LegalPage name="impressum" lang="de" />;
}
