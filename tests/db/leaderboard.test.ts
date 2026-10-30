// The leaderboard on Home (round 2026-10-30): OC and helper slots of ESN
// events that took place this semester; newbies are the members of the
// newbies Google group (role 'newbie').
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, admin, anonClient, as, createEvent, daysFromNow, hoursFromNow } from "../helpers/local";
import { berlinDate } from "@/lib/dates";
import { semesterFor } from "@/lib/internal";

const ids: string[] = [];
const semester = semesterFor(berlinDate(new Date().toISOString())).key;
const board = async () => {
  const { data, error } = await (await as(USERS.member)).rpc("leaderboard", { semester });
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((r) => [r.profile_id, r]));
};

beforeAll(async () => {
  await admin.from("role_members").insert({ email: USERS.volunteer2.email, role: "newbie", source: "manual" });
});
afterAll(async () => {
  await admin.from("role_members").delete().eq("email", USERS.volunteer2.email).eq("role", "newbie");
  for (const id of ids) await admin.from("events").delete().eq("id", id);
});

describe("leaderboard", () => {
  it("counts OC and helper slots of events that took place, newbies marked by their group", async () => {
    const before = await board();
    const count = (id: string, k: "oc_count" | "helper_count") => before.get(id)?.[k] ?? 0;
    // Took place: counts. Ahead or cancelled: does not.
    ids.push((await createEvent({ title: "Leaderboard past", starts_at: hoursFromNow(-3), oc: USERS.volunteer1, helpers: [USERS.volunteer2], helpers_needed: 1 })).id);
    ids.push((await createEvent({ title: "Leaderboard ahead", starts_at: daysFromNow(2), oc: USERS.volunteer1, helpers: [USERS.volunteer2], helpers_needed: 1 })).id);
    ids.push((await createEvent({ title: "Leaderboard cancelled", starts_at: hoursFromNow(-5), status: "cancelled", oc: USERS.volunteer1, helpers: [USERS.volunteer2], helpers_needed: 1 })).id);
    const after = await board();
    expect(after.get(USERS.volunteer1.id)).toMatchObject({ oc_count: count(USERS.volunteer1.id, "oc_count") + 1, newbie: false });
    expect(after.get(USERS.volunteer2.id)).toMatchObject({ helper_count: count(USERS.volunteer2.id, "helper_count") + 1, newbie: true });
  });

  it("members only, and only semester keys", async () => {
    expect((await (await as(USERS.newcomer)).rpc("leaderboard", { semester })).error?.code).toBe("42501");
    expect((await anonClient().rpc("leaderboard", { semester })).error).not.toBeNull();
    expect((await (await as(USERS.member)).rpc("leaderboard", { semester: "2026-3" })).error?.code).toBe("22023");
  });
});
