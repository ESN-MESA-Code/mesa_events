"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { proposeIdea } from "@/app/actions/planning";
import { EVENT_TYPES, EVENT_TYPE_LABELS } from "@/lib/labels";
import type { IdeaPrefill } from "@/lib/inspiration";

const schema = z.object({
  title: z.string().trim().min(1, "Give it a name").max(200),
  proposed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  pitch: z.string().max(2000),
  helpers_needed: z.coerce.number().int().min(0).max(50),
  wants_to_oc: z.boolean(),
  type_suggestion: z.enum(["", ...EVENT_TYPES]),
});
type Values = z.input<typeof schema>;

const EMPTY: Values = { title: "", proposed_date: "", pitch: "", helpers_needed: 2, wants_to_oc: true, type_suggestion: "" };

/** `prefill` ("Propose this again" from Get inspired) replaces the form's values whenever it changes. */
export function IdeaForm({ prefill }: { prefill?: (IdeaPrefill & { nonce: number }) | null }) {
  const { run, pending, error } = useAction();
  const { register, handleSubmit, reset, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const e = formState.errors;

  useEffect(() => {
    if (prefill) reset({ ...EMPTY, ...prefill });
  }, [prefill, reset]);

  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit((v) => {
        const p = schema.parse(v);
        run(proposeIdea, { ...p, type_suggestion: p.type_suggestion || null }, () => reset(EMPTY));
      })}
      noValidate
      data-testid="idea-form"
    >
      <Field label="Title" htmlFor="idea-title" error={e.title?.message}>
        <Input id="idea-title" {...register("title")} placeholder="e.g. Pub quiz in English" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" htmlFor="idea-date" error={e.proposed_date?.message}>
          <Input id="idea-date" type="date" {...register("proposed_date")} />
        </Field>
        <Field label="Helpers needed" htmlFor="idea-helpers" error={e.helpers_needed?.message}>
          <Input id="idea-helpers" type="number" min={0} max={50} {...register("helpers_needed")} />
        </Field>
      </div>
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
