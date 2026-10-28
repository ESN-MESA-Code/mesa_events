import { hasRole, type AppRole } from "@/lib/roles";

export interface NavItem {
  href: string;
  label: string;
}

/** The main navigation for a member with `roles` (pages check access again). */
export function navItems(roles: readonly AppRole[]): NavItem[] {
  const items: NavItem[] = [
    { href: "/calendar", label: "Calendar" },
    { href: "/ideas", label: "Ideas" },
    { href: "/volunteer", label: "Volunteer" },
    { href: "/me", label: "My events" },
  ];
  const exec = roles.includes("executive");
  if (hasRole(roles, "events") || exec) items.push({ href: "/team/events", label: "Events team" });
  if (hasRole(roles, "comms") || exec) items.push({ href: "/team/comms", label: "Comms" });
  if (hasRole(roles, "finance") || exec) items.push({ href: "/team/finance", label: "Finance" });
  if (hasRole(roles, "admin")) items.push({ href: "/admin", label: "Admin" });
  return items;
}
