"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { checkInInternal } from "@/app/actions/internal";
import { describeError } from "@/components/ActionButton";
import { Card, CardContent, buttonVariants } from "@/components/ui";

/** Checks in with the scanned token once the page is open (an action, not on render). */
export function CheckIn({ eventId, title, token, back }: { eventId: string; title: string; token: string | null; back: string }) {
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const sent = useRef(false);
  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    checkInInternal({ internal_event_id: eventId, token }).then((r) =>
      setState(r.ok ? { ok: true, text: r.data.result === "already" ? "You were already checked in ✓" : "You are checked in ✓" } : { ok: false, text: describeError(r) ?? "That did not work." })
    );
  }, [eventId, token]);

  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="space-y-4 py-8 text-center">
        <p className="text-sm text-gray-500">{title}</p>
        {!token ? (
          <p className="text-gray-700">Scan the QR code on HR&apos;s screen, or type its four digits on the meeting&apos;s page.</p>
        ) : !state ? (
          <p className="text-gray-500">Checking you in …</p>
        ) : (
          <p className={state.ok ? "text-2xl font-semibold text-emerald-700" : "text-lg text-amber-800"} data-testid="checkin-result">
            {state.text}
          </p>
        )}
        <Link href={back} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Open the meeting
        </Link>
      </CardContent>
    </Card>
  );
}
