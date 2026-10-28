// Google Drive client (REST, fetch-based) for event photos, used only when a
// service account is configured (GOOGLE_MODE=real). Files go into one
// folder per event below DRIVE_PHOTOS_FOLDER_ID (a shared drive folder the
// service account can write to). Uploading the same file name into the same
// folder twice returns the existing file, so retries are safe.
import { accessToken, type Fetch, type ServiceAccount } from "@/lib/google/serviceAccount";
import type { DriveClient } from "@/lib/google/types";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink";
export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const FOLDER = "application/vnd.google-apps.folder";

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export class GoogleDriveClient implements DriveClient {
  constructor(
    private sa: ServiceAccount,
    private parentFolderId: string,
    private subject?: string,
    private fetchFn: Fetch = fetch
  ) {}

  private async token() {
    return accessToken(this.sa, DRIVE_SCOPES, this.subject, this.fetchFn);
  }

  private async find(name: string, parent: string, mimeType?: string) {
    const query = [`name = '${q(name)}'`, `'${q(parent)}' in parents`, "trashed = false", mimeType && `mimeType = '${mimeType}'`]
      .filter(Boolean)
      .join(" and ");
    const url = `${API}/files?q=${encodeURIComponent(query)}&fields=files(id,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    const res = await this.fetchFn(url, { headers: { Authorization: `Bearer ${await this.token()}` } });
    if (!res.ok) throw new Error(`Drive search failed (${res.status}): ${await res.text()}`);
    const { files } = (await res.json()) as { files: Array<{ id: string; webViewLink: string }> };
    return files[0] ?? null;
  }

  private async folderId(name: string) {
    const existing = await this.find(name, this.parentFolderId, FOLDER);
    if (existing) return existing.id;
    const res = await this.fetchFn(`${API}/files?supportsAllDrives=true&fields=id`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await this.token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER, parents: [this.parentFolderId] }),
    });
    if (!res.ok) throw new Error(`Creating Drive folder failed (${res.status}): ${await res.text()}`);
    return ((await res.json()) as { id: string }).id;
  }

  async uploadFile({ folder, fileName, mimeType, data }: { folder: string; fileName: string; mimeType: string; data: Uint8Array }) {
    const parent = await this.folderId(folder);
    const existing = await this.find(fileName, parent);
    if (existing) return { id: existing.id, url: existing.webViewLink };

    const boundary = `mesa-${crypto.randomUUID()}`;
    const meta = JSON.stringify({ name: fileName, parents: [parent] });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
      Buffer.from(data),
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const res = await this.fetchFn(UPLOAD, {
      method: "POST",
      headers: { Authorization: `Bearer ${await this.token()}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!res.ok) throw new Error(`Drive upload failed (${res.status}): ${await res.text()}`);
    const file = (await res.json()) as { id: string; webViewLink: string };
    return { id: file.id, url: file.webViewLink };
  }
}
