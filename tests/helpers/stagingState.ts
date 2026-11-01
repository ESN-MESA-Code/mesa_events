// The demo data on the shared local stack (the DB test and the staging-mode
// E2E seed it again): whether it was there before, and putting that back
// afterwards – so the dev database ends as it started.
import { SERVICE_ROLE_KEY, type Db } from "./local";
import { deleteDemoMembers, removeStagingData, seedStaging, stagingTag } from "@/lib/staging/seed";

export const LOCAL_SEED = { serviceRoleKey: SERVICE_ROLE_KEY, baseUrl: "http://localhost:3000", domain: "esnmesa.org" };

export interface DemoState {
  staging: boolean;
}

export async function demoState(db: Db): Promise<DemoState> {
  const { count } = await db.from("events").select("id", { count: "exact", head: true }).eq("created_by", stagingTag("esnmesa.org"));
  return { staging: (count ?? 0) > 0 };
}

export async function restoreDemoState(db: Db, before: DemoState) {
  await removeStagingData(db, "esnmesa.org");
  if (before.staging) {
    await seedStaging(db, LOCAL_SEED);
    return;
  }
  await deleteDemoMembers(db, "esnmesa.org");
}
