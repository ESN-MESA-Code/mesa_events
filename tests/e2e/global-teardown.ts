// Playwright's global teardown: remove what the run created (review 2026-10-29 A7).
import { cleanTestData } from "../helpers/global-cleanup";

export default async function teardown() {
  await cleanTestData("after E2E");
}
