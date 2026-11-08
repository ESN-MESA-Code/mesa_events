"use client";

import { Clock, ClipboardCheck, Smartphone, UserCheck } from "lucide-react";
import { countryName } from "@/lib/countries";
import { Stat } from "@/components/EventKit";
import type { Breakdown, Event, EventStats } from "@/types/attendance";

interface Props {
  event: Event;
  /** public.event_summary(): the numbers, plus the counts per answer once the list is closed */
  stats: EventStats | null;
}

const NOT_GIVEN = "not_given";

function time(iso: string | null) {
  if (!iso) return "–";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** Rows of one breakdown, largest first, "Not given" last. */
function rows(breakdown: Breakdown, label: (key: string) => string) {
  return Object.entries(breakdown)
    .sort(([a, x], [b, y]) => Number(a === NOT_GIVEN) - Number(b === NOT_GIVEN) || y - x || a.localeCompare(b))
    .map(([key, n]) => ({ key, label: key === NOT_GIVEN ? "Not given" : label(key), n }));
}

/** One breakdown as bars, each as long as its share of the largest answer. */
function BreakdownList({ title, breakdown, label = (k) => k }: { title: string; breakdown?: Breakdown; label?: (key: string) => string }) {
  if (!breakdown || Object.keys(breakdown).length === 0) return null;
  const list = rows(breakdown, label);
  const max = Math.max(...list.map((r) => r.n), 1);
  return (
    <div className="rounded-xl border border-gray-100 p-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">{title}</h3>
      <ul className="space-y-1.5 text-sm text-gray-700">
        {list.map((r) => (
          <li key={r.key}>
            <div className="flex justify-between gap-3">
              <span className={r.key === NOT_GIVEN ? "text-gray-400" : "min-w-0 truncate"}>{r.label}</span>
              <span className="font-semibold tabular-nums">{r.n}</span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
              <div className={r.key === NOT_GIVEN ? "h-full rounded-full bg-gray-300" : "h-full rounded-full bg-esn/70"} style={{ width: `${(r.n / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What every organiser – and finance – sees of an event: counts, no names. */
export default function EventSummary({ event, stats }: Props) {
  const signins = stats?.signins ?? 0;
  const hasBreakdown = stats?.university !== undefined;

  return (
    <div className="space-y-4">
      {/* Only figures that say something; each one says what it is (usability review #26). */}
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <Stat icon={UserCheck} label="Sign-ins" value={signins} />
        {event.headcount !== null ? (
          <Stat icon={ClipboardCheck} label="Counted by the OC" value={event.headcount} title="People the OC counted at the event, entered with the sign-off" tone="green" valueTone="default" />
        ) : (
          <div className="flex items-center rounded-xl border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-500">The OC enters a headcount when signing the list off.</div>
        )}
        {(stats?.kiosk ?? 0) > 0 && <Stat icon={Smartphone} label="On the OC's phone" value={stats!.kiosk} title="Signed in on the organiser's device instead of their own (kiosk)" tone="gray" />}
        {signins > 0 && (
          <Stat
            icon={Clock}
            tone="gray"
            label={signins === 1 || time(stats!.first_signin) === time(stats!.last_signin) ? "Signed in at" : "First – last sign-in"}
            value={time(stats!.first_signin) === time(stats!.last_signin) ? time(stats!.first_signin) : `${time(stats!.first_signin)}–${time(stats!.last_signin)}`}
          />
        )}
      </div>

      {event.headcount !== null && event.headcount !== signins && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {event.headcount > signins
            ? `${event.headcount - signins} counted ${event.headcount - signins === 1 ? "person has" : "people have"} not signed in.`
            : `${signins - event.headcount} more sign-ins than people counted.`}
        </p>
      )}

      {hasBreakdown ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <BreakdownList title="University" breakdown={stats!.university} />
          <BreakdownList title="Exchange programme" breakdown={stats!.exchange_program} />
          <BreakdownList
            title="ESNcard"
            breakdown={stats!.esn_card}
            label={(k) => (k === "yes" ? "Yes" : k === "no" ? "No" : k)}
          />
          <BreakdownList title="Nationality" breakdown={stats!.nationality} label={(k) => countryName(k)} />
        </div>
      ) : (
        signins > 0 && (
          <p className="text-xs text-gray-400">
            The breakdown by university, programme, ESNcard and nationality appears once the list
            is closed.
          </p>
        )
      )}
    </div>
  );
}
