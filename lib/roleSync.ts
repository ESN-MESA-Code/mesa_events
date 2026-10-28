// At each login: the person's membership of every configured role group, so
// someone added to or removed from a group does not wait for the daily
// sync. Server only. A failed check leaves the roles as they were.
import { googleClients } from "@/lib/google";
import { roleGroups, type AppRole } from "@/lib/roles";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function refreshRolesFor(email: string, env: Record<string, string | undefined> = process.env) {
  const groups = roleGroups(env);
  const roles = Object.keys(groups) as AppRole[];
  if (roles.length === 0) return;
  const admin = supabaseAdmin();
  const { directory } = googleClients(admin, env);
  for (const role of roles) {
    const member = await directory.isGroupMember(groups[role]!, email);
    const { error } = await admin.rpc("set_group_role", { member_email: email, member_role: role, member });
    if (error) throw error;
  }
}
