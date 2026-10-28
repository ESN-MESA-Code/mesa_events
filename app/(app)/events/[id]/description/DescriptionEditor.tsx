"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  CONFIG,
  ESN_OBJECTIVES,
  ESN_TYPES,
  STEP_FIELDS,
  applyEsnDefaults,
  coerceFields,
  esnObjectiveIds,
  formatCount,
  fromTemplate,
  renderDescription,
  validateAll,
  type DescriptionFields,
  type StepId,
} from "@/lib/description/template";
import { searchTemplates, type SearchEntry } from "@/lib/description/search";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select, Textarea } from "@/components/ui";
import { describeError, useAction } from "@/components/ActionButton";
import { publishDescription, reviewDescription, saveDescription, submitDescription } from "@/app/actions/descriptions";
import { cn } from "@/lib/utils";

type Status = "draft" | "submitted" | "changes_requested" | "approved" | "published" | string;

const STATUS: Record<string, { label: string; tone: "gray" | "blue" | "amber" | "green" | "purple" }> = {
  draft: { label: "Draft", tone: "gray" },
  submitted: { label: "Waiting for Comms review", tone: "blue" },
  changes_requested: { label: "Changes requested", tone: "amber" },
  approved: { label: "Approved – ready to publish", tone: "green" },
  published: { label: "Published", tone: "purple" },
};

const STEP_TITLES: Record<StepId, string> = { basics: "Basics", intro: "Intro", program: "Programme", extras: "Details" };
const AUTOSAVE_MS = 800;

interface Props {
  eventId: string;
  viewer: { name: string; email: string };
  initial: {
    fields: DescriptionFields;
    exists: boolean;
    version: number;
    status: Status;
    publishedAt: string | null;
    publishRequested: boolean;
    approvedBy: string | null;
  };
  can: { submit: boolean; review: boolean; hasSpace: boolean };
  pool: SearchEntry[];
  templates: Record<string, DescriptionFields>;
  reviews: Array<{ id: string; reviewer: string; decision: string; comment: string; when: string }>;
}

export function DescriptionEditor({ eventId, viewer, initial, can, pool, templates, reviews }: Props) {
  const router = useRouter();
  const [fields, setFields] = useState(initial.fields);
  const [status, setStatus] = useState<Status>(initial.status);
  // "new": no description yet – the fields are prefilled from the event and
  // saved together with the first edit (nothing is unsaved before that).
  const [saveState, setSaveState] = useState<"new" | "saved" | "saving" | "dirty" | "error">(initial.exists ? "saved" : "new");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [others, setOthers] = useState<string[]>([]);
  const [showTemplates, setShowTemplates] = useState(!initial.exists);
  const dirty = useRef<Set<keyof DescriptionFields>>(new Set());
  const prefillPending = useRef(!initial.exists);
  const fieldsRef = useRef(fields);
  const version = useRef(initial.version);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, startSave] = useTransition();
  const { run, pending, error } = useAction();
  const [comment, setComment] = useState("");

  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);

  const rendered = useMemo(() => renderDescription(fields), [fields]);
  const validation = useMemo(() => validateAll(fields), [fields]);
  const length = rendered.chat.length;

  // ── Autosave: the changed fields only, merged on the server ───────────────
  function flush() {
    if (!dirty.current.size) return;
    const keys = [...dirty.current];
    dirty.current.clear();
    const patch = Object.fromEntries(keys.map((k) => [k, fieldsRef.current[k]]));
    setSaveState("saving");
    startSave(async () => {
      const r = await saveDescription({ event_id: eventId, patch });
      if (!r.ok) {
        keys.forEach((k) => dirty.current.add(k));
        setSaveState("error");
        setSaveError(describeError(r));
        return;
      }
      version.current = r.data.version;
      setStatus(r.data.status);
      setSaveError(null);
      setSaveState(dirty.current.size ? "dirty" : "saved");
    });
  }

  /** The first edit of a new description also saves the prefilled fields. */
  function takePrefill() {
    if (!prefillPending.current) return;
    prefillPending.current = false;
    (Object.keys(fieldsRef.current) as Array<keyof DescriptionFields>).forEach((k) => dirty.current.add(k));
  }

  function change<K extends keyof DescriptionFields>(key: K, value: DescriptionFields[K]) {
    takePrefill();
    setFields((f) => {
      let next = { ...f, [key]: value };
      if (key === "esnType") {
        next = applyEsnDefaults(next, f.esnType);
        dirty.current.add("esnObjectives");
      }
      return next;
    });
    dirty.current.add(key);
    setSaveState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, AUTOSAVE_MS);
  }

  // Save before leaving the page.
  useEffect(() => {
    const save = () => flush();
    window.addEventListener("beforeunload", save);
    return () => {
      window.removeEventListener("beforeunload", save);
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flush reads refs only
  }, []);

  // ── Others' edits (realtime) and who else is editing (presence) ──────────
  useEffect(() => {
    const channel = supabase
      .channel(`description:${eventId}`, { config: { presence: { key: viewer.email } } })
      .on("postgres_changes", { event: "*", schema: "public", table: "descriptions", filter: `event_id=eq.${eventId}` }, (payload) => {
        const row = payload.new as { version?: number; fields?: unknown; status?: string; updated_by?: string };
        if (!row?.version || row.version <= version.current) return;
        version.current = row.version;
        if (row.status) setStatus(row.status);
        if (row.updated_by === viewer.email) return;
        const remote = coerceFields(row.fields);
        // Keep what this editor is still typing; take everything else.
        setFields((f) => {
          const next = { ...f };
          for (const k of Object.keys(remote) as Array<keyof DescriptionFields>) {
            if (!dirty.current.has(k)) (next as Record<string, unknown>)[k] = remote[k];
          }
          return next;
        });
      })
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ name: string }>();
        setOthers(
          Object.entries(state)
            .filter(([key]) => key !== viewer.email)
            .map(([, metas]) => metas[0]?.name ?? "Someone")
        );
      })
      .subscribe(async (s) => {
        if (s === "SUBSCRIBED") await channel.track({ name: viewer.name });
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, viewer.email, viewer.name]);

  // ── Templates ─────────────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [expand, setExpand] = useState<string | undefined>();
  const results = useMemo(() => searchTemplates(pool, query, eventId, expand), [pool, query, eventId, expand]);

  function applyTemplate(id: string) {
    const t = templates[id];
    if (!t) return;
    if (!window.confirm("Replace the current text with this event's description? The date stays.")) return;
    const next = fromTemplate(t, fieldsRef.current);
    prefillPending.current = false;
    setFields(next);
    (Object.keys(next) as Array<keyof DescriptionFields>).forEach((k) => dirty.current.add(k));
    setShowTemplates(false);
    setSaveState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 50);
  }

  const st = STATUS[status] ?? STATUS.draft;
  const tooLong = length > CONFIG.MAX_CHARS;
  const text = (key: keyof DescriptionFields, label: string, opts: { area?: boolean; hint?: string; placeholder?: string; rows?: number } = {}) => (
    <Field label={label} htmlFor={`f-${key}`} hint={opts.hint}>
      {opts.area ? (
        <Textarea id={`f-${key}`} rows={opts.rows ?? 4} value={String(fields[key] ?? "")} placeholder={opts.placeholder} onChange={(e) => change(key, e.target.value as never)} onBlur={flush} />
      ) : (
        <Input id={`f-${key}`} value={String(fields[key] ?? "")} placeholder={opts.placeholder} onChange={(e) => change(key, e.target.value as never)} onBlur={flush} />
      )}
    </Field>
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={st.tone} data-testid="description-status">
            {st.label}
          </Badge>
          <span className="text-xs text-gray-500" data-testid="save-state" aria-live="polite">
            {saveState === "new"
              ? "Not saved yet – prefilled from the event, saves as you type"
              : saveState === "saved"
                ? "All changes saved"
                : saveState === "saving"
                  ? "Saving…"
                  : saveState === "error"
                    ? "Not saved"
                    : "Unsaved changes"}
          </span>
          {others.length > 0 && (
            <span className="text-xs text-esn" data-testid="presence">
              Also editing: {others.join(", ")}
            </span>
          )}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setShowTemplates((v) => !v)}>
            {showTemplates ? "Hide templates" : "Start from a previous event"}
          </Button>
        </div>
        {saveError && <Alert tone="error">{saveError}</Alert>}

        {showTemplates && (
          <Card>
            <CardHeader>
              <CardTitle>Start from a previous event?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Input aria-label="Search previous events" placeholder="Search by name, venue or text (e.g. hike, pub quiz)" value={query} onChange={(e) => setQuery(e.target.value)} />
              {!results.rows.length && <p className="text-sm text-gray-500">{pool.length ? "No match." : "No published descriptions yet."}</p>}
              <ul className="divide-y divide-gray-100 text-sm" data-testid="template-results">
                {results.rows.map((r) => (
                  <li key={r.rec.eventId} className="flex items-center gap-2 py-1.5">
                    <span className="font-medium">{r.rec.published.title || r.rec.eventTitle}</span>
                    <span className="text-xs text-gray-500">{r.rec.published.dateIso}</span>
                    {r.earlier.length > 0 && (
                      <button type="button" className="text-xs text-esn hover:underline" onClick={() => setExpand(r.key)}>
                        +{r.earlier.length} earlier
                      </button>
                    )}
                    <Button size="sm" variant="outline" className="ml-auto" onClick={() => applyTemplate(r.rec.eventId)}>
                      Use
                    </Button>
                  </li>
                ))}
              </ul>
              {results.totalGroups > results.shownGroups && <p className="text-xs text-gray-500">Showing {results.shownGroups} of {results.totalGroups} – refine the search.</p>}
            </CardContent>
          </Card>
        )}

        {(Object.keys(STEP_FIELDS) as StepId[]).map((step) => (
          <Card key={step}>
            <CardHeader>
              <CardTitle>{STEP_TITLES[step]}</CardTitle>
              {validation.errors[step].length > 0 && <Badge tone="amber">{validation.errors[step].length} to fix</Badge>}
            </CardHeader>
            <CardContent className="space-y-3">
              {step === "basics" && (
                <>
                  {text("title", "Event name")}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Date" htmlFor="f-dateIso">
                      <Input id="f-dateIso" type="date" value={fields.dateIso} onChange={(e) => change("dateIso", e.target.value)} onBlur={flush} />
                    </Field>
                    {text("time", "Time", { hint: "19:30, 7pm, 19:30–22:00 or TBA" })}
                  </div>
                  {text("venue", "Venue", { placeholder: CONFIG.VENUE_SUGGESTIONS.join(", ") })}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {text("price", "Price", { hint: "9.50, free or TBA" })}
                    {text("priceNote", "Price note", { placeholder: "ESNcard holders € 7.50" })}
                  </div>
                </>
              )}
              {step === "intro" && (
                <>
                  {text("hook", "Hook: “Are you ready for …?”", { placeholder: "a night at the museum" })}
                  {text("intro", "Introduction (2–4 sentences)", { area: true })}
                </>
              )}
              {step === "program" && (
                <>
                  {text("program", "What does the event look like? (one point per line)", { area: true })}
                  {text("bring", "What should I bring? (one item per line, end with an emoji)", { area: true, placeholder: "Good mood 😄" })}
                </>
              )}
              {step === "extras" && (
                <>
                  {text("importantHeading", "Important info heading (optional)", { placeholder: CONFIG.DEFAULT_IMPORTANT_HEADING })}
                  {text("important", "Important info (one point per line, optional)", { area: true, rows: 3 })}
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={fields.weather} onChange={(e) => change("weather", e.target.checked)} /> Add the weather note (outdoor events)
                  </label>
                  {text("closing", "Closing: “We can’t wait to …”", { placeholder: "see you there!" })}
                  <Field label="ESN Activities: type" htmlFor="f-esnType">
                    <Select id="f-esnType" value={fields.esnType} onChange={(e) => change("esnType", e.target.value)}>
                      <option value="">Choose …</option>
                      {ESN_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <fieldset>
                    <legend className="text-sm font-medium text-gray-700 mb-1">ESN Activities: objectives</legend>
                    <div className="grid sm:grid-cols-2 gap-1 max-h-40 overflow-y-auto rounded border border-gray-200 p-2 text-xs">
                      {ESN_OBJECTIVES.map(([value, label]) => {
                        const ids = esnObjectiveIds(fields);
                        return (
                          <label key={value} className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={ids.includes(value)}
                              onChange={(e) => change("esnObjectives", (e.target.checked ? [...ids, value] : ids.filter((x) => x !== value)).join(","))}
                            />
                            {label}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                </>
              )}
              {validation.errors[step].map((e) => (
                <p key={e} className="text-xs text-red-600">
                  {e}
                </p>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-4 xl:sticky xl:top-4 h-fit">
        <Card>
          <CardHeader>
            <CardTitle>Preview (Chat post)</CardTitle>
            <span className={cn("text-sm tabular-nums", tooLong ? "text-red-600 font-semibold" : length > CONFIG.MAX_CHARS * 0.9 ? "text-amber-700" : "text-gray-500")} data-testid="char-counter">
              {formatCount(length)} / {formatCount(CONFIG.MAX_CHARS)}
            </span>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-sm leading-relaxed break-words" data-testid="preview" dangerouslySetInnerHTML={{ __html: rendered.html }} />
            {validation.warnings.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-amber-800">
                {validation.warnings.map((w) => (
                  <li key={w}>💡 {w}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Comms hand-off</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {initial.publishedAt && <p className="text-gray-600">Published {initial.publishedAt}. Editing again needs a new review; publishing then edits the same message.</p>}
            {can.submit && (status === "draft" || status === "changes_requested") && (
              <div>
                <Button
                  disabled={pending || !validation.ok || saveState !== "saved"}
                  onClick={() => {
                    flush();
                    run(submitDescription, { event_id: eventId }, () => setStatus("submitted"));
                  }}
                >
                  Submit for Comms review
                </Button>
                {!validation.ok && <p className="text-xs text-gray-500 mt-1">Fix the points marked in the form first.</p>}
              </div>
            )}
            {status === "submitted" && !can.review && <p className="text-gray-600">Waiting for the Comms team.</p>}
            {can.review && status === "submitted" && (
              <div className="space-y-2">
                <Textarea aria-label="Review comment" placeholder="Comment (required when requesting changes)" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  <Button variant="success" disabled={pending || !validation.ok} onClick={() => run(reviewDescription, { event_id: eventId, decision: "approved", comment }, () => setStatus("approved"))}>
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    disabled={pending || !comment.trim()}
                    onClick={() => run(reviewDescription, { event_id: eventId, decision: "changes_requested", comment }, () => setStatus("changes_requested"))}
                  >
                    Request changes
                  </Button>
                </div>
              </div>
            )}
            {can.review && status === "approved" && (
              <div>
                <Button disabled={pending || !can.hasSpace} onClick={() => run(publishDescription, { event_id: eventId }, () => router.refresh())}>
                  {initial.publishedAt ? "Publish the update" : "Publish to the Chat space (@all)"}
                </Button>
                {!can.hasSpace && <p className="text-xs text-gray-500 mt-1">The event has no Chat space yet.</p>}
                {initial.publishRequested && <p className="text-xs text-gray-500 mt-1">Publishing is under way…</p>}
              </div>
            )}
            {error && <Alert tone="error">{error}</Alert>}
            {reviews.length > 0 && (
              <ul className="border-t border-gray-100 pt-2 space-y-2" data-testid="reviews">
                {reviews.map((r) => (
                  <li key={r.id}>
                    <Badge tone={r.decision === "approved" ? "green" : "amber"}>{r.decision === "approved" ? "Approved" : "Changes requested"}</Badge>{" "}
                    <span className="text-xs text-gray-500">
                      {r.reviewer} · {r.when}
                    </span>
                    {r.comment && <p className="text-gray-700 whitespace-pre-line mt-0.5">{r.comment}</p>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
