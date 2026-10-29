import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import LegalFooter from "@/components/LegalFooter";
import { StagingBanner } from "@/components/StagingBanner";
import { isStaging, isStagingBuild, stagingSignInEnabled } from "@/lib/staging";

// A staging build says so in every tab title.
const TITLE_PREFIX = isStagingBuild() ? "[Staging] " : "";

export const metadata: Metadata = {
  title: { default: `${TITLE_PREFIX}MESA Events`, template: `${TITLE_PREFIX}%s – MESA Events` },
  description: "ESN MESA's internal event workflow: ideas, schedule, volunteers, descriptions, attendance and reimbursements",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Reading the request headers renders every page per request, so Next.js
  // can put the CSP nonce (proxy.ts) on its scripts.
  await headers();
  return (
    <html lang="en">
      <body className="antialiased bg-gray-50 min-h-screen font-sans flex flex-col">
        {isStaging() && <StagingBanner signIn={stagingSignInEnabled()} />}
        <div className="flex-1">{children}</div>
        <LegalFooter />
      </body>
    </html>
  );
}
