// Home's building blocks (redesign 2026-11-04, design canvas "MESA Home
// Redesign"): the "happening now" hero, the To do rows, the open-slot cards
// and the section headings. Cards with a date tile keep the time and role
// above the title and give the title and the status a fixed height, so the
// lines line up from card to card.
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ChevronRight, QrCode } from "lucide-react";
import { berlinTime, dueUrgency } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui";
import { DateTile } from "@/components/MyEventCard";

/** Colours of a deadline: red within 24 hours or past, amber within 48, else ESN blue. */
const URGENCY_TONE = {
  urgent: "bg-red-50 text-red-700",
  soon: "bg-amber-50 text-amber-800",
  later: "bg-esn/5 text-esn",
} as const;

/** A heading row: title, optional count and note, an optional link at the end. */
export function SectionHeader({ id, title, count, note, link }: { id: string; title: string; count?: number; note?: string; link?: { href: string; label: string } }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 id={id} className="flex items-center gap-2 text-lg font-bold text-gray-900">
        {title}
        {!!count && (
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-esn px-2 text-xs font-bold tabular-nums text-white">{count}</span>
        )}
      </h2>
      {note && <span className="text-sm text-gray-600">{note}</span>}
      {link && (
        <Link href={link.href} className="ml-auto text-sm font-semibold text-esn hover:underline">
          {link.label}
        </Link>
      )}
    </div>
  );
}

/** "Overdue" / "Due within 24 h" / "Due within 2 days"; nothing for later deadlines. Wide screens only – the detail line says it on phones. */
function DueChip({ iso, now }: { iso: string; now: number }) {
  const urgency = dueUrgency(iso, now);
  if (urgency === "later") return null;
  const text = Date.parse(iso) < now ? "Overdue" : urgency === "urgent" ? "Due within 24 h" : "Due within 2 days";
  return <span className={cn("hidden shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold sm:inline-flex", URGENCY_TONE[urgency])}>{text}</span>;
}

/** One row of To do: the whole row is the link; an icon tinted by the deadline, what to do, its detail. */
export function TodoRow({
  href,
  icon: Icon,
  title,
  detail,
  due,
  now,
  cta,
  testId,
  linkTestId,
}: {
  href: string;
  icon: LucideIcon;
  title: React.ReactNode;
  detail: React.ReactNode;
  due?: string | null;
  now: number;
  /** A button-like label on wide screens ("Fill in the form"). */
  cta?: string;
  testId: string;
  linkTestId?: string;
}) {
  const tone = due ? dueUrgency(due, now) : "later";
  return (
    <li className="border-t border-gray-100 first:border-t-0" data-testid={testId}>
      <Link href={href} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none sm:px-5" data-testid={linkTestId}>
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", URGENCY_TONE[tone])} aria-hidden="true">
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-gray-900">{title}</span>
          <span className="block text-sm text-gray-600">{detail}</span>
        </span>
        {cta && <span className="hidden shrink-0 rounded-lg bg-esn px-3 py-1.5 text-sm font-semibold text-white sm:inline-block">{cta}</span>}
        {due && <DueChip iso={due} now={now} />}
        <ChevronRight className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
      </Link>
    </li>
  );
}

/** The orange dot that pulses (not with reduced motion). */
function LiveDot() {
  return (
    <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
      <span className="absolute inline-flex h-full w-full rounded-full bg-esn-orange opacity-75 motion-safe:animate-ping" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-esn-orange" />
    </span>
  );
}

/** An event happening now, or a duty on now: its own card above everything else. */
export function LiveCard({
  label,
  title,
  titleHref,
  titleTestId,
  stepLabel,
  primary,
  secondary,
  testId,
}: {
  label: string;
  title: string;
  titleHref: string;
  titleTestId: string;
  stepLabel: string;
  primary?: { href: string; label: string; testId?: string };
  secondary?: { href: string; label: string };
  testId: string;
}) {
  return (
    <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-esn-orange/40 bg-orange-50 p-4 sm:p-5" data-testid={testId}>
      <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-esn-orange text-white sm:flex" aria-hidden="true">
        <QrCode className="h-6 w-6" />
      </span>
      <div className="min-w-56 flex-1">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-orange-800">
          <LiveDot />
          {label}
        </p>
        <h2 className="mt-0.5 text-xl font-bold text-gray-900">
          <Link href={titleHref} className="hover:underline" data-testid={titleTestId}>
            {title}
          </Link>
        </h2>
        <p className="text-sm text-gray-700">Next step: {stepLabel}</p>
      </div>
      {(primary || secondary) && (
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {primary && (
            <Link href={primary.href} className={cn(buttonVariants({ size: "lg" }), "w-full px-5 sm:w-auto")} data-testid={primary.testId}>
              {primary.label}
            </Link>
          )}
          {secondary && (
            <Link href={secondary.href} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full sm:w-auto")}>
              {secondary.label}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

/** The fixed part next to a date tile: one line above (time, role…), a two-line title below. */
export function TileHeading({ overline, children }: { overline: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-xs font-medium tabular-nums text-gray-600">{overline}</p>
      <div className="mt-0.5 line-clamp-2 min-h-[2lh] break-words font-semibold leading-snug text-gray-900">{children}</div>
    </div>
  );
}

/** An event that needs people, with the way to its page to claim the slot. */
export function SlotCard({ id, title, startsAt, need }: { id: string; title: string; startsAt: string; need: string }) {
  const href = `/events/${id}?from=home`;
  return (
    <li className="w-64 shrink-0 snap-start sm:w-auto">
      <div className="flex h-full flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex gap-3">
          <DateTile iso={startsAt} tone="open" />
          <TileHeading overline={`${berlinTime(startsAt)} · ${need}`}>
            <Link href={href} className="hover:text-esn" title={title}>
              {title}
            </Link>
          </TileHeading>
        </div>
        <Link href={href} className={cn(buttonVariants({ variant: "outline" }), "mt-auto w-full")}>
          View and claim
        </Link>
      </div>
    </li>
  );
}
