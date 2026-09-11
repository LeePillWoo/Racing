import { existsSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
let pw;
try { pw = await import("playwright"); } catch {
  const links = join(process.env.LOCALAPPDATA, "ms-playwright", ".links");
  for (const name of readdirSync(links)) {
    const modulePath = join(readFileSync(join(links, name), "utf8").trim(), "index.mjs");
    if (existsSync(modulePath)) { pw = await import(pathToFileURL(modulePath).href); break; }
  }
}
assert.ok(pw, "Install Playwright or provide the existing local browser tooling.");
mkdirSync("artifacts", { recursive: true });
const browser = await pw.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], warnings = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => {
  if (message.type() === "error") errors.push(message.text());
  if (message.type() === "warning") warnings.push(message.text());
});
try {
  await page.goto("http://127.0.0.1:5173/");
  await page.locator("#start-button").waitFor({ state: "visible", timeout: 60000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "artifacts/start-desktop.png" });
  await page.locator("#start-button").click();
  await page.waitForFunction(() => window.__racing.countdown === 0);
  await page.waitForTimeout(150);
  await page.screenshot({ path: "artifacts/race-desktop.png" });
  await page.keyboard.down("KeyW"); await page.waitForFunction(() => window.__racing.playerVehicle.telemetry.forwardSpeedMs > 8, { timeout: 20000 }); await page.keyboard.up("KeyW");
  const speed = await page.evaluate(() => window.__racing.playerVehicle.telemetry.forwardSpeedMs);
  assert.ok(speed > 4, "Browser throttle should accelerate, speed=" + speed);
  await page.keyboard.press("Escape");
  const before = await page.evaluate(() => window.__racing.playerVehicle.position().toArray());
  await page.waitForTimeout(400);
  assert.deepEqual(await page.evaluate(() => window.__racing.playerVehicle.position().toArray()), before);
  await page.locator("#resume-button").click();
  await page.keyboard.press("KeyR");
  await page.waitForTimeout(300);
  await page.keyboard.down("KeyS"); await page.waitForTimeout(1800); await page.keyboard.up("KeyS");
  assert.ok(await page.evaluate(() => window.__racing.playerVehicle.telemetry.forwardSpeedMs < -1));
  await page.keyboard.press("KeyC");
  await page.waitForTimeout(200);
  await page.keyboard.press("KeyC");
  await page.keyboard.down("Space");
  assert.equal(await page.evaluate(() => window.__racing.input.sample().handbrake), true, "Space should engage the drift handbrake");
  await page.keyboard.up("Space");
  assert.equal(await page.evaluate(() => window.__racing.input.sample().handbrake), false);
  await page.keyboard.press("KeyR");
  await page.waitForTimeout(500);
  await page.keyboard.down("ShiftLeft");
  assert.equal(await page.evaluate(() => window.__racing.input.sample().boost), true);
  assert.equal(await page.evaluate(() => window.__racing.input.sample().handbrake), false);
  await page.waitForFunction(() => window.__racing.playerVehicle.telemetry.boosting);
  assert.equal(await page.evaluate(() => window.__racing.playerVehicle.meshes.root.getObjectByName("exhaust-flame").children[1].visible), true);
  await page.waitForTimeout(600);
  await page.screenshot({ path: "artifacts/boost-desktop.png" });
  await page.keyboard.up("ShiftLeft");
  await page.waitForFunction(() => !window.__racing.playerVehicle.telemetry.boosting);
  await page.keyboard.down("KeyW");
  await page.waitForFunction(() => window.__racing.playerVehicle.telemetry.forwardSpeedMs > 10);
  await page.keyboard.down("Space");
  await page.keyboard.down("KeyD");
  await page.waitForFunction(() => [...window.__racing.tireSmoke.points.geometry.attributes.alpha.array].some(a => a > 0.1));
  await page.waitForTimeout(250);
  assert.ok(await page.evaluate(() => [...window.__racing.skidMarks.mesh.geometry.attributes.color.array].some((a, i) => i % 4 === 3 && a > 0.1)));
  await page.screenshot({ path: "artifacts/drift-desktop.png" });
  await page.keyboard.up("Space"); await page.keyboard.up("KeyD"); await page.keyboard.up("KeyW");
  const diagnostics = await page.evaluate(() => ({
    cars: window.__racing.raceManager.racers.length,
    drawCalls: window.__racing.renderer.info.render.calls,
    triangles: window.__racing.renderer.info.render.triangles,
    ai: window.__racing.aiEntries.map(e => ({ name: e.racer.name, speed: e.vehicle.telemetry.speedKmh, progress: e.racer.distanceTraveled })),
  }));
  assert.equal(diagnostics.cars, 12);
  await page.setViewportSize({ width: 640, height: 1138 });
  await page.keyboard.press("KeyR"); await page.waitForTimeout(700);
  await page.screenshot({ path: "artifacts/race-portrait.png" });

  const mobileContext = await browser.newContext({ viewport: { width: 640, height: 1138 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const mobile = await mobileContext.newPage();
  mobile.on("pageerror", error => errors.push(error.message));
  await mobile.goto("http://127.0.0.1:5173/");
  await mobile.locator("#start-button").waitFor({ state: "visible", timeout: 60000 });
  await mobile.locator("#start-button").tap();
  await mobile.locator(".touch-controls").waitFor({ state: "visible" });
  await mobile.waitForFunction(() => window.__racing.countdown === 0);
  const gasBox = await mobile.locator('[data-control="KeyW"]').boundingBox();
  const leftBox = await mobile.locator('[data-control="KeyA"]').boundingBox();
  const session = await mobileContext.newCDPSession(mobile);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [
    { x: gasBox.x + gasBox.width / 2, y: gasBox.y + gasBox.height / 2, id: 1 },
    { x: leftBox.x + leftBox.width / 2, y: leftBox.y + leftBox.height / 2, id: 2 },
  ]});
  const held = await mobile.evaluate(() => window.__racing.input.sample());
  assert.equal(held.throttle, 1); assert.equal(held.steer, -1);
  const driftBox = await mobile.locator('[data-control="Space"]').boundingBox();
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [
    { x: driftBox.x + driftBox.width / 2, y: driftBox.y + driftBox.height / 2, id: 3 },
  ]});
  assert.equal(await mobile.evaluate(() => window.__racing.input.sample().handbrake), true, "the DRIFT touch button should engage the handbrake");
  await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  const released = await mobile.evaluate(() => window.__racing.input.sample());
  assert.equal(released.throttle, 0); assert.equal(released.steer, 0);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mobile.locator("#pause-button").tap();
  await mobile.locator("#resume-button").waitFor({ state: "visible" });
  await mobile.locator("#resume-button").tap();
  await mobile.screenshot({ path: "artifacts/race-touch.png" });
  await mobileContext.close();

  console.log(JSON.stringify({ errors, warnings, speed, diagnostics, touch: "passed" }, null, 2));
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
