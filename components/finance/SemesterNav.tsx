import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { shiftSemester, type Semester } from "@/lib/internal";
import { buttonVariants } from "@/components/ui";

/** ← WiSe 26/27 → for the Finance pages that show one semester. */
export function SemesterNav({ semester, path, extra = "" }: { semester: Semester; path: string; extra?: string }) {
  const prev = shiftSemester(semester, -1);
  const next = shiftSemester(semester, 1);
  return (
    <nav aria-label="Semester" className="flex items-center gap-1">
      <Link href={`${path}?semester=${prev.key}${extra}`} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label={`Previous semester (${prev.name})`}>
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </Link>
      <span className="min-w-28 text-center font-semibold" data-testid="semester">
        {semester.name}
      </span>
      <Link href={`${path}?semester=${next.key}${extra}`} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label={`Next semester (${next.name})`}>
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </nav>
  );
}

/** A figure tile: label, value, an optional line under it; a link makes it a shortcut. */
export function Figure({ label, value, sub, tone, href, testId }: { label: string; value: string; sub?: React.ReactNode; tone?: string; href?: string; testId?: string }) {
  const body = (
    <>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${tone ?? "text-gray-900"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
    </>
  );
  const cls = "block rounded-xl border border-gray-200 bg-white p-4 shadow-sm";
  return href ? (
    <Link href={href} className={`${cls} hover:border-esn`} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <div className={cls} data-testid={testId}>
      {body}
    </div>
  );
}
