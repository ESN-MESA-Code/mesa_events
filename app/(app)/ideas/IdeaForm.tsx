"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { CategorySelect, FormatSelect } from "@/components/Sorting";
import { proposeIdea } from "@/app/actions/planning";
import { EVENT_TYPES, EVENT_TYPE_LABELS } from "@/lib/labels";
import { suggestCategory, type Category, type Format } from "@/lib/formats";
import type { IdeaPrefill } from "@/lib/inspiration";
import { cycleTimeline, type TimelineDays } from "@/lib/timeline";
import { formatDate, formatDateTime, monthLabel } from "@/lib/dates";
import { PartnerPicker, type Member, type Partner } from "./PartnerPicker";

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
 * from the keywords) until the member picks one; a format brings its
 * category, type and helpers (round 2026-11-01). The date starts at
 * `earliest`: months whose ideas deadline passed are closed, every later one
 * is open (round 2026-11-02).
 */
export function IdeaForm({
  prefill,
  categories,
  formats,
  earliest,
  days,
  members,
}: {
  prefill?: (IdeaPrefill & { nonce: number }) | null;
  categories: Category[];
  formats: Format[];
  earliest: string;
  days: TimelineDays;
  /** Everyone who can be named as partner (not the viewer). */
  members: Member[];
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

  function pickFormat(id: string) {
    setValue("format_id", id);
    const f = formats.find((x) => x.id === id);
    if (!f) return;
    if (f.category_id) {
      setValue("category_id", f.category_id);
      setPicked(true);
    }
    if (!getValues("title").trim()) setValue("title", f.name, { shouldValidate: true });
    if (!getValues("type_suggestion")) setValue("type_suggestion", f.type);
    setValue("helpers_needed", f.helpers_needed);
  }

  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit((v) => {
        const p = checked.parse(v);
        run(proposeIdea, { ...p, type_suggestion: p.type_suggestion || null, category_id: p.category_id || null, format_id: p.format_id || null, partners }, () => {
          setPicked(false);
          setPartners([]);
          reset(EMPTY);
        });
      })}
      noValidate
      data-testid="idea-form"
    >
      <Field label="Title" htmlFor="idea-title" error={e.title?.message}>
        <Input id="idea-title" {...register("title")} placeholder="e.g. Pub quiz in English" />
      </Field>
      {formats.length > 0 && (
        <Field label="Is this a new run of an event we did before?" htmlFor="idea-format" hint="Then its earlier runs and descriptions stay together.">
          <FormatSelect id="idea-format" formats={formats} categories={categories} value={formatId ?? ""} onChange={pickFormat} />
        </Field>
      )}
      <Field label="Date" htmlFor="idea-date" error={e.proposed_date?.message} hint={e.proposed_date ? undefined : dateHint}>
        <Input id="idea-date" type="date" min={earliest} {...register("proposed_date")} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="OCs needed" htmlFor="idea-ocs" error={e.ocs_needed?.message} hint={minOcs > 1 ? `At least ${minOcs}: you and your co-OCs` : undefined}>
          <Input id="idea-ocs" type="number" min={minOcs} max={10} {...register("ocs_needed")} />
        </Field>
        <Field label="Helpers needed" htmlFor="idea-helpers" error={e.helpers_needed?.message}>
          <Input id="idea-helpers" type="number" min={0} max={50} {...register("helpers_needed")} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category" htmlFor="idea-category" hint={categoryId && categoryId === suggested && !formatId ? "Suggested from the title" : undefined}>
          <CategorySelect
            id="idea-category"
            categories={categories}
            value={categoryId ?? ""}
            empty="Not sure"
            onChange={(id) => {
              setPicked(true);
              setValue("category_id", id);
            }}
          />
        </Field>
        <Field label="Type (a suggestion – the Events team decides)" htmlFor="idea-type">
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
      <Field label="Pitch" htmlFor="idea-pitch" hint="What is it, why would internationals love it, rough costs?" error={e.pitch?.message}>
        <Textarea id="idea-pitch" rows={4} {...register("pitch")} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" {...register("wants_to_oc")} /> I want to be the OC of this event
      </label>
      <Field label="Run it with someone? (optional)" hint="They are asked first and count once they say yes – as co-OC or helper. Nobody else is asked for the slots they take.">
        <PartnerPicker members={members} value={partners} onChange={setPartners} />
      </Field>
      {error && <Alert tone="error">{error}</Alert>}
      <Button disabled={pending}>{pending ? "Sending…" : "Propose idea"}</Button>
    </form>
  );
}
