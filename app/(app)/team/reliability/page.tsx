import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { formatShortDate } from "@/lib/dates";
import { hasRole } from "@/lib/roles";
import { OUTCOME_SHORT, type ReliabilityRow } from "@/lib/reliability";
import { Alert, Badge, PageHeader } from "@/components/ui";
import { Panel } from "@/components/Panel";
import { AddToBlacklist, ReliabilityTable } from "./ReliabilityTable";

export const metadata: Metadata = { title: "Reliability" };

const PERIODS = [
  { months: 6, label: "6 months" },
  { months: 12, label: "12 months" },
  { months: 24, label: "2 years" },
] as const;

// Who shows up (2026-11-07), for HR and the Events team (the executive board
// reads): per member, events done, what OCs reported after events, late
// drop-outs and the blacklist (public.member_reliability()). People on the
// blacklist are left out of the automatic allocation and only help on events
// the Events team marked non-crucial.
export default async function ReliabilityPage({ searchParams }: { searchParams: Promise<{ months?: string; person?: string }> }) {
  const viewer = await requirePageRole(["hr", "events"], { executiveMayRead: true, page: "Reliability" });
  const canEdit = hasRole(viewer.roles, "hr") || hasRole(viewer.roles, "events");
  const sp = await searchParams;
  const months = PERIODS.find((p) => String(p.months) === sp.months)?.months ?? 12;
  const person = z.uuid().safeParse(sp.person).success ? sp.person! : null;
  const supabase = await createSessionClient();
  const [{ data, error }, { data: members }, { data: incidents }, { data: history }] = await Promise.all([
    supabase.rpc("member_reliability", { months }),
    canEdit ? supabase.from("profiles").select("id, full_name, email").order("full_name") : Promise.resolve({ data: [] }),
    person ? supabase.rpc("member_incidents", { profile: person }) : Promise.resolve({ data: [] }),
    person
      ? supabase.from("volunteer_blacklist").select("id, reason, added_by, added_at, removed_at, removed_by, remove_note").eq("profile_id", person).order("added_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  const rows = (data ?? []) as ReliabilityRow[];
  const link = (q: { months?: number; person?: string | null }) => {
    const p = new URLSearchParams();
    if ((q.months ?? months) !== 12) p.set("months", String(q.months ?? months));
    if (q.person) p.set("person", q.person);
    const s = p.toString();
    return `/team/reliability${s ? `?${s}` : ""}`;
  };
  const selected = person ? (rows.find((r) => r.profile_id === person) ?? (members ?? []).map((m) => ({ full_name: m.full_name, email: m.email, profile_id: m.id })).find((m) => m.profile_id === person)) : null;

  return (
    <>
      <PageHeader
        title="Reliability"
        description="Who shows up: events done, what OCs reported after their events and drop-outs less than 48 hours before the start. People on the blacklist still see the volunteer form, but the allocation leaves them out – the Events team adds them only as helpers on events marked non-crucial."
      >
        <nav aria-label="Period" className="flex items-center gap-1 text-sm">
          {PERIODS.map((p) => (
            <Link
              key={p.months}
              href={link({ months: p.months, person })}
              aria-current={p.months === months ? "page" : undefined}
              className={p.months === months ? "rounded-md border border-esn/30 bg-esn/5 px-3 py-1.5 font-semibold text-esn-dark" : "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-700 hover:text-esn"}
            >
              {p.label}
            </Link>
          ))}
        </nav>
      </PageHeader>

      {selected && (
        <Panel
          title={selected.full_name || selected.email}
          className="mb-6"
          aside={
            <Link href={link({ person: null })} className="text-sm text-esn hover:underline">
              Close
            </Link>
          }
        >
          <div className="grid gap-6 md:grid-cols-2" data-testid="reliability-detail">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-700">Incidents (all time)</h3>
              {!(incidents ?? []).length ? (
                <p className="text-sm text-gray-500">Nothing reported.</p>
              ) : (
                <ul className="divide-y divide-gray-100 text-sm">
                  {(incidents ?? []).map((i, n) => (
                    <li key={`${i.event_id}-${n}`} className="py-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone={i.kind === "excused" ? "gray" : "red"}>{OUTCOME_SHORT[i.kind as keyof typeof OUTCOME_SHORT] ?? i.kind}</Badge>
                        <Link href={`/events/${i.event_id}`} className="font-medium text-gray-900 hover:text-esn">
                          {i.event_title}
                        </Link>
                        <span className="text-xs text-gray-500">{formatShortDate(i.starts_at)}</span>
                      </span>
                      {i.note && <span className="mt-0.5 block text-gray-700">“{i.note}”</span>}
                      {i.reported_by && <span className="block text-xs text-gray-500">reported by {i.reported_by}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-700">Blacklist history</h3>
              {!(history ?? []).length ? (
                <p className="text-sm text-gray-500">Never on the blacklist.</p>
              ) : (
                <ul className="divide-y divide-gray-100 text-sm">
                  {(history ?? []).map((h) => (
                    <li key={h.id} className="py-2">
                      <span className="block">
                        <Badge tone={h.removed_at ? "gray" : "red"}>{h.removed_at ? "Was on it" : "On it now"}</Badge> “{h.reason}”
                      </span>
                      <span className="block text-xs text-gray-500">
                        added {formatShortDate(h.added_at)} by {h.added_by}
                        {h.removed_at && ` · taken off ${formatShortDate(h.removed_at)} by ${h.removed_by}${h.remove_note ? ` – “${h.remove_note}”` : ""}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Panel>
      )}

      {error ? (
        <Alert tone="error">{error.message}</Alert>
      ) : (
        <ReliabilityTable rows={rows} canEdit={canEdit} detailHref={Object.fromEntries(rows.map((r) => [r.profile_id, link({ person: r.profile_id })]))} />
      )}

      {canEdit && (
        <Panel title="Put someone else on the blacklist" className="mt-6">
          <AddToBlacklist members={(members ?? []).filter((m) => !rows.some((r) => r.profile_id === m.id))} />
        </Panel>
      )}
    </>
  );
}
