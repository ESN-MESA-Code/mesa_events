import type { LeaderCategory, LeaderMetric, Ranked } from "@/lib/leaderboard";
import { cn } from "@/lib/utils";

/**
 * One colour per category (checked for colour-vision deficiency and contrast
 * on white, 2026-10-31); text stays in the gray ink, the colour marks only.
 */
export const CATEGORY_STYLE: Record<LeaderMetric, { color: string; icon: string; total: string }> = {
  oc_count: { color: "#4549B8", icon: "🧭", total: "events organised" },
  helper_count: { color: "#0091C8", icon: "🤝", total: "helper slots filled" },
  office_hour_count: { color: "#E06A12", icon: "☕", total: "office hours staffed" },
};

const MEDAL = ["#E8B400", "#A3ACB9", "#C47A3E"];
const STEP_HEIGHT = ["h-24", "h-16", "h-11"];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase() || "?";
}

function Avatar({ name, place, size = "md" }: { name: string; place: number; size?: "md" | "lg" }) {
  return (
    <span
      className={cn("relative inline-flex items-center justify-center rounded-full bg-white font-semibold text-gray-800 ring-4", size === "lg" ? "h-14 w-14 text-base" : "h-11 w-11 text-sm")}
      style={{ ["--tw-ring-color" as string]: MEDAL[place - 1] ?? "#e5e7eb" }}
      aria-hidden
    >
      {initials(name)}
      {place === 1 && <span className="absolute -top-4 text-lg">👑</span>}
    </span>
  );
}

/**
 * The top three on a podium – 2nd, 1st, 3rd from left to right; tied
 * places stand on the same step. An empty step invites the first one.
 */
export function Podium({ rows, category, viewerId }: { rows: Ranked[]; category: LeaderCategory; viewerId: string }) {
  const { color } = CATEGORY_STYLE[category.metric];
  const three = rows.slice(0, 3);
  const order = [three[1], three[0], three[2]];
  return (
    <ol className="grid grid-cols-3 items-end gap-2" aria-label={`${category.title}: top three`}>
      {order.map((r, i) => {
        const slot = [2, 1, 3][i];
        if (!r)
          return (
            <li key={`empty-${slot}`} className="flex flex-col items-center gap-1">
              <span className="text-center text-[11px] leading-tight text-gray-400">Free spot</span>
              <div className={cn("w-full rounded-t-lg border-2 border-dashed border-gray-200", STEP_HEIGHT[slot - 1])} />
            </li>
          );
        const me = r.id === viewerId;
        return (
          <li key={r.id} className="flex min-w-0 flex-col items-center gap-1.5" title={`${r.name}: ${category.unit(r.count)} (place ${r.place})`}>
            <Avatar name={r.name} place={r.place} size={r.place === 1 ? "lg" : "md"} />
            <span className={cn("w-full truncate text-center text-xs font-medium", me ? "text-esn-dark" : "text-gray-800")}>
              {r.name}
              {me && " (you)"}
            </span>
            <span className="text-[11px] tabular-nums text-gray-500">{category.unit(r.count)}</span>
            <div
              className={cn("flex w-full items-start justify-center rounded-t-lg pt-1.5 text-lg font-bold text-white", STEP_HEIGHT[Math.min(r.place, 3) - 1])}
              style={{ background: `linear-gradient(180deg, ${color}, ${color}cc)` }}
            >
              <span aria-label={`Place ${r.place}`}>{r.place}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Everyone after the podium, with a bar against the leader's count. */
export function RankList({ rows, category, viewerId, max }: { rows: Ranked[]; category: LeaderCategory; viewerId: string; max: number }) {
  const { color } = CATEGORY_STYLE[category.metric];
  if (!rows.length) return null;
  return (
    <ol className="space-y-1.5" aria-label={`${category.title}: further places`}>
      {rows.map((r) => {
        const me = r.id === viewerId;
        return (
          <li
            key={r.id}
            className={cn("grid grid-cols-[1.75rem_minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-gray-50", me && "bg-esn/5 hover:bg-esn/10")}
            title={`${r.name}: ${category.unit(r.count)} (place ${r.place})`}
          >
            <span className="text-right text-xs tabular-nums text-gray-500">{r.place}.</span>
            <span className={cn("truncate", me ? "font-semibold text-esn-dark" : "text-gray-800")}>
              {r.name}
              {me && " (you)"}
            </span>
            <span className="h-2.5 rounded-r bg-gray-100" aria-hidden>
              <span className="block h-full rounded-r" style={{ width: `${Math.max(6, (r.count / max) * 100)}%`, background: color }} />
            </span>
            <span className="text-xs tabular-nums text-gray-600">{r.count}</span>
          </li>
        );
      })}
    </ol>
  );
}
