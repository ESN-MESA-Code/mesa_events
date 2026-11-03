"use client";

// The attendance of a Tuesday Talk or internal event (round 2026-11-03 (2)):
// members check in with the four digits on HR's screen (or by scanning its
// QR code); HR shows the code, sees who checked in, adds or takes back
// anyone and closes the list. The executive board reads it.
import { useState } from "react";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, Select, buttonVariants } from "@/components/ui";
import { ActionButton, useAction } from "@/components/ActionButton";
import { checkInInternal, closeInternalAttendance, markInternalAttendance } from "@/app/actions/internal";
import type { CheckinState } from "@/lib/internalAttendance";
import { cn } from "@/lib/utils";

export interface AttendanceEntry {
  profileId: string;
  name: string;
  via: "qr" | "code" | "hr";
  addedBy: string;
  at: string;
  removedAt: string | null;
  removedBy: string | null;
}

const VIA: Record<AttendanceEntry["via"], string> = { qr: "scanned", code: "typed the code", hr: "added by HR" };

export function AttendanceCard({
  eventId,
  state,
  opensLabel,
  closesLabel,
  closedBy,
  planner,
  seesAll,
  mine,
  entries,
  members,
}: {
  eventId: string;
  state: CheckinState;
  opensLabel: string;
  closesLabel: string;
  closedBy: string | null;
  planner: boolean;
  /** Planners and the executive board see everyone; a member only themself. */
  seesAll: boolean;
  mine: AttendanceEntry | null;
  entries: AttendanceEntry[];
  members: Array<{ id: string; name: string }>;
}) {
  const present = entries.filter((e) => !e.removedAt);
  const removed = entries.filter((e) => e.removedAt);
  return (
    <Card data-testid="attendance">
      <CardHeader>
        <CardTitle>Attendance</CardTitle>
        {seesAll && <Badge tone={present.length ? "blue" : "gray"}>{present.length} here</Badge>}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <MyCheckIn eventId={eventId} state={state} opensLabel={opensLabel} mine={mine} />
        {planner && <PlannerControls eventId={eventId} state={state} opensLabel={opensLabel} closesLabel={closesLabel} closedBy={closedBy} present={present} members={members} />}
        {seesAll && (
          <>
            {!present.length ? (
              <EmptyState>Nobody checked in yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-gray-100" data-testid="attendance-list">
                {present.map((e) => (
                  <li key={e.profileId} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
                    <span className="font-medium text-gray-900">{e.name}</span>
                    <span className="text-xs text-gray-500">
                      {VIA[e.via]} · {e.at}
                    </span>
                    {planner && (
                      <ActionButton
                        action={markInternalAttendance}
                        input={{ internal_event_id: eventId, profile_id: e.profileId, present: false }}
                        variant="ghost"
                        className="ml-auto"
                        confirm={`Take back the check-in of ${e.name}?`}
                      >
                        Remove
                      </ActionButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {removed.length > 0 && (
              <details className="text-xs text-gray-600">
                <summary className="cursor-pointer">Taken back ({removed.length})</summary>
                <ul className="mt-1 space-y-1">
                  {removed.map((e) => (
                    <li key={e.profileId}>
                      {e.name} – by {e.removedBy}, {e.removedAt}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The member's own check-in: the four digits from HR's screen. */
function MyCheckIn({ eventId, state, opensLabel, mine }: { eventId: string; state: CheckinState; opensLabel: string; mine: AttendanceEntry | null }) {
  const { run, pending, error } = useAction();
  const [code, setCode] = useState("");
  if (mine && !mine.removedAt) return <p className="font-medium text-emerald-700" data-testid="checked-in">You are checked in ✓</p>;
  if (mine?.removedAt) return <p className="text-amber-800">HR took your check-in back – ask HR if that is wrong.</p>;
  if (state === "before") return <p className="text-gray-600">Checking in opens {opensLabel} – scan the code on HR&apos;s screen, or type its four digits here.</p>;
  if (state !== "open") return <p className="text-gray-600">{state === "cancelled" ? "This date is cancelled." : "Checking in is closed."}</p>;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(checkInInternal, { internal_event_id: eventId, code }, () => setCode(""), "Checked in ✓");
      }}
      data-testid="checkin-form"
    >
      <label className="space-y-1">
        <span className="block text-xs text-gray-600">Scan the QR code on HR&apos;s screen, or type its four digits</span>
        <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" autoComplete="off" placeholder="0000" aria-label="Check-in code" className="w-28 text-center font-mono text-lg tracking-widest" />
      </label>
      <Button disabled={pending || code.length !== 4}>Check in</Button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </form>
  );
}

/** HR: the screen with the code, adding someone, closing the list. */
function PlannerControls({
  eventId,
  state,
  opensLabel,
  closesLabel,
  closedBy,
  present,
  members,
}: {
  eventId: string;
  state: CheckinState;
  opensLabel: string;
  closesLabel: string;
  closedBy: string | null;
  present: AttendanceEntry[];
  members: Array<{ id: string; name: string }>;
}) {
  const { run, pending, error } = useAction();
  const [who, setWho] = useState("");
  const here = new Set(present.map((p) => p.profileId));
  const addable = members.filter((m) => !here.has(m.id));
  return (
    <div className="space-y-3 rounded-lg border border-esn/20 bg-esn/5 p-3" data-testid="attendance-hr">
      <div className="flex flex-wrap items-center gap-2">
        {state === "open" ? (
          <a href={`/checkin-screen/${eventId}`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: "sm" })} data-testid="show-code">
            Show the check-in code ↗
          </a>
        ) : (
          <span className="text-gray-700">
            {state === "before" ? `The check-in code can be shown from ${opensLabel}.` : state === "closed" ? `Closed${closedBy ? ` by ${closedBy}` : ""}.` : state === "after" ? `Checking in ended ${closesLabel}.` : "Cancelled."}
          </span>
        )}
        {state === "closed" ? (
          <ActionButton action={closeInternalAttendance} input={{ internal_event_id: eventId, closed: false }} variant="outline" className="ml-auto">
            Reopen
          </ActionButton>
        ) : (
          state !== "cancelled" && (
            <ActionButton action={closeInternalAttendance} input={{ internal_event_id: eventId, closed: true }} variant="outline" className="ml-auto" confirm="Close the list? Nobody can check in any more; you can still add and remove people.">
              Close the list
            </ActionButton>
          )
        )}
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (who) run(markInternalAttendance, { internal_event_id: eventId, profile_id: who, present: true }, () => setWho(""));
        }}
      >
        <Select aria-label="Add someone" value={who} onChange={(e) => setWho(e.target.value)} className={cn("h-9 min-w-0 flex-1")}>
          <option value="">Add someone (phone died, no camera …)</option>
          {addable.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="outline" disabled={pending || !who}>
          Add
        </Button>
      </form>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
