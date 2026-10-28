"use client";

import { useMemo, useState } from "react";
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, type SortingState } from "@tanstack/react-table";
import { Badge, Button, Input, Select } from "@/components/ui";
import { ActionButton, useAction } from "@/components/ActionButton";
import { checkReimbursement, markBelegReceived, payEarly, rejectReimbursement } from "@/app/actions/handin";
import { CATEGORY_LABELS, EXPENSE_KIND_LABELS, STATUS_LABELS, mayPayEarly, type Category, type ClaimStatus, type ExpenseKind } from "@/lib/reimbursement";
import { formatCents, parseEuroToCents } from "@/lib/dates";

export interface ClaimRow {
  id: string;
  status: string;
  claimant: string;
  role: string;
  event: string;
  eventId: string;
  eventDate: string;
  kind: string;
  vendor: string;
  amount: number;
  suggested: number;
  approved: number | null;
  flags: string[];
  category: string;
  policyVersion: number;
  payoutMethod: string | null;
  beleg: string | null;
}

const TONE: Record<ClaimStatus, "gray" | "blue" | "green" | "red" | "purple"> = {
  not_submitted: "gray",
  beleg_received: "blue",
  checked: "green",
  paid: "purple",
  rejected: "red",
};

function CheckForm({ row }: { row: ClaimRow }) {
  const { run, pending, error, setError } = useAction();
  const [amount, setAmount] = useState((row.suggested / 100).toFixed(2));
  const [mode, setMode] = useState<"none" | "check" | "reject">("none");
  const [reason, setReason] = useState("");
  if (mode === "none") {
    return (
      <span className="flex gap-1">
        <Button size="sm" onClick={() => setMode("check")} disabled={!row.payoutMethod} title={row.payoutMethod ? undefined : "No bank or PayPal details yet"}>
          Check
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMode("reject")}>
          Reject
        </Button>
      </span>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (mode === "reject") return run(rejectReimbursement, { claim_id: row.id, reason });
        const cents = parseEuroToCents(amount);
        if (cents === null) return setError("Enter an amount.");
        run(checkReimbursement, { claim_id: row.id, approved_cents: cents });
      }}
    >
      {mode === "check" ? (
        <Input aria-label="Amount to pay" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-8 w-20" />
      ) : (
        <Input aria-label="Reason" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} className="h-8 w-40" />
      )}
      <Button size="sm" variant={mode === "check" ? "success" : "destructive"} disabled={pending}>
        {mode === "check" ? "Approve" : "Reject"}
      </Button>
      <Button size="sm" type="button" variant="ghost" onClick={() => setMode("none")}>
        ×
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}

const col = createColumnHelper<ClaimRow>();

export function ClaimsTable({ rows }: { rows: ClaimRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [status, setStatus] = useState("open");
  const [search, setSearch] = useState("");

  const data = useMemo(
    () => rows.filter((r) => (status === "all" ? true : status === "open" ? ["not_submitted", "beleg_received", "checked"].includes(r.status) : r.status === status)),
    [rows, status]
  );

  const columns = useMemo(
    () => [
      col.accessor("claimant", {
        header: "Claimant",
        cell: (c) => (
          <span>
            {c.getValue()} <span className="text-xs text-gray-500">({c.row.original.role})</span>
          </span>
        ),
      }),
      col.accessor("event", {
        header: "Event",
        cell: (c) => (
          <a href={`/events/${c.row.original.eventId}/hand-in`} className="hover:text-esn">
            {c.getValue()}
            <span className="block text-xs text-gray-500">{c.row.original.eventDate}</span>
          </a>
        ),
      }),
      col.accessor("kind", {
        header: "Expense",
        cell: (c) => (
          <span>
            {EXPENSE_KIND_LABELS[c.getValue() as ExpenseKind]?.split(" (")[0]}
            <span className="block text-xs text-gray-500">
              {c.row.original.vendor} · {CATEGORY_LABELS[c.row.original.category as Category]} · rules v{c.row.original.policyVersion}
            </span>
          </span>
        ),
      }),
      col.accessor("amount", { header: "Paid", cell: (c) => <span className="tabular-nums whitespace-nowrap">{formatCents(c.getValue())}</span> }),
      col.accessor("suggested", {
        header: "Suggested",
        cell: (c) => (
          <span className="tabular-nums whitespace-nowrap">
            {formatCents(c.getValue())}
            {c.row.original.flags.length > 0 && <span className="block text-[11px] text-amber-700">{c.row.original.flags.join(", ").replace(/_/g, " ")}</span>}
          </span>
        ),
      }),
      col.accessor("approved", { header: "Approved", cell: (c) => <span className="tabular-nums whitespace-nowrap">{formatCents(c.getValue())}</span> }),
      col.accessor("status", {
        header: "Status",
        cell: (c) => (
          <span>
            <Badge tone={TONE[c.getValue() as ClaimStatus]}>{STATUS_LABELS[c.getValue() as ClaimStatus]}</Badge>
            {c.row.original.beleg && <span className="block text-[11px] text-gray-500">Beleg {c.row.original.beleg}</span>}
          </span>
        ),
      }),
      col.display({
        id: "actions",
        header: "",
        cell: ({ row: { original: r } }) => (
          <span className="flex flex-col items-start gap-1">
            {r.status === "not_submitted" && (
              <ActionButton action={markBelegReceived} input={{ claim_id: r.id }} variant="outline">
                Beleg received
              </ActionButton>
            )}
            {r.status === "beleg_received" && <CheckForm row={r} />}
            {r.status === "checked" && mayPayEarly(r.approved) && (
              <ActionButton action={payEarly} input={{ claim_id: r.id }} variant="outline" confirm="Pay this claim now, outside the monthly batch?">
                Pay early
              </ActionButton>
            )}
            {!r.payoutMethod && !["paid", "rejected"].includes(r.status) && <span className="text-[11px] text-amber-700">no payout details</span>}
          </span>
        ),
      }),
    ],
    []
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table v8 is not compiler-aware
  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: search },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select aria-label="Status filter" value={status} onChange={(e) => setStatus(e.target.value)} className="w-56">
          <option value="open">Open (not paid)</option>
          <option value="all">All</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Input aria-label="Search claims" placeholder="Search name, event, vendor…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="claims-table">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="text-left text-xs uppercase text-gray-500">
                {hg.headers.map((h) => (
                  <th key={h.id} className="py-2 pr-3 whitespace-nowrap">
                    {h.isPlaceholder ? null : (
                      <button type="button" className="uppercase" onClick={h.column.getToggleSortingHandler()} disabled={!h.column.getCanSort()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {{ asc: " ▲", desc: " ▼" }[h.column.getIsSorted() as string] ?? ""}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-gray-100">
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="align-top" data-testid={`claim-${row.original.vendor}`}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="py-2 pr-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!table.getRowModel().rows.length && <p className="py-6 text-center text-sm text-gray-500">No claims.</p>}
      </div>
    </div>
  );
}
