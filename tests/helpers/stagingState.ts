// The staging demo on the shared local stack (the DB test and the
// staging-mode E2E seed it): what the database held before, and putting that
// back afterwards – the staging demo again, or the small demo seed
// (scripts/seed-demo.mjs) – so the dev database ends as it started.
import { spawnSync } from "node:child_process";
import { SERVICE_ROLE_KEY, type Db } from "./local";
import { deleteDemoMembers, removeStagingData, seedStaging, stagingTag } from "@/lib/staging/seed";

export const LOCAL_SEED = { serviceRoleKey: SERVICE_ROLE_KEY, baseUrl: "http://localhost:3000", domain: "esnmesa.org" };

export interface DemoState {
  staging: boolean;
  demo: boolean;
}

export async function demoState(db: Db): Promise<DemoState> {
  const count = async (tag: string) => (await db.from("events").select("id", { count: "exact", head: true }).eq("created_by", tag)).count ?? 0;
  return { staging: (await count(stagingTag("esnmesa.org"))) > 0, demo: (await count("demo@esnmesa.org")) > 0 };
}

export async function restoreDemoState(db: Db, before: DemoState) {
  await removeStagingData(db, "esnmesa.org");
  if (before.staging) {
    await seedStaging(db, LOCAL_SEED);
    return;
  }
  await deleteDemoMembers(db, "esnmesa.org");
  if (before.demo) {
    const res = spawnSync(process.execPath, ["scripts/seed-demo.mjs"], { stdio: "inherit" });
    if (res.status !== 0) throw new Error("Restoring the demo seed failed (npm run seed:demo).");
  }
}
