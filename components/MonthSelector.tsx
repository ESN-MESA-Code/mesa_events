"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Select, buttonVariants } from "@/components/ui";
import { neighbours } from "@/lib/month";
import { cn } from "@/lib/utils";

export interface MonthChoice {
  /** "2026-11" */
  value: string;
  label: string;
  /** "done", "3 to do" … shown in the dropdown. */
  note?: string;
  /** Where the month leads (default: `path?month=…`). */
  href?: string;
}

const read = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or storage blocked: the choice is just not remembered.
  }
};

/**
 * The month at the top of the team pages and the calendar (brief 2026-10-29, C):
 * ← → and a dropdown, ?month=YYYY-MM in the URL. Without a month in the URL
 * the page opens on the viewer's last choice (this browser) when it is still
 * offered, else on the server's default (the first month with work).
 */
export function MonthSelector({
  options,
  current,
  path,
  storageKey,
  explicit,
  extra,
}: {
  options: MonthChoice[];
  current: string | null;
  path: string;
  storageKey: string;
  /** The URL named the month. */
  explicit: boolean;
  /** An extra entry at the end, e.g. "+ Plan a new month". */
  extra?: { label: string; href: string };
}) {
  const router = useRouter();
  const values = options.map((o) => o.value);
  const href = (v: string) => options.find((o) => o.value === v)?.href ?? `${path}?month=${v}`;

  useEffect(() => {
    if (explicit) {
      if (current) write(storageKey, current);
      return;
    }
    const remembered = read(storageKey);
    if (remembered && remembered !== current && values.includes(remembered)) router.replace(href(remembered));
    // Runs when the page's month changes; `values`/`href` follow from the props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explicit, current, storageKey]);

  const { prev, next } = current ? neighbours(values, current) : { prev: null, next: null };
  const arrow = (target: string | null, label: string, text: string) =>
    target ? (
      <Link href={href(target)} aria-label={label} className={buttonVariants({ variant: "outline", size: "sm" })} data-testid={`month-arrow-${text === "←" ? "prev" : "next"}`}>
        {text}
      </Link>
    ) : (
      <span aria-hidden="true" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "opacity-40")}>
        {text}
      </span>
    );

  return (
    <div className="flex min-w-0 max-w-full items-center gap-2" data-testid="month-selector">
      {arrow(prev, "Previous month", "←")}
      <Select
        aria-label="Month"
        className="w-auto min-w-0 flex-1 sm:max-w-[22rem] sm:flex-none"
        value={current ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          if (extra && v === "__extra") return router.push(extra.href);
          write(storageKey, v);
          router.push(href(v));
        }}
      >
        {!current && <option value="">Pick a month</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
            {o.note ? ` · ${o.note}` : ""}
          </option>
        ))}
        {extra && <option value="__extra">{extra.label}</option>}
      </Select>
      {arrow(next, "Next month", "→")}
    </div>
  );
}
