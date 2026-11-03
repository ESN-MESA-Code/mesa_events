"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { checkinCode } from "@/app/actions/internal";
import { describeError } from "@/components/ActionButton";
import { checkinUrl } from "@/lib/internalAttendance";

/** Fetches the current code at each change (every 20 seconds) and shows it as large as the screen allows. */
export function CheckinScreen({ eventId, title, base }: { eventId: string; title: string; base: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [code, setCode] = useState<{ token: string; code: string; secondsLeft: number; count: number } | null>(null);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let timer: number;
    let alive = true;
    const load = async () => {
      const r = await checkinCode({ internal_event_id: eventId });
      if (!alive) return;
      if (!r.ok) {
        setError(describeError(r));
        setCode(null);
        timer = window.setTimeout(load, 10_000);
        return;
      }
      setError(null);
      setCode(r.data);
      setLeft(r.data.secondsLeft);
      // A moment after the next change, so the server already has the new window.
      timer = window.setTimeout(load, r.data.secondsLeft * 1000 + 300);
    };
    load();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [eventId]);

  // The countdown under the code.
  useEffect(() => {
    const t = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!code || !canvas.current) return;
    const size = Math.min(window.innerWidth * 0.8, window.innerHeight * 0.62);
    QRCode.toCanvas(canvas.current, checkinUrl(base, eventId, code.token), { width: size, margin: 2 });
  }, [code, base, eventId]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white p-6 text-center" data-testid="checkin-screen">
      <h1 className="text-2xl font-semibold text-gray-900 sm:text-3xl">Check in: {title}</h1>
      {error ? (
        <p className="max-w-md text-lg text-amber-800">{error}</p>
      ) : !code ? (
        <p className="text-gray-500">Loading the code …</p>
      ) : (
        <>
          <canvas ref={canvas} aria-label="Check-in QR code" />
          <p className="text-gray-600">Scan with your phone camera – or open the meeting in MESA Events and type</p>
          <p className="font-mono text-6xl font-bold tracking-[0.3em] text-esn-dark" data-testid="checkin-digits">
            {code.code}
          </p>
          <p className="text-sm text-gray-500">
            New code in {left} s · {code.count} checked in
          </p>
        </>
      )}
    </main>
  );
}
