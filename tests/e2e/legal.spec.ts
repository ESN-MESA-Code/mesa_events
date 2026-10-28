// Legal pages are public and linked from every page (from MESAttendance).
import { expect, test } from "./fixtures";

for (const [path, heading] of [
  ["/impressum", "Impressum / Legal notice"],
  ["/terms", "Participation terms"],
  ["/privacy", "Privacy notice"],
  ["/datenschutz", "Datenschutzerklärung"],
]) {
  test(`${path} is public`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText("info@esnmesa.org").first()).toBeVisible();
  });
}

test("the login page links them in its footer", async ({ page }) => {
  await page.goto("/login");
  const footer = page.getByRole("contentinfo");
  await footer.getByRole("link", { name: "Impressum / Legal notice" }).click();
  await expect(page.getByText("VR 200385")).toBeVisible();
});
