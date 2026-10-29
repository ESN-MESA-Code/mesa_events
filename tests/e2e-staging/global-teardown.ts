import fs from "node:fs";
import { admin } from "../helpers/local";
import { restoreDemoState } from "../helpers/stagingState";
import { STATE_FILE } from "./global-setup";

export default async function teardown() {
  const before = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : { staging: false, demo: true };
  await restoreDemoState(admin, before);
  fs.rmSync(STATE_FILE, { force: true });
}
