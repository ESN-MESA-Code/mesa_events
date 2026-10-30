import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { appBaseUrl } from "@/lib/env";
import { userscript } from "@/lib/esn/script";
import { addMonths, cycleLabel, formatDateTime, monthOf, monthStartIso, nextMonthStartIso, nowMs } from "@/lib/dates";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { EsnUpload } from "@/components/EsnUpload";
import { MonthSelector } from "@/components/MonthSelector";
import { revokeEsnToken } from "@/app/actions/esn";
import { loadEsn } from "@/lib/esn/load";
import { hasRole } from "@/lib/roles";
import { monthParam, parseMonthParam, pickMonth } from "@/lib/month";
import { CopyScript, NewTokenForm } from "./TokenClient";

export const metadata: Metadata = { title: "ESN Activities" };

// The executive board's ESN Activities page (round 2026-10-30; it was
// Comms' – brief 2026-10-29, B): the month's events that took place with
// their upload status and actions, personal access tokens for the browser
// script, how to install it, how an upload goes.
export default async function EsnActivitiesPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const viewer = await requirePageRole(["executive"], { page: "ESN Activities" });
  const canSet = hasRole(viewer.roles, "executive");
  const sp = await searchParams;
  const supabase = await createSessionClient();
  const now = nowMs();
  const thisMonth = monthOf(new Date(now).toISOString());
  const from = addMonths(thisMonth, -6);
  const [{ data: tokens }, { data: happened }] = await Promise.all([
    supabase.from("esn_access_tokens").select("id, label, token_prefix, created_at, expires_at, last_used_at, revoked_at").order("created_at", { ascending: false }),
    // Events that took place from half a year back until now: those are uploaded.
    supabase
      .from("events")
      .select("id, title, starts_at")
      .in("status", ["confirmed", "understaffed", "completed"])
      .eq("source", "platform")
      .gte("starts_at", monthStartIso(from))
      .lte("starts_at", new Date(now).toISOString())
      .order("starts_at"),
  ]);
  const esn = await loadEsn(supabase, (happened ?? []).map((e) => e.id));
  const toDo = (m: string) => (happened ?? []).filter((e) => monthOf(e.starts_at) === m && esn.get(e.id)?.status.state !== "uploaded").length;
  const months = [...new Set((happened ?? []).map((e) => monthOf(e.starts_at)))].sort();
  const month = pickMonth(months.map((m) => ({ month: m, hasWork: toDo(m) > 0 })), parseMonthParam(sp.month), thisMonth);
  const inMonth = month ? (happened ?? []).filter((e) => e.starts_at >= monthStartIso(month) && e.starts_at < nextMonthStartIso(month)) : [];
  const base = appBaseUrl();
  const state = (t: { revoked_at: string | null; expires_at: string }) => (t.revoked_at ? "revoked" : Date.parse(t.expires_at) <= now ? "expired" : "active");

  return (
    <>
      <PageHeader
        title="ESN Activities"
        description="Upload events to activities.esn.org: a browser script fills the form “Register your physical activity” from MESA Events and links the saved activity back."
      >
        <MonthSelector
          options={months.map((m) => ({ value: monthParam(m), label: cycleLabel(m), note: toDo(m) ? `${toDo(m)} to upload` : "done" }))}
          current={month ? monthParam(month) : null}
          path="/team/esn-activities"
          storageKey="mesa:month:esn"
          explicit={!!parseMonthParam(sp.month)}
        />
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>To upload</CardTitle>
            {month && <Badge tone={toDo(month) ? "blue" : "green"}>{toDo(month) ? `${toDo(month)} to upload` : "all uploaded"}</Badge>}
          </CardHeader>
          <CardContent>
            {!inMonth.length ? (
              <EmptyState>No events took place in this month yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-gray-100 text-sm" data-testid="esn-events">
                {inMonth.map((e) => {
                  const x = esn.get(e.id);
                  return (
                    <li key={e.id} className="grid gap-2 py-3 md:grid-cols-[10.5rem_minmax(0,14rem)_minmax(0,1fr)] md:items-center" data-testid={`esn-row-${e.id}`}>
                      <span className="tabular-nums text-gray-600">{formatDateTime(e.starts_at)}</span>
                      <Link href={`/events/${e.id}/hand-in`} className="truncate font-medium text-gray-900 hover:text-esn">
                        {e.title}
                      </Link>
                      {x && <EsnUpload eventId={e.id} status={x.status} canSet={canSet} compact />}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your personal access tokens</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600">
              The script signs in with a token instead of your MESA Events session (activities.esn.org cannot send it). A token acts for you, so keep it to
              yourself. It is shown once, only works while you are on the executive board, and you can revoke it here at any time.
            </p>
            <NewTokenForm baseUrl={base} />
            {!tokens?.length ? (
              <EmptyState>No tokens yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-gray-100 text-sm" data-testid="esn-tokens">
                {tokens.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="font-medium">{t.label}</span>
                    <code className="text-xs text-gray-500">{t.token_prefix}…</code>
                    <Badge tone={state(t) === "active" ? "green" : "gray"}>{state(t)}</Badge>
                    <span className="w-full text-xs text-gray-500">
                      created {formatDateTime(t.created_at)} ·{" "}
                      {state(t) === "revoked" ? `revoked ${formatDateTime(t.revoked_at!)}` : `expires ${formatDateTime(t.expires_at)}`} ·{" "}
                      {t.last_used_at ? `last used ${formatDateTime(t.last_used_at)}` : "never used"}
                    </span>
                    {state(t) === "active" && (
                      <ActionButton action={revokeEsnToken} input={{ token_id: t.id }} variant="outline" confirm={`Revoke “${t.label}”? The script stops working with it.`}>
                        Revoke
                      </ActionButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Install the browser script (once, in Chrome)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>
                Install{" "}
                <a href="https://chromewebstore.google.com/detail/dhdgffkkebhmkfjojejmpbldmpobfkfo" target="_blank" rel="noopener noreferrer" className="text-esn hover:underline">
                  Tampermonkey
                </a>{" "}
                in Chrome.
              </li>
              <li>
                Chrome → Extensions → Manage extensions → Tampermonkey → <strong>Details</strong> → switch on <strong>Allow User Scripts</strong>.
              </li>
              <li>Create a token (on the left) and copy the script that carries it – or copy the script below, which asks for the token on first use.</li>
              <li>
                Tampermonkey icon → <strong>Create a new script…</strong> → select everything in the editor, paste, then <strong>File → Save</strong>.
              </li>
            </ol>
            <CopyScript script={userscript(base)} label="Copy script (asks for the token)" />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Uploading an event</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>
                Log in on{" "}
                <a href="https://activities.esn.org" target="_blank" rel="noopener noreferrer" className="text-esn hover:underline">
                  activities.esn.org
                </a>{" "}
                (ESN account) in the same Chrome.
              </li>
              <li>
                In the list above (or on an event&apos;s Hand-in tab) click <strong>Open ESN form</strong> – best once the OC wrote the event report (“Ready to upload”).
              </li>
              <li>The form is filled – green = filled, red = please complete. Nothing is submitted. Check it, optionally add a header image (1920×460), click Save.</li>
              <li>
                On the new activity page click <strong>Link to MESA Events</strong> in the box at the bottom right. The event is marked uploaded and its Chat
                space is told. Without the script, <strong>Paste link</strong> in the list above does the same by hand.
              </li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
