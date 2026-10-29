// A production build has nothing of staging: no banner, no demo sign-in, no
// reset, no outbox, no noindex header (lib/staging.ts; the staging side is
// tests/e2e-staging).
import { expect, test, USERS } from "./fixtures";

test("no demo sign-in or banner", async ({ page, request }) => {
  await page.goto("/login");
  await expect(page).not.toHaveTitle(/\[Staging\]/);
  await expect(page.getByTestId("staging-banner")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Demo sign-in/ })).toHaveCount(0);

  expect((await request.get("/staging")).status()).toBe(404);
  expect((await request.post("/auth/staging/code", { form: { code: "local-staging-access-code" } })).status()).toBe(404);
  expect((await request.post("/auth/staging/sign-in", { form: { persona: "admin" } })).status()).toBe(404);
  expect((await request.get("/login")).headers()["x-robots-tag"]).toBeUndefined();
  expect(await (await request.get("/robots.txt")).text()).toContain("Disallow: /");
});

test("no demo outbox or reset", async ({ as }) => {
  const page = await as(USERS.admin);
  await page.goto("/admin/demo-outbox");
  await expect(page.getByTestId("not-found")).toBeVisible();
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  await expect(page.getByTestId("staging-reset")).toHaveCount(0);
  const res = await page.request.post("/admin/demo-data/reset", { form: { confirm: "RESET" }, maxRedirects: 0 });
  expect(res.status()).toBe(404);
});
