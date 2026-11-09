// Server actions: the generated "use server" files match lib/actions, and
// every action declares what it revalidates (review B5) – description
// autosave nothing, nobody the whole app unless it changes the navigation.
import { describe, expect, it } from "vitest";
import { differences } from "../../scripts/gen-actions.mjs";
import { PAGES, type Action } from "@/lib/actions/core";
import * as admin from "@/lib/actions/admin";
import * as attendance from "@/lib/actions/attendance";
import * as descriptions from "@/lib/actions/descriptions";
import * as esn from "@/lib/actions/esn";
import * as handin from "@/lib/actions/handin";
import * as planning from "@/lib/actions/planning";
import * as publishing from "@/lib/actions/publishing";
import * as roster from "@/lib/actions/roster";

const modules = { admin, attendance, descriptions, esn, handin, planning, publishing, roster };
const actions = Object.entries(modules).flatMap(([mod, m]) =>
  Object.entries(m)
    .filter(([, v]) => typeof v === "function" && "revalidate" in v)
    .map(([name, v]) => [`${mod}.${name}`, v as Action<unknown>] as const)
);

describe("generated actions", () => {
  it("app/actions/* match lib/actions/* (npm run gen:actions)", () => {
    expect(differences()).toEqual([]);
  });
});

describe("revalidation", () => {
  it("finds every action", () => {
    expect(actions.length).toBe(83);
  });

  it("autosave revalidates nothing", () => {
    expect(descriptions.saveDescription.revalidate).toEqual([]);
  });

  it("only actions that change the navigation revalidate every page", () => {
    const everything = actions.filter(([, a]) => a.revalidate.includes(PAGES.all)).map(([n]) => n);
    expect(everything.sort()).toEqual([
      "admin.addManualRole",
      "admin.removeManualRole",
      // The cycle timeline shows on Home, Ideas, the calendar and the Events pages (round 2026-11-02).
      "admin.updateSetting",
      // The header's profile menu marks missing payout details (round 2026-10-30).
      "handin.deleteMyPayoutDetails",
      "handin.setMyPayoutDetails",
      "planning.closeForm",
      "planning.openForm",
      "planning.submitVolunteerForm",
    ]);
  });

  it("targets are known pages", () => {
    const known = new Set<unknown>(Object.values(PAGES));
    for (const [name, a] of actions) for (const t of a.revalidate) expect(known.has(t), name).toBe(true);
  });
});
