"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * The member's avatar opens their profile menu (round 2026-10-30): who is
 * signed in, payout details (IBAN or PayPal – marked while missing), their
 * events, sign out.
 */
export function ProfileMenu({ name, email, roles, initials, hasPayout }: { name: string; email: string; roles: string; initials: string; hasPayout: boolean }) {
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
        aria-label={`Your profile: ${name}${hasPayout ? "" : " – payout details missing"}`}
        className="relative flex items-center gap-2.5 rounded-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        data-testid="profile-button"
      >
        <span aria-hidden="true" className="h-9 w-9 rounded-full bg-white/15 ring-2 ring-white/40 flex items-center justify-center text-sm font-semibold shrink-0 hover:bg-white/25">
          {initials}
        </span>
        {!hasPayout && <span aria-hidden="true" className="absolute left-6 top-0 h-3 w-3 rounded-full bg-esn-orange ring-2 ring-esn" />}
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
          <Link role="menuitem" href="/me/payout" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50">
            💳 Payout details (IBAN / PayPal)
            {!hasPayout && <span className="ml-auto rounded-full bg-amber-100 px-2 text-[11px] font-medium text-amber-900">missing</span>}
          </Link>
          <Link role="menuitem" href="/me" onClick={() => setOpen(false)} className="block px-4 py-2.5 hover:bg-gray-50">
            📅 My events and reimbursements
          </Link>
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
