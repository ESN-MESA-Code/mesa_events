// Google Drive client (REST, fetch-based) for the event photo folders, used
// only when a service account is configured (GOOGLE_MODE=real). The team
// uploads photos straight into the folders (as with the description bot);
// the platform only creates the folders below DRIVE_PHOTOS_FOLDER_ID (a
// shared drive the members can open) and counts the files in them. Finding
// an existing folder by name before creating one makes retries safe.
import { accessToken, type Fetch, type ServiceAccount } from "@/lib/google/serviceAccount";
import type { DriveClient } from "@/lib/google/types";
import { driveFolderUrl } from "@/lib/photos";

const API = "https://www.googleapis.com/drive/v3";
// Full Drive scope: the files to count are uploaded by members, which the
// narrower drive.file scope (files the app created) would not see. The
// service account (or GOOGLE_DRIVE_SUBJECT) needs access to the shared drive.
export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];
const FOLDER = "application/vnd.google-apps.folder";
const ALL_DRIVES = "supportsAllDrives=true&includeItemsFromAllDrives=true";
/** How deep subfolders are counted (e.g. "Videos" inside the event folder). */
const MAX_DEPTH = 3;

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export class GoogleDriveClient implements DriveClient {
  constructor(
    private sa: ServiceAccount,
    private rootFolderId: string,
    private subject?: string,
    private fetchFn: Fetch = fetch
  ) {}

  private async token() {
    return accessToken(this.sa, DRIVE_SCOPES, this.subject, this.fetchFn);
  }

  private async list(query: string, pageToken?: string) {
    const url = `${API}/files?q=${encodeURIComponent(query)}&fields=nextPageToken,files(id,mimeType)&pageSize=1000&${ALL_DRIVES}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const res = await this.fetchFn(url, { headers: { Authorization: `Bearer ${await this.token()}` } });
    if (!res.ok) throw new Error(`Drive search failed (${res.status}): ${await res.text()}`);
    return (await res.json()) as { nextPageToken?: string; files: Array<{ id: string; mimeType: string }> };
  }

  private async child(parent: string, name: string) {
    const { files } = await this.list(`name = '${q(name)}' and '${q(parent)}' in parents and mimeType = '${FOLDER}' and trashed = false`);
    if (files[0]) return files[0].id;
    const res = await this.fetchFn(`${API}/files?supportsAllDrives=true&fields=id`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await this.token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }),
    });
    if (!res.ok) throw new Error(`Creating Drive folder failed (${res.status}): ${await res.text()}`);
    return ((await res.json()) as { id: string }).id;
  }

  async ensureFolder(path: string[]) {
    let id = this.rootFolderId;
    for (const name of path) id = await this.child(id, name);
    return { id, url: driveFolderUrl(id) };
  }

  async countFiles(folderId: string, depth = 0): Promise<number> {
    let n = 0;
    let pageToken: string | undefined;
    do {
      const page = await this.list(`'${q(folderId)}' in parents and trashed = false`, pageToken);
      for (const f of page.files) {
        if (f.mimeType !== FOLDER) n++;
        else if (depth + 1 < MAX_DEPTH) n += await this.countFiles(f.id, depth + 1);
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return n;
  }
}
