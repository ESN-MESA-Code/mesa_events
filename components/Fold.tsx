"use client";

// Folding sections (round 2026-11-03 (2)): forms and steps used now and then
// stay folded until needed, instead of filling the page every visit.
import { useEffect, useState } from "react";

/**
 * A <details> that starts open or folded, then stays as the member left it –
 * a refresh after saving does not fold away the confirmation.
 */
export function Fold({ defaultOpen, children, ...props }: Omit<React.DetailsHTMLAttributes<HTMLDetailsElement>, "open" | "onToggle"> & { defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details {...props} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      {children}
    </details>
  );
}

/**
 * A link into a folded section (#register-receipt from Home, #propose …)
 * unfolds it, on load and for links on the page.
 */
export function RevealOnHash() {
  useEffect(() => {
    const reveal = (hash: string) => {
      const el = hash.length > 1 ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
      if (!el) return;
      for (let node: HTMLElement | null = el; node; node = node.parentElement) if (node instanceof HTMLDetailsElement) node.open = true;
      el.scrollIntoView({ block: "start" });
    };
    reveal(window.location.hash);
    const onHash = () => reveal(window.location.hash);
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href*='#']");
      if (a instanceof HTMLAnchorElement && a.pathname === window.location.pathname && a.hash) window.setTimeout(() => reveal(a.hash), 0);
    };
    window.addEventListener("hashchange", onHash);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("click", onClick);
    };
  }, []);
  return null;
}

/** A card folded to its title ("＋ Book income or spending") until it is needed. */
export function FoldCard({ title, defaultOpen = false, id, testId, children }: { title: string; defaultOpen?: boolean; id?: string; testId?: string; children: React.ReactNode }) {
  return (
    <Fold id={id} defaultOpen={defaultOpen} className="group scroll-mt-4 rounded-xl border border-gray-200 bg-white shadow-sm" data-testid={testId}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-base font-semibold text-gray-900 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
        <span className="text-esn group-open:hidden">＋</span>
        {title}
        <span aria-hidden="true" className="ml-auto text-xs font-normal text-gray-400 transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="px-5 pb-5">{children}</div>
    </Fold>
  );
}
