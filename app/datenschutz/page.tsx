import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = { title: "Datenschutzerklärung – MESAttendance" };

// Informationen nach Art. 13 DSGVO – der Text ist legal/privacy.de.md. Die
// englische Fassung (legal/privacy.en.md) sagt dasselbe; beide zusammen ändern.
export default function DatenschutzPage() {
  return (
    <LegalPage
      name="privacy.de"
      lang="de"
      switchTo={{ href: "/privacy", label: "English version" }}
    />
  );
}
