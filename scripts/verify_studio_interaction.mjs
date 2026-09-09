// Real browser input regression: dragging, cancellation, camera, history and touch.
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-webgl"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = process.env.STUDIO_URL || "http://127.0.0.1:8766";
try {
  await page.goto(base + "/studio.html");
  await page
    .locator("#plan [data-instance]")
    .first()
    .waitFor({ state: "attached" });
  await page.locator("#tab-plan").click();
  const first = page.locator("#plan [data-instance]").first();
  const circle = first.locator("circle");
  await circle.scrollIntoViewIfNeeded();
  const start = await circle.boundingBox();
  const x = start.x + start.width / 2,
    y = start.y + start.height / 2;
  const camera = await page.locator("#plan svg").getAttribute("viewBox");
  const polygon = await first.locator("polygon").getAttribute("points");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 65, y + 33, { steps: 12 });
  await page.waitForFunction(() =>
    document.querySelector("#plan [data-instance]").hasAttribute("transform"),
  );
  assert.match(
    await first.getAttribute("transform"),
    /translate\(/,
    "moves before release",
  );
  assert.equal(
    await page.locator("#plan svg").getAttribute("viewBox"),
    camera,
    "camera stable during drag",
  );
  await page.mouse.up();
  assert.notEqual(
    await first.locator("polygon").getAttribute("points"),
    polygon,
  );
  assert.equal(
    await page.locator("#plan svg").getAttribute("viewBox"),
    camera,
    "no refit on drop",
  );
  await page.locator("#undo").click();
  assert.equal(
    await first.locator("polygon").getAttribute("points"),
    polygon,
    "one undo restores entire drag",
  );
  assert(
    await page.locator("#undo").isDisabled(),
    "one drag makes one history entry",
  );
  await circle.scrollIntoViewIfNeeded();
  const b = await circle.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 70, b.y + 40, { steps: 8 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal(
    await first.locator("polygon").getAttribute("points"),
    polygon,
    "Escape cancels placement",
  );
  assert(await page.locator("#undo").isDisabled());
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -130);
  await page.waitForFunction(
    (c) => document.querySelector("#plan svg").getAttribute("viewBox") !== c,
    camera,
  );
  await page.locator("#fit-plan").click();
  assert.equal(await page.locator("#plan svg").getAttribute("viewBox"), camera);
  // Browser touch input, followed by OS interruption, leaves geometry intact.
  await circle.scrollIntoViewIfNeeded();
  const touchBox = await circle.boundingBox();
  const touch = {
    x: touchBox.x + touchBox.width / 2,
    y: touchBox.y + touchBox.height / 2,
  };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touch],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: touch.x + 40, y: touch.y + 20 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  assert.equal(await first.locator("polygon").getAttribute("points"), polygon);
  assert(await page.locator("#undo").isDisabled());
  // Context transport test uses a recorded response; real model is tested separately.
  let request;
  await page.route("**/api/studio/tutor", async (route) => {
    request = route.request().postDataJSON();
    await route.fulfill({
      json: {
        reply: "Your goal and the placed wall modules are available here.",
        parameters: null,
        sources: [
          {
            title: "Window schema",
            url: "https://github.com/OpenSourceEcology/iconic-cad/blob/54fb950/library/modules/window_4x8_2x6_36x48/schema.py",
          },
        ],
      },
    });
  });
  await page
    .locator("#project-goal")
    .fill("Make a 30 inch rough opening for the garden room");
  await page.locator("#project-goal").blur();
  await page.locator("#chat-input").fill("Remember the garden room.");
  await page.locator("#send-chat").click();
  await page.waitForFunction(
    () => !document.querySelector("#send-chat").disabled,
  );
  await page.locator("#chat-input").fill("What is my goal?");
  await page.locator("#send-chat").click();
  await page.waitForFunction(
    () => !document.querySelector("#send-chat").disabled,
  );
  assert.equal(request.project.placed_count, 12);
  assert.match(request.project.goal, /garden room/);
  assert(
    request.history.some((m) => m.content === "Remember the garden room."),
  );
  assert(!JSON.stringify(request).includes("CASCADE Topology"));
  await page.reload();
  await page.locator("#project-goal").waitFor();
  await page.waitForFunction(() =>
    document.querySelector("#project-goal").value.includes("garden room"),
  );
  await page.waitForFunction(() =>
    document
      .querySelector("#chat-log")
      .textContent.includes("Remember the garden room"),
  );
  assert.match(
    await page.locator("#chat-log").textContent(),
    /Remember the garden room/,
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS continuous drag, stable camera, one-step undo, cancellation, zoom, persisted tutor goal/history and bounded context",
  );
} finally {
  await browser.close();
}
