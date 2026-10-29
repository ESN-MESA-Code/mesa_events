// Global setup/teardown of the DB and E2E suites (review 2026-10-29 A7):
// they share the local database with `npm run dev:local`, so leftovers of
// an earlier (crashed) run are removed first, and everything the run
// created afterwards – the dev UI shows only the demo data again.
import { removeTestData } from "../../scripts/clean-test-data.mjs";
import { admin } from "./local";

export async function cleanTestData(when: string) {
  const n = await removeTestData(admin);
  if (n.cycles || n.events || n.ideas) console.log(`[${when}] removed test data: ${n.cycles} cycles, ${n.events} events, ${n.ideas} ideas`);
}

/** Vitest globalSetup: clean before, and return the teardown. */
export default async function setup() {
  await cleanTestData("before");
  return async () => cleanTestData("after");
}
