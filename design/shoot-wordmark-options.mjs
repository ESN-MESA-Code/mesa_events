// `node design/shoot-wordmark-options.mjs "$PWD/design/wordmark-options.html" "$PWD/design/screenshots"`
// – one PNG per variant and place (header, 375 px header, login card) and a
// full-page shot. Run from the repo root (needs @playwright/test).
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { mkdirSync } from "node:fs";
const [, , html, out] = process.argv;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(html).href);
await page.evaluate(() => document.fonts.ready);
for (const el of await page.$$("[data-shot]")) {
  const name = await el.getAttribute("data-shot");
  await (await el.$(":scope > *")).screenshot({ path: `${out}/${name}.png` });
}
await page.screenshot({ path: `${out}/../wordmark-options-full.png`, fullPage: true, scale: "css" });
await browser.close();
