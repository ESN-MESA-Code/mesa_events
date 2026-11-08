import Link from "next/link";
import { ArrowUpRight, CalendarRange, Image as ImageIcon, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The Comms pages as tabs (round 2026-10-30; redesign 2026-11-08: a card like
 * the Events month's stage bar): the month's events by stage, the
 * advertisement schedule (round 2026-11-03: "publish" is the description in
 * the Chat space, "advertise" the posts on the channels) and the default
 * pictures, keeping the month. ESN Activities is the executive board's
 * page; executives get a link to it.
 */
export function CommsTabs({ current, month, executive }: { current: "stages" | "schedule" | "pictures"; month: string | null; executive: boolean }) {
  const q = month ? `?month=${month}` : "";
  const tabs = [
    { id: "stages", label: "Events by stage", href: `/team/comms${q}`, icon: ListChecks },
    { id: "schedule", label: "Advertisement schedule", href: `/team/comms/schedule${q}`, icon: CalendarRange },
    { id: "pictures", label: "Pictures", href: `/team/comms/pictures${q}`, icon: ImageIcon },
  ] as const;
  return (
    <nav aria-label="Comms pages" className="mb-6 flex items-center gap-1 overflow-x-auto rounded-2xl border border-gray-200 bg-white p-1.5 shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="comms-tabs">
      {tabs.map((t) => {
        const on = current === t.id;
        return (
          <Link
            key={t.id}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={cn("inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition-colors", on ? "bg-esn/[0.07] text-esn" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900")}
          >
            <t.icon className={cn("h-4 w-4", on ? "text-esn" : "text-gray-400")} aria-hidden="true" />
            {t.label}
          </Link>
        );
      })}
      {executive && (
        <Link href={`/team/esn-activities${q}`} className="ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap px-3 py-2 text-sm font-medium text-esn hover:underline">
          ESN Activities (executive board)
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      )}
    </nav>
  );
}
