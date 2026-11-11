"use client";

import { useAction } from "@/components/ActionButton";
import { Select } from "@/components/ui";
import { setCategorySphere } from "@/app/actions/payments";
import { SPHERE_LABELS, SPHERES, type Sphere } from "@/lib/financeReport";

export function SphereSelect({ id, name, sphere }: { id: string; name: string; sphere: Sphere }) {
  const { run, pending, error } = useAction();
  return (
    <span className="inline-flex w-full items-center gap-1 sm:w-auto">
      <Select aria-label={`Sphere of ${name}`} className="h-8 w-full text-xs sm:w-56" value={sphere} disabled={pending} onChange={(e) => run(setCategorySphere, { id, sphere: e.target.value }, undefined, "Sphere changed.")}>
        {SPHERES.map((s) => (
          <option key={s} value={s}>
            {SPHERE_LABELS[s].de}
          </option>
        ))}
      </Select>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
