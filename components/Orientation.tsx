"use client";

// "How MESA events work" on Home for members without any event yet
// (usability review #14). Dismissed per browser – a convenience, so it
// shows again where storage is unavailable.
import { useEffect, useState } from "react";
import Link from "next/link";

const KEY = "mesa-orientation-dismissed";

export function OrientationCard({ hasPayout }: { hasPayout: boolean }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the browser's storage once
      if (localStorage.getItem(KEY)) setHidden(true);
    } catch {
      // Storage blocked: keep showing it.
    }
  }, []);
  if (hidden) return null;
  return (
    <section aria-labelledby="orientation-title" className="rounded-xl border border-esn/30 bg-white p-4 shadow-sm" data-testid="orientation">
      <div className="flex items-start gap-3">
        <h2 id="orientation-title" className="mr-auto text-base font-semibold text-gray-900">
          How MESA events work
        </h2>
        <button
          type="button"
          className="text-sm text-gray-500 hover:text-gray-800"
          onClick={() => {
            setHidden(true);
            try {
              localStorage.setItem(KEY, "1");
            } catch {
              // Not remembered; it shows again next time.
            }
          }}
        >
          Got it, hide this
        </button>
      </div>
      <ol className="mt-3 grid gap-3 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-4 list-decimal list-inside">
        <li>
          <strong>Propose an idea</strong> under Ideas. The Events team builds each month&apos;s schedule from them – you become the OC of your idea by default.
        </li>
        <li>
          <strong>Fill in the volunteer form</strong> each month: pick the events you can do, as <strong>OC</strong> or <strong>helper</strong>. You submit once.
        </li>
        <li>
          <strong>The roster</strong> is allocated after the deadline: every event gets an OC first, then everyone gets one event before anyone gets a second. Your events then show up here.
        </li>
        <li>
          <strong>OC</strong> = owns the event: description, attendance list, hand-in. <strong>Helper</strong> = helps on the day. Missed the form? Claim an <strong>open slot</strong> any time.
        </li>
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <Link href="/ideas" className="text-esn hover:underline">
          Propose an idea →
        </Link>
        {!hasPayout && (
          <span className="text-xs text-gray-600">
            No payout details yet.{" "}
            <Link href="/me/reimbursements#payout" className="text-esn hover:underline">
              Add your IBAN or PayPal
            </Link>{" "}
            so Finance can pay you back what you spend for an event.
          </span>
        )}
      </div>
    </section>
  );
}
