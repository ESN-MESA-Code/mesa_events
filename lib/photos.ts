// Event photo folders in the photo drive, as the description bot named them
// (esn-event-description-bot: semesterOf_ in src/Database.gs,
// semesterFolderName_ and photoFolder_ in worker/Worker.gs). Pure, so the
// names are unit-tested (tests/unit/photos.test.ts).
//
//   <DRIVE_PHOTOS_FOLDER_ID>/<semester>/<yyyy-MM-dd Event title>
//   semester: SoSe_26 = April–September, WiSe_26-27 = October–March

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "2026-11-02" → { key: "2026-2", name: "WiSe 26/27" }; "2026-05-01" → { key: "2026-1", name: "SoSe 26" } (the bot's Sheet tabs). */
export function semesterOf(iso: string): { key: string; name: string } {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const yy = (n: number) => pad2(n % 100);
  if (m >= 4 && m <= 9) return { key: `${y}-1`, name: `SoSe ${yy(y)}` };
  const start = m >= 10 ? y : y - 1;
  return { key: `${start}-2`, name: `WiSe ${yy(start)}/${yy(start + 1)}` };
}

/**
 * "SoSe_26" (April–September) / "WiSe_25-26" (October–March): the semester
 * folders of the photo drive. (The bot's version gave "WiSe_-1-00" for
 * January 2000; years wrap here.)
 */
export function semesterFolderName(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const yy = (n: number) => pad2(n % 100);
  if (m >= 4 && m <= 9) return `SoSe_${yy(y)}`;
  return m >= 10 ? `WiSe_${yy(y)}-${yy(y + 1)}` : `WiSe_${yy(y - 1)}-${yy(y)}`;
}

/** "2026-11-02 Pub quiz": the event's folder (slashes would make subfolders). */
export function photoFolderName(dateIso: string, title: string): string {
  return `${dateIso} ${title.replace(/\s+/g, " ").trim().replace(/[\\/]/g, "-")}`.trim();
}

/** The path below the photo drive's root: [semester, event folder]. */
export function photoFolderPath(dateIso: string, title: string): [string, string] {
  return [semesterFolderName(dateIso), photoFolderName(dateIso, title)];
}

/** A Drive folder's address. */
export const driveFolderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;

export interface PhotoFolderState {
  folder_url: string | null;
  photo_count: number | null;
  counted_at: string | null;
  marked_uploaded_at: string | null;
}

/** Photos count as handed in: a file in the folder, or ticked by hand (as private.photos_in()). */
export function photosIn(f: Pick<PhotoFolderState, "photo_count" | "marked_uploaded_at"> | null | undefined): boolean {
  return !!f && ((f.photo_count ?? 0) > 0 || !!f.marked_uploaded_at);
}
