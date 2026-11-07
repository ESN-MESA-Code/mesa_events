// A titled white panel (redesign 2026-11-07): the cards of the event page,
// with the rounder corners of the Home, Ideas and My events cards.
import { cn } from "@/lib/utils";

export function Panel({ title, aside, id, className, children }: { title: string; aside?: React.ReactNode; id?: string; className?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-label={title} className={cn("scroll-mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5", className)}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-base font-bold text-gray-900">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
