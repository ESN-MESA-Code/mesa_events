"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AttendanceForm from "@/components/attendance/AttendanceForm";
import { listState, signinsCloseAt, signinsOpenAt } from "@/lib/attendance/window";
import type { Event, FormTexts } from "@/types/attendance";

// How long the exit button must be held, so participants don't leave by accident.
const EXIT_HOLD_MS = 1500;

interface Props {
  event: Event;
  recordedBy: string;
  texts: FormTexts;
}

export default function KioskView({ event, recordedBy, texts }: Props) {
  const router = useRouter();
  // Changing the key remounts the form: empty fields for the next person.
  const [round, setRound] = useState(0);
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNext = useCallback(() => {
    setRound((r) => r + 1);
    window.scrollTo(0, 0);
  }, []);

  function startHold() {
    setHolding(true);
    holdTimer.current = setTimeout(() => {
      router.push(`/events/${event.id}/attendance`);
    }, EXIT_HOLD_MS);
  }

  function cancelHold() {
    setHolding(false);
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }

  return (
    <>
      <div className="bg-gray-900 text-white text-xs px-4 py-2 flex items-center gap-3">
        <span className="font-medium">Organiser device</span>
        <span className="opacity-70 truncate">Signed in as {recordedBy}</span>
        <button
          type="button"
          onPointerDown={startHold}
          onPointerUp={cancelHold}
          onPointerLeave={cancelHold}
          onPointerCancel={cancelHold}
          onContextMenu={(e) => e.preventDefault()}
          className="relative ml-auto shrink-0 overflow-hidden rounded border border-white/30 px-3 py-1 select-none touch-none"
        >
          <span
            className="absolute inset-y-0 left-0 bg-white/30"
            style={{
              width: holding ? "100%" : "0%",
              transition: holding ? `width ${EXIT_HOLD_MS}ms linear` : "none",
            }}
          />
          <span className="relative">Hold to exit</span>
        </button>
      </div>

      <AttendanceForm
        key={round}
        event={{
          id: event.id,
          title: event.title,
          event_date: event.event_date,
          risk_notice: event.risk_notice,
          opens_at: signinsOpenAt(event.event_date).toISOString(),
          closes_at: signinsCloseAt(event.event_date).toISOString(),
          closed: listState(event) === "closed",
        }}
        texts={texts}
        kiosk={{ recordedBy, onNext: handleNext }}
      />
    </>
  );
}
