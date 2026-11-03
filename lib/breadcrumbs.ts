// Where an event page was opened from (?from=…), so its breadcrumb leads
// back there instead of always to the calendar.

const PLACES: Record<string, { label: string; href: string }> = {
  home: { label: "Home", href: "/" },
  me: { label: "My events", href: "/me" },
  reimbursements: { label: "Reimbursements", href: "/me/reimbursements" },
  calendar: { label: "Calendar", href: "/calendar" },
  events: { label: "Events team", href: "/team/events" },
  comms: { label: "Comms", href: "/team/comms" },
  finance: { label: "Finance", href: "/team/finance" },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function backLink(from: string | null | undefined): { label: string; href: string } {
  if (from?.startsWith("cycle:") && UUID.test(from.slice(6))) return { label: "The month", href: `/team/events/cycles/${from.slice(6)}` };
  return PLACES[from ?? ""] ?? PLACES.calendar;
}

/** `href` with the origin kept (only known values). */
export function withFrom(href: string, from: string | null | undefined): string {
  if (!from || (backLink(from) === PLACES.calendar && from !== "calendar")) return href;
  return `${href}${href.includes("?") ? "&" : "?"}from=${encodeURIComponent(from)}`;
}
