import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-webgl"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const out = process.env.STUDIO_VERIFY_OUT || "reports/studio-placement";
await mkdir(out, { recursive: true });
try {
  await page.goto(
    (process.env.STUDIO_URL || "http://127.0.0.1:8766") + "/studio.html",
  );
  await page.waitForFunction(
    () => document.querySelector("#viewport").dataset.previewState === "ready",
  );
  await page.locator('[data-domain="machines"]').click();
  assert(await page.locator("#machine-task").isVisible());
  await page.locator("#lesson-action").click();
  await page.locator("#placement-panel summary").click();
  const before = await page.locator("#place-position-2").inputValue();
  await page.locator("#place-position-2").fill("25");
  await page.locator("#place-rotation-0").fill("90");
  await page.locator("#placement-form button").click();
  assert.equal(await page.locator("#place-position-2").inputValue(), "25");
  await page.locator("#undo").click();
  // Undo chooses the first part; select the spacer again.
  await page
    .locator("#asset-palette button")
    .filter({ hasText: "Motor mounting plate" })
    .click();
  assert.equal(await page.locator("#place-position-2").inputValue(), before);
  await page.locator('[data-transform="translate"]').click();
  await page.locator("#focus-selected").click();
  const canvas = page.locator("#viewport canvas");
  await canvas.scrollIntoViewIfNeeded();
  // Find the rendered blue Z arrow rather than relying on fixed screen coordinates.
  async function blueHandle() {
    return canvas.evaluate((c) => {
      const copy = document.createElement("canvas");
      copy.width = c.width;
      copy.height = c.height;
      const ctx = copy.getContext("2d");
      ctx.drawImage(c, 0, 0);
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      const pixels = [];
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          if (data[i + 2] > 180 && data[i] < 110 && data[i + 1] < 150)
            pixels.push([x, y]);
        }
      if (!pixels.length) return null;
      const top = Math.min(...pixels.map((p) => p[1]));
      const tip = pixels.filter((p) => p[1] >= top + 4 && p[1] <= top + 10);
      if (!tip.length) return null;
      const b = c.getBoundingClientRect();
      return {
        x:
          b.x +
          ((tip.reduce((s, p) => s + p[0], 0) / tip.length) * b.width) /
            c.width,
        y: b.y + ((top + 7) * b.height) / c.height,
      };
    });
  }
  await page.waitForTimeout(250);
  const tip = await blueHandle();
  assert(tip, "Z handle is visible");
  await page.mouse.move(tip.x, tip.y);
  await page.mouse.down();
  await page.mouse.move(tip.x, tip.y - 35, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  assert.notEqual(
    await page.locator("#place-position-2").inputValue(),
    before,
    "Z handle moves part in depth",
  );
  await page.locator("#undo").click();
  await page
    .locator("#asset-palette button")
    .filter({ hasText: "Motor mounting plate" })
    .click();
  assert.equal(
    await page.locator("#place-position-2").inputValue(),
    before,
    "one undo restores Z drag",
  );
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const tip2 = await blueHandle();
  assert(tip2);
  await page.mouse.move(tip2.x, tip2.y);
  await page.mouse.down();
  await page.mouse.move(tip2.x, tip2.y - 20, { steps: 8 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal(
    await page.locator("#place-position-2").inputValue(),
    before,
    "Escape cancels gizmo movement",
  );
  await page.locator("#stack-target").selectOption("instance_1");
  await page.locator("#stack-gap").fill("3");
  await page.locator("#stack-above").click();
  assert(
    Number(await page.locator("#place-position-2").inputValue()) > 0,
    "stack raises spacer",
  );
  // Save non-planar rotations and elevation, then independently reopen in FreeCAD.
  await page.locator("#place-rotation-0").fill("35");
  await page.locator("#place-rotation-1").fill("20");
  await page.locator("#placement-form button").click();
  for (const [id, name] of [
    ["save-project", "placed.json"],
    ["export-cad", "placed.FCStd"],
  ]) {
    const pending = page.waitForEvent("download");
    await page.locator("#" + id).click();
    await (await pending).saveAs(out + "/" + name);
  }
  const saved = JSON.parse(await readFile(out + "/placed.json", "utf8"));
  const selected = saved.instances.find((i) => i.id === "instance_3");
  assert.equal(selected.rotation[0], 35);
  assert.equal(selected.rotation[1], 20);
  await page.locator("#project-file").setInputFiles(out + "/placed.json");
  await page
    .locator("#asset-palette button")
    .filter({ hasText: "Motor mounting plate" })
    .click();
  assert.equal(await page.locator("#place-rotation-0").inputValue(), "35");
  await page.screenshot({
    path: out + "/machine-placement.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS exact XYZ/rotation, real Z gizmo drag, one-step undo, Escape, stacking, portable transforms and CAD download",
  );
} finally {
  await browser.close();
}
