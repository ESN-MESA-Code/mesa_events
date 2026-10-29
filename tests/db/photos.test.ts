// Event photos in Google Drive (brief 2026-10-29, A): pg_cron's scheduler
// enqueues the folder, the two Chat reminders (once each) and the counts;
// the jobs create <semester>/<yyyy-MM-dd Title> in the fake Drive and post
// to the fake Chat; "Check again" and the OC's tick, with who may do what.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, admin, as, createEvent, hoursFromNow } from "../helpers/local";
import { actionContext } from "./actionContext";
import * as H from "@/lib/actions/handin";
import { runDueJobs, type JobDeps } from "@/lib/jobs/runner";
import { HANDLERS } from "@/lib/jobs/handlers";
import { countPhotos } from "@/lib/jobs/photos";
import { googleClients } from "@/lib/google";
import { MemoryDriveClient } from "@/lib/google/fakes";
import { berlinDate } from "@/lib/dates";
import { photoFolderPath } from "@/lib/photos";

const deps: JobDeps = { admin, google: googleClients(admin, { GOOGLE_MODE: "fake" }), env: {}, baseUrl: "http://mesa.test" };
const runJobs = () => runDueJobs(deps, HANDLERS, { worker: "photos-test" });
const schedule = async () => {
  const { error } = await admin.rpc("schedule_photo_jobs");
  expect(error).toBeNull();
};
const folderOf = async (eventId: string) =>
  (await admin.from("event_photo_folders").select("*").eq("event_id", eventId).maybeSingle()).data;
const messagesIn = async (space: string) => (await admin.from("fake_chat_messages").select("name, text").eq("space", space)).data ?? [];
const space = () => `spaces/FAKEPHOTO${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

let now: { id: string; title: string; starts_at: string; space: string };
let yesterday: { id: string; title: string; starts_at: string; space: string };
let later: string;
let cancelled: string;
const created: string[] = [];

beforeAll(async () => {
  const make = async (title: string, starts_at: string, status: "confirmed" | "cancelled" = "confirmed") => {
    const e = await createEvent({ title, starts_at, status, oc: USERS.oc, helpers: [USERS.helper] });
    created.push(e.id);
    return e;
  };
  // Started an hour ago: folder and "take pictures".
  const a = await make(`Photo quiz / ${crypto.randomUUID().slice(0, 6)}`, hoursFromNow(-1));
  // Started 36 hours ago: the next-morning reminder is due (its start reminder is past).
  const b = await make(`Photo hike ${crypto.randomUUID().slice(0, 6)}`, hoursFromNow(-36));
  later = (await make("Photo later", hoursFromNow(24 * 5))).id;
  cancelled = (await make("Photo cancelled", hoursFromNow(-2), "cancelled")).id;
  now = { ...a, space: space() };
  yesterday = { ...b, space: space() };
  for (const e of [now, yesterday]) await admin.from("events").update({ chat_space_name: e.space, chat_space_url: "https://chat.google.com/room/x" }).eq("id", e.id);
});
afterAll(async () => {
  for (const e of [now, yesterday]) await admin.from("fake_chat_messages").delete().eq("space", e.space);
  const { data: rows } = await admin.from("event_photo_folders").select("folder_id").in("event_id", created);
  const ids = (rows ?? []).map((r) => r.folder_id).filter((x): x is string => !!x);
  if (ids.length) await admin.from("fake_drive_folders").delete().in("id", ids);
  await admin.from("jobs").delete().in("event_id", created);
  await admin.from("events").delete().in("id", created);
});

describe("folders and reminders on schedule", () => {
  it("creates <semester>/<yyyy-MM-dd Title> on the event's day, not before, not for cancelled events", async () => {
    await schedule();
    const { data: jobs } = await admin.from("jobs").select("idempotency_key").in("event_id", created);
    const keys = (jobs ?? []).map((j) => j.idempotency_key);
    expect(keys).toContain(`drive.ensure_folder:${now.id}`);
    expect(keys).toContain(`chat.photo_reminder:start:${now.id}`);
    expect(keys).toContain(`chat.photo_reminder:upload:${yesterday.id}`);
    expect(keys).not.toContain(`chat.photo_reminder:start:${yesterday.id}`);
    expect(keys).not.toContain(`chat.photo_reminder:upload:${now.id}`);
    expect(keys.filter((k) => k.endsWith(later) || k.endsWith(cancelled))).toEqual([]);

    await runJobs();
    const folder = await folderOf(now.id);
    const [semester, name] = photoFolderPath(berlinDate(now.starts_at), now.title);
    expect(name).not.toContain("/");
    expect(folder).toMatchObject({ folder_path: `${semester}/${name}`, folder_url: `https://drive.google.com/drive/folders/${folder!.folder_id}` });
    const { data: fake } = await admin.from("fake_drive_folders").select("name, parent_id").eq("id", folder!.folder_id!).single();
    const { data: parent } = await admin.from("fake_drive_folders").select("name").eq("id", fake!.parent_id).single();
    expect([parent!.name, fake!.name]).toEqual([semester, name]);
  });

  it("posts each reminder once in the event's space", async () => {
    const start = await messagesIn(now.space);
    expect(start).toHaveLength(1);
    expect(start[0].text).toBe(`<users/all> 📸 *${now.title}* starts now – please take lots of pictures and videos for our socials! 🎉`);

    const upload = await messagesIn(yesterday.space);
    expect(upload).toHaveLength(1);
    const folder = await folderOf(yesterday.id);
    expect(upload[0].text).toContain(`Please upload your pictures and videos here: <${folder!.folder_url}|📁 ${folder!.folder_path!.split("/")[1]}>`);

    // The scheduler runs every 5 minutes: nothing is posted twice.
    await schedule();
    await runJobs();
    expect(await messagesIn(now.space)).toHaveLength(1);
    expect(await messagesIn(yesterday.space)).toHaveLength(1);
    const { count } = await admin.from("jobs").select("id", { count: "exact", head: true }).eq("idempotency_key", `chat.photo_reminder:start:${now.id}`);
    expect(count).toBe(1);
  });

  it("reuses an existing folder of the same name", async () => {
    const before = await folderOf(now.id);
    await admin.from("event_photo_folders").update({ folder_id: null, folder_url: null, folder_path: null }).eq("event_id", now.id);
    await HANDLERS["drive.ensure_folder"]({ payload: { event_id: now.id } } as never, deps);
    expect((await folderOf(now.id))!.folder_id).toBe(before!.folder_id);
  });
});

describe("the count from Drive", () => {
  it("'Check again' counts the folder's files (also in subfolders); only the event's people and the teams may ask", async () => {
    const folder = (await folderOf(now.id))!;
    const videos = await deps.google.drive.ensureFolder([...folder.folder_path!.split("/"), "Videos"]);
    await admin.from("fake_drive_files").insert([
      { id: `f-${crypto.randomUUID()}`, folder_id: folder.folder_id!, file_name: "1.jpg" },
      { id: `f-${crypto.randomUUID()}`, folder_id: folder.folder_id!, file_name: "2.jpg" },
      { id: `f-${crypto.randomUUID()}`, folder_id: videos.id, file_name: "1.mp4" },
    ]);
    expect(await H.checkPhotosAgain(await actionContext(USERS.member), { event_id: now.id })).toMatchObject({ ok: false, error: "forbidden" });
    expect((await (await as(USERS.member)).rpc("request_photo_count", { event: now.id })).error?.code).toBe("42501");
    expect((await H.checkPhotosAgain(await actionContext(USERS.helper), { event_id: now.id })).ok).toBe(true);
    expect((await H.checkPhotosAgain(await actionContext(USERS.comms), { event_id: now.id })).ok).toBe(true);
    await runJobs();
    expect(await folderOf(now.id)).toMatchObject({ photo_count: 3, count_error: null });
  });

  it("no folder yet: nothing to count", async () => {
    expect((await H.checkPhotosAgain(await actionContext(USERS.oc), { event_id: later })).ok).toBe(false);
  });

  it("Drive cannot be read: the error is kept for the hand-in and the job retried", async () => {
    const drive = new MemoryDriveClient();
    drive.failNext = 1;
    await expect(countPhotos({ payload: { event_id: now.id } } as never, { ...deps, google: { ...deps.google, drive } })).rejects.toThrow(/Fake Drive API failure/);
    expect((await folderOf(now.id))!.count_error).toMatch(/Fake Drive API failure/);
    await countPhotos({ payload: { event_id: now.id } } as never, deps);
    expect((await folderOf(now.id))!.count_error).toBeNull();
  });
});

describe("the OC's tick", () => {
  it("only the OC or the Events team ticks; it counts as handed in and is logged", async () => {
    expect(await H.markPhotosUploaded(await actionContext(USERS.helper), { event_id: yesterday.id, uploaded: true })).toMatchObject({ ok: false, error: "forbidden" });
    expect((await (await as(USERS.helper)).rpc("mark_photos_uploaded", { event: yesterday.id, uploaded: true })).error?.code).toBe("42501");
    expect((await (await as(USERS.comms)).rpc("mark_photos_uploaded", { event: yesterday.id, uploaded: true })).error?.code).toBe("42501");
    expect((await H.markPhotosUploaded(await actionContext(USERS.oc), { event_id: yesterday.id, uploaded: true })).ok).toBe(true);
    expect(await folderOf(yesterday.id)).toMatchObject({ marked_uploaded_by: USERS.oc.email });
    const { data: log } = await (await as(USERS.helper)).from("activity_log").select("entity, details").eq("event_id", yesterday.id).eq("entity", "event_photo_folders");
    expect(log).toEqual([{ entity: "event_photo_folders", details: { marked_uploaded: true } }]);

    expect((await H.markPhotosUploaded(await actionContext(USERS.events), { event_id: yesterday.id, uploaded: false })).ok).toBe(true);
    expect((await folderOf(yesterday.id))!.marked_uploaded_at).toBeNull();
    expect((await (await as(USERS.oc)).rpc("mark_photos_uploaded", { event: cancelled, uploaded: true })).error).not.toBeNull();
  });

  it("the cycle's hand-in reads the folder: a file or the tick", async () => {
    const { data: cycle } = await admin.from("planning_cycles").insert({ month: "2999-12-01", created_by: "tests@mesa.invalid" }).select("id").single();
    try {
      await admin.from("events").update({ cycle_id: cycle!.id }).in("id", [now.id, yesterday.id]);
      const read = async () => {
        const { data } = await (await as(USERS.events)).rpc("cycle_hand_in", { cycles: [cycle!.id] });
        return Object.fromEntries((data ?? []).map((r) => [r.event_id, r.photos_in]));
      };
      expect(await read()).toEqual({ [now.id]: true, [yesterday.id]: false });
      await (await as(USERS.oc)).rpc("mark_photos_uploaded", { event: yesterday.id, uploaded: true });
      expect(await read()).toEqual({ [now.id]: true, [yesterday.id]: true });
    } finally {
      await admin.from("events").update({ cycle_id: null }).in("id", [now.id, yesterday.id]);
      await admin.from("planning_cycles").delete().eq("id", cycle!.id);
    }
  });
});
