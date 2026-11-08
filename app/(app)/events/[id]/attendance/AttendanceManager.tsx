"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { useParticipants } from "@/hooks/useParticipants";
import QRCodeDisplay from "@/components/attendance/QRCodeDisplay";
import AttendanceTable from "@/components/attendance/AttendanceTable";
import EventSummary from "@/components/attendance/EventSummary";
import { OPENS_BEFORE_MS, listState, signinsOpenAt } from "@/lib/attendance/window";
import { formatDateTime } from "@/lib/dates";
import { BarChart3, CalendarClock, Check, CheckCircle2, EyeOff, Flag, Link2, Lock, PenLine, QrCode, Radio, ShieldAlert, Smartphone, Users } from "lucide-react";
import { Alert, Button, Input, Textarea, buttonVariants } from "@/components/ui";
import { Panel } from "@/components/Panel";
import { ProgressTrack, type TrackStep } from "@/components/EventKit";
import { cn } from "@/lib/utils";
import { useAction } from "@/components/ActionButton";
import { setRiskNotice, signOffList } from "@/app/actions/attendance";
import type { Event, EventStats } from "@/types/attendance";
import { plural } from "@/lib/plural";

// MESAttendance's event page, inside the event: the list's state, sign-off,
// summary for Finance, QR code and kiosk, and the live names.
export function AttendanceManager({
  event,
  canSignOff,
  canOrganise,
  ocEmail,
  isExecutive,
  attendanceUrl,
}: {
  event: Event;
  canSignOff: boolean;
  canOrganise: boolean;
  ocEmail: string | null;
  isExecutive: boolean;
  /** The public sign-in form's absolute address, from the server (usability review #24: no hydration mismatch). */
  attendanceUrl: string;
}) {
  const { participants, loading: loadingParticipants, error: participantsError, live } = useParticipants(event.id);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [signingOff, setSigningOff] = useState(false);
  const [headcount, setHeadcount] = useState("");
  const [riskOpen, setRiskOpen] = useState(false);
  const [risk, setRisk] = useState(event.risk_notice ?? "");
  const [copied, setCopied] = useState(false);
  const [, setTick] = useState(0);
  const { run, pending, error, setError, confirm } = useAction();

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
  const locked = (stats?.signins ?? 0) > 0;
  const finishBelow = state === "open" && canSignOff && !event.signed_off_at;

  // Closing the list cannot be undone: the dialog says how many signed in (usability review #6).
  const signOffForm = (
    <form
      className="space-y-3 rounded-xl border border-esn/20 bg-esn/5 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const counted = Number(headcount);
        if (headcount.trim() === "" || !Number.isInteger(counted) || counted < 0 || counted > 10000) {
          setError("Please enter how many people you counted.");
          return;
        }
        const signins = stats?.signins ?? participants.length;
        const ok = await confirm({
          title: `Close the list with ${plural(signins, "sign-in")}?`,
          body: `You counted ${counted}. Participants can't sign in afterwards, and only executives see the names from then on.`,
          confirmLabel: "Sign off & close",
          danger: state === "open",
        });
        if (ok) run(signOffList, { event_id: event.id, headcount: counted }, () => setSigningOff(false), "Attendance list signed off.");
      }}
    >
      <p className="text-sm font-semibold text-gray-900">Finish the event and sign the list off</p>
      <p className="text-xs text-gray-600">After the sign-off nobody can sign in any more, and only executives see the names from then on.</p>
      <label className="block">
        <span className="block text-sm font-medium text-gray-700 mb-1">How many people did you count at the event?</span>
        <Input type="number" inputMode="numeric" min={0} max={10000} value={headcount} onChange={(e) => setHeadcount(e.target.value)} className="w-32" />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending}>{pending ? "Signing off…" : "Sign off & close sign-ins"}</Button>
        <Button type="button" variant="outline" onClick={() => setSigningOff(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Could not copy – copy the address from the browser instead.");
    }
  }

  const opensAt = formatDateTime(signinsOpenAt(event.event_date).toISOString());
  const signedOff = !!event.signed_off_at;
  const hero = signedOff
    ? { icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-600", title: "Attendance list signed off", text: `on ${formatDateTime(event.signed_off_at!)} by ${event.signed_off_by} · ${event.headcount} counted` }
    : state === "upcoming"
      ? { icon: CalendarClock, tone: "bg-esn/5 text-esn", title: `Sign-ins open ${opensAt}`, text: "Participants scan the QR code at the event. You sign the list off afterwards." }
      : state === "open"
        ? { icon: Radio, tone: "bg-emerald-50 text-emerald-600", title: "Participants can sign in now", text: "Show the QR code at the start. Sign the list off once the event is over – otherwise it closes 24 hours after the start." }
        : {
            icon: Lock,
            tone: "bg-amber-50 text-amber-700",
            title: "Sign-ins are closed",
            text: canSignOff ? "Enter how many people you counted and sign the list off – Finance needs the headcount." : `Only the OC${ocEmail ? ` (${ocEmail})` : ""} can sign this list off.`,
          };
  const HeroIcon = hero.icon;
  const track: TrackStep[] = [
    { label: "Sign-ins open", note: state === "upcoming" ? opensAt : `${plural(OPENS_BEFORE_MS / 3_600_000, "hour")} before`, state: state === "upcoming" ? "current" : "done" },
    { label: "Event", note: formatDateTime(event.event_date), state: state === "upcoming" ? "todo" : state === "open" ? "current" : "done" },
    { label: "Signed off", note: signedOff ? `${event.headcount} counted` : "by the OC", state: signedOff ? "done" : state === "closed" ? "current" : "todo" },
  ];
  const side = canOrganise || finishBelow;

  return (
    <div className="space-y-5">
      {/* Where the list stands, with its one action (redesign 2026-11-08). The next step's anchor: the finish card while sign-ins run. */}
      <section id={finishBelow ? undefined : "sign-off"} aria-label="Attendance list" className="scroll-mt-4 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-start gap-4 p-4 sm:p-5">
          <span className={cn("relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", hero.tone)} aria-hidden="true">
            <HeroIcon className="h-6 w-6" />
            {state === "open" && !signedOff && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500 ring-2 ring-white" />}
          </span>
          <div className="min-w-0 flex-1">
            <span
              data-testid="list-state"
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                signedOff ? "bg-emerald-50 text-emerald-800" : state === "open" ? "bg-emerald-600 text-white" : state === "upcoming" ? "bg-esn/10 text-esn" : "border border-amber-200 bg-amber-50 text-amber-800"
              )}
            >
              {signedOff ? "✓ Signed off" : state === "open" ? "Open for sign-ins" : state === "upcoming" ? "Not open yet" : "Closed – awaiting sign-off"}
            </span>
            <h2 className="mt-1.5 text-lg font-bold text-gray-900">{hero.title}</h2>
            <p className="text-sm text-gray-600">{hero.text}</p>
          </div>
          {state === "closed" && canSignOff && !signedOff && !signingOff && (
            <Button onClick={() => setSigningOff(true)} className="w-full sm:w-auto">
              <PenLine className="h-4 w-4" aria-hidden="true" />
              Finish &amp; sign off
            </Button>
          )}
        </div>
        {/* Before and during the event there is nothing to sign off here; finishing sits further down (usability review #6). */}
        {signingOff && state === "closed" && <div className="border-t border-gray-100 p-4 sm:p-5">{signOffForm}</div>}
        <div className="border-t border-gray-100 bg-gray-50/60 px-2 py-4 sm:px-6">
          <ProgressTrack steps={track} label="Attendance list steps" className="mx-auto max-w-xl" />
        </div>
        {(event.risk_notice || (canOrganise && !locked && !signedOff) || error) && (
          <div className="space-y-3 border-t border-gray-100 px-4 py-3 sm:px-5">
            {event.risk_notice && !riskOpen && (
              <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold">Risk notice</p>
                  <p className="text-sm whitespace-pre-line">{event.risk_notice}</p>
                </div>
              </div>
            )}
            {canOrganise &&
              !locked &&
              !signedOff &&
              (riskOpen ? (
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
                <Button size="sm" variant="ghost" className="-ml-2" onClick={() => setRiskOpen(true)}>
                  {event.risk_notice ? "Edit risk notice" : "+ Risk notice (e.g. for hikes)"}
                </Button>
              ))}
            {error && <Alert tone="error">{error}</Alert>}
          </div>
        )}
      </section>

      <div className={cn("grid items-start gap-5", side && "lg:grid-cols-[minmax(0,1fr)_20rem]")}>
        <div className="min-w-0 space-y-5">
          <Panel
            title="Summary"
            icon={BarChart3}
            description="Finance sees these counts, not the names."
            aside={
              <Button size="sm" variant="outline" onClick={copyLink}>
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Link2 className="h-3.5 w-3.5" aria-hidden="true" />}
                {copied ? "Link copied" : "Copy link for finance"}
              </Button>
            }
          >
            <EventSummary event={event} stats={stats} />
          </Panel>

          <Panel
            title="Participants"
            icon={Users}
            count={stats?.signins ?? participants.length}
            countTone="blue"
            aside={isExecutive && state === "closed" ? <span className="text-xs text-gray-500">Visible to you as an executive</span> : state === "open" && live ? <LiveDot /> : undefined}
          >
            {!canSeeNames || (!canOrganise && !isExecutive) ? (
              <p className="flex flex-col items-center gap-2 py-6 text-center text-sm text-gray-500">
                <EyeOff className="h-5 w-5 text-gray-300" aria-hidden="true" />
                {state === "closed" ? "The list is closed: only executives see the names now." : "Only the event's OC and helpers see the names."}
              </p>
            ) : loadingParticipants ? (
              <p className="text-sm text-gray-500">Loading participants…</p>
            ) : (
              <>
                {participantsError && (
                  <Alert tone="error" className="mb-3">
                    {participantsError}
                  </Alert>
                )}
                {!live && state === "open" && !participantsError && <p className="mb-2 text-xs text-gray-500">No live connection – the list updates every 15 seconds.</p>}
                <AttendanceTable participants={participants} />
              </>
            )}
          </Panel>
        </div>

        {/* On phones the QR code comes first while it is needed. */}
        {side && (
          <div className={cn("space-y-5 lg:sticky lg:top-4", state !== "closed" && "order-first lg:order-none")}>
            {canOrganise && (
              <Panel title="Attendance QR code" icon={QrCode}>
                {state === "closed" ? (
                  <p className="flex flex-col items-center gap-2 py-4 text-center text-sm text-gray-600">
                    <Lock className="h-5 w-5 text-gray-300" aria-hidden="true" />
                    Sign-ins are closed – {event.signed_off_at ? "the attendance list was signed off." : "the event ended more than 24 hours ago."}
                  </p>
                ) : (
                  <div className="flex flex-col items-center">
                    {state === "upcoming" && <p className="mb-4 w-full rounded-lg border border-esn/20 bg-esn/5 px-3 py-2 text-center text-sm text-esn-dark">Sign-ins open at {opensAt}.</p>}
                    <QRCodeDisplay url={attendanceUrl} size={200} title={event.title} />
                    {state === "open" && (
                      <div className="mt-4 w-full border-t border-gray-100 pt-4 text-center">
                        <Link href={`/kiosk/${event.id}`} className={cn(buttonVariants(), "w-full")}>
                          <Smartphone className="h-4 w-4" aria-hidden="true" />
                          Sign in on this device
                        </Link>
                        <p className="mt-2 text-xs text-gray-500">For participants without a phone or internet: opens the form on your device and clears it after each person.</p>
                      </div>
                    )}
                  </div>
                )}
              </Panel>
            )}

            {finishBelow && (
              <section id="sign-off" aria-label="Event over?" className="scroll-mt-4 space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5" data-testid="finish-card">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-esn/5 text-esn" aria-hidden="true">
                    <Flag className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-gray-900">Event over?</h2>
                    <p className="text-sm text-gray-600">Signing off closes the list – nobody can sign in afterwards. Otherwise it closes 24 hours after the start.</p>
                  </div>
                </div>
                {signingOff ? (
                  signOffForm
                ) : (
                  <Button variant="outline" className="w-full" onClick={() => setSigningOff(true)}>
                    Finish &amp; sign off
                  </Button>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The list follows sign-ins as they happen. */
function LiveDot() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
      <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
      Live
    </span>
  );
}
