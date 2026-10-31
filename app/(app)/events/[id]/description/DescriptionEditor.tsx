"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  CONFIG,
  ESN_OBJECTIVES,
  STEP_IDS,
  changedSteps,
  ESN_TYPES,
  applyEsnDefaults,
  coerceFields,
  esnObjectiveIds,
  formatCount,
  formatPrice,
  isDraftEmpty,
  fromTemplate,
  renderDescription,
  validateAll,
  type DescriptionFields,
  type StepId,
} from "@/lib/description/template";
import { searchTemplates, type SearchEntry } from "@/lib/description/search";
import { ACCESS_LABELS, ESN_RATINGS, RATING_LABELS, SUSTAIN_LABELS, esnGoal, parseRatings } from "@/lib/esn/formData";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select, Textarea } from "@/components/ui";
import { describeError, useAction } from "@/components/ActionButton";
import { publishDescription, reviewDescription, saveDescription, submitDescription } from "@/app/actions/descriptions";
import { cn } from "@/lib/utils";
import type { EventAddress } from "@/lib/address";
import { VenueFields } from "./VenueFields";

type Status = "draft" | "submitted" | "changes_requested" | "approved" | "published" | string;

const STATUS: Record<string, { label: string; tone: "gray" | "blue" | "amber" | "green" | "purple" }> = {
  draft: { label: "Draft", tone: "gray" },
  submitted: { label: "Waiting for Comms review", tone: "blue" },
  changes_requested: { label: "Changes requested", tone: "amber" },
  approved: { label: "Approved – ready to publish", tone: "green" },
  published: { label: "Published", tone: "purple" },
};

const STEP_TITLES: Record<StepId, string> = { basics: "Basics", intro: "Intro", program: "Programme", extras: "Details", esn: "For ESN Activities" };
/** The steps that make up the published text (left); "esn" sits below the preview. */
const TEXT_STEPS: StepId[] = ["basics", "intro", "program", "extras"];
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
  /** The event's venue name and address (the venue fields start from them). */
  place: { location: string; address: EventAddress | null; canSaveEvent: boolean };
  /** The price in the event's details (cents; null = TBA), compared with the post's (usability review #4). */
  eventPriceCents: number | null;
  /** The last review when it asked for changes, with the version it saw (null: not kept). */
  lastRequest: { reviewer: string; comment: string; when: string; fields: DescriptionFields | null } | null;
}

export function DescriptionEditor({ eventId, viewer, initial, can, pool, templates, reviews, place, eventPriceCents, lastRequest }: Props) {
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
  const { run, pending, error, confirm } = useAction();
  const [comment, setComment] = useState("");

  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);

  const rendered = useMemo(() => renderDescription(fields), [fields]);
  const validation = useMemo(() => validateAll(fields), [fields]);
  const suggestedGoal = useMemo(() => esnGoal(fields), [fields]);
  const typeRatings = ESN_RATINGS[fields.esnType] ?? { access: [2, 2, 2, 1], sustain: [1, 2] };
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

  async function applyTemplate(id: string, name: string) {
    const t = templates[id];
    if (!t) return;
    if (
      !(await confirm({
        title: `Use the description of ${name}?`,
        body: "It replaces the current text in every field. The date stays. Change what is different this time before submitting.",
        confirmLabel: "Replace the text",
        danger: !isDraftEmpty(fieldsRef.current),
      }))
    )
      return;
    const next = fromTemplate(t, fieldsRef.current);
    prefillPending.current = false;
    setFields(next);
    (Object.keys(next) as Array<keyof DescriptionFields>).forEach((k) => dirty.current.add(k));
    setShowTemplates(false);
    setSaveState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 50);
  }

  // The event's price and the post's (usability review #4): two fields, so a difference is shown.
  const eventPrice =
    eventPriceCents === null
      ? { label: "TBA", input: "TBA" }
      : eventPriceCents === 0
        ? { label: "FREE", input: "free" }
        : { label: `€ ${(eventPriceCents / 100).toFixed(2)}`, input: (eventPriceCents / 100).toFixed(2) };
  const postPrice = formatPrice(fields.price, "").value ?? "";
  const priceDiffers = postPrice !== eventPrice.label && !(eventPriceCents === null && !postPrice);

  // What changed since Comms asked for changes (usability review #17).
  const changed = useMemo(() => new Set(lastRequest?.fields ? changedSteps(lastRequest.fields, fields) : []), [lastRequest, fields]);
  const openErrors = STEP_IDS.flatMap((step) => validation.errors[step].map((e) => ({ step, e })));
  const reviewing = can.review && status === "submitted";

  function approve() {
    run(reviewDescription, { event_id: eventId, decision: "approved", comment }, () => setStatus("approved"), "Approved – it can be published now.");
  }
  function requestChanges() {
    run(reviewDescription, { event_id: eventId, decision: "changes_requested", comment }, () => setStatus("changes_requested"), "Sent back to the OC with your comment.");
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
    <div id="description" className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] scroll-mt-4">
      {/* Comms' decision at the top, staying in view (usability review #17). */}
      {reviewing && (
        <div className="sticky top-0 z-20 xl:col-span-2 rounded-xl border border-esn/30 bg-white/95 p-3 shadow-md backdrop-blur space-y-2" data-testid="review-bar">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-sm font-semibold text-esn-dark">Waiting for your review</span>
            <Button variant="success" size="sm" disabled={pending || !validation.ok} onClick={approve}>
              Approve
            </Button>
            <Button variant="outline" size="sm" disabled={pending || !comment.trim()} onClick={requestChanges}>
              Request changes
            </Button>
          </div>
          <Textarea aria-label="Review comment" placeholder="Comment (required when requesting changes)" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} className="min-h-0" />
          {!validation.ok && <p className="text-xs text-amber-800">Approving needs the points listed under “Comms hand-off” fixed – fix typos yourself, or request changes.</p>}
          {error && <Alert tone="error">{error}</Alert>}
        </div>
      )}
      {lastRequest && (status === "submitted" || status === "changes_requested") && (
        <Alert tone={status === "changes_requested" ? "warning" : "info"} className="xl:col-span-2" data-testid="last-request">
          <p>
            <strong>Changes requested</strong> by {lastRequest.reviewer}, {lastRequest.when}
            {lastRequest.comment && <>: “{lastRequest.comment}”</>}
          </p>
          <p className="mt-1 text-xs">
            {!lastRequest.fields
              ? "The version Comms saw is not kept, so changes can't be shown."
              : changed.size
                ? `Changed since: ${[...changed].map((s) => STEP_TITLES[s]).join(", ")} (marked below).`
                : "Nothing changed since then yet."}
          </p>
        </Alert>
      )}
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
                    <Button size="sm" variant="outline" className="ml-auto" onClick={() => applyTemplate(r.rec.eventId, r.rec.published.title || r.rec.eventTitle)}>
                      Use
                    </Button>
                  </li>
                ))}
              </ul>
              {results.totalGroups > results.shownGroups && <p className="text-xs text-gray-500">Showing {results.shownGroups} of {results.totalGroups} – refine the search.</p>}
            </CardContent>
          </Card>
        )}

        {TEXT_STEPS.map((step) => (
          <Card key={step} id={`step-${step}`} className={cn("scroll-mt-40", changed.has(step) && "ring-2 ring-esn/40")}>
            <CardHeader>
              <CardTitle>{STEP_TITLES[step]}</CardTitle>
              {changed.has(step) && <Badge tone="blue">Changed since the review</Badge>}
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
                  <VenueFields eventId={eventId} initial={place} canSaveEvent={place.canSaveEvent} postVenue={fields.venue} onVenue={(v) => change("venue", v)} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    {text("price", "Price shown in the post", { hint: `9.50, free or TBA · event details: ${eventPrice.label}` })}
                    {text("priceNote", "Price note", { placeholder: "ESNcard holders € 7.50" })}
                  </div>
                  {priceDiffers && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status" data-testid="price-mismatch">
                      The post says <strong>{postPrice || "nothing"}</strong>, the event&apos;s details say <strong>{eventPrice.label}</strong>.{" "}
                      {eventPriceCents !== null ? (
                        <button type="button" className="font-semibold underline" onClick={() => change("price", eventPrice.input)}>
                          Use {eventPrice.label} in the post
                        </button>
                      ) : (
                        <>
                          {place.canSaveEvent ? "Set the price under Overview → Edit details" : "The OC sets the price in the event's details"} once it is fixed.
                        </>
                      )}
                    </div>
                  )}
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

      {/* The preview stays in view while editing (usability review #16). */}
      <div className={cn("space-y-4 h-fit xl:sticky xl:overflow-y-auto xl:pr-1", reviewing ? "xl:top-44 xl:max-h-[calc(100vh-12rem)]" : "xl:top-4 xl:max-h-[calc(100vh-2rem)]")} data-testid="preview-column">
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

        <Card data-testid="esn-details" id="step-esn" className={cn("scroll-mt-40", changed.has("esn") && "ring-2 ring-esn/40")}>
          <CardHeader>
            <CardTitle>{STEP_TITLES.esn}</CardTitle>
            {changed.has("esn") && <Badge tone="blue">Changed since the review</Badge>}
            {validation.errors.esn.length > 0 && <Badge tone="amber">{validation.errors.esn.length} to fix</Badge>}
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-gray-500">Not part of the post above – the executive board needs it to register the event on activities.esn.org. Changing only these keeps the review.</p>
                  <Field label="Activity type" htmlFor="f-esnType">
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
                    <legend className="text-sm font-medium text-gray-700 mb-1">Objectives</legend>
                    <div className="grid sm:grid-cols-2 gap-1 text-xs">
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
            <Field label="Goal of the event" htmlFor="f-esnGoal" hint="1–3 sentences: what should participants get out of it?">
              <Textarea id="f-esnGoal" rows={3} value={fields.esnGoal} onChange={(e) => change("esnGoal", e.target.value)} onBlur={flush} />
            </Field>
            {!fields.esnGoal.trim() && suggestedGoal && (
              <button type="button" className="text-xs text-esn hover:underline" onClick={() => change("esnGoal", suggestedGoal)}>
                Use “{suggestedGoal.slice(0, 80)}{suggestedGoal.length > 80 ? "…" : ""}” (from the hook and intro)
              </button>
            )}
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="mb-1 text-sm font-medium text-gray-700">Accessibility and sustainability</legend>
              {[...ACCESS_LABELS.map((label, i) => ({ key: "esnAccess" as const, n: 4, i, label })), ...SUSTAIN_LABELS.map((label, i) => ({ key: "esnSustain" as const, n: 2, i, label }))].map((r) => {
                const current = parseRatings(fields[r.key], r.n) ?? (r.key === "esnAccess" ? typeRatings.access : typeRatings.sustain);
                return (
                  <Field key={`${r.key}-${r.i}`} label={r.label} htmlFor={`f-${r.key}-${r.i}`}>
                    <Select
                      id={`f-${r.key}-${r.i}`}
                      value={String(current[r.i])}
                      onChange={(e) => change(r.key, current.map((v, j) => (j === r.i ? Number(e.target.value) : v)).join(","))}
                    >
                      {RATING_LABELS.map((l, v) => (
                        <option key={l} value={v}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  </Field>
                );
              })}
            </fieldset>
            {validation.errors.esn.map((e) => (
              <p key={e} className="text-xs text-red-600">
                {e}
              </p>
            ))}
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
                    run(submitDescription, { event_id: eventId }, () => setStatus("submitted"), "Submitted – Comms reviews it next. You'll see their answer here.");
                  }}
                >
                  Submit for Comms review
                </Button>
                {!validation.ok && <OpenErrors errors={openErrors} />}
              </div>
            )}
            {status === "submitted" && !can.review && <p className="text-gray-600">Waiting for the Comms team.</p>}
            {reviewing && <p className="text-gray-600">Approve or request changes in the bar at the top.</p>}
            {reviewing && !validation.ok && <OpenErrors errors={openErrors} />}
            {can.review && status === "approved" && (
              <div>
                <Button disabled={pending || !can.hasSpace} onClick={() => run(publishDescription, { event_id: eventId }, () => router.refresh(), "Publishing to the Chat space…")}>
                  {initial.publishedAt ? "Publish the update" : "Publish to the Chat space (@all)"}
                </Button>
                {!can.hasSpace && <p className="text-xs text-gray-500 mt-1">The event has no Chat space yet.</p>}
                {initial.publishRequested && <p className="text-xs text-gray-500 mt-1">Publishing is under way…</p>}
              </div>
            )}
            {error && !reviewing && <Alert tone="error">{error}</Alert>}
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

/** The open errors next to the submit or approve button, each a link to its step (usability review #16). */
function OpenErrors({ errors }: { errors: Array<{ step: StepId; e: string }> }) {
  return (
    <div className="mt-2 text-xs" data-testid="open-errors">
      <p className="text-gray-600">Fix these first:</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {errors.map(({ step, e }) => (
          <li key={`${step}-${e}`}>
            <a href={`#step-${step}`} className="text-red-700 hover:underline">
              {STEP_TITLES[step]}: {e}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
