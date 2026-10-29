// Playwright's global setup: remove leftovers of an earlier run (review 2026-10-29 A7).
import { cleanTestData } from "../helpers/global-cleanup";

export default async function setup() {
  await cleanTestData("before E2E");
}
