// Team roles come from Google Workspace groups. The group addresses are
// configuration (env), e.g. GROUP_EVENTS=events-team@esnmesa.org; the role
// sync job (lib/jobs/handlers.ts) mirrors their members into
// public.role_members, and admins can add members by hand.
import type { Database } from "@/types/database";

export type AppRole = Database["public"]["Enums"]["app_role"];

export const APP_ROLES: AppRole[] = ["events", "comms", "finance", "treasurer", "executive", "admin"];

export const ROLE_GROUP_ENV: Record<AppRole, string> = {
  events: "GROUP_EVENTS",
  comms: "GROUP_COMMS",
  finance: "GROUP_FINANCE",
  treasurer: "GROUP_TREASURER",
  executive: "GROUP_EXECUTIVES",
  admin: "GROUP_ADMINS",
};

export const ROLE_LABELS: Record<AppRole, string> = {
  events: "Events team",
  comms: "Comms team",
  finance: "Finance team",
  treasurer: "Treasurer",
  executive: "Executive",
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

/** Events, Comms, Finance and the executives see every event (public.is_team()). */
export function isTeam(roles: readonly AppRole[]): boolean {
  return roles.some((r) => r !== "admin");
}
