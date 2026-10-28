// Reads the members of a Google Workspace group with the Admin SDK Directory
// API, as a service account (ported from MESAttendance). Used by the role
// sync job and at login.
//
// The service account needs read access to groups, either
// * an admin role with the "Groups → Read" privilege (GOOGLE_ADMIN_SUBJECT unset), or
// * domain-wide delegation for the scope below, impersonating a Workspace
//   admin (GOOGLE_ADMIN_SUBJECT = that admin's email).
import { accessToken, type Fetch, type ServiceAccount } from "@/lib/google/serviceAccount";
import type { DirectoryClient } from "@/lib/google/types";

const DIRECTORY = "https://admin.googleapis.com/admin/directory/v1";
export const GROUP_MEMBER_SCOPE = "https://www.googleapis.com/auth/admin.directory.group.member.readonly";

interface MembersPage {
  members?: Array<{ email?: string; type?: string; status?: string }>;
  nextPageToken?: string;
}

/** Email addresses of the group's users, including members of nested groups; suspended users left out. */
export async function groupMemberEmails(group: string, token: string, fetchFn: Fetch = fetch): Promise<string[]> {
  const emails = new Set<string>();
  let pageToken: string | undefined;
  do {
    const url = new URL(`${DIRECTORY}/groups/${encodeURIComponent(group)}/members`);
    url.searchParams.set("maxResults", "200");
    url.searchParams.set("includeDerivedMembership", "true");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Listing ${group} failed (${res.status}): ${await res.text()}`);
    const page = (await res.json()) as MembersPage;
    for (const m of page.members ?? []) {
      if (m.type === "USER" && m.status !== "SUSPENDED" && m.email) emails.add(m.email.toLowerCase());
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return [...emails];
}

/** Whether `email` is in the group, directly or through a nested group. */
export async function isGroupMember(group: string, email: string, token: string, fetchFn: Fetch = fetch) {
  const url = `${DIRECTORY}/groups/${encodeURIComponent(group)}/hasMember/${encodeURIComponent(email)}`;
  const res = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Checking ${email} in ${group} failed (${res.status}): ${await res.text()}`);
  const { isMember } = (await res.json()) as { isMember?: boolean };
  return isMember === true;
}

export class GoogleDirectoryClient implements DirectoryClient {
  constructor(
    private sa: ServiceAccount,
    private subject?: string,
    private fetchFn: Fetch = fetch
  ) {}

  private token() {
    return accessToken(this.sa, [GROUP_MEMBER_SCOPE], this.subject, this.fetchFn);
  }

  async groupMemberEmails(group: string) {
    return groupMemberEmails(group, await this.token(), this.fetchFn);
  }

  async isGroupMember(group: string, email: string) {
    return isGroupMember(group, email, await this.token(), this.fetchFn);
  }
}
