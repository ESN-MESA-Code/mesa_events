"use client";

import { useMemo, useState } from "react";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Field, Input, Select, Textarea } from "@/components/ui";
import { ActionButton, useAction } from "@/components/ActionButton";
import { CategoryBadge, CategorySelect, FormatSelect } from "@/components/Sorting";
import {
  addEventCategory,
  createFormat,
  mergeFormats,
  setEventCategoryActive,
  setFormatActive,
  sortPastEvents,
  unlinkEvents,
  updateEventCategory,
  updateFormat,
} from "@/app/actions/formats";
import { EVENT_TYPES, EVENT_TYPE_LABELS, type EventType } from "@/lib/labels";
import { ESN_TYPES } from "@/lib/description/template";
import { categoryLabel, sortedCategories, type Category, type Format } from "@/lib/formats";
import { formatDate } from "@/lib/dates";
import { plural } from "@/lib/plural";

// ── Sorting events ──────────────────────────────────────────────────────────

export interface SortGroup {
  key: string;
  name: string;
  categoryId: string | null;
  formatId: string | null;
  /** Events of the group without a category yet. */
  uncategorized: number;
  type: EventType;
  helpers: number;
  location: string | null;
  events: Array<{ id: string; title: string; startsAt: string }>;
}

/** "new" = a new format named after the group, "" = one-offs (category only), else an existing format. */
type Choice = { name: string; categoryId: string; target: string };

const initialChoice = (g: SortGroup): Choice => ({ name: g.name, categoryId: g.categoryId ?? "", target: g.formatId ?? (g.events.length > 1 ? "new" : "") });

function itemOf(g: SortGroup, c: Choice) {
  const target = c.target === "new" && !c.name.trim() ? "" : c.target;
  if (!c.categoryId && !target) return null;
  return {
    event_ids: g.events.map((e) => e.id),
    category_id: c.categoryId || null,
    format_id: target && target !== "new" ? target : null,
    // History has no helpers: a new format starts with the usual two.
    new_format: target === "new" ? { name: c.name.trim(), type: g.type, helpers_needed: g.helpers > 0 ? g.helpers : 2, location: g.location } : null,
  };
}

/**
 * Events without a format, grouped by their name (runs of one event meet:
 * "Hike to X" = "Hiking Trip to X"), with a suggested category, and a new
 * format for repeats or the existing one of the same name. One row or all
 * shown at once.
 */
export function SortCard({ groups, categories, formats, canEdit }: { groups: SortGroup[]; categories: Category[]; formats: Format[]; canEdit: boolean }) {
  const { run, pending, error } = useAction();
  const [filter, setFilter] = useState<"category" | "repeats" | "all">(groups.some((g) => g.uncategorized) ? "category" : "repeats");
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [open, setOpen] = useState<string | null>(null);
  const choiceOf = (g: SortGroup) => choices[g.key] ?? initialChoice(g);
  const set = (g: SortGroup, patch: Partial<Choice>) => setChoices((c) => ({ ...c, [g.key]: { ...choiceOf(g), ...patch } }));
  const shown = useMemo(
    () => groups.filter((g) => (filter === "all" ? true : filter === "category" ? g.uncategorized > 0 : g.events.length > 1 || !!g.formatId)),
    [groups, filter]
  );
  const items = shown.map((g) => itemOf(g, choiceOf(g))).filter((x) => x !== null);
  const counts = { category: groups.filter((g) => g.uncategorized > 0).length, repeats: groups.filter((g) => g.events.length > 1 || g.formatId).length, all: groups.length };

  return (
    <Card data-testid="sort-events">
      <CardHeader>
        <CardTitle>Sort events</CardTitle>
        <span className="text-xs text-gray-500">{plural(groups.reduce((n, g) => n + g.events.length, 0), "event")} without a format</span>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {(
            [
              ["category", "Without a category"],
              ["repeats", "Repeats without a format"],
              ["all", "All without a format"],
            ] as const
          ).map(([k, label]) => (
            <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} onClick={() => setFilter(k)} aria-pressed={filter === k}>
              {label} ({counts[k]})
            </Button>
          ))}
          {canEdit && items.length > 0 && (
            <Button
              size="sm"
              variant="success"
              className="ml-auto"
              disabled={pending}
              onClick={() => run(sortPastEvents, { items }, () => setChoices({}), (d) => `${plural(d.sorted, "event")} sorted.`)}
              data-testid="sort-all"
            >
              Save all {plural(shown.length, "row")} as shown
            </Button>
          )}
        </div>
        <p className="text-xs text-gray-500">
          Categories are suggested from the names (keywords below), a new format for events that ran more than once. Check the rows, change what is wrong, then save one row or all.
        </p>
        {error && <Alert tone="error">{error}</Alert>}
        {!shown.length ? (
          <EmptyState>Nothing to sort here.</EmptyState>
        ) : (
          <ul className="divide-y divide-gray-100" data-testid="sort-groups">
            {shown.map((g) => {
              const c = choiceOf(g);
              const item = itemOf(g, c);
              const first = g.events[g.events.length - 1].startsAt;
              const last = g.events[0].startsAt;
              return (
                <li key={g.key} className="grid gap-2 py-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] lg:items-center" data-testid={`sort-${g.name}`}>
                  <div className="min-w-0 space-y-1">
                    {c.target === "new" && canEdit ? (
                      <Input aria-label={`Format name for ${g.name}`} value={c.name} onChange={(e) => set(g, { name: e.target.value })} className="h-8" />
                    ) : (
                      <p className="truncate font-medium text-gray-900">{g.name}</p>
                    )}
                    <button type="button" className="text-xs text-esn hover:underline" onClick={() => setOpen(open === g.key ? null : g.key)} aria-expanded={open === g.key}>
                      {g.events.length > 1 ? `${plural(g.events.length, "run")}, ${formatDate(first)} – ${formatDate(last)}` : formatDate(last)}
                    </button>
                    {open === g.key && (
                      <ul className="ml-4 list-disc pl-4 text-xs text-gray-500">
                        {g.events.map((e) => (
                          <li key={e.id}>
                            {formatDate(e.startsAt)} · {e.title}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <CategorySelect aria-label={`Category of ${g.name}`} categories={categories} value={c.categoryId} onChange={(id) => set(g, { categoryId: id })} disabled={!canEdit} />
                  <Select aria-label={`Format of ${g.name}`} value={c.target} onChange={(e) => set(g, { target: e.target.value })} disabled={!canEdit}>
                    <option value="">{g.events.length > 1 ? "One-offs – no format" : "A one-off – no format"}</option>
                    <option value="new">New format “{c.name.trim() || g.name}”</option>
                    {formats
                      .filter((f) => f.active || f.id === c.target)
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          Add to {f.name}
                        </option>
                      ))}
                  </Select>
                  {canEdit && (
                    <Button size="sm" variant="outline" disabled={pending || !item} onClick={() => item && run(sortPastEvents, { items: [item] }, undefined, `${g.name} sorted.`)}>
                      Save
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ── Formats ─────────────────────────────────────────────────────────────────

interface FormatRow extends Format {
  stats: { runs: number; avgHeadcount: number | null; last: string | null };
  runs: Array<{ id: string; title: string; startsAt: string; headcount: number | null }>;
}

function FormatForm({ initial, categories, onDone }: { initial?: FormatRow; categories: Category[]; onDone: () => void }) {
  const { run, pending, error } = useAction();
  const [v, setV] = useState({
    name: initial?.name ?? "",
    category_id: initial?.category_id ?? "",
    type: initial?.type ?? ("standard" as EventType),
    helpers_needed: initial?.helpers_needed ?? 2,
    location: initial?.location ?? "",
    meeting_point: initial?.meeting_point ?? "",
  });
  const id = initial?.id ?? "new";
  return (
    <form
      className="grid gap-3 rounded-lg border border-dashed border-gray-300 p-3 sm:grid-cols-2 lg:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        const input = { ...v, category_id: v.category_id || null, location: v.location || null, meeting_point: v.meeting_point || null, helpers_needed: Number(v.helpers_needed) };
        if (initial) run(updateFormat, { id: initial.id, ...input }, onDone, "Format saved.");
        else run(createFormat, input, onDone, "Format added.");
      }}
    >
      <Field label="Name" htmlFor={`fm-name-${id}`}>
        <Input id={`fm-name-${id}`} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required maxLength={200} />
      </Field>
      <Field label="Category" htmlFor={`fm-cat-${id}`}>
        <CategorySelect id={`fm-cat-${id}`} categories={categories} value={v.category_id} onChange={(c) => setV({ ...v, category_id: c })} />
      </Field>
      <Field label="Type" htmlFor={`fm-type-${id}`}>
        <Select id={`fm-type-${id}`} value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as EventType })}>
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {EVENT_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Helpers" htmlFor={`fm-helpers-${id}`}>
        <Input id={`fm-helpers-${id}`} type="number" min={0} max={50} value={v.helpers_needed} onChange={(e) => setV({ ...v, helpers_needed: Number(e.target.value) })} />
      </Field>
      <Field label="Usual place" htmlFor={`fm-loc-${id}`}>
        <Input id={`fm-loc-${id}`} value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} maxLength={300} />
      </Field>
      <Field label="Usual meeting point" htmlFor={`fm-meet-${id}`} hint="Only when people meet elsewhere">
        <Input id={`fm-meet-${id}`} value={v.meeting_point} onChange={(e) => setV({ ...v, meeting_point: e.target.value })} maxLength={300} placeholder="e.g. München Hauptbahnhof" />
      </Field>
      <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-3">
        <Button size="sm" disabled={pending}>
          {initial ? "Save" : "Add format"}
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </form>
  );
}

/** The formats: runs and turnout, edit, merge two into one, hide; the runs with "Take out". */
export function FormatsCard({ formats, categories, canEdit }: { formats: FormatRow[]; categories: Category[]; canEdit: boolean }) {
  const { run, pending, error } = useAction();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [merging, setMerging] = useState<{ from: string; into: string } | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const categoryOf = new Map(categories.map((c) => [c.id, c]));
  const list = formats.filter((f) => showHidden || f.active).sort((a, b) => b.stats.runs - a.stats.runs || a.name.localeCompare(b.name));

  return (
    <Card data-testid="formats">
      <CardHeader>
        <CardTitle>Formats</CardTitle>
        <span className="text-xs text-gray-500">{plural(formats.filter((f) => f.active).length, "format")}</span>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && !adding && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              + New format
            </Button>
          )}
          {formats.some((f) => !f.active) && (
            <label className="ml-auto flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden
            </label>
          )}
        </div>
        {adding && <FormatForm categories={categories} onDone={() => setAdding(false)} />}
        {error && <Alert tone="error">{error}</Alert>}
        {!list.length ? (
          <EmptyState>No formats yet – sort the events above, or add one.</EmptyState>
        ) : (
          <ul className="divide-y divide-gray-100" data-testid="format-list">
            {list.map((f) =>
              editing === f.id ? (
                <li key={f.id} className="py-3">
                  <FormatForm initial={f} categories={categories} onDone={() => setEditing(null)} />
                </li>
              ) : (
                <li key={f.id} className="space-y-2 py-2.5" data-testid={`format-${f.name}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{f.name}</span>
                    <CategoryBadge category={f.category_id ? categoryOf.get(f.category_id) : null} />
                    <Badge>{EVENT_TYPE_LABELS[f.type]}</Badge>
                    {!f.active && <Badge tone="amber">hidden</Badge>}
                    <button type="button" className="text-xs text-esn hover:underline" onClick={() => setOpen(open === f.id ? null : f.id)} aria-expanded={open === f.id}>
                      {f.stats.runs ? `ran ${plural(f.stats.runs, "time")}` : "no run yet"}
                      {f.runs.length > f.stats.runs ? `, ${f.runs.length - f.stats.runs} planned` : ""}
                    </button>
                    <span className="text-xs text-gray-500">
                      {f.stats.avgHeadcount !== null && `about ${plural(f.stats.avgHeadcount, "person", "people")} each · `}
                      {f.stats.last && `last ${formatDate(f.stats.last)}`}
                    </span>
                    {canEdit && (
                      <span className="ml-auto flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(f.id)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setMerging(merging?.from === f.id ? null : { from: f.id, into: "" })}>
                          Merge
                        </Button>
                        <ActionButton action={setFormatActive} input={{ id: f.id, active: !f.active }} variant="ghost" done={f.active ? `${f.name} hidden.` : `${f.name} shown again.`}>
                          {f.active ? "Hide" : "Show"}
                        </ActionButton>
                      </span>
                    )}
                  </div>
                  {merging?.from === f.id && (
                    <form
                      className="flex flex-wrap items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        run(mergeFormats, { from: f.id, into: merging.into }, () => setMerging(null), (d) => `${plural(d.moved, "event")} moved, ${f.name} hidden.`);
                      }}
                    >
                      <span className="text-xs text-gray-600">Move all runs and ideas of {f.name} to</span>
                      <FormatSelect aria-label={`Merge ${f.name} into`} formats={formats.filter((x) => x.id !== f.id)} categories={categories} value={merging.into} onChange={(into) => setMerging({ from: f.id, into })} empty="Pick a format" className="h-8 w-auto" />
                      <Button size="sm" disabled={pending || !merging.into}>
                        Merge
                      </Button>
                    </form>
                  )}
                  {open === f.id && (
                    <ul className="ml-4 list-disc pl-4 text-xs text-gray-600" data-testid="format-runs">
                      {f.runs.map((r) => (
                        <li key={r.id}>
                          {formatDate(r.startsAt)} · {r.title}
                          {r.headcount !== null ? ` · ${plural(r.headcount, "person", "people")}` : ""}
                          {canEdit && (
                            <button type="button" className="ml-2 text-red-700 hover:underline" disabled={pending} onClick={() => run(unlinkEvents, { event_ids: [r.id] }, undefined, "Taken out of the format.")}>
                              Take out
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ── Categories ──────────────────────────────────────────────────────────────

function CategoryForm({ initial, onDone }: { initial?: Category; onDone: () => void }) {
  const { run, pending, error } = useAction();
  const [v, setV] = useState({ name: initial?.name ?? "", emoji: initial?.emoji ?? "", esn_type: initial?.esn_type ?? "", keywords: initial?.keywords ?? "", sort: initial?.sort ?? 100 });
  const id = initial?.id ?? "new";
  return (
    <form
      className="grid gap-3 rounded-lg border border-dashed border-gray-300 p-3 sm:grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)_6rem]"
      onSubmit={(e) => {
        e.preventDefault();
        const input = { name: v.name, emoji: v.emoji, esn_type: v.esn_type || null, keywords: v.keywords };
        if (initial) run(updateEventCategory, { id: initial.id, ...input, sort: Number(v.sort) }, onDone, "Category saved.");
        else run(addEventCategory, input, onDone, "Category added.");
      }}
    >
      <Field label="Emoji" htmlFor={`cat-emoji-${id}`}>
        <Input id={`cat-emoji-${id}`} value={v.emoji} onChange={(e) => setV({ ...v, emoji: e.target.value })} maxLength={16} />
      </Field>
      <Field label="Name" htmlFor={`cat-name-${id}`}>
        <Input id={`cat-name-${id}`} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required maxLength={60} />
      </Field>
      <Field label="ESN activity type" htmlFor={`cat-esn-${id}`} hint="Prefilled in new descriptions">
        <Select id={`cat-esn-${id}`} value={v.esn_type} onChange={(e) => setV({ ...v, esn_type: e.target.value })}>
          <option value="">None</option>
          {ESN_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
      {initial ? (
        <Field label="Order" htmlFor={`cat-sort-${id}`}>
          <Input id={`cat-sort-${id}`} type="number" min={0} max={32000} value={v.sort} onChange={(e) => setV({ ...v, sort: Number(e.target.value) })} />
        </Field>
      ) : (
        <span />
      )}
      <div className="sm:col-span-4">
        <Field label="Keywords" htmlFor={`cat-kw-${id}`} hint="Words in a title that suggest this category. Up to 4 letters they match whole words, longer ones the start of a word. The first category in the order wins.">
          <Textarea id={`cat-kw-${id}`} rows={2} value={v.keywords} onChange={(e) => setV({ ...v, keywords: e.target.value })} maxLength={2000} />
        </Field>
      </div>
      <div className="flex items-center gap-2 sm:col-span-4">
        <Button size="sm" disabled={pending}>
          {initial ? "Save" : "Add category"}
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </form>
  );
}

/** The categories in their order (the suggestion's too); never deleted, only hidden. */
export function CategoriesCard({ categories, canEdit }: { categories: Array<Category & { events: number }>; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const esnLabel = new Map(ESN_TYPES.map((t) => [t.id as string, t.label as string]));
  return (
    <Card data-testid="categories">
      <CardHeader>
        <CardTitle>Categories</CardTitle>
        <span className="text-xs text-gray-500">{plural(categories.filter((c) => c.active).length, "category", "categories")}</span>
      </CardHeader>
      <CardContent className="space-y-3">
        {canEdit && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            + New category
          </Button>
        )}
        {adding && <CategoryForm onDone={() => setAdding(false)} />}
        <ul className="divide-y divide-gray-100" data-testid="category-list">
          {sortedCategories(categories, true).map((c) =>
            editing === c.id ? (
              <li key={c.id} className="py-3">
                <CategoryForm initial={c} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span className={c.active ? "font-medium text-gray-900" : "font-medium text-gray-400 line-through"}>{categoryLabel(c)}</span>
                <span className="text-xs text-gray-500">{plural(c.events, "event")}</span>
                {c.esn_type && <span className="text-xs text-gray-500">ESN: {esnLabel.get(c.esn_type) ?? c.esn_type}</span>}
                <span className="min-w-0 basis-full truncate text-xs text-gray-400 sm:basis-auto sm:flex-1" title={c.keywords}>
                  {c.keywords}
                </span>
                {canEdit && (
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(c.id)}>
                      Edit
                    </Button>
                    <ActionButton action={setEventCategoryActive} input={{ id: c.id, active: !c.active }} variant="ghost" done={c.active ? `${c.name} hidden.` : `${c.name} shown again.`}>
                      {c.active ? "Hide" : "Show"}
                    </ActionButton>
                  </span>
                )}
              </li>
            )
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
