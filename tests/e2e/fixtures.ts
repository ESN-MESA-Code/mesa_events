// Shared steps for the end-to-end tests. (Fixture callbacks are called
// `provide` rather than Playwright's usual `use`, which React's lint rules
// would take for a hook.)
import { expect, test as base, type BrowserContext, type Page } from "@playwright/test";
import { JOBS_SECRET, USERS, admin, passwordSession, sessionCookies, type SeedUser } from "../helpers/local";

export { expect, USERS, admin };

const sessions = new Map<string, object>();

/** Signs a seeded member in (real Supabase Auth session) by setting the cookies the app reads. */
export async function signInAs(context: BrowserContext, baseURL: string, user: SeedUser) {
  let session = sessions.get(user.email);
  if (!session) {
    session = await passwordSession(user);
    sessions.set(user.email, session);
  }
  await context.clearCookies();
  await context.addCookies(sessionCookies(session, baseURL));
}

export const test = base.extend<{ as: (user: SeedUser) => Promise<Page> }>({
  // `await as(USERS.events)`: the page, signed in as that member.
  as: async ({ page, context, baseURL }, provide) => {
    await provide(async (user) => {
      await signInAs(context, baseURL!, user);
      return page;
    });
  },
});

/** Runs due jobs now (what pg_cron does every 30 seconds), through the protected route. */
export async function runJobs(baseURL: string) {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${baseURL}/api/jobs/run`, { method: "POST", headers: { Authorization: `Bearer ${JOBS_SECRET}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { claimed: number; failed: number };
    expect(body.failed).toBe(0);
    if (!body.claimed) return;
  }
}

/** A month no other run uses, as "YYYY-MM". */
export function freshMonth() {
  const year = 2040 + Math.floor(Math.random() * 50);
  const month = 1 + Math.floor(Math.random() * 12);
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Waits until the editor's autosave reports all changes saved. */
export async function waitSaved(page: Page) {
  await expect(page.getByTestId("save-state")).toHaveText("All changes saved");
}
