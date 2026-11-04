"use client";

import { useEffect } from "react";
import { hashDay, revealDay } from "./reveal";

/** On "#day-2026-11-04" (Today, "+2 more"), scroll the day list there – opening the folded earlier days if needed. */
export function RevealOnHash({ page }: { page: string }) {
  useEffect(() => {
    const go = () => {
      const day = hashDay(window.location.hash);
      if (day) revealDay(day, false);
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [page]);
  return null;
}
