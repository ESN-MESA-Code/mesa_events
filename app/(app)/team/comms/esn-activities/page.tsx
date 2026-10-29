import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { appBaseUrl } from "@/lib/env";
import { userscript } from "@/lib/esn/script";
import { formatDateTime, nowMs } from "@/lib/dates";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { revokeEsnToken } from "@/app/actions/esn";
import { CopyScript, NewTokenForm } from "./TokenClient";

export const metadata: Metadata = { title: "ESN Activities" };

// The Comms team's ESN Activities page (brief 2026-10-29, B; the bot's
// install page): personal access tokens for the browser script, how to
// install it, how an upload goes.
export default async function EsnActivitiesPage() {
  await requirePageRole(["comms"], { page: "ESN Activities" });
  const supabase = await createSessionClient();
  const { data: tokens } = await supabase
    .from("esn_access_tokens")
    .select("id, label, token_prefix, created_at, expires_at, last_used_at, revoked_at")
    .order("created_at", { ascending: false });
  const base = appBaseUrl();
  const now = nowMs();
  const state = (t: { revoked_at: string | null; expires_at: string }) => (t.revoked_at ? "revoked" : Date.parse(t.expires_at) <= now ? "expired" : "active");

  return (
    <>
      <PageHeader
        title="ESN Activities"
        description="Upload events to activities.esn.org: a browser script fills the form “Register your physical activity” from MESA Events and links the saved activity back."
      >
        <Link href="/team/comms" className="text-sm text-esn hover:underline">
          ← Comms
        </Link>
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your personal access tokens</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600">
              The script signs in with a token instead of your MESA Events session (activities.esn.org cannot send it). A token acts for you, so keep it to
              yourself. It is shown once, only works while you are in the Comms team, and you can revoke it here at any time.
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
                On the{" "}
                <Link href="/team/comms" className="text-esn hover:underline">
                  Comms page
                </Link>{" "}
                (or an event&apos;s Hand-in tab) click <strong>Open ESN form</strong> – best once the OC wrote the event report (“Ready to upload”).
              </li>
              <li>The form is filled – green = filled, red = please complete. Nothing is submitted. Check it, optionally add a header image (1920×460), click Save.</li>
              <li>
                On the new activity page click <strong>Link to MESA Events</strong> in the box at the bottom right. The event is marked uploaded and its Chat
                space is told. Without the script, <strong>Paste link</strong> on the Comms page does the same by hand.
              </li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
