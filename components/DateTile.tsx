// An event's day as a small calendar leaf: My events, Home, Ideas, Volunteer.
import { formatShortDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

export const TILE_TONE = {
  default: "bg-esn/5 text-esn-dark",
  live: "bg-esn-orange/10 text-esn-orange",
  /** An open slot to claim (Home). */
  open: "bg-sky-50 text-sky-800",
  /** Cancelled or dropped. */
  muted: "bg-gray-100 text-gray-500",
};

/** An event's day as a small calendar leaf ("Nov / 3 / Tue"). */
export function DateTile({ iso, live, tone = "default" }: { iso: string; live?: boolean; tone?: keyof typeof TILE_TONE }) {
  const [weekday, day, month] = formatShortDate(iso).split(" ");
  return (
    <div className={cn("flex w-12 shrink-0 flex-col items-center self-start rounded-lg py-1.5 leading-tight", TILE_TONE[live ? "live" : tone])} aria-hidden="true">
      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{month}</span>
      <span className="text-lg font-bold tabular-nums">{day}</span>
      <span className="text-[10px] text-gray-500">{weekday}</span>
    </div>
  );
}

