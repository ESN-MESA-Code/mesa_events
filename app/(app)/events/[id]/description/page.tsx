import type { Metadata } from "next";
import { loadEventForPage } from "@/lib/events";
import { coerceFields, renderDescription } from "@/lib/description/template";
import { prefillFromEvent } from "@/lib/description/prefill";
import { searchEntry, type SearchEntry } from "@/lib/description/search";
import { dueUrgency, formatDateTime, nowMs } from "@/lib/dates";
import { hasRole } from "@/lib/roles";
import { Alert, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { DescriptionEditor } from "./DescriptionEditor";
import { eventAddress, hasAddress } from "@/lib/address";
import { loadSorting } from "@/lib/sortingLoad";

export const metadata: Metadata = { title: "Description" };

export default async function DescriptionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, supabase, viewer, isOc, isStaff, isTeam, cycle } = await loadEventForPage(id);
  const isComms = hasRole(viewer.roles, "comms");
  const isEvents = hasRole(viewer.roles, "events");
  const canEdit = isOc || isEvents || isComms;

  const { data: description } = await supabase.from("descriptions").select("*").eq("event_id", id).maybeSingle();

  // Helpers and other members: read only.
  if (!canEdit) {
    const text = description?.published_text ?? null;
    const fields = description ? coerceFields(description.fields) : null;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Description</CardTitle>
        </CardHeader>
        <CardContent>
          {isStaff || isTeam ? (
            fields ? (
              <div className="rounded-lg bg-gray-50 p-4 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: renderDescription(fields).html }} />
            ) : (
              <EmptyState>The OC has not started the description yet.</EmptyState>
            )
          ) : text ? (
            <pre className="whitespace-pre-wrap font-sans text-sm">{text}</pre>
          ) : (
            <EmptyState>The description is not published yet.</EmptyState>
          )}
        </CardContent>
      </Card>
    );
  }

  const [{ data: reviews }, { data: published }, { categories, formats }, { count: runs }] = await Promise.all([
    supabase.from("reviews").select("id, reviewer, decision, comment, created_at").eq("event_id", id).order("created_at", { ascending: false }),
    supabase
      .from("descriptions")
      .select("event_id, approved_fields, events(title, format_id)")
      .not("published_at", "is", null)
      .neq("event_id", id)
      .limit(500),
    loadSorting(supabase),
    // Earlier runs of the format that took place (round 2026-11-01).
    event.format_id
      ? supabase
          .from("events")
          .select("id", { count: "exact", head: true })
          .eq("format_id", event.format_id)
          .neq("id", id)
          .lte("starts_at", new Date(nowMs()).toISOString())
          .not("status", "in", "(dropped,cancelled)")
      : Promise.resolve({ count: 0 }),
  ]);
  const category = categories.find((c) => c.id === event.category_id);
  const format = formats.find((f) => f.id === event.format_id);
  const pool: SearchEntry[] = (published ?? []).map((p) => {
    const f = coerceFields(p.approved_fields);
    const ev = p.events as { title: string; format_id: string | null } | null;
    return searchEntry(p.event_id, ev?.title ?? f.title, f, ev?.format_id ?? null);
  });
  // The last published run of the same format: the first template offered (round 2026-11-01).
  const lastRun = event.format_id
    ? pool.filter((p) => p.formatId === event.format_id).sort((a, b) => (a.published.dateIso < b.published.dateIso ? 1 : -1))[0]
    : undefined;
  const templates = Object.fromEntries((published ?? []).map((p) => [p.event_id, coerceFields(p.approved_fields)]));
  // After "changes requested": the version Comms saw, to show what changed since (usability review #17).
  const lastReview = reviews?.[0];
  const { data: reviewed } =
    lastReview?.decision === "changes_requested"
      ? await supabase.from("description_versions").select("fields").eq("event_id", id).eq("kind", "submitted").lte("created_at", lastReview.created_at).order("id", { ascending: false }).limit(1).maybeSingle()
      : { data: null };
  const deadline = cycle?.description_deadline ?? null;
  const now = nowMs();
  const late = deadline !== null && Date.parse(deadline) < now && (!description || ["draft", "changes_requested"].includes(description.status));
  // Never submitted by the deadline: the event is cancelled (round 2026-10-30; usability review #1).
  const notSubmitted = !description || description.status === "draft";
  const urgency = deadline ? dueUrgency(deadline, now) : "later";

  return (
    <div className="space-y-4">
      {deadline && (
        <Alert tone={late || urgency === "urgent" ? "error" : urgency === "soon" ? "warning" : "info"} data-testid="description-deadline">
          Descriptions for this month are due <strong>{formatDateTime(deadline)}</strong>.{" "}
          {notSubmitted
            ? Date.parse(deadline) < now
              ? "The deadline has passed."
              : "If this one is not submitted for Comms review by then, the event is cancelled automatically."
            : description.status === "changes_requested"
              ? "It was submitted, so it is not cancelled – but fix it soon, it counts as late after the deadline."
              : null}
        </Alert>
      )}
      <DescriptionEditor
        eventId={id}
        viewer={{ name: viewer.name, email: viewer.email }}
        initial={{
          fields: description ? coerceFields(description.fields) : prefillFromEvent(event, category?.esn_type),
          exists: !!description,
          version: description?.version ?? 0,
          status: description?.status ?? "draft",
          publishedAt: description?.published_at ? formatDateTime(description.published_at) : null,
          publishRequested: !!description?.publish_requested_at && (!description.published_at || description.publish_requested_at > description.published_at),
          approvedBy: description?.approved_by ?? null,
        }}
        can={{ submit: isOc || isEvents, review: isComms, hasSpace: !!event.chat_space_requested_at }}
        pool={pool}
        templates={templates}
        lastRun={lastRun ? { eventId: lastRun.eventId, format: format?.name ?? lastRun.published.title, date: lastRun.published.dateIso } : null}
        sorting={{ categoryId: event.category_id, formatId: event.format_id, runs: runs ?? 0, canEdit: isEvents, categories, formats }}
        reviews={(reviews ?? []).map((r) => ({ ...r, when: formatDateTime(r.created_at) }))}
        place={{ location: event.location ?? "", address: hasAddress(eventAddress(event)) ? eventAddress(event) : null, canSaveEvent: isOc || isEvents }}
        eventPriceCents={event.price_cents}
        lastRequest={
          lastReview?.decision === "changes_requested"
            ? { reviewer: lastReview.reviewer, comment: lastReview.comment, when: formatDateTime(lastReview.created_at), fields: reviewed ? coerceFields(reviewed.fields) : null }
            : null
        }
      />
    </div>
  );
}
