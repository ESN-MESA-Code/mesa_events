import type { Metadata } from "next";
import { createSessionClient } from "@/lib/supabase/session";
import { requirePageRole } from "@/lib/access";
import { APP_ROLES, ROLE_GROUP_ENV, ROLE_LABELS, roleGroups } from "@/lib/roles";
import { googleMode } from "@/lib/google";
import { formatDateTime } from "@/lib/dates";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { AddRoleForm, SettingsForm } from "./forms";
import { removeManualRole, retryJob, syncRolesNow } from "@/app/actions/admin";
import { isStaging } from "@/lib/staging";
import { StagingCard } from "./StagingCard";
import { setChannelEnabled } from "@/app/actions/publishing";
import { telegramMode } from "@/lib/telegram";

export const metadata: Metadata = { title: "Admin" };

// Admin (IT): role mapping (groups from env), manual role members, settings,
// and the jobs queue (Chat, Drive, role sync) with retries.
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  await requirePageRole(["admin"], { page: "Admin" });
  const { demo } = await searchParams;
  const supabase = await createSessionClient();
  const [{ data: members }, { data: jobs }, { data: settings }, { data: channels }] = await Promise.all([
    supabase.from("role_members").select("*").order("role").order("email"),
    supabase.from("jobs").select("id, kind, status, attempts, max_attempts, last_error, run_after, updated_at, idempotency_key").order("id", { ascending: false }).limit(50),
    supabase.from("app_settings").select("key, value").order("key"),
    supabase.from("publication_channels").select("key, name, kind, enabled").order("position"),
  ]);
  const groups = roleGroups();
  const mode = googleMode();

  return (
    <>
      <PageHeader title="Admin" description="Role mapping, settings and background jobs." />
      <div className="space-y-6">
        {/* Staging builds only (a build-time constant), and only on the staging site. */}
        {process.env.NEXT_PUBLIC_APP_ENV === "staging" && isStaging() && <StagingCard result={demo} />}
        {mode === "fake" && (
          <Alert tone="warning">
            Google services run in <strong>fake mode</strong> (no service account configured): Chat spaces, messages and the Drive
            photo folders are recorded in the database only (<code>npm run fake:drive</code> puts files into a folder).
          </Alert>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Role groups</CardTitle>
            <ActionButton action={syncRolesNow} input={{}} variant="outline">
              Sync roles now
            </ActionButton>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500 mb-3">
              Group addresses are configuration variables; members are synced daily and at each login.
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500">
                  <th className="py-1">Role</th>
                  <th>Variable</th>
                  <th>Group</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {APP_ROLES.map((r) => (
                  <tr key={r}>
                    <td className="py-1.5">{ROLE_LABELS[r]}</td>
                    <td className="font-mono text-xs">{ROLE_GROUP_ENV[r]}</td>
                    <td>{groups[r] ?? <span className="text-gray-400">not set</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Role members</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <AddRoleForm />
            <ul className="divide-y divide-gray-100 text-sm">
              {(members ?? []).map((m) => (
                <li key={`${m.email}-${m.role}-${m.source}`} className="flex items-center gap-3 py-2">
                  <span className="w-40">{ROLE_LABELS[m.role]}</span>
                  <span className="mr-auto">{m.email}</span>
                  <Badge tone={m.source === "group" ? "blue" : "gray"}>{m.source === "group" ? "from group" : "manual"}</Badge>
                  {m.source === "manual" && (
                    <ActionButton action={removeManualRole} input={{ email: m.email, role: m.role }} variant="ghost" confirm={`Remove ${m.email} from ${ROLE_LABELS[m.role]}?`}>
                      Remove
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Publishing channels</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-gray-500">
              Where Comms publishes events. Telegram runs {telegramMode() === "fake" ? <strong>on the fake (no token configured)</strong> : "on the configured bot"}; the manual channels are marked by hand.
            </p>
            <ul className="divide-y divide-gray-100 text-sm" data-testid="channels">
              {(channels ?? []).map((c) => (
                <li key={c.key} className="flex items-center gap-2 py-2">
                  <span className="font-medium text-gray-900">{c.name}</span>
                  <Badge tone={c.kind === "auto" ? "blue" : "gray"}>{c.kind === "auto" ? "by the platform" : "by hand"}</Badge>
                  <span className="ml-auto">
                    <ActionButton action={setChannelEnabled} input={{ channel: c.key, enabled: !c.enabled }} variant={c.enabled ? "outline" : "default"}>
                      {c.enabled ? "Switch off" : "Switch on"}
                    </ActionButton>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
          </CardHeader>
          <CardContent>
            <SettingsForm settings={Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]))} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Background jobs</CardTitle>
            <span className="text-xs text-gray-500">Latest 50</span>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="jobs-table">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500">
                  <th className="py-1">#</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Updated</th>
                  <th>Error</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(jobs ?? []).map((j) => (
                  <tr key={j.id} className="align-top">
                    <td className="py-1.5 tabular-nums">{j.id}</td>
                    <td className="font-mono text-xs" title={j.idempotency_key}>{j.kind}</td>
                    <td>
                      <Badge tone={j.status === "done" ? "green" : j.status === "dead" ? "red" : j.status === "failed" ? "amber" : "blue"}>{j.status}</Badge>
                    </td>
                    <td className="tabular-nums">
                      {j.attempts}/{j.max_attempts}
                    </td>
                    <td className="whitespace-nowrap">{formatDateTime(j.updated_at)}</td>
                    <td className="text-xs text-red-700 max-w-xs break-words">{j.last_error}</td>
                    <td>
                      {(j.status === "dead" || j.status === "failed") && (
                        <ActionButton action={retryJob} input={{ id: j.id }} variant="outline">
                          Retry
                        </ActionButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
