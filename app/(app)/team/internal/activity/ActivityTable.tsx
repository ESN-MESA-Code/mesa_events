"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Card, Input } from "@/components/ui";
import { ACTIVITY_COLUMNS, activityCsv, sortActivity, type ActivityColumn, type ActivityRow } from "@/lib/internalAttendance";
import { cn } from "@/lib/utils";

/** Sortable by any column, searchable by name or email, and saved as a spreadsheet. */
export function ActivityTable({ rows, semester }: { rows: ActivityRow[]; semester: string }) {
  const [by, setBy] = useState<ActivityColumn>("full_name");
  const [query, setQuery] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((r) => (!q || r.full_name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)) && (!onlyActive || ACTIVITY_COLUMNS.some((c) => r[c.key] > 0)));
    return sortActivity(list, by);
  }, [rows, by, query, onlyActive]);
  const totals = ACTIVITY_COLUMNS.map((c) => rows.reduce((s, r) => s + r[c.key], 0));

  const download = () => {
    const blob = new Blob([activityCsv(shown)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mesa-activity-${semester.replace(/[^\w]+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a name or email" aria-label="Search members" className="h-9 max-w-xs" />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
          Only members with activity
        </label>
        <span className="text-xs text-gray-500">{shown.length} members</span>
        <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={download}>
          Download as CSV
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="activity-table">
          <thead className="bg-gray-50 text-left text-xs text-gray-600">
            <tr>
              <Head col="full_name" label="Member" by={by} onSort={setBy} />
              {ACTIVITY_COLUMNS.map((c) => (
                <Head key={c.key} col={c.key} label={c.label} by={by} onSort={setBy} className="text-right" />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shown.map((r) => (
              <tr key={r.profile_id} data-testid={`activity-${r.email}`}>
                <td className="px-3 py-2">
                  <span className="font-medium text-gray-900">{r.full_name}</span>
                  {r.newbie && (
                    <Badge tone="purple" className="ml-2">
                      Newbie
                    </Badge>
                  )}
                  <span className="block text-xs text-gray-500">{r.email}</span>
                </td>
                {ACTIVITY_COLUMNS.map((c) => (
                  <td key={c.key} className={cn("px-3 py-2 text-right tabular-nums", r[c.key] ? "text-gray-900" : "text-gray-300")}>
                    {r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50 text-xs text-gray-600">
            <tr>
              <td className="px-3 py-2 font-medium">All members</td>
              {totals.map((t, i) => (
                <td key={ACTIVITY_COLUMNS[i].key} className="px-3 py-2 text-right tabular-nums">
                  {t}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

/** A column header that sorts by its column (numbers highest first, names A–Z). */
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
