// The picture of a Telegram post (the bot's pictureBlob_): a Google Drive
// link or file id (read through the Drive client), or an image URL that
// Telegram fetches itself. Telegram takes JPG, PNG and WebP up to 10 MB.
// The bot converted HEIC and large files with Drive's thumbnail; that
// needs either Apps Script or a native image library here, so such files
// are refused with a clear message instead (docs/DECISIONS.md).
import type { DriveClient } from "@/lib/google/types";
import type { TelegramPhoto } from "@/lib/telegram/types";

export const PICTURE_MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

export class PictureError extends Error {}

/** The Drive file id in a link ("…/d/<id>/view", "…?id=<id>") or a bare id; null for other text. */
export function driveFileId(ref: string): string | null {
  const r = ref.trim();
  return (r.match(/\/d\/([\w-]{20,})/) ?? r.match(/[?&]id=([\w-]{20,})/) ?? r.match(/^([\w-]{25,})$/) ?? [])[1] ?? null;
}

export async function resolvePicture(ref: string, drive: DriveClient): Promise<TelegramPhoto> {
  const r = ref.trim();
  const id = driveFileId(r);
  if (id) {
    const info = await drive.fileInfo(id).catch(() => {
      throw new PictureError("The Telegram picture is not readable in Drive – is it in the shared photo drive?");
    });
    if (/heic|heif/i.test(info.mimeType)) throw new PictureError("Telegram does not take HEIC (iPhone) photos – export the picture as JPG and use that file.");
    if (!TYPES.includes(info.mimeType)) throw new PictureError("The Telegram picture is not a JPG, PNG or WebP image.");
    if (info.size > PICTURE_MAX_BYTES) throw new PictureError("The Telegram picture is larger than 10 MB – use a smaller copy.");
    return { bytes: await drive.download(id), mimeType: info.mimeType, name: info.name || `picture-${id}.jpg` };
  }
  if (/^https:\/\/\S+$/i.test(r)) return { url: r };
  throw new PictureError("The Telegram picture must be a Google Drive link or an image URL (https://…).");
}
