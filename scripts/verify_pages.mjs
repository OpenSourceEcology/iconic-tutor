// Serve reports/pages-preview on port 8777, or set STUDIO_PAGES_URL to Pages.
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-webgl"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [],
  api = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (new URL(r.url()).pathname.startsWith("/api/")) api.push(r.url());
});
try {
  const url =
    process.env.STUDIO_PAGES_URL || "http://127.0.0.1:8777/iconic-tutor/";
  await page.goto(url + "studio.html?lesson=machines");
  await page.waitForFunction(
    () => document.querySelector("#viewport").dataset.previewState === "ready",
  );
  await page.locator("#hosting-note").waitFor({ state: "visible" });
  assert(await page.locator("#generate").isDisabled());
  assert.match(
    await page.locator("#tutor-mode").textContent(),
    /AI not connected/,
  );
  await page.locator("#mount-fit").click();
  await page.waitForFunction(
    () => document.querySelector("#viewport").dataset.livePlateWidth === "90",
  );
  assert.match(await page.locator("#mount-feedback").textContent(), /line up/);
  await page.locator("#mount-exploded").click();
  assert.equal(
    await page.locator("#viewport").getAttribute("data-exploded"),
    "true",
  );
  await page.locator("#lesson-action").click();
  assert(await page.locator("#lesson-action").isDisabled());
  await page.locator("#chat-input").fill("What changes here?");
  await page.locator("#send-chat").click();
  assert.match(await page.locator("#chat-log").textContent(), /gold plate/);
  const download = page.waitForEvent("download");
  await page.locator("#export-cad").click();
  assert((await download).suggestedFilename().endsWith(".FCStd"));
  await page.locator('[data-domain="house"]').click();
  assert.equal(
    await page.locator("#instance-count").textContent(),
    "12 placed modules",
  );
  assert.deepEqual(api, [], "static site makes no backend API requests");
  assert.deepEqual(errors, []);
  console.log(
    "PASS Pages subpath, live previews, guided mode, exports and explicit backend limits",
  );
} finally {
  await browser.close();
}
