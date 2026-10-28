import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import LegalFooter from "@/components/LegalFooter";

export const metadata: Metadata = {
  title: { default: "MESA Events", template: "%s – MESA Events" },
  description: "ESN MESA's internal event workflow: ideas, schedule, volunteers, descriptions, attendance and reimbursements",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Reading the request headers renders every page per request, so Next.js
  // can put the CSP nonce (proxy.ts) on its scripts.
  await headers();
  return (
    <html lang="en">
      <body className="antialiased bg-gray-50 min-h-screen font-sans flex flex-col">
        <div className="flex-1">{children}</div>
        <LegalFooter />
      </body>
    </html>
  );
}
