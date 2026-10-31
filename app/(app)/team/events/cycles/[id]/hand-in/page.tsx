import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { formatDateTime, nowMs } from "@/lib/dates";
import { plural } from "@/lib/plural";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Hand-in" };

// The cycle's hand-in: per running event what is still missing (attendance
// list, photos, event report, Belege), in date order.
export default async function HandInPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  await requirePageRole(["events"], { executiveMayRead: true, hide: true });
  const supabase = await createSessionClient();
  const [{ data: events }, { data: handIn }] = await Promise.all([
    supabase.from("events").select("id, title, starts_at, status").eq("cycle_id", id).not("status", "in", "(dropped,cancelled,draft)").order("starts_at"),
    supabase.rpc("cycle_hand_in", { cycles: [id] }),
  ]);
  const now = nowMs();
  const of = new Map((handIn ?? []).map((h) => [h.event_id, h]));

  const rows = (events ?? []).map((e) => {
    const h = of.get(e.id);
    const started = Date.parse(e.starts_at) <= now;
    const missing = h
      ? [!h.signed_off && "attendance list", !h.photos_in && "photos", !h.report_in && "event report", h.belege_missing > 0 && plural(h.belege_missing, "paper receipt")].filter(Boolean)
      : [];
    return { ...e, started, missing };
  });
  const open = rows.filter((r) => r.started && r.missing.length);
  const rest = rows.filter((r) => !(r.started && r.missing.length));
  const row = (r: (typeof rows)[number]) => (
    <li key={r.id} className="grid grid-cols-[8.5rem_minmax(0,1fr)_auto] items-center gap-3 py-2">
      <span className="tabular-nums text-gray-600">{formatDateTime(r.starts_at)}</span>
      <Link href={`/events/${r.id}/hand-in?from=cycle:${id}`} className="truncate font-medium text-gray-900 hover:text-esn">
        {r.title}
      </Link>
      <span className="justify-self-end text-xs">
        {!r.started ? (
          <span className="text-gray-500">after the event</span>
        ) : r.missing.length ? (
          <span className="text-amber-800">missing {r.missing.join(", ")}</span>
        ) : (
          <Badge tone="green">✓ handed in</Badge>
        )}
      </span>
    </li>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Not handed in yet</CardTitle>
          <Badge tone={open.length ? "amber" : "green"}>{open.length}</Badge>
        </CardHeader>
        <CardContent>
          {!open.length ? (
            <EmptyState>Nothing missing from the events that took place.</EmptyState>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm" data-testid="hand-in-open">
              {open.map(row)}
            </ul>
          )}
        </CardContent>
      </Card>
      {rest.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Handed in or still ahead</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-gray-100 text-sm" data-testid="hand-in-rest">
              {rest.map(row)}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
