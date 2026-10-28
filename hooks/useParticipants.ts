"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { Participant } from "@/types/attendance";

const COLUMNS = "id, event_id, first_name, last_name, entry_method, recorded_by, notice_version, terms_version, created_at";

/** `a` plus the rows of `b` it does not have yet, in sign-in order. */
function merge(a: Participant[], b: Participant[]) {
  const ids = new Set(a.map((p) => p.id));
  const added = b.filter((p) => !ids.has(p.id));
  if (added.length === 0) return a;
  return [...a, ...added].sort((x, y) => x.created_at.localeCompare(y.created_at));
}

/**
 * The event's sign-ins, live. Empty when the viewer may not see the names
 * (closed list, not an executive) – the database decides.
 */
export function useParticipants(eventId: string) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchParticipants() {
      const { data, error } = await supabase
        .from("participants")
        .select(COLUMNS)
        .eq("event_id", eventId)
        .order("created_at", { ascending: true });

      if (!error && data) {
        setParticipants((prev) => merge(prev, data as Participant[]));
      }
      setLoading(false);
    }

    fetchParticipants();

    const channel = supabase
      .channel(`participants:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "participants",
          filter: `event_id=eq.${eventId}`,
        },
        (payload) => {
          setParticipants((prev) => merge(prev, [payload.new as Participant]));
        }
      )
      // Live updates only start once realtime confirms the subscription;
      // fetch again then so a sign-in in between is not missed.
      .on("system", {}, (payload) => {
        if (payload.extension === "postgres_changes" && payload.status === "ok") {
          fetchParticipants();
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId]);

  return { participants, loading };
}
