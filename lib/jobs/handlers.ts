// Job handlers by kind. Each one is idempotent: it may run again after a
// failure or a crash halfway through.
import { roleGroups, type AppRole } from "@/lib/roles";
import type { JobHandler } from "@/lib/jobs/runner";
import { cancellation, createSpace, eventStatusChange, remindOc, rosterChange, syncSpaceMembers } from "@/lib/jobs/chat";
import { publishDescription } from "@/lib/jobs/descriptions";
import { countPhotos, ensureFolder, photoReminder } from "@/lib/jobs/photos";
import { esnUploaded } from "@/lib/jobs/esn";
import { channelPublished, publishTelegramPost } from "@/lib/jobs/publishing";

/** Mirrors the configured Google groups into public.role_members ('group' rows). */
export const syncRoles: JobHandler = async (_job, { admin, google, env }) => {
  const groups = roleGroups(env);
  const roles = Object.keys(groups) as AppRole[];
  if (roles.length === 0) return { skipped: "No role groups configured (GROUP_* variables)" };
  const counts: Record<string, number> = {};
  for (const role of roles) {
    const emails = await google.directory.groupMemberEmails(groups[role]!);
    const { data, error } = await admin.rpc("replace_group_role", { member_role: role, emails });
    if (error) throw new Error(`${role}: ${error.message}`);
    counts[role] = data ?? 0;
  }
  return counts;
};

export const noop: JobHandler = async (job) => ({ echoed: job.payload });

export const HANDLERS: Record<string, JobHandler> = {
  "directory.sync_roles": syncRoles,
  "system.noop": noop,
  "chat.create_space": createSpace,
  "chat.sync_members": syncSpaceMembers,
  "chat.roster_message": rosterChange,
  "chat.event_status": eventStatusChange,
  "chat.publish_description": publishDescription,
  "drive.ensure_folder": ensureFolder,
  "drive.count_photos": countPhotos,
  "chat.photo_reminder": photoReminder,
  "chat.esn_uploaded": esnUploaded,
  "chat.remind_oc": remindOc,
  "chat.cancellation": cancellation,
  "telegram.publish_post": publishTelegramPost,
  "chat.channel_published": channelPublished,
};
