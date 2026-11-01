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

const schema = z.object({
  title: z.string().trim().min(1, "Give it a name").max(200),
  proposed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  pitch: z.string().max(2000),
  helpers_needed: z.coerce.number().int().min(0).max(50),
  wants_to_oc: z.boolean(),
  type_suggestion: z.enum(["", ...EVENT_TYPES]),
  category_id: z.string(),
  format_id: z.string(),
});
type Values = z.input<typeof schema>;

const EMPTY: Values = { title: "", proposed_date: "", pitch: "", helpers_needed: 2, wants_to_oc: true, type_suggestion: "", category_id: "", format_id: "" };

/**
 * `prefill` ("Propose this again" from Get inspired) fills the form (the
 * workspace mounts a new form for each one). The category follows the title (suggested
 * from the keywords) until the member picks one; a format brings its
 * category, type and helpers (round 2026-11-01).
 */
export function IdeaForm({ prefill, categories, formats }: { prefill?: (IdeaPrefill & { nonce: number }) | null; categories: Category[]; formats: Format[] }) {
  const { run, pending, error } = useAction();
  const { register, handleSubmit, reset, setValue, getValues, control, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: prefill ? { ...EMPTY, ...prefill, category_id: prefill.category_id ?? "", format_id: prefill.format_id ?? "" } : EMPTY,
  });
  const e = formState.errors;
  const [title, categoryId, formatId] = useWatch({ control, name: ["title", "category_id", "format_id"] });
  // The member chose the category (or it came with "Propose this again"): no more suggestions.
  const [picked, setPicked] = useState(!!prefill?.category_id);

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
        const p = schema.parse(v);
        run(proposeIdea, { ...p, type_suggestion: p.type_suggestion || null, category_id: p.category_id || null, format_id: p.format_id || null }, () => {
          setPicked(false);
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
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" htmlFor="idea-date" error={e.proposed_date?.message}>
          <Input id="idea-date" type="date" {...register("proposed_date")} />
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
      {error && <Alert tone="error">{error}</Alert>}
      <Button disabled={pending}>{pending ? "Sending…" : "Propose idea"}</Button>
    </form>
  );
}
