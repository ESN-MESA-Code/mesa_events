// Jump to a day in the Calendar's day list (redesign 2026-11-04): the first
// day on or after it that has something, opening the folded earlier days
// when it is among them. Used by the phone's mini month and on "#day-…" links.

const visible = (el: Element) => el.getClientRects().length > 0;

export function revealDay(day: string, smooth = true): boolean {
  const list = document.querySelector<HTMLElement>('[data-testid="calendar-list"]');
  if (!list || !visible(list)) return false;
  const days = [...list.querySelectorAll<HTMLElement>("[data-day]")];
  const target = days.find((el) => (el.dataset.day ?? "") >= day) ?? days[days.length - 1];
  if (!target) return false;
  const folded = target.closest("details");
  if (folded && !folded.open) folded.open = true;
  requestAnimationFrame(() => target.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" }));
  return true;
}

/** The day in "#day-2026-11-04", if any. */
export function hashDay(hash: string): string | null {
  const m = hash.match(/^#day-(\d{4}-\d{2}-\d{2})$/);
  return m ? m[1] : null;
}
