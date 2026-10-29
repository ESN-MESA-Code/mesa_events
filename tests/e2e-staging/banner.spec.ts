// The staging banner is readable on a phone (375 px), and the page does not scroll sideways.
import { expect, test } from "@playwright/test";
import { STAGING_LOCAL_ENV } from "../../scripts/staging/local-env.mjs";

test("banner at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/staging");
  await page.getByLabel("Access code").fill(STAGING_LOCAL_ENV.STAGING_ACCESS_CODE);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("list", { name: "Roles" }).getByRole("button", { name: /^Helper/ }).click();
  await expect(page).toHaveURL(/\/$/);
  const banner = page.getByTestId("staging-banner");
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("link", { name: "Switch role" })).toBeVisible();
  expect((await banner.boundingBox())!.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({ path: "test-results/staging/banner-375.png" });
});
