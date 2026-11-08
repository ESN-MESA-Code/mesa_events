"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { CategoryBadge, CategorySelect, FormatSelect } from "@/components/Sorting";
import { updateEvent } from "@/app/actions/planning";
import type { Category, Format } from "@/lib/formats";
import { plural } from "@/lib/plural";

export interface Sorting {
  categoryId: string | null;
  formatId: string | null;
  /** Earlier runs of the format that took place. */
  runs: number;
  /** The Events team changes them (the OC and Comms see them). */
  canEdit: boolean;
  categories: Category[];
  formats: Format[];
}

/**
 * The event's category and format above its description (round 2026-11-01):
 * what kind of event it is and which recurring event it is a run of. The
 * Events team changes them here; `onCategory` tells the editor the old and
 * new category, so an untouched ESN activity type can follow.
 */
export function SortingBar({ eventId, sorting, onCategory }: { eventId: string; sorting: Sorting; onCategory: (from: Category | undefined, to: Category | undefined) => void }) {
  const { run, pending, error } = useAction();
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState({ categoryId: sorting.categoryId ?? "", formatId: sorting.formatId ?? "" });
  const [draft, setDraft] = useState(current);
  const categoryOf = (id: string) => sorting.categories.find((c) => c.id === id);
  const format = sorting.formats.find((f) => f.id === current.formatId);

  function save() {
    // A format brings its category when none is picked (as the database does).
    const categoryId = draft.categoryId || sorting.formats.find((f) => f.id === draft.formatId)?.category_id || "";
    run(updateEvent, { id: eventId, category_id: categoryId || null, format_id: draft.formatId || null }, () => {
      if (categoryId !== current.categoryId) onCategory(categoryOf(current.categoryId), categoryOf(categoryId));
      setCurrent({ categoryId, formatId: draft.formatId });
      setEditing(false);
    }, "Category and format saved.");
  }

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-2.5 text-sm" data-testid="sorting-bar">
        <CategorySelect aria-label="Category" categories={sorting.categories} value={draft.categoryId} onChange={(id) => setDraft({ ...draft, categoryId: id })} className="h-8 w-auto" />
        <FormatSelect
          aria-label="A run of"
          formats={sorting.formats}
          categories={sorting.categories}
          value={draft.formatId}
          empty="A one-off – no format"
          onChange={(id) => setDraft({ formatId: id, categoryId: sorting.formats.find((f) => f.id === id)?.category_id ?? draft.categoryId })}
          size="sm"
        />
        <Button size="sm" disabled={pending} onClick={save}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600" data-testid="sorting-bar">
      {current.categoryId ? <CategoryBadge category={categoryOf(current.categoryId)} /> : <span className="text-xs text-gray-500">No category yet</span>}
      <span className="text-xs">
        {format ? (
          <>
            a run of <strong className="font-medium text-gray-800">{format.name}</strong> ({sorting.runs ? `ran ${plural(sorting.runs, "time")} before` : "the first run"})
          </>
        ) : (
          "a one-off"
        )}
      </span>
      {sorting.canEdit && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setDraft(current);
            setEditing(true);
          }}
        >
          Change
        </Button>
      )}
    </div>
  );
}
