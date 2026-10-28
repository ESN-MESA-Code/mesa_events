"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function EventTabs({ id }: { id: string }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/events/${id}`, label: "Overview" },
    { href: `/events/${id}/description`, label: "Description" },
    { href: `/events/${id}/attendance`, label: "Attendance" },
    { href: `/events/${id}/hand-in`, label: "Hand-in" },
  ];
  return (
    <nav aria-label="Event" className="border-b border-gray-200">
      <ul className="flex gap-1 overflow-x-auto">
        {tabs.map((t) => {
          const active = pathname === t.href;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn("block px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap", active ? "border-esn text-esn" : "border-transparent text-gray-600 hover:text-gray-900")}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
