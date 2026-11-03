// The member's duties at internal events (round 2026-11-03 (2)): office
// hours and Stammtisch where HR made them OC or helper. They sit in My events
// and on Home next to the member's ESN events; the next step comes from the
// time and – for an office hour – its cash box. Pure (tests/unit/myDuties.test.ts).
import type { InternalKind } from "@/lib/internal";

export interface DutyData {
  id: string;
  kind: InternalKind;
  title: string;
  status: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
}

export interface DutyCash {
  openingCountedAt: string | null;
  closedAt: string | null;
}

export interface DutyStep {
  label: string;
  /** action: the member's to do; waiting: nothing to do yet; done. */
  kind: "action" | "waiting" | "done";
  /** Where it is done (the office hour's page with its cash box). */
  cash: boolean;
}

const HOUR = 3_600_000;
/** Without an end, an office hour or Stammtisch counts as two hours long. */
const LENGTH = 2 * HOUR;

export function dutyEnd(d: Pick<DutyData, "starts_at" | "ends_at">): number {
  return d.ends_at ? Date.parse(d.ends_at) : Date.parse(d.starts_at) + LENGTH;
}

/** The times as My events and Home group them (an end is filled in). */
export function dutyTimed(d: Pick<DutyData, "starts_at" | "ends_at">) {
  return { starts_at: d.starts_at, ends_at: d.ends_at ?? new Date(dutyEnd(d)).toISOString() };
}

/**
 * Before: on duty (nothing to do yet). During an office hour: the OC counts
 * the cash box at the start, then counts again and signs it off at the end.
 * After: the OC signs the box off if that is still open; otherwise done.
 * A Stammtisch has no cash box – just the duty.
 */
export function dutyStep(d: DutyData, role: "oc" | "helper", cash: DutyCash | null, now: number): DutyStep {
  const office = d.kind === "office_hour";
  const what = office ? "the office hour" : "the Stammtisch";
  if (d.status === "cancelled") return { label: "Cancelled – no duty", kind: "done", cash: false };
  const started = Date.parse(d.starts_at) <= now;
  const over = dutyEnd(d) <= now;
  const ocBox = office && role === "oc";
  if (!started) return { label: role === "oc" ? `You run ${what}${office ? " – count the cash box at the start" : ""}` : `Help at ${what}`, kind: "waiting", cash: false };
  if (!over) {
    if (ocBox && !cash?.openingCountedAt) return { label: "Count the cash box before you open", kind: "action", cash: true };
    if (ocBox && !cash?.closedAt) return { label: "On duty – count again and sign off the cash box at the end", kind: "waiting", cash: true };
    return { label: "On duty now", kind: "waiting", cash: false };
  }
  if (ocBox && !cash?.closedAt) return { label: "Count and sign off the cash box", kind: "action", cash: true };
  return { label: ocBox ? "Cash box signed off" : "Done – thanks for helping", kind: "done", cash: false };
}

