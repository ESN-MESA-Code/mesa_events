"use client";

import { Users } from "lucide-react";
import type { Participant } from "@/types/attendance";

interface Props {
  participants: Participant[];
}

// Names only: the optional answers are only counted, never stored per person,
// and there are no signatures. One numbered row per person, surname first as
// on a paper list; two columns from the small breakpoint on (redesign 2026-11-08).

function KioskBadge({ p, short = false }: { p: Participant; short?: boolean }) {
  if (p.entry_method !== "kiosk") return null;
  return (
    <span
      title={`Signed in on ${p.recorded_by ?? "an organiser"}'s device`}
      className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500"
    >
      {short ? "K" : "Kiosk"}
    </span>
  );
}

export default function AttendanceTable({ participants }: Props) {
  if (participants.length === 0) {
    return (
      <p className="flex flex-col items-center gap-2 py-6 text-center text-sm text-gray-500">
        <Users className="h-5 w-5 text-gray-300" aria-hidden="true" />
        No participants yet.
      </p>
    );
  }

  return (
    <ol className="grid gap-x-6 sm:grid-cols-2" aria-label="Participants">
      {participants.map((p, idx) => (
        <li key={p.id} data-testid="participant-card" className="flex min-w-0 items-center gap-3 border-b border-gray-100 py-2">
          <span className="w-6 shrink-0 text-right text-xs tabular-nums text-gray-400">{idx + 1}</span>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-esn/10 text-[11px] font-bold text-esn-dark" aria-hidden="true">
            {((p.first_name[0] ?? "") + (p.last_name[0] ?? "")).toUpperCase()}
          </span>
          <span className="min-w-0 truncate text-sm text-gray-700" title={`${p.first_name} ${p.last_name}`}>
            <span className="font-semibold text-gray-900">{p.last_name}</span>, {p.first_name}
          </span>
          <span className="ml-auto shrink-0">
            <KioskBadge p={p} />
          </span>
        </li>
      ))}
    </ol>
  );
}
