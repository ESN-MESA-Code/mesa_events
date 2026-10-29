// A staging build: the banner and noindex everywhere, the demo sign-in
// behind the access code, role switching, the outbox and the reset card.
import { expect, test, type Page } from "@playwright/test";
import { STAGING_LOCAL_ENV } from "../../scripts/staging/local-env.mjs";

const CODE = STAGING_LOCAL_ENV.STAGING_ACCESS_CODE;

async function unlock(page: Page) {
  await page.goto("/staging");
  await page.getByLabel("Access code").fill(CODE);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("list", { name: "Roles" })).toBeVisible();
}

async function pick(page: Page, role: string) {
  await page.getByRole("list", { name: "Roles" }).getByRole("button", { name: new RegExp(`^${role}`) }).click();
}

const sameOrigin = (page: Page) => ({ origin: new URL(page.url()).origin });

test("access code → role picker → role, with the banner on every page", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveTitle(/^\[Staging\] /);
  await expect(page.getByTestId("staging-banner")).toContainText("Staging – demo data only, nothing is real");
  await page.getByRole("link", { name: "Demo sign-in (staging)" }).click();

  // A wrong code is refused; the roles stay hidden.
  await page.getByLabel("Access code").fill("not-the-code-at-all");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toHaveText("That is not the access code.");
  await expect(page.getByRole("list", { name: "Roles" })).toHaveCount(0);

  await page.getByLabel("Access code").fill(CODE);
  await page.getByRole("button", { name: "Continue" }).click();
  const roles = page.getByRole("list", { name: "Roles" });
  await expect(roles.getByRole("listitem")).toHaveCount(10);
  await expect(roles).toContainText("Plans the month");

  await pick(page, "Events team");
  await expect(page).toHaveURL(/\/team\/events/);
  await expect(page.getByTestId("viewer-name")).toHaveText("Amara Okafor");
  await expect(page.getByTestId("staging-banner")).toBeVisible();
  await expect(page).toHaveTitle(/^\[Staging\] /);

  // Switch role from the banner: the picker is still unlocked.
  await page.getByTestId("staging-banner").getByRole("link", { name: "Switch role" }).click();
  await expect(page.getByTestId("signed-in-as")).toContainText("Amara Okafor");
  await pick(page, "OC");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("viewer-name")).toHaveText("Chloé Dubois");
  await expect(page.getByText("Language Café").first()).toBeVisible();
});

test("the demo outbox shows what would have been sent", async ({ page }) => {
  await unlock(page);
  await pick(page, "Comms team");
  await expect(page).toHaveURL(/\/team\/comms/);
  await page.getByTestId("staging-banner").getByRole("link", { name: "Demo outbox" }).click();
  await expect(page.getByRole("heading", { name: "Demo outbox" })).toBeVisible();
  const outbox = page.getByTestId("outbox");
  await expect(outbox).toContainText("Welcome to the space for");
  await page.getByRole("link", { name: /^Direct messages/ }).click();
  await expect(outbox).toContainText("dropped out");
  await page.getByRole("link", { name: /^Drive folders/ }).click();
  await expect(outbox).toContainText("Pub Quiz Night");
});

test("admins see the reset; it needs the confirmation", async ({ page }) => {
  await unlock(page);
  await pick(page, "Admin");
  await expect(page).toHaveURL(/\/admin/);
  const card = page.getByTestId("staging-reset");
  await expect(card.getByRole("button", { name: "Reset demo data" })).toBeVisible();
  // Without "RESET" nothing happens. (The reset itself wipes the shared local
  // database, so it is not run here; tests/db/staging.test.ts runs the wipe
  // in a rolled-back transaction.)
  const res = await page.request.post("/admin/demo-data/reset", { form: { confirm: "nope" }, maxRedirects: 0, headers: sameOrigin(page) });
  expect(res.status()).toBe(303);
  expect(res.headers().location).toContain("/admin?demo=confirm");
  // Another site cannot post it.
  const cross = await page.request.post("/admin/demo-data/reset", { form: { confirm: "RESET" }, maxRedirects: 0, headers: { origin: "https://evil.example" } });
  expect(cross.status()).toBe(403);
});

test("members who are not admins cannot reset", async ({ page }) => {
  await unlock(page);
  await pick(page, "Member");
  await expect(page).toHaveURL(/\/$/);
  const res = await page.request.post("/admin/demo-data/reset", { form: { confirm: "RESET" }, maxRedirects: 0, headers: sameOrigin(page) });
  expect(res.status()).toBe(403);
});

test("noindex and robots.txt", async ({ request }) => {
  const res = await request.get("/login");
  expect(res.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  const robots = await request.get("/robots.txt");
  expect(await robots.text()).toContain("Disallow: /");
  expect(robots.headers()["x-robots-tag"]).toBe("noindex, nofollow");
});

test("the sign-in route needs the code", async ({ request }) => {
  const res = await request.post("/auth/staging/sign-in", { form: { persona: "admin" }, maxRedirects: 0 });
  expect(res.status()).toBe(303);
  expect(res.headers().location).toMatch(/\/staging$/);
});
