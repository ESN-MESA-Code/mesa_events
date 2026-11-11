"use client";

import { useMemo, useState } from "react";
import { Download, Search, Sprout, Users } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { ACTIVITY_COLUMNS, activityCsv, sortActivity, type ActivityColumn, type ActivityRow } from "@/lib/internalAttendance";
import { cn } from "@/lib/utils";

type Who = "all" | "members" | "newbies";

/** Newbies (the newbies Google group) and members, each its own group of the list (2026-11-11) – the few newbies first, not below 50 members. */
const GROUPS = [
  { key: "newbies", newbie: true, label: "Newbies", icon: Sprout, pill: "bg-fuchsia-100 text-fuchsia-800", avatar: "bg-fuchsia-100 text-fuchsia-800" },
  { key: "members", newbie: false, label: "Members", icon: Users, pill: "bg-esn/10 text-esn", avatar: "bg-esn/10 text-esn" },
] as const;

const initials = (name: string) =>
  name
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

const sum = (rows: ActivityRow[], key: (typeof ACTIVITY_COLUMNS)[number]["key"]) => rows.reduce((s, r) => s + r[key], 0);

/**
 * The semester per member: members and newbies listed as two groups with
 * their own totals, filtered to one of them, searchable by name or email,
 * sortable by any column, and saved as a spreadsheet.
 */
export function ActivityTable({ rows, semester }: { rows: ActivityRow[]; semester: string }) {
  const [by, setBy] = useState<ActivityColumn>("full_name");
  const [query, setQuery] = useState("");
  const [who, setWho] = useState<Who>("all");
  const [onlyActive, setOnlyActive] = useState(false);
  const counts = { all: rows.length, members: rows.filter((r) => !r.newbie).length, newbies: rows.filter((r) => r.newbie).length };
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter(
      (r) =>
        (who === "all" || r.newbie === (who === "newbies")) &&
        (!q || r.full_name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)) &&
        (!onlyActive || ACTIVITY_COLUMNS.some((c) => r[c.key] > 0))
    );
    return sortActivity(list, by);
  }, [rows, by, query, who, onlyActive]);
  const groups = GROUPS.map((g) => ({ ...g, rows: shown.filter((r) => r.newbie === g.newbie) })).filter((g) => g.rows.length);

  const download = () => {
    const blob = new Blob([activityCsv(shown)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mesa-activity-${semester.replace(/[^\w]+/g, "-")}${who === "all" ? "" : `-${who}`}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3">
        <label className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a name or email"
            aria-label="Search members"
            className="h-9 w-full rounded-md border border-gray-300 bg-white pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-esn-accent"
          />
        </label>
        <div role="group" aria-label="Show" className="inline-flex rounded-lg bg-gray-100 p-0.5 text-sm" data-testid="activity-filter">
          {(
            [
              ["all", "All", null],
              ["members", "Members", Users],
              ["newbies", "Newbies", Sprout],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              aria-pressed={who === key}
              onClick={() => setWho(key)}
              data-testid={`activity-filter-${key}`}
              className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors", who === key ? "bg-white text-esn shadow-sm" : "text-gray-600 hover:text-gray-900")}
            >
              {Icon && <Icon className="size-3.5" aria-hidden="true" />}
              {label}
              <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", who === key ? "bg-esn/10" : "bg-gray-200 text-gray-600")}>{counts[key]}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={onlyActive}
          onClick={() => setOnlyActive((x) => !x)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            onlyActive ? "border-esn bg-esn text-white" : "border-gray-300 bg-white text-gray-700 hover:border-esn/40"
          )}
        >
          Only with activity
        </button>
        <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={download}>
          <Download className="mr-1.5 size-4" aria-hidden="true" />
          CSV
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="activity-table">
          <thead className="border-b border-gray-200 text-left text-xs text-gray-500">
            <tr>
              <Head col="full_name" label="Name" by={by} onSort={setBy} />
              {ACTIVITY_COLUMNS.map((c) => (
                <Head key={c.key} col={c.key} label={c.label} by={by} onSort={setBy} className="text-right" />
              ))}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.key} className="divide-y divide-gray-100" data-testid={`activity-group-${g.key}`}>
              {/* The group: who it is, how many, and what they did together. */}
              <tr className="bg-gray-50">
                <th scope="rowgroup" className="px-3 py-2 text-left">
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold", g.pill)}>
                    <g.icon className="size-3.5" aria-hidden="true" />
                    {g.label}
                  </span>
                  <span className="ml-2 text-xs font-normal text-gray-500">{g.rows.length}</span>
                </th>
                {ACTIVITY_COLUMNS.map((c) => (
                  <td key={c.key} className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-gray-600" title={`${g.label} together`}>
                    {sum(g.rows, c.key)}
                  </td>
                ))}
              </tr>
              {g.rows.map((r) => (
                <tr key={r.profile_id} data-testid={`activity-${r.email}`} className="hover:bg-gray-50/60">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2.5">
                      <span className={cn("relative inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold", g.avatar)} aria-hidden="true">
                        {initials(r.full_name) || "?"}
                        {r.newbie && (
                          <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-white p-px">
                            <Sprout className="size-3 text-fuchsia-600" />
                          </span>
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-medium text-gray-900">
                          {r.full_name}
                          <span className="sr-only">{r.newbie ? " (newbie)" : " (member)"}</span>
                        </span>
                        <span className="block truncate text-xs text-gray-500">{r.email}</span>
                      </span>
                    </span>
                  </td>
                  {ACTIVITY_COLUMNS.map((c) => (
                    <td key={c.key} className={cn("px-3 py-2 text-right tabular-nums", r[c.key] ? "font-medium text-gray-900" : "text-gray-300")}>
                      {r[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
          {!groups.length && (
            <tbody>
              <tr>
                <td colSpan={ACTIVITY_COLUMNS.length + 1} className="px-3 py-8 text-center text-sm text-gray-500">
                  Nobody matches.
                </td>
              </tr>
            </tbody>
          )}
          {groups.length > 1 && (
            <tfoot className="border-t border-gray-200 bg-gray-50 text-xs text-gray-600">
              <tr>
                <td className="px-3 py-2 font-semibold">Everyone shown</td>
                {ACTIVITY_COLUMNS.map((c) => (
                  <td key={c.key} className="px-3 py-2 text-right font-semibold tabular-nums">
                    {sum(shown, c.key)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}

/** A column header that sorts by its column (numbers highest first, names A–Z) – within each group. */
function Head({ col, label, by, onSort, className }: { col: ActivityColumn; label: string; by: ActivityColumn; onSort: (c: ActivityColumn) => void; className?: string }) {
  return (
    <th scope="col" className={cn("px-3 py-2 font-medium", className)} aria-sort={by === col ? (col === "full_name" ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => onSort(col)} className={cn("hover:text-esn", by === col && "text-esn")}>
        {label}
        {by === col && " ↓"}
      </button>
    </th>
  );
}
