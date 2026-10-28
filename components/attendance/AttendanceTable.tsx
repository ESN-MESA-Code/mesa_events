"use client";

import type { Participant } from "@/types/attendance";

interface Props {
  participants: Participant[];
}

// Names only: the optional answers are only counted, never stored per person,
// and there are no signatures. Phones get one line per person, wider screens a
// table.

function KioskBadge({ p, short = false }: { p: Participant; short?: boolean }) {
  if (p.entry_method !== "kiosk") return null;
  return (
    <span
      title={`Signed in on ${p.recorded_by ?? "an organiser"}'s device`}
      className="align-middle rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-500"
    >
      {short ? "K" : "Kiosk"}
    </span>
  );
}

export default function AttendanceTable({ participants }: Props) {
  if (participants.length === 0) {
    return (
      <p className="text-gray-500 text-sm py-4 text-center">
        No participants yet.
      </p>
    );
  }

  return (
    <>
      <ul className="sm:hidden divide-y divide-gray-200">
        {participants.map((p, idx) => (
          <li key={p.id} data-testid="participant-card" className="flex items-center gap-2 px-1 py-2">
            <span className="w-6 shrink-0 text-xs text-gray-400">{idx + 1}</span>
            <span className="min-w-0 truncate text-sm font-medium text-gray-900" title={`${p.first_name} ${p.last_name}`}>
              {p.first_name} {p.last_name}
            </span>
            <span className="ml-auto shrink-0">
              <KioskBadge p={p} short />
            </span>
          </li>
        ))}
      </ul>

      <div className="hidden sm:block relative overflow-x-auto">
        <table className="min-w-full text-sm text-left whitespace-nowrap">
          <thead>
            <tr className="bg-gray-100 text-gray-600 uppercase text-xs">
              <th className="px-3 py-2 whitespace-nowrap">#</th>
              <th className="px-3 py-2 whitespace-nowrap">Surname</th>
              <th className="px-3 py-2 whitespace-nowrap">First Name</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {participants.map((p, idx) => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-gray-400 text-xs">{idx + 1}</td>
                <td className="px-3 py-2 font-medium text-gray-900">
                  {p.last_name} <KioskBadge p={p} />
                </td>
                <td className="px-3 py-2 text-gray-700">{p.first_name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
