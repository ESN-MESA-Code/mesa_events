import type { Metadata } from "next";
import Link from "next/link";
import { getViewer } from "@/lib/supabase/session";
import { ROLE_LABELS } from "@/lib/roles";
import { Card, CardContent, PageHeader, buttonVariants } from "@/components/ui";

export const metadata: Metadata = { title: "No access" };

// Where team pages send signed-in members without the role (lib/access.ts).
export default async function NoAccessPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page } = await searchParams;
  const viewer = (await getViewer())!;
  const name = page && /^[A-Za-z ()]{1,40}$/.test(page) ? page : "This page";
  return (
    <>
      <PageHeader title="No access" />
      <Card data-testid="no-access">
        <CardContent className="pt-5 space-y-3 text-sm text-gray-700">
          <p>
            <strong>{name}</strong> is for a team you are not in. You are signed in as {viewer.email}
            {viewer.roles.length ? ` (${viewer.roles.map((r) => ROLE_LABELS[r]).join(", ")})` : " (member)"}.
          </p>
          <p>Team roles come from the Google groups of the teams. If you should have access, ask the IT admins.</p>
          <Link href="/" className={buttonVariants()}>
            Back to Home
          </Link>
        </CardContent>
      </Card>
    </>
  );
}
