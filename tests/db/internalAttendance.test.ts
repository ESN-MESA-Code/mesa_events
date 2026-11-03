// Attendance of Tuesday Talks and internal events (round 2026-11-03 (2)):
// the rotating check-in code only HR sees, checking in with its token or
// digits, HR's control, who reads what, and member_activity().
import { afterAll, describe, expect, it } from "vitest";
import { TEST_TAG, USERS, admin, as, daysFromNow, hoursFromNow, type SeedUser } from "../helpers/local";
import { berlinDate } from "@/lib/dates";
import { semesterFor } from "@/lib/internal";

const ids: string[] = [];
async function meeting(kind = "tuesday_talk", starts_at = hoursFromNow(-0.5)) {
  const { data, error } = await admin
    .from("internal_events")
    .insert({ kind: kind as never, title: `Attendance ${kind}`, starts_at, ends_at: new Date(Date.parse(starts_at) + 90 * 60_000).toISOString(), created_by: TEST_TAG })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  ids.push(data.id);
  return data.id;
}
const codeFor = async (id: string) => {
  const { data, error } = await (await as(USERS.hr)).rpc("checkin_code", { internal_event: id });
  if (error) throw new Error(error.message);
  return data![0];
};
const present = async (id: string) => {
  const { data } = await admin.from("internal_attendance").select("profile_id, via, removed_at").eq("internal_event_id", id);
  return data ?? [];
};

afterAll(async () => {
  for (const id of ids) await admin.from("internal_events").delete().eq("id", id);
});

describe("the check-in code", () => {
  it("only HR and the Vice President get it, and only while checking in is open", async () => {
    const id = await meeting();
    for (const u of [USERS.member, USERS.executive, USERS.helper]) {
      const { error } = await (await as(u)).rpc("checkin_code", { internal_event: id });
      expect(error?.message, u.email).toMatch(/Only HR and the Vice President/);
    }
    const hr = await codeFor(id);
    expect(hr.code).toMatch(/^\d{4}$/);
    expect(hr.token).toMatch(/^\d+\.[0-9a-f]{64}$/);
    const vp = (await (await as(USERS.vp)).rpc("checkin_code", { internal_event: id })).data![0];
    expect(vp.code).toBe(hr.code);

    const later = await meeting("tuesday_talk", daysFromNow(3));
    const { error } = await (await as(USERS.hr)).rpc("checkin_code", { internal_event: later });
    expect(error?.message).toMatch(/not open/);
    const office = await meeting("office_hour");
    expect((await (await as(USERS.hr)).rpc("checkin_code", { internal_event: office })).error?.message).toMatch(/not open/);
  });
});

describe("checking in", () => {
  it("with the scanned token: once; a changed token is refused", async () => {
    const id = await meeting();
    const { token } = await codeFor(id);
    const member = await as(USERS.member);
    const [win, mac] = token.split(".");
    expect((await member.rpc("check_in_internal", { internal_event: id, token: `${Number(win) - 1}.${mac}` })).error?.message).toMatch(/expired/);
    expect((await member.rpc("check_in_internal", { internal_event: id, token: `${win}.${"0".repeat(64)}` })).error?.message).toMatch(/expired/);
    expect((await member.rpc("check_in_internal", { internal_event: id, token })).data).toBe("checked_in");
    expect((await member.rpc("check_in_internal", { internal_event: id, token })).data).toBe("already");
    expect(await present(id)).toEqual([{ profile_id: USERS.member.id, via: "qr", removed_at: null }]);
  });

  it("with the four digits: five wrong tries, then HR has to add them", async () => {
    const id = await meeting("internal");
    const { code } = await codeFor(id);
    const wrong = code === "0000" ? "0001" : "0000";
    const v1 = await as(USERS.volunteer1);
    for (let i = 0; i < 5; i++) expect((await v1.rpc("check_in_internal", { internal_event: id, code: wrong })).data).toBe("wrong");
    expect((await v1.rpc("check_in_internal", { internal_event: id, code: (await codeFor(id)).code })).error?.message).toMatch(/Too many wrong codes/);
    // Someone else with the right digits.
    expect((await (await as(USERS.volunteer2)).rpc("check_in_internal", { internal_event: id, code: (await codeFor(id)).code })).data).toBe("checked_in");
  });

  it("not before the window, not after HR closed the list", async () => {
    const later = await meeting("tuesday_talk", daysFromNow(3));
    expect((await (await as(USERS.member)).rpc("check_in_internal", { internal_event: later, code: "1234" })).error?.message).toMatch(/closed/);
    const id = await meeting();
    const { token } = await codeFor(id);
    expect((await (await as(USERS.member)).rpc("close_internal_attendance", { internal_event: id, closed: true })).error?.message).toMatch(/Only HR/);
    expect((await (await as(USERS.hr)).rpc("close_internal_attendance", { internal_event: id, closed: true })).error).toBeNull();
    expect((await (await as(USERS.member)).rpc("check_in_internal", { internal_event: id, token })).error?.message).toMatch(/closed/);
    // HR still adds someone after closing.
    expect((await (await as(USERS.hr)).rpc("mark_internal_attendance", { internal_event: id, profile: USERS.helper.id, present: true })).error).toBeNull();
    expect(await present(id)).toEqual([{ profile_id: USERS.helper.id, via: "hr", removed_at: null }]);
  });
});

describe("HR's control and who reads what", () => {
  it("HR adds and takes back (kept with who); a member cannot; a taken-back member cannot check in again", async () => {
    const id = await meeting();
    expect((await (await as(USERS.member)).rpc("mark_internal_attendance", { internal_event: id, profile: USERS.member.id, present: true })).error?.message).toMatch(/Only HR/);
    const hr = await as(USERS.hr);
    await hr.rpc("mark_internal_attendance", { internal_event: id, profile: USERS.member.id, present: true });
    await hr.rpc("mark_internal_attendance", { internal_event: id, profile: USERS.member.id, present: false });
    const { data: row } = await admin.from("internal_attendance").select("removed_by, removed_at").eq("internal_event_id", id).single();
    expect(row).toMatchObject({ removed_by: USERS.hr.email });
    expect(row!.removed_at).not.toBeNull();
    const { token } = await codeFor(id);
    expect((await (await as(USERS.member)).rpc("check_in_internal", { internal_event: id, token })).error?.message).toMatch(/HR took your check-in back/);
    // Direct writes are refused for everyone but the functions.
    expect((await (await as(USERS.member)).from("internal_attendance").insert({ internal_event_id: id, profile_id: USERS.member.id, via: "hr", added_by: "x" })).error).not.toBeNull();
  });

  it("a member reads only their own check-ins; HR and the executive board read all", async () => {
    const id = await meeting();
    const hr = await as(USERS.hr);
    await hr.rpc("mark_internal_attendance", { internal_event: id, profile: USERS.member.id, present: true });
    await hr.rpc("mark_internal_attendance", { internal_event: id, profile: USERS.helper.id, present: true });
    const read = async (u: SeedUser) => ((await (await as(u)).from("internal_attendance").select("profile_id").eq("internal_event_id", id)).data ?? []).length;
    expect(await read(USERS.member)).toBe(1);
    expect(await read(USERS.volunteer1)).toBe(0);
    expect(await read(USERS.hr)).toBe(2);
    expect(await read(USERS.executive)).toBe(2);
  });
});

describe("member_activity", () => {
  const semester = semesterFor(berlinDate(new Date().toISOString())).key;
  it("counts Tuesday Talks and other meetings attended; HR, VP and the board only", async () => {
    const before = (await (await as(USERS.hr)).rpc("member_activity", { semester })).data ?? [];
    const was = before.find((r) => r.profile_id === USERS.volunteer2.id) ?? { talk_count: 0, meeting_count: 0 };
    const talk = await meeting();
    const other = await meeting("internal");
    const hr = await as(USERS.hr);
    await hr.rpc("mark_internal_attendance", { internal_event: talk, profile: USERS.volunteer2.id, present: true });
    await hr.rpc("mark_internal_attendance", { internal_event: other, profile: USERS.volunteer2.id, present: true });
    const after = ((await hr.rpc("member_activity", { semester })).data ?? []).find((r) => r.profile_id === USERS.volunteer2.id);
    expect(after).toMatchObject({ talk_count: was.talk_count + 1, meeting_count: was.meeting_count + 1 });
    // Everyone with a profile is listed, also without activity.
    expect(((await hr.rpc("member_activity", { semester })).data ?? []).some((r) => r.profile_id === USERS.member.id)).toBe(true);
    expect((await (await as(USERS.executive)).rpc("member_activity", { semester })).error).toBeNull();
    expect((await (await as(USERS.member)).rpc("member_activity", { semester })).error?.message).toMatch(/HR, the Vice President/);
  });
});
