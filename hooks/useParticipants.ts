"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { Participant } from "@/types/attendance";

const COLUMNS = "id, event_id, first_name, last_name, entry_method, recorded_by, notice_version, terms_version, created_at";
/** Without live updates (Realtime down or blocked) the list is fetched this often. */
const POLL_MS = 15_000;

/** `a` plus the rows of `b` it does not have yet, in sign-in order. */
function merge(a: Participant[], b: Participant[]) {
  const ids = new Set(a.map((p) => p.id));
  const added = b.filter((p) => !ids.has(p.id));
  if (added.length === 0) return a;
  return [...a, ...added].sort((x, y) => x.created_at.localeCompare(y.created_at));
}

/**
 * The event's sign-ins, live. Empty when the viewer may not see the names
 * (closed list, not an executive) – the database decides. When Realtime
 * cannot connect, the list is fetched every 15 seconds instead, and a failed
 * fetch is reported rather than "loading" forever (usability review #25).
 */
export function useParticipants(eventId: string) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let poll: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    async function fetchParticipants() {
      try {
        const { data, error } = await supabase.from("participants").select(COLUMNS).eq("event_id", eventId).order("created_at", { ascending: true });
        if (stopped) return;
        if (error) throw error;
        setParticipants((prev) => merge(prev, (data ?? []) as Participant[]));
        setError(null);
      } catch {
        if (!stopped) setError("Could not load the participants – check your connection. Trying again …");
      } finally {
        if (!stopped) setLoading(false);
      }
    }

    function startPolling() {
      if (poll) return;
      setLive(false);
      poll = setInterval(fetchParticipants, POLL_MS);
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
          if (poll) clearInterval(poll);
          poll = null;
          setLive(true);
          fetchParticipants();
        }
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") startPolling();
      });
    // No confirmation within 10 seconds: poll meanwhile.
    const fallback = setTimeout(() => {
      if (!stopped && channel.state !== "joined") startPolling();
    }, 10_000);

    return () => {
      stopped = true;
      clearTimeout(fallback);
      if (poll) clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [eventId]);

  return { participants, loading, error, live };
}
