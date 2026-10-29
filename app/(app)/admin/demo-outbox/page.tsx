import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/supabase/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { demoToolsEnabled } from "@/lib/staging";
import { formatDateTime } from "@/lib/dates";
import { plural } from "@/lib/plural";
import { OUTBOX_KINDS, dmRecipient, folderPath, parseOutboxKind, readableChatText, sortOutbox, type OutboxEntry } from "@/lib/demoOutbox";
import { Badge, Card, CardContent, EmptyState, PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Demo outbox" };

const LIMIT = 150;

const KIND_BADGE: Record<OutboxEntry["kind"], { label: string; tone: "blue" | "green" | "amber" | "gray" }> = {
  message: { label: "Chat message", tone: "blue" },
  dm: { label: "Direct message", tone: "amber" },
  space: { label: "Chat space", tone: "green" },
  folder: { label: "Drive folder", tone: "gray" },
  telegram: { label: "Telegram", tone: "blue" },
};

// What the platform would have sent: Chat spaces and messages, Drive
// folders and Telegram posts, from the fakes' tables (service role – they
// hold fake data only). Staging and development only; any signed-in member
// may look, because presenters switch roles.
export default async function DemoOutboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!demoToolsEnabled()) notFound();
  const viewer = await getViewer();
  if (!viewer) notFound();
  const kind = parseOutboxKind((await searchParams).kind);

  const admin = supabaseAdmin();
  const [spaces, members, messages, folders, files, people, telegram] = await Promise.all([
    admin.from("fake_chat_spaces").select("name, display_name, description, created_at").order("created_at", { ascending: false }).limit(LIMIT),
    admin.from("fake_chat_members").select("space"),
    admin.from("fake_chat_messages").select("name, space, text, edits, created_at, updated_at").order("updated_at", { ascending: false }).limit(LIMIT),
    admin.from("fake_drive_folders").select("id, name, parent_id, created_at").order("created_at", { ascending: false }).limit(500),
    admin.from("fake_drive_files").select("folder_id"),
    admin.from("profiles").select("email, full_name"),
    admin.from("fake_telegram_messages").select("chat_id, kind, text, photo, edits, deleted, updated_at").order("updated_at", { ascending: false }).limit(LIMIT),
  ]);

  const names = new Map((people.data ?? []).map((p) => [p.email.toLowerCase(), p.full_name || p.email]));
  const spaceNames = new Map((spaces.data ?? []).map((s) => [s.name, s.display_name]));
  const memberCount = new Map<string, number>();
  for (const m of members.data ?? []) memberCount.set(m.space, (memberCount.get(m.space) ?? 0) + 1);
  const folderMap = new Map((folders.data ?? []).map((f) => [f.id, { name: f.name, parent: f.parent_id }]));
  const fileCount = new Map<string, number>();
  for (const f of files.data ?? []) fileCount.set(f.folder_id, (fileCount.get(f.folder_id) ?? 0) + 1);

  const entries: OutboxEntry[] = [];
  for (const m of messages.data ?? []) {
    const to = dmRecipient(m.space);
    entries.push({
      kind: to ? "dm" : "message",
      at: m.updated_at,
      where: to ? `To ${names.get(to.toLowerCase()) ?? to}` : (spaceNames.get(m.space) ?? m.space),
      title: to ? "Direct message from the bot" : "Message in the event's space",
      body: readableChatText(m.text, names),
      meta: m.edits > 0 ? [`edited ${m.edits}×`, `first sent ${formatDateTime(m.created_at)}`] : [],
    });
  }
  for (const s of spaces.data ?? []) {
    entries.push({
      kind: "space",
      at: s.created_at,
      where: s.display_name,
      title: "Space created",
      body: s.description,
      meta: [plural(memberCount.get(s.name) ?? 0, "member")],
    });
  }
  // Event folders: the ones that are not just a semester folder.
  const parents = new Set((folders.data ?? []).map((f) => f.parent_id));
  for (const f of folders.data ?? []) {
    const isSemester = /^(SoSe|WiSe)_/.test(f.name) && parents.has(f.id);
    if (isSemester) continue;
    entries.push({
      kind: "folder",
      at: f.created_at,
      where: "Photo drive",
      title: folderPath(f.id, folderMap),
      body: "",
      meta: [plural(fileCount.get(f.id) ?? 0, "photo")],
    });
  }
  for (const t of telegram.data ?? []) {
    entries.push({
      kind: "telegram",
      at: t.updated_at,
      where: t.chat_id,
      title: t.kind === "photo" ? "Photo post" : "Post",
      // Telegram HTML, shown as text.
      body: t.text.replace(/<\/?(b|i|u|s|a)[^>]*>/g, ""),
      meta: [...(t.edits > 0 ? [`edited ${t.edits}×`] : []), ...(t.deleted ? ["deleted"] : [])],
    });
  }

  const shown = sortOutbox(kind === "all" ? entries : entries.filter((e) => e.kind === kind));
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);

  return (
    <>
      <PageHeader
        title="Demo outbox"
        description="Everything the platform would have sent to Google Chat, Google Drive and Telegram – on this demo site nothing leaves the database."
      />
      <nav aria-label="Filter" className="flex flex-wrap gap-2 mb-4">
        {OUTBOX_KINDS.map((k) => (
          <Link
            key={k.key}
            href={k.key === "all" ? "/admin/demo-outbox" : `/admin/demo-outbox?kind=${k.key}`}
            aria-current={kind === k.key ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              kind === k.key ? "bg-esn text-white border-esn" : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
            )}
          >
            {k.label}
            <span className="ml-1 tabular-nums opacity-75">{k.key === "all" ? entries.length : (counts.get(k.key) ?? 0)}</span>
          </Link>
        ))}
      </nav>
      {shown.length === 0 ? (
        <EmptyState>Nothing sent yet. Confirm a roster or publish a description, and it shows up here.</EmptyState>
      ) : (
        <ol className="space-y-3" data-testid="outbox">
          {shown.map((e, i) => (
            <li key={`${e.kind}-${e.at}-${i}`}>
              <Card>
                <CardContent className="pt-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone={KIND_BADGE[e.kind].tone}>{KIND_BADGE[e.kind].label}</Badge>
                    <span className="font-medium text-gray-900 break-words min-w-0">{e.where}</span>
                    <time dateTime={e.at} className="ml-auto text-xs text-gray-500 whitespace-nowrap">
                      {formatDateTime(e.at)}
                    </time>
                  </div>
                  <p className="text-sm text-gray-700 break-words">{e.title}</p>
                  {e.body && <pre className="whitespace-pre-wrap break-words font-sans text-sm text-gray-800 bg-gray-50 rounded-md p-3 border border-gray-100">{e.body}</pre>}
                  {e.meta.length > 0 && <p className="text-xs text-gray-500">{e.meta.join(" · ")}</p>}
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
