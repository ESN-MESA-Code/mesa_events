// The staging-mode E2E runs against the local stack with the staging demo
// seeded; the teardown puts back what was there (tests/helpers/stagingState.ts).
import fs from "node:fs";
import { admin } from "../helpers/local";
import { LOCAL_SEED, demoState } from "../helpers/stagingState";
import { seedStaging } from "@/lib/staging/seed";

export const STATE_FILE = "test-results/staging-e2e-state.json";

export default async function setup() {
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(await demoState(admin)));
  await seedStaging(admin, LOCAL_SEED);
}
