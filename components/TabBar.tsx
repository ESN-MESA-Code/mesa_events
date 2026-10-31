"use client";

// Page tabs (event tabs, cycle pages). They scroll sideways on narrow
// screens with a fade at the edge that has more, instead of being cut off
// or showing a stray vertical scrollbar (usability review #23).
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export interface Tab {
  href: string;
  label: string;
  active: boolean;
  /** A dot after the label, with this text for screen readers and the tooltip. */
  note?: string;
}

export function TabBar({ label, tabs }: { label: string; tabs: Tab[] }) {
  const ref = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMore({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    update();
    // The active tab in view on narrow screens.
    const active = el.querySelector<HTMLElement>('[aria-current="page"]');
    if (active && active.offsetLeft + active.offsetWidth > el.clientWidth) el.scrollLeft = active.offsetLeft - 16;
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <nav aria-label={label} className="relative border-b border-gray-200">
      <ul ref={ref} className="flex overflow-x-auto overflow-y-hidden [scrollbar-width:none] sm:gap-1 [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => (
          <li key={t.href} className="shrink-0">
            <Link
              href={t.href}
              aria-current={t.active ? "page" : undefined}
              className={cn(
                "flex items-center gap-1 whitespace-nowrap border-b-2 px-2 py-2 text-sm font-medium sm:px-3",
                t.active ? "border-esn text-esn" : "border-transparent text-gray-600 hover:text-gray-900"
              )}
            >
              {t.label}
              {t.note && <span className="h-2 w-2 rounded-full bg-esn-orange" title={t.note} aria-label={t.note} />}
            </Link>
          </li>
        ))}
      </ul>
      {more.left && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-gray-50 to-transparent" />}
      {more.right && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-gray-50 to-transparent" />}
    </nav>
  );
}
