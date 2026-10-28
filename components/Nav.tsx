"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActive, type Navigation, type NavItem } from "@/lib/nav";

function Item({ item, pathname, onClick, block }: { item: NavItem; pathname: string; onClick?: () => void; block?: boolean }) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-1.5 whitespace-nowrap text-sm font-medium transition-colors",
        block
          ? cn("rounded-md px-3 py-2.5", active ? "bg-white/15 text-white" : "text-white/80 hover:bg-white/10 hover:text-white")
          : cn("px-3 py-2.5 border-b-2", active ? "border-esn-accent text-white" : "border-transparent text-white/75 hover:text-white")
      )}
    >
      {item.label}
      {item.badge && (
        <span className="rounded-full bg-esn-orange px-1.5 text-[11px] font-semibold leading-4 text-white" aria-label="needs your answer">
          {item.badge}
        </span>
      )}
    </Link>
  );
}

// Personal pages, then the team pages as their own group. On phones one
// "Menu" button opens both groups (nothing hidden in a scrolling bar).
export default function Nav({ nav }: { nav: Navigation }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = [...nav.personal, ...nav.team].find((i) => isActive(pathname, i.href));
  const pending = nav.personal.some((i) => i.badge);

  return (
    <nav aria-label="Main" className="bg-esn-dark/95">
      {/* Desktop */}
      <div className="hidden md:flex max-w-6xl mx-auto px-4 items-center">
        <ul className="flex gap-1">
          {nav.personal.map((item) => (
            <li key={item.href}>
              <Item item={item} pathname={pathname} />
            </li>
          ))}
        </ul>
        {nav.team.length > 0 && (
          <div className="ml-auto flex items-center gap-1" data-testid="nav-team">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-white/50 pr-1">Team</span>
            <ul className="flex gap-1 border-l border-white/20 pl-1">
              {nav.team.map((item) => (
                <li key={item.href}>
                  <Item item={item} pathname={pathname} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {/* Phone */}
      <div className="md:hidden px-3">
        <button
          type="button"
          className="flex w-full items-center gap-2 py-2.5 text-sm font-medium text-white"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden="true" className="text-lg leading-none">
            {open ? "✕" : "☰"}
          </span>
          Menu
          {pending && !open && <span className="rounded-full bg-esn-orange h-2 w-2" aria-label="something needs your answer" />}
          <span className="ml-auto text-white/70 truncate">{current?.label}</span>
        </button>
        {open && (
          <div id="mobile-nav" className="pb-3 space-y-3">
            <ul className="grid grid-cols-2 gap-1">
              {nav.personal.map((item) => (
                <li key={item.href}>
                  <Item item={item} pathname={pathname} onClick={() => setOpen(false)} block />
                </li>
              ))}
            </ul>
            {nav.team.length > 0 && (
              <div>
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-white/50">Team</p>
                <ul className="grid grid-cols-2 gap-1">
                  {nav.team.map((item) => (
                    <li key={item.href}>
                      <Item item={item} pathname={pathname} onClick={() => setOpen(false)} block />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
