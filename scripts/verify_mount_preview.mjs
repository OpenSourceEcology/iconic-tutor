// Real UI: immediate size feedback, stable scale, assembled/exploded views,
// preview isolation, and preservation of the older Axis study.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-webgl"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const output = "reports/mount-preview";
await mkdir(output, { recursive: true });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function saved(name) {
  const pending = page.waitForEvent("download");
  await page.locator("#save-project").click();
  await (await pending).saveAs(output + "/" + name);
  return JSON.parse(await readFile(output + "/" + name, "utf8"));
}
try {
  await page.goto(
    (process.env.STUDIO_URL || "http://127.0.0.1:8766") +
      "/studio.html?lesson=machines",
  );
  await page.waitForFunction(
    () => document.querySelector("#viewport").dataset.previewState === "ready",
  );
  assert.equal(await page.locator("#param-width_mm").inputValue(), "60");
  assert.match(await page.locator("#mount-feedback").textContent(), /15.0 mm/);
  const original = await saved("before.json");
  await page.locator("#mount-top").click();
  await page.locator("#range-width_mm").focus();
  await page.keyboard.press("Home");
  for (let n = 0; n < 30; n++) await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    () => document.querySelector("#viewport").dataset.livePlateWidth === "90",
  );
  assert.equal(await page.locator("#param-width_mm").inputValue(), "90");
  assert.match(
    await page.locator("#mount-feedback").textContent(),
    /four frame-hole centers line up/,
  );
  assert.deepEqual(
    await saved("preview-only.json"),
    original,
    "slider previews do not overwrite checked CAD",
  );
  await page.screenshot({ path: output + "/aligned-top.png", fullPage: true });
  await page.locator("#mount-exploded").click();
  assert.equal(
    await page.locator("#viewport").getAttribute("data-exploded"),
    "true",
  );
  assert.deepEqual(
    await saved("exploded.json"),
    original,
    "exploding is a view operation",
  );
  await page.screenshot({ path: output + "/exploded.png", fullPage: true });
  await page.locator("#mount-assembly").click();
  assert.equal(
    await page.locator("#viewport").getAttribute("data-exploded"),
    "false",
  );
  // Exercise the first-time migration of a real legacy project.
  await page.evaluate(async () => {
    const { seedProject } = await import("./js/studio-core.js");
    const { saveSession } = await import("./js/studio-storage.js");
    const catalog = (await (await fetch("data/studio/catalog.json")).json())
      .assets;
    const legacy = seedProject(
      "machines",
      catalog.filter((a) => a.source_id.startsWith("axis_")),
    );
    legacy.goal = "Keep my old Axis study";
    await saveSession({
      projects: { machines: legacy },
      lessons: { machines: 1 },
    });
  });
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelector("#selected-title").textContent ===
      "Motor mounting plate",
  );
  assert(await page.locator("#download-axis").isVisible());
  const pending = page.waitForEvent("download");
  await page.locator("#download-axis").click();
  await (await pending).saveAs(output + "/legacy.json");
  const legacy = JSON.parse(await readFile(output + "/legacy.json", "utf8"));
  assert.equal(legacy.goal, "Keep my old Axis study");
  assert.equal(legacy.instances.length, 3);
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    assert(
      !(await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )),
    );
    await page.screenshot({
      path: output + `/mobile-${width}.png`,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS live resizing, hole alignment, view-only explosion, preserved CAD and archived Axis migration",
  );
} finally {
  await browser.close();
}
