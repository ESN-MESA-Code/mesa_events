import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = { title: "Privacy notice – MESAttendance" };

// Information under Art. 13 GDPR – the text is legal/privacy.en.md. The German
// version (legal/privacy.de.md) says the same; change both together.
export default function PrivacyPage() {
  return (
    <LegalPage
      name="privacy.en"
      lang="en"
      switchTo={{ href: "/datenschutz", label: "Deutsche Fassung" }}
    />
  );
}
