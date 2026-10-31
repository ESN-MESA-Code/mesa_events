"use client";

import { countryName } from "@/lib/countries";
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

function BreakdownList({ title, breakdown, label = (k) => k }: { title: string; breakdown?: Breakdown; label?: (key: string) => string }) {
  if (!breakdown || Object.keys(breakdown).length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{title}</h3>
      <ul className="text-sm text-gray-700 space-y-0.5">
        {rows(breakdown, label).map((r) => (
          <li key={r.key} className="flex justify-between gap-3">
            <span className={r.key === NOT_GIVEN ? "text-gray-400" : ""}>{r.label}</span>
            <span className="tabular-nums">{r.n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Figure({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2" title={hint}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-900 tabular-nums">{value}</p>
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Figure label="Sign-ins" value={signins} />
        {event.headcount !== null ? (
          <Figure label="Counted by the OC" value={event.headcount} hint="People the OC counted at the event, entered with the sign-off" />
        ) : (
          <div className="rounded-lg border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-500">The OC enters a headcount when signing the list off.</div>
        )}
        {(stats?.kiosk ?? 0) > 0 && <Figure label="On the OC's phone (kiosk)" value={stats!.kiosk} hint="Signed in on the organiser's device instead of their own" />}
        {signins > 0 && (
          <Figure
            label={signins === 1 || time(stats!.first_signin) === time(stats!.last_signin) ? "Signed in at" : "First – last sign-in"}
            value={time(stats!.first_signin) === time(stats!.last_signin) ? time(stats!.first_signin) : `${time(stats!.first_signin)}–${time(stats!.last_signin)}`}
          />
        )}
      </div>

      {event.headcount !== null && event.headcount !== signins && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          {event.headcount > signins
            ? `${event.headcount - signins} counted ${event.headcount - signins === 1 ? "person has" : "people have"} not signed in.`
            : `${signins - event.headcount} more sign-ins than people counted.`}
        </p>
      )}

      {hasBreakdown ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
