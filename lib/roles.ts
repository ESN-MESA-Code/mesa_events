// Team roles come from Google Workspace groups. The group addresses are
// configuration (env), e.g. GROUP_EVENTS=events-team@esnmesa.org; the role
// sync job (lib/jobs/handlers.ts) mirrors their members into
// public.role_members, and admins can add members by hand.
import type { Database } from "@/types/database";

export type AppRole = Database["public"]["Enums"]["app_role"];

export const APP_ROLES: AppRole[] = ["events", "comms", "finance", "treasurer", "executive", "hr", "vice_president", "newbie", "admin"];

export const ROLE_GROUP_ENV: Record<AppRole, string> = {
  events: "GROUP_EVENTS",
  comms: "GROUP_COMMS",
  finance: "GROUP_FINANCE",
  treasurer: "GROUP_TREASURER",
  executive: "GROUP_EXECUTIVES",
  hr: "GROUP_HR",
  vice_president: "GROUP_VICE_PRESIDENT",
  newbie: "GROUP_NEWBIES",
  admin: "GROUP_ADMINS",
};

export const ROLE_LABELS: Record<AppRole, string> = {
  events: "Events team",
  comms: "Comms team",
  finance: "Finance team",
  treasurer: "Treasurer",
  executive: "Executive",
  hr: "HR",
  vice_president: "Vice President",
  newbie: "Newbie",
  admin: "Admin (IT)",
};

/** The configured group address per role (roles without one are left out). */
export function roleGroups(env: Record<string, string | undefined> = process.env): Partial<Record<AppRole, string>> {
  const out: Partial<Record<AppRole, string>> = {};
  for (const role of APP_ROLES) {
    const group = env[ROLE_GROUP_ENV[role]]?.trim().toLowerCase();
    if (group) out[role] = group;
  }
  return out;
}

/** Whether `roles` include `wanted`; the Treasurer counts as Finance (as public.has_role()). */
export function hasRole(roles: readonly AppRole[], wanted: AppRole): boolean {
  return roles.includes(wanted) || (wanted === "finance" && roles.includes("treasurer"));
}

/** Roles that do not see every event: IT, the internal planners and newbies. */
const NOT_TEAM: AppRole[] = ["admin", "hr", "vice_president", "newbie"];

/** Events, Comms, Finance and the executives see every event (public.is_team()). */
export function isTeam(roles: readonly AppRole[]): boolean {
  return roles.some((r) => !NOT_TEAM.includes(r));
}

/** HR and the Vice President plan internal events, meetings and office hours (public.is_internal_planner()). */
export function isInternalPlanner(roles: readonly AppRole[]): boolean {
  return roles.includes("hr") || roles.includes("vice_president");
}

/** Executive board meetings: the executives and the planners (public.sees_board_meetings()). */
export function seesBoardMeetings(roles: readonly AppRole[]): boolean {
  return roles.includes("executive") || isInternalPlanner(roles);
}
