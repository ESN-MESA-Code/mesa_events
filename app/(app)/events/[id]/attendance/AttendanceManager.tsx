"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { useParticipants } from "@/hooks/useParticipants";
import QRCodeDisplay from "@/components/attendance/QRCodeDisplay";
import AttendanceTable from "@/components/attendance/AttendanceTable";
import EventSummary from "@/components/attendance/EventSummary";
import { formatDateTime, listState, signinsOpenAt } from "@/lib/attendance/window";
import { Alert, Button, Card, Input, Textarea } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { setRiskNotice, signOffList } from "@/app/actions/attendance";
import type { Event, EventStats } from "@/types/attendance";

// MESAttendance's event page, inside the event: the list's state, sign-off,
// summary for Finance, QR code and kiosk, and the live names.
export function AttendanceManager({
  event,
  canSignOff,
  canOrganise,
  ocEmail,
  isExecutive,
}: {
  event: Event;
  canSignOff: boolean;
  canOrganise: boolean;
  ocEmail: string | null;
  isExecutive: boolean;
}) {
  const { participants, loading: loadingParticipants } = useParticipants(event.id);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [signingOff, setSigningOff] = useState(false);
  const [headcount, setHeadcount] = useState("");
  const [riskOpen, setRiskOpen] = useState(false);
  const [risk, setRisk] = useState(event.risk_notice ?? "");
  const [copied, setCopied] = useState(false);
  const [, setTick] = useState(0);
  const { run, pending, error, setError } = useAction();

  const fetchStats = useCallback(async () => {
    const { data } = await supabase.rpc("event_summary", { event: event.id });
    setStats((data as EventStats | null) ?? null);
  }, [event.id]);

  // Re-render every minute, so the page follows the sign-in window.
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  // The counts follow the live list and the sign-off.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetches, then sets
    fetchStats();
  }, [fetchStats, participants.length, event.signed_off_at]);

  const state = listState(event);
  const canSeeNames = state !== "closed" || isExecutive;
  const attendanceUrl = typeof window !== "undefined" ? `${window.location.origin}/event/${event.public_token}` : `/event/${event.public_token}`;
  const locked = (stats?.signins ?? 0) > 0;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Could not copy – copy the address from the browser instead.");
    }
  }

  return (
    <div className="space-y-6">
      <Card id="sign-off" className="p-5 space-y-3 scroll-mt-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span
            data-testid="list-state"
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${event.signed_off_at ? "bg-esn/10 text-esn" : "bg-amber-50 text-amber-800 border border-amber-200"}`}
          >
            {event.signed_off_at ? "✓ Signed off" : state === "open" ? "Open for sign-ins" : state === "upcoming" ? "Not open yet" : "Closed – awaiting sign-off"}
          </span>
          {event.signed_off_at ? (
            <span className="text-xs text-gray-500">
              on {formatDateTime(event.signed_off_at)} by {event.signed_off_by} · {event.headcount} counted
            </span>
          ) : canSignOff ? (
            !signingOff && (
              <Button size="sm" onClick={() => setSigningOff(true)}>
                Finish &amp; sign off
              </Button>
            )
          ) : (
            <span className="text-xs text-gray-500">Only the OC{ocEmail ? ` (${ocEmail})` : ""} can sign this list off.</span>
          )}
        </div>
        {signingOff && (
          <form
            className="rounded-lg border border-esn/30 bg-esn/5 p-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const counted = Number(headcount);
              if (headcount.trim() === "" || !Number.isInteger(counted) || counted < 0 || counted > 10000) {
                setError("Please enter how many people you counted.");
                return;
              }
              run(signOffList, { event_id: event.id, headcount: counted }, () => setSigningOff(false));
            }}
          >
            <p className="text-sm font-semibold text-gray-900">Finish the event and sign the list off</p>
            <p className="text-xs text-gray-600">After the sign-off nobody can sign in any more, and only executives see the names from then on.</p>
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 mb-1">How many people did you count at the event?</span>
              <Input type="number" inputMode="numeric" min={0} max={10000} value={headcount} onChange={(e) => setHeadcount(e.target.value)} className="w-32" />
            </label>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setSigningOff(false)}>
                Cancel
              </Button>
              <Button disabled={pending}>{pending ? "Signing off…" : "Sign off & close sign-ins"}</Button>
            </div>
          </form>
        )}

        {event.risk_notice && !riskOpen && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-xs font-semibold text-amber-900">Risk notice</p>
            <p className="text-sm text-amber-900 whitespace-pre-line">{event.risk_notice}</p>
          </div>
        )}
        {canOrganise && !locked && !event.signed_off_at && (
          riskOpen ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(setRiskNotice, { event_id: event.id, risk_notice: risk }, () => setRiskOpen(false));
              }}
            >
              <Textarea aria-label="Risk notice" rows={3} value={risk} onChange={(e) => setRisk(e.target.value)} placeholder="e.g. Mountain hike, 4 hours, steep paths. Bring hiking boots." />
              <div className="flex gap-2">
                <Button size="sm" disabled={pending}>
                  Save risk notice
                </Button>
                <Button size="sm" type="button" variant="ghost" onClick={() => setRiskOpen(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setRiskOpen(true)}>
              {event.risk_notice ? "Edit risk notice" : "+ Risk notice (e.g. for hikes)"}
            </Button>
          )
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </Card>

      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Summary</h2>
          <Button size="sm" variant="outline" onClick={copyLink}>
            {copied ? "✓ Link copied" : "Copy link for finance"}
          </Button>
        </div>
        <EventSummary event={event} stats={stats} />
        <p className="text-xs text-gray-400">Finance sees these counts, not the names.</p>
      </Card>

      {canOrganise && (
        <Card className="p-5 flex flex-col items-center">
          <h2 className="text-lg font-semibold mb-4 self-start">Attendance QR code</h2>
          {state === "closed" ? (
            <p className="text-sm text-gray-600 py-6 text-center">
              🔒 Sign-ins are closed – {event.signed_off_at ? "the attendance list was signed off." : "the event ended more than 24 hours ago."}
            </p>
          ) : (
            <>
              {state === "upcoming" && (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4 text-center">
                  Sign-ins open at {formatDateTime(signinsOpenAt(event.event_date))}.
                </p>
              )}
              <QRCodeDisplay url={attendanceUrl} size={220} />
              {state === "open" && (
                <div className="mt-6 pt-4 border-t border-gray-200 w-full text-center">
                  <Link href={`/kiosk/${event.id}`} className="inline-block bg-esn text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-esn-dark">
                    Sign in on this device
                  </Link>
                  <p className="text-xs text-gray-400 mt-2">For participants without a phone or internet: opens the form on your device and clears it after each person.</p>
                </div>
              )}
            </>
          )}
        </Card>
      )}

      <Card className="p-2 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4 px-1 pt-1 sm:p-0">
          <h2 className="text-lg font-semibold">
            Participants <span className="text-gray-400 font-normal text-base">({stats?.signins ?? participants.length})</span>
          </h2>
          {isExecutive && state === "closed" && <span className="text-xs text-gray-500">Visible to you as an executive</span>}
        </div>
        {!canSeeNames || (!canOrganise && !isExecutive) ? (
          <p className="text-gray-500 text-sm py-4 text-center">
            {state === "closed" ? "The list is closed: only executives see the names now." : "Only the event's OC and helpers see the names."}
          </p>
        ) : loadingParticipants ? (
          <p className="text-gray-500 text-sm">Loading participants…</p>
        ) : (
          <AttendanceTable participants={participants} />
        )}
      </Card>
    </div>
  );
}
