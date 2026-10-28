"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import AttendanceForm from "@/components/attendance/AttendanceForm";
import type { FormTexts, PublicEvent } from "@/types/attendance";

/** The public form at /event/[token]: looks the event up by its QR code token. */
export default function AttendancePage({ texts }: { texts: FormTexts }) {
  const { token } = useParams<{ token: string }>();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchEvent() {
      // Events are private; this returns only the title, date, risk notice and
      // sign-in window of the one event whose QR code token matches.
      const { data, error } = await supabase.rpc("get_public_event", { token });
      const found = (data as PublicEvent[] | null)?.[0];
      if (!error && found) setEvent(found);
      setLoading(false);
    }
    fetchEvent();
  }, [token]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Loading event…</p>
      </main>
    );
  }

  if (!event) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 font-medium">Event not found.</p>
          <p className="text-gray-400 text-sm mt-1">This link may be invalid or expired.</p>
        </div>
      </main>
    );
  }

  return <AttendanceForm event={event} texts={texts} />;
}
