import Link from "next/link";
import { Card, CardContent, PageHeader, buttonVariants } from "@/components/ui";

// Inside the member area (navigation stays): unknown pages and records the
// member may not see – one answer for both.
export default function NotFound() {
  return (
    <>
      <PageHeader title="Not found" />
      <Card data-testid="not-found">
        <CardContent className="pt-5 space-y-3 text-sm text-gray-700">
          <p>This page does not exist, or it is not available to you.</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/" className={buttonVariants()}>
              Back to Home
            </Link>
            <Link href="/calendar" className={buttonVariants({ variant: "outline" })}>
              Calendar
            </Link>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
