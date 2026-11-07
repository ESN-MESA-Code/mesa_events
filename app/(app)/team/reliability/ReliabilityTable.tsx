"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { addToBlacklist, removeFromBlacklist } from "@/app/actions/reliability";
import { LEVEL_LABELS, reliability, sortByConcern, type ReliabilityRow } from "@/lib/reliability";
import { formatShortDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

const COUNTS = [
  { key: "events_done", label: "Events", hint: "Events they were on that took place" },
  { key: "no_show", label: "No-show", hint: "Didn't show up, no notice" },
  { key: "short_notice", label: "Short notice", hint: "Cancelled at short notice outside the app" },
  { key: "late_dropouts", label: "Late drop-out", hint: "Dropped out in the app less than 48 hours before" },
  { key: "late", label: "Late", hint: "Very late or left early" },
  { key: "excused", label: "Excused", hint: "Missed for a good reason – not counted against them" },
] as const;

/** Least reliable first; searchable; the blacklist kept right here. */
export function ReliabilityTable({ rows, canEdit, detailHref }: { rows: ReliabilityRow[]; canEdit: boolean; detailHref: Record<string, string> }) {
  const [query, setQuery] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortByConcern(rows).filter(
      (r) =>
        (!q || r.full_name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)) &&
        (!onlyIssues || r.blacklisted || ["unreliable", "some_issues"].includes(reliability(r).level))
    );
  }, [rows, query, onlyIssues]);
  const blacklisted = rows.filter((r) => r.blacklisted).length;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a name or email" aria-label="Search members" className="h-9 max-w-xs" />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
          Only issues and blacklist
        </label>
        <span className="ml-auto text-xs text-gray-500">
          {shown.length} members · {blacklisted} on the blacklist
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="reliability-table">
          <thead className="bg-gray-50 text-left text-xs text-gray-600">
            <tr>
              <th className="px-3 py-2 font-medium">Member</th>
              <th className="px-3 py-2 font-medium" title="Each no-show, short-notice cancellation or late drop-out costs a full event, being late half">
                Score
              </th>
              {COUNTS.map((c) => (
                <th key={c.key} className="px-3 py-2 text-right font-medium" title={c.hint}>
                  {c.label}
                </th>
              ))}
              <th className="px-3 py-2 font-medium">Last issue</th>
              <th className="px-3 py-2 font-medium">Blacklist</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shown.map((r) => {
              const x = reliability(r);
              const level = LEVEL_LABELS[x.level];
              return (
                <tr key={r.profile_id} className={cn(r.blacklisted && "bg-red-50/40")} data-testid={`reliability-${r.email}`}>
                  <td className="px-3 py-2">
                    <Link href={detailHref[r.profile_id]} className="font-medium text-gray-900 hover:text-esn">
                      {r.full_name || r.email}
                    </Link>
                    <span className="block text-xs text-gray-500">{r.email}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Badge tone={level.tone}>{level.label}</Badge>
                    {x.score !== null && <span className="ml-2 tabular-nums text-gray-700">{x.score}%</span>}
                  </td>
                  {COUNTS.map((c) => (
                    <td key={c.key} className={cn("px-3 py-2 text-right tabular-nums", r[c.key] ? (c.key === "events_done" || c.key === "excused" ? "text-gray-900" : "font-semibold text-red-700") : "text-gray-300")}>
                      {r[c.key]}
                    </td>
                  ))}
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">{r.last_incident_at ? formatShortDate(r.last_incident_at) : "–"}</td>
                  <td className="px-3 py-2 min-w-56">
                    <BlacklistCell row={r} canEdit={canEdit} />
                  </td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr>
                <td colSpan={COUNTS.length + 4} className="px-3 py-6 text-center text-gray-500">
                  Nobody here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function BlacklistCell({ row: r, canEdit }: { row: ReliabilityRow; canEdit: boolean }) {
  const { run, pending, error, confirm } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const name = r.full_name || r.email;

  if (r.blacklisted) {
    return (
      <div className="space-y-1">
        <Badge tone="red" title={r.blacklist_reason ?? undefined}>
          Blacklisted
        </Badge>
        <p className="text-xs text-gray-600">
          “{r.blacklist_reason}” – {r.blacklisted_by}, {r.blacklisted_at ? formatShortDate(r.blacklisted_at) : ""}
        </p>
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={async () => {
              if (!(await confirm({ title: `Take ${name} off the blacklist?`, body: "From the next allocation on, they are placed automatically again.", confirmLabel: "Take off" }))) return;
              run(removeFromBlacklist, { profile_id: r.profile_id }, undefined, `${name} is off the blacklist.`);
            }}
          >
            Take off
          </Button>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }
  if (!canEdit) return <span className="text-xs text-gray-400">–</span>;
  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Blacklist…
      </Button>
    );
  }
  return (
    <form
      className="space-y-1"
      onSubmit={(e) => {
        e.preventDefault();
        run(addToBlacklist, { profile_id: r.profile_id, reason }, () => setOpen(false), `${name} is on the blacklist.`);
      }}
    >
      <Input aria-label={`Why ${name} goes on the blacklist`} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} className="h-8" maxLength={500} required />
      <span className="flex gap-2">
        <Button size="sm" variant="destructive" disabled={pending || !reason.trim()}>
          Blacklist
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </span>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}

/** Someone without events in the period (so not in the table). */
export function AddToBlacklist({ members }: { members: Array<{ id: string; full_name: string; email: string }> }) {
  const { run, pending, error } = useAction();
  const [profile, setProfile] = useState("");
  const [reason, setReason] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(addToBlacklist, { profile_id: profile, reason }, () => {
          setProfile("");
          setReason("");
        }, "Added to the blacklist.");
      }}
    >
      <Select aria-label="Member" value={profile} onChange={(e) => setProfile(e.target.value)} className="h-9 max-w-xs" required>
        <option value="">Choose a member…</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.full_name || m.email} ({m.email})
          </option>
        ))}
      </Select>
      <Input aria-label="Reason" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 max-w-sm" maxLength={500} required />
      <Button size="sm" variant="destructive" disabled={pending || !profile || !reason.trim()}>
        Blacklist
      </Button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </form>
  );
}
