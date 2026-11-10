"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { CategorySelect } from "@/components/Sorting";
import { proposeIdea } from "@/app/actions/planning";
import { EVENT_TYPES, EVENT_TYPE_LABELS } from "@/lib/labels";
import { formatKey, suggestCategory, type Category } from "@/lib/formats";
import { ideaFromEarlier, type EarlierEvent, type IdeaPrefill } from "@/lib/inspiration";
import { cycleTimeline, type TimelineDays } from "@/lib/timeline";
import { formatDate, formatDateTime, monthLabel } from "@/lib/dates";
import { PartnerPicker, type Member, type Partner } from "./PartnerPicker";
import { TitleSearch, runsNote } from "./TitleSearch";

const schema = z.object({
  title: z.string().trim().min(1, "Give it a name").max(200),
  proposed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  pitch: z.string().max(2000),
  helpers_needed: z.coerce.number().int().min(0).max(50),
  ocs_needed: z.coerce.number().int().min(1).max(10),
  wants_to_oc: z.boolean(),
  type_suggestion: z.enum(["", ...EVENT_TYPES]),
  category_id: z.string(),
  format_id: z.string(),
});
type Values = z.input<typeof schema>;

const EMPTY: Values = { title: "", proposed_date: "", pitch: "", helpers_needed: 2, ocs_needed: 1, wants_to_oc: true, type_suggestion: "", category_id: "", format_id: "" };

/**
 * `prefill` ("Propose this again" from Get inspired) fills the form (the
 * workspace mounts a new form for each one). The category follows the title (suggested
 * from the keywords) until the member picks one. The title searches the
 * earlier events (round 2026-11-10, replacing the separate "new run of"
 * field): picking one links its format and fills in the rest from its last
 * run – every field the member has not typed into themself. The date starts at
 * `earliest`: months whose ideas deadline passed are closed, every later one
 * is open (round 2026-11-02).
 */
export function IdeaForm({
  prefill,
  categories,
  earlier,
  earliest,
  days,
  members,
  onDone,
}: {
  prefill?: (IdeaPrefill & { nonce: number }) | null;
  categories: Category[];
  /** The earlier events the title offers (lib/inspiration.ts earlierEvents). */
  earlier: EarlierEvent[];
  earliest: string;
  days: TimelineDays;
  /** Everyone who can be named as partner (not the viewer). */
  members: Member[];
  /** After the idea is sent (the side panel closes). */
  onDone?: () => void;
}) {
  const { run, pending, error } = useAction();
  const checked = useMemo(
    () => schema.refine((v) => v.proposed_date >= earliest, { path: ["proposed_date"], message: `Ideas for that month are closed – pick a date from ${formatDate(`${earliest}T12:00:00Z`)} on` }),
    [earliest]
  );
  const { register, handleSubmit, reset, setValue, getValues, control, formState } = useForm<Values>({
    resolver: zodResolver(checked),
    defaultValues: prefill ? { ...EMPTY, ...prefill, category_id: prefill.category_id ?? "", format_id: prefill.format_id ?? "" } : EMPTY,
  });
  const e = formState.errors;
  // Read here so the form tracks them: a pick leaves the fields the member typed into alone.
  const dirty = formState.dirtyFields;
  const [title, categoryId, formatId, date] = useWatch({ control, name: ["title", "category_id", "format_id", "proposed_date"] });
  // Which month's schedule the idea goes into, and until when ideas for it are taken.
  const dateHint = /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") && date! >= earliest
    ? `Goes into the ${monthLabel(`${date!.slice(0, 7)}-01`)} schedule – ideas for it are due ${formatDateTime(cycleTimeline(`${date!.slice(0, 7)}-01`, days).ideasDue)}.`
    : `From ${formatDate(`${earliest}T12:00:00Z`)} on – any later month is fine, next year too.`;
  // The member chose the category (or it came with "Propose this again"): no more suggestions.
  const [picked, setPicked] = useState(!!prefill?.category_id);
  // Partners (round 2026-11-04): asked as co-OC or helper; co-OCs raise the OCs needed.
  const [partners, setPartners] = useState<Partner[]>([]);
  const wantsOc = useWatch({ control, name: "wants_to_oc" });
  const minOcs = Math.max(1, (wantsOc ? 1 : 0) + partners.filter((p) => p.role === "oc").length);
  useEffect(() => {
    if (Number(getValues("ocs_needed")) < minOcs) setValue("ocs_needed", minOcs);
  }, [minOcs, getValues, setValue]);

  const suggested = useMemo(() => suggestCategory({ title: title ?? "" }, categories)?.id ?? "", [title, categories]);
  useEffect(() => {
    if (picked || formatId) return;
    if (suggested !== getValues("category_id")) setValue("category_id", suggested);
  }, [suggested, picked, formatId, getValues, setValue]);

  // The earlier event this idea runs again: picked from the title's list, or the one "Propose this again" came from.
  const [source, setSource] = useState<EarlierEvent | null>(() =>
    prefill ? (earlier.find((g) => (prefill.format_id ? g.format?.id === prefill.format_id : g.key === `t:${formatKey(prefill.title)}`)) ?? null) : null
  );
  const [categoryByHand, setCategoryByHand] = useState(false);

  function pickEarlier(g: EarlierEvent) {
    const fill = ideaFromEarlier(g, earliest);
    setSource(g);
    setValue("title", fill.title, { shouldValidate: formState.isSubmitted });
    setValue("format_id", fill.format_id ?? "");
    if (!dirty.pitch) setValue("pitch", fill.pitch);
    if (!dirty.proposed_date && fill.proposed_date) setValue("proposed_date", fill.proposed_date, { shouldValidate: formState.isSubmitted });
    if (!dirty.helpers_needed) setValue("helpers_needed", fill.helpers_needed);
    if (!dirty.type_suggestion) setValue("type_suggestion", fill.type_suggestion);
    if (fill.category_id && !categoryByHand) {
      setValue("category_id", fill.category_id);
      setPicked(true);
    }
  }
  // "It's something new": the idea keeps what is filled in, without the link.
  function unlink() {
    setSource(null);
    setValue("format_id", "");
  }

  return (
    <form
      className="space-y-6"
      onSubmit={handleSubmit((v) => {
        const p = checked.parse(v);
        run(proposeIdea, { ...p, type_suggestion: p.type_suggestion || null, category_id: p.category_id || null, format_id: p.format_id || null, partners }, () => {
          setPicked(false);
          setSource(null);
          setCategoryByHand(false);
          setPartners([]);
          reset(EMPTY);
          onDone?.();
        }, "Idea sent – the Events team sees it now.");
      })}
      noValidate
      data-testid="idea-form"
    >
      <Group title="What">
        {/* Which earlier event this runs again, above the title it named (round 2026-11-10). */}
        {source && (
          <div className="flex items-start gap-2 rounded-lg border border-esn/30 bg-esn/5 px-3 py-2 text-sm" data-testid="idea-rerun">
            <span aria-hidden className="mt-px text-esn">
              ↻
            </span>
            <p className="min-w-0 flex-1 text-gray-700">
              {formatId ? "A new run of " : "Again: "}
              <strong className="font-semibold text-gray-900">{source.name}</strong> <span className="text-gray-500">({runsNote(source)})</span>
              {source.runs.length > 0 && <span className="block text-xs text-gray-500">Filled in from its last run – change anything you like.</span>}
            </p>
            <button type="button" className="shrink-0 text-xs font-semibold text-esn hover:underline" onClick={unlink}>
              It&apos;s something new
            </button>
          </div>
        )}
        <Field
          label="Title"
          htmlFor="idea-title"
          error={e.title?.message}
          hint={source || !earlier.length ? undefined : "Type a new name – or pick an earlier event to run it again, and the rest fills itself in."}
        >
          <TitleSearch
            id="idea-title"
            field={register("title")}
            text={title ?? ""}
            options={earlier}
            categories={categories}
            onPick={pickEarlier}
            invalid={!!e.title}
            placeholder={earlier.length ? "e.g. Pub quiz in English – or search earlier events" : "e.g. Pub quiz in English"}
          />
        </Field>
        <Field label="Pitch" htmlFor="idea-pitch" hint="What is it, why would internationals love it, rough costs?" error={e.pitch?.message}>
          <Textarea id="idea-pitch" rows={4} {...register("pitch")} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category" htmlFor="idea-category" hint={categoryId && categoryId === suggested && !formatId ? "Suggested from the title" : undefined}>
            <CategorySelect
              id="idea-category"
              categories={categories}
              value={categoryId ?? ""}
              empty="Not sure"
              onChange={(id) => {
                setPicked(true);
                setCategoryByHand(true);
                setValue("category_id", id);
              }}
            />
          </Field>
          <Field label="Type" htmlFor="idea-type" hint="A suggestion – the Events team decides.">
            <Select id="idea-type" {...register("type_suggestion")}>
              <option value="">Not sure</option>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EVENT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Group>
      <Group title="When">
        <Field label="Date" htmlFor="idea-date" error={e.proposed_date?.message} hint={e.proposed_date ? undefined : dateHint}>
          <Input id="idea-date" type="date" min={earliest} {...register("proposed_date")} />
        </Field>
      </Group>
      <Group title="Who">
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 text-sm has-[:checked]:border-esn/40 has-[:checked]:bg-esn/5">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-esn" {...register("wants_to_oc")} />
          <span>
            <span className="block font-medium text-gray-900">I want to be the OC of this event</span>
            <span className="block text-xs text-gray-600">Untick it if you only bring the idea and someone else should run it.</span>
          </span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="OCs needed" htmlFor="idea-ocs" error={e.ocs_needed?.message} hint={minOcs > 1 ? `At least ${minOcs}: you and your co-OCs` : undefined}>
            <Input id="idea-ocs" type="number" min={minOcs} max={10} {...register("ocs_needed")} />
          </Field>
          <Field label="Helpers needed" htmlFor="idea-helpers" error={e.helpers_needed?.message}>
            <Input id="idea-helpers" type="number" min={0} max={50} {...register("helpers_needed")} />
          </Field>
        </div>
        <Field label="Run it with someone? (optional)" hint="They are asked first and count once they say yes – as co-OC or helper. Nobody else is asked for the slots they take.">
          <PartnerPicker members={members} value={partners} onChange={setPartners} />
        </Field>
      </Group>
      {/* Stays in view at the bottom of the side panel. */}
      <div className="sticky bottom-0 -mx-5 space-y-2 border-t border-gray-200 bg-white px-5 py-3">
        {error && <Alert tone="error">{error}</Alert>}
        <Button size="lg" className="w-full" disabled={pending}>
          {pending ? "Sending…" : "Propose idea"}
        </Button>
      </div>
    </form>
  );
}

/** A titled group of fields in the form. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-500">{title}</legend>
      {children}
    </fieldset>
  );
}
