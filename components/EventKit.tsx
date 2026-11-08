// Building blocks of an event's tabs (redesign 2026-11-08): a figure tile,
// a notice with an icon and a title, a progress track of steps, and the
// initials avatar of the roster – one look for Overview, Attendance,
// Hand-in and the cash box.
import type { LucideIcon } from "lucide-react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STAT_TONE = {
  default: "bg-esn/5 text-esn",
  amber: "bg-amber-50 text-amber-700",
  green: "bg-emerald-50 text-emerald-700",
  red: "bg-red-50 text-red-700",
  gray: "bg-gray-100 text-gray-500",
} as const;

const VALUE_TONE = { default: "text-gray-900", amber: "text-amber-800", green: "text-emerald-700", red: "text-red-700", gray: "text-gray-500" } as const;

/** One figure: an icon, a small label, the value, a line under it. Inside a panel. */
export function Stat({
  icon: Icon,
  label,
  value,
  note,
  tone = "default",
  valueTone,
  title,
  testId,
  className,
}: {
  icon?: LucideIcon;
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  tone?: keyof typeof STAT_TONE;
  valueTone?: keyof typeof VALUE_TONE;
  title?: string;
  testId?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-start gap-3 rounded-xl border border-gray-100 bg-gray-50/70 p-3", className)} title={title} data-testid={testId}>
      {Icon && (
        <span className={cn("hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg sm:flex", STAT_TONE[tone])} aria-hidden="true">
          <Icon className="h-[18px] w-[18px]" />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{label}</p>
        <p className={cn("text-xl font-bold leading-tight tabular-nums break-words", VALUE_TONE[valueTone ?? (tone === "default" || tone === "gray" ? "default" : tone)])}>{value}</p>
        {note && <p className="mt-0.5 text-xs text-gray-500">{note}</p>}
      </div>
    </div>
  );
}

const CALLOUT_TONE = {
  info: { box: "border-esn/20 bg-esn/5", icon: "bg-esn/10 text-esn", title: "text-esn-dark", text: "text-esn-dark/90" },
  warning: { box: "border-amber-200 bg-amber-50", icon: "bg-amber-100 text-amber-700", title: "text-amber-950", text: "text-amber-900" },
  error: { box: "border-red-200 bg-red-50", icon: "bg-red-100 text-red-700", title: "text-red-900", text: "text-red-800" },
  success: { box: "border-emerald-200 bg-emerald-50", icon: "bg-emerald-100 text-emerald-700", title: "text-emerald-950", text: "text-emerald-900" },
} as const;

/** A notice above a tab's content: an icon, a bold first line, the details and its buttons. */
export function Callout({
  tone = "info",
  icon: Icon,
  title,
  children,
  actions,
  className,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, "title"> & { tone?: keyof typeof CALLOUT_TONE; icon: LucideIcon; title: React.ReactNode; actions?: React.ReactNode }) {
  const t = CALLOUT_TONE[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex gap-3 rounded-2xl border p-4", t.box, className)} {...props}>
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", t.icon)} aria-hidden="true">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className={cn("font-semibold", t.title)}>{title}</p>
        {children && <div className={cn("mt-0.5", t.text)}>{children}</div>}
        {actions && <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export interface TrackStep {
  label: string;
  note?: React.ReactNode;
  state: "done" | "current" | "todo";
}

/** Steps on a line (attendance list, cash box): done ✓, the current one ringed, the rest grey. */
export function ProgressTrack({ steps, label, className }: { steps: TrackStep[]; label: string; className?: string }) {
  return (
    <ol aria-label={label} className={cn("grid gap-y-3", className)} style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((s, i) => (
        <li key={s.label} className="relative flex flex-col items-center px-1 text-center" aria-current={s.state === "current" ? "step" : undefined} data-state={s.state}>
          {i > 0 && <span aria-hidden="true" className={cn("absolute right-1/2 top-3.5 h-0.5 w-full", s.state === "todo" ? "bg-gray-200" : "bg-emerald-400")} />}
          <span
            className={cn(
              "relative z-10 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
              s.state === "done" && "bg-emerald-500 text-white",
              s.state === "current" && "bg-white text-esn ring-2 ring-esn",
              s.state === "todo" && "bg-gray-100 text-gray-400"
            )}
          >
            {s.state === "done" ? <Check className="h-4 w-4" strokeWidth={3} aria-label="Done" /> : i + 1}
          </span>
          <span className={cn("mt-1.5 text-xs font-semibold leading-tight", s.state === "todo" ? "text-gray-400" : "text-gray-900")}>{s.label}</span>
          {s.note && <span className="mt-0.5 text-[11px] leading-tight text-gray-500">{s.note}</span>}
        </li>
      ))}
    </ol>
  );
}

/** "Chloé Dubois" → "CD". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/** A round initials badge: dark blue for the OC, light for everyone else. */
export function Avatar({ name, strong = false, size = "md" }: { name: string; strong?: boolean; size?: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-bold",
        size === "md" ? "h-9 w-9 text-xs" : "h-7 w-7 text-[11px]",
        strong ? "bg-esn text-white" : "bg-esn/10 text-esn-dark"
      )}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
