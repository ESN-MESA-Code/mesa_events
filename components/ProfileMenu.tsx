"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The member's avatar opens their profile menu (round 2026-10-30): who is
 * signed in, sign out. Payout details are on the Reimbursements page, My
 * events in the navigation (round 2026-11-03 (2)).
 */
export function ProfileMenu({ name, email, roles, initials }: { name: string; email: string; roles: string; initials: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Close on outside clicks and Escape (and when a link is followed).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Your profile: ${name}`}
        className="relative flex items-center gap-2.5 rounded-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        data-testid="profile-button"
      >
        <span aria-hidden="true" className="h-9 w-9 rounded-full bg-white/15 ring-2 ring-white/40 flex items-center justify-center text-sm font-semibold shrink-0 hover:bg-white/25">
          {initials}
        </span>
        <span className="hidden md:block leading-tight min-w-0">
          <span className="block text-sm font-medium truncate max-w-[14rem]" data-testid="viewer-name">
            {name}
          </span>
          <span className="block text-xs text-white/70 truncate max-w-[16rem]" data-testid="viewer-roles">
            {roles}
          </span>
        </span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-lg border border-gray-200 bg-white text-sm text-gray-800 shadow-xl" data-testid="profile-menu">
          <div className="border-b border-gray-100 px-4 py-3">
            <p className="font-medium text-gray-900">{name}</p>
            <p className="truncate text-xs text-gray-500">{email}</p>
          </div>
          <form action="/auth/signout" method="post" className="border-t border-gray-100">
            <button role="menuitem" className="block w-full px-4 py-2.5 text-left hover:bg-gray-50">
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
