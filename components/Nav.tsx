"use client";

// The main navigation (shell redesign 2026-11-04, design canvas "MESA Home
// Redesign"). Wide screens: one header bar – the personal pages, then the
// team pages behind a "Team" menu. Phones and tablets: a tab bar at the
// bottom (Home, My events, Calendar, Ideas) whose "Menu" opens every page,
// the team pages as their own group.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, ChevronDown, House, Lightbulb, Menu, Ticket, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { isActive, type Navigation, type NavItem } from "@/lib/nav";

function Badge({ text }: { text: string }) {
  return (
    <span className="rounded-full bg-esn-orange px-1.5 text-[11px] font-semibold leading-4 text-white" aria-label="needs your answer">
      {text}
    </span>
  );
}

/** Closes a popover on outside clicks, Escape and navigation. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => close(), [pathname]); // eslint-disable-line react-hooks/exhaustive-deps -- close on navigation only
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

function BarLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium transition-colors xl:px-3",
        active ? "bg-white/15 font-semibold text-white" : "text-white/80 hover:bg-white/10 hover:text-white"
      )}
    >
      {item.label}
      {item.badge && <Badge text={item.badge} />}
    </Link>
  );
}

/** The team pages behind one button in the header bar. */
function TeamMenu({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const active = items.some((i) => isActive(pathname, i.href));
  return (
    <div ref={ref} className="relative" data-testid="nav-team">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="team-menu"
        className={cn(
          "flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium transition-colors xl:px-3",
          active ? "bg-white/15 font-semibold text-white" : "text-white/80 hover:bg-white/10 hover:text-white"
        )}
      >
        Team
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <ul id="team-menu" className="absolute left-0 z-30 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 text-sm text-gray-800 shadow-xl">
          {items.map((item) => {
            const current = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={cn("block px-4 py-2.5 hover:bg-gray-50", current && "bg-esn/5 font-semibold text-esn")}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The header bar's navigation (wide screens only). */
export default function Nav({ nav }: { nav: Navigation }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="hidden min-w-0 items-center gap-0.5 lg:flex">
      {nav.personal.map((item) => (
        <BarLink key={item.href} item={item} pathname={pathname} />
      ))}
      {nav.team.length > 0 && <TeamMenu items={nav.team} pathname={pathname} />}
    </nav>
  );
}

const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Home", icon: House },
  { href: "/me", label: "My events", icon: Ticket },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/ideas", label: "Ideas", icon: Lightbulb },
];

function SheetLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn("flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium", active ? "bg-esn/10 font-semibold text-esn" : "text-gray-800 hover:bg-gray-50")}
    >
      {item.label}
      {item.badge && <Badge text={item.badge} />}
    </Link>
  );
}

/** The tab bar at the bottom of phones and tablets; "Menu" opens every page. */
export function BottomTabs({ nav }: { nav: Navigation }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const pending = nav.personal.some((i) => i.badge);
  // Menu is "current" on the pages that have no tab of their own.
  const onTab = TABS.some((t) => isActive(pathname, t.href));
  const tab = "flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold";
  return (
    <div ref={ref} className="lg:hidden" id="bottom-tabs">
      {open && <div className="fixed inset-0 z-30 bg-black/30" aria-hidden="true" />}
      {open && (
        <div
          id="mobile-nav"
          className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 max-h-[70vh] space-y-3 overflow-y-auto rounded-t-2xl border-t border-gray-200 bg-white px-3 pb-3 pt-4 shadow-2xl"
        >
          <ul className="grid grid-cols-2 gap-1">
            {nav.personal.map((item) => (
              <li key={item.href}>
                <SheetLink item={item} pathname={pathname} />
              </li>
            ))}
          </ul>
          {nav.team.length > 0 && (
            <div>
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Team</p>
              <ul className="grid grid-cols-2 gap-1">
                {nav.team.map((item) => (
                  <li key={item.href}>
                    <SheetLink item={item} pathname={pathname} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <nav aria-label="Tabs" className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(4rem+env(safe-area-inset-bottom))] border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = !open && isActive(pathname, href);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn(tab, active ? "text-esn" : "text-gray-600")}>
              <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          className={cn(tab, "relative", open || !onTab ? "text-esn" : "text-gray-600")}
        >
          {open ? <X className="h-[22px] w-[22px]" aria-hidden="true" /> : <Menu className="h-[22px] w-[22px]" aria-hidden="true" />}
          Menu
          {pending && !open && <span className="absolute right-[calc(50%-18px)] top-2.5 h-2 w-2 rounded-full bg-esn-orange" aria-label="something needs your answer" />}
        </button>
      </nav>
    </div>
  );
}
