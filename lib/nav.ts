import { hasRole, isInternalPlanner, type AppRole } from "@/lib/roles";

export interface NavItem {
  href: string;
  label: string;
  /** A small count or mark next to the label (e.g. the open volunteer form). */
  badge?: string;
}

export interface Navigation {
  /** What the member does for themself. */
  personal: NavItem[];
  /** Team pages (a separate group). */
  team: NavItem[];
}

/** The volunteer form as the navigation sees it. */
export type VolunteerNav = { open: boolean; submitted: boolean };

/**
 * The main navigation for a member with `roles` (pages check access again).
 * Volunteer appears only while a form is open, marked until they answered.
 * Executives see every team page (read-only where they cannot act).
 * Order (round 2026-11-03 (2)): the member's own things first – their events,
 * reimbursements, the open form – then the pages to browse.
 */
export function navItems(roles: readonly AppRole[], volunteer: VolunteerNav = { open: false, submitted: false }): Navigation {
  const personal: NavItem[] = [
    { href: "/", label: "Home" },
    { href: "/me", label: "My events" },
    // Claims follow the money, not the events.
    { href: "/me/reimbursements", label: "Expenses" },
    ...(volunteer.open ? [{ href: "/volunteer", label: "Volunteer", badge: volunteer.submitted ? undefined : "1" }] : []),
    { href: "/ideas", label: "Ideas" },
    { href: "/calendar", label: "Calendar" },
    { href: "/leaderboard", label: "Ranking" },
  ];
  const exec = roles.includes("executive");
  const team: NavItem[] = [];
  if (hasRole(roles, "events") || exec) team.push({ href: "/team/events", label: "Events" });
  if (hasRole(roles, "comms") || exec) team.push({ href: "/team/comms", label: "Comms" });
  if (hasRole(roles, "finance") || exec) team.push({ href: "/team/finance", label: "Finance" });
  // Internal events, meetings and office hours are planned by HR and the Vice President (round 2026-10-30).
  if (isInternalPlanner(roles) || exec) team.push({ href: "/team/internal", label: "Internal" });
  // Uploading to ESN Activities is the executive board's (round 2026-10-30).
  if (exec) team.push({ href: "/team/esn-activities", label: "ESN Activities" });
  if (hasRole(roles, "admin")) team.push({ href: "/admin", label: "Admin" });
  return { personal, team };
}

/** Whether `href` is the current section ("/" and My events only on the page itself – Expenses sits under /me). */
export function isActive(pathname: string, href: string): boolean {
  return href === "/" || href === "/me" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}
