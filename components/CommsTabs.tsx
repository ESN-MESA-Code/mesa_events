import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The Comms pages as tabs (round 2026-10-30): the month's events by stage and
 * the publishing schedule, keeping the month. ESN Activities is the
 * executive board's page; executives get a link to it.
 */
export function CommsTabs({ current, month, executive }: { current: "stages" | "schedule"; month: string | null; executive: boolean }) {
  const q = month ? `?month=${month}` : "";
  const tabs = [
    { id: "stages", label: "Events by stage", href: `/team/comms${q}` },
    { id: "schedule", label: "Publishing schedule", href: `/team/comms/schedule${q}` },
  ] as const;
  return (
    <nav aria-label="Comms pages" className="mb-6 flex flex-wrap items-center gap-1 border-b border-gray-200" data-testid="comms-tabs">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={current === t.id ? "page" : undefined}
          className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", current === t.id ? "border-esn text-esn" : "border-transparent text-gray-600 hover:text-esn")}
        >
          {t.label}
        </Link>
      ))}
      {executive && (
        <Link href={`/team/esn-activities${q}`} className="ml-auto px-3 py-2 text-sm text-esn hover:underline">
          ESN Activities (executive board) →
        </Link>
      )}
    </nav>
  );
}
