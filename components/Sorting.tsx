"use client";

// Category badge and the category / format pickers of the idea, schedule and
// event forms (round 2026-11-01).
import { Badge, Select } from "@/components/ui";
import { categoryLabel, sortedCategories, type Category, type Format } from "@/lib/formats";

export function CategoryBadge({ category }: { category: Pick<Category, "emoji" | "name"> | null | undefined }) {
  if (!category) return null;
  return <Badge tone="purple">{categoryLabel(category)}</Badge>;
}

/** The categories to pick from: the active ones, plus the current one if it is hidden. */
export function CategorySelect({ categories, value, onChange, id, empty = "No category yet", ...rest }: { categories: Category[]; value: string; onChange: (id: string) => void; id?: string; empty?: string } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">) {
  const choices = sortedCategories(categories, true).filter((c) => c.active || c.id === value);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      <option value="">{empty}</option>
      {choices.map((c) => (
        <option key={c.id} value={c.id}>
          {categoryLabel(c)}
        </option>
      ))}
    </Select>
  );
}

/** "Is this a new run of …?": the active formats by name, plus the current one if it is hidden. */
export function FormatSelect({ formats, categories, value, onChange, id, empty = "No – something new", ...rest }: { formats: Format[]; categories: Category[]; value: string; onChange: (id: string) => void; id?: string; empty?: string } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">) {
  const emoji = new Map(categories.map((c) => [c.id, c.emoji]));
  const choices = formats.filter((f) => f.active || f.id === value).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      <option value="">{empty}</option>
      {choices.map((f) => (
        <option key={f.id} value={f.id}>
          {[f.category_id ? emoji.get(f.category_id) : "", f.name].filter(Boolean).join(" ")}
        </option>
      ))}
    </Select>
  );
}
