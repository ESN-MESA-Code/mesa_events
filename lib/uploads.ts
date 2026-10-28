// What may be uploaded where: hand-in photos only (receipts are tracked as
// data, the paper Beleg is mandatory – no receipt photos). The Storage
// bucket enforces the same limits (migration 20261028000500_reimbursements.sql);
// this gives a clear message first and builds the object paths the storage
// policies expect.

export const UPLOADS = {
  photo: { bucket: "event-photos", maxBytes: 15 * 1024 * 1024, types: ["image/jpeg", "image/png", "image/webp", "image/heic"] },
} as const;

export type UploadKind = keyof typeof UPLOADS;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

export function validateUpload(kind: UploadKind, file: { type: string; size: number }): string | null {
  const rule = UPLOADS[kind];
  if (!(rule.types as readonly string[]).includes(file.type)) {
    return `This file type is not allowed – use ${rule.types.map((t) => EXT[t].toUpperCase()).join(", ")}.`;
  }
  if (file.size <= 0) return "The file is empty.";
  if (file.size > rule.maxBytes) return `The file is too large (at most ${Math.round(rule.maxBytes / 1024 / 1024)} MB).`;
  return null;
}

/** event-photos/<event>/<uuid>.<ext> */
export function photoPath(eventId: string, mime: string, id = crypto.randomUUID()): string {
  return `${eventId}/${id}.${EXT[mime]}`;
}

export const PHOTO_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|heic)$/;
