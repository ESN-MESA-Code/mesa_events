// Loads what the ESN form data and status need for some events – with the
// member's client in pages (RLS: Comms, Events, executives read uploads;
// staff and teams read reports) or the service role in the API routes
// (after the token was checked). Server only.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { coerceFields } from "@/lib/description/template";
import { buildEsnFormData, esnStatus, type EsnFormData, type EsnStatus, type EsnUpload, type EventReport } from "@/lib/esn/formData";

export interface EsnEntry {
  data: EsnFormData;
  upload: EsnUpload | null;
  status: EsnStatus;
  report: EventReport | null;
}

export async function loadEsn(db: SupabaseClient<Database>, eventIds: string[]): Promise<Map<string, EsnEntry>> {
  const out = new Map<string, EsnEntry>();
  if (!eventIds.length) return out;
  const [{ data: events, error }, { data: descriptions }, { data: reports }, { data: uploads }] = await Promise.all([
    db.from("events").select("id, title, starts_at, ends_at, location, price_cents").in("id", eventIds),
    db.from("descriptions").select("event_id, status, fields, approved_fields, published_at").in("event_id", eventIds),
    db.from("event_reports").select("*").in("event_id", eventIds),
    db.from("esn_uploads").select("event_id, activity_url, uploaded_at, uploaded_by, via").in("event_id", eventIds),
  ]);
  if (error) throw new Error(error.message);
  const byEvent = <T extends { event_id: string }>(rows: T[] | null) => new Map((rows ?? []).map((r) => [r.event_id, r]));
  const desc = byEvent(descriptions);
  const rep = byEvent(reports);
  const up = byEvent(uploads);
  for (const e of events ?? []) {
    const d = desc.get(e.id);
    // Published once: what Comms approved and published (later edits wait for a new review).
    const published = d?.published_at && d.approved_fields ? coerceFields(d.approved_fields) : null;
    const report = (rep.get(e.id) as EventReport | undefined) ?? null;
    const upload = up.get(e.id) ?? null;
    const data = buildEsnFormData({
      eventId: e.id,
      event: e,
      published,
      classification: d ? coerceFields(d.fields) : null,
      report,
    });
    out.set(e.id, { data, upload, status: esnStatus(data, upload), report });
  }
  return out;
}
