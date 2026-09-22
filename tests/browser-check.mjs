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
  await page.waitForTimeout(600);
  assert.equal(await page.locator(".track-card").count(), 3, "the grid should offer three circuits");
  assert.equal(await page.locator(".track-card.selected").count(), 1);
  assert.equal(await page.locator(".car-card").count(), 8, "the garage should offer eight cars");
  assert.equal(await page.locator(".car-card.selected").count(), 1);
  await page.locator('.car-card[data-car="hornet-v8"]').click();
  assert.equal(await page.locator('.car-card[data-car="hornet-v8"]').getAttribute("aria-checked"), "true");
  await page.screenshot({ path: "artifacts/start-desktop.png" });
  await page.locator("#start-button").click();
  await page.waitForFunction(() => window.__racing && window.__racing.countdown === 0, null, { timeout: 90000 });
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
  // Wait for the car to actually be reversing rather than for a stopwatch: a slow machine
  // simulates less time per frame, and a fixed sleep then fails for no reason worth failing over.
  await page.keyboard.down("KeyS");
  await page.waitForFunction(() => window.__racing.playerVehicle.telemetry.forwardSpeedMs < -1, null, { timeout: 40000 });
  await page.keyboard.up("KeyS");
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
  // Crash the car into a barrier on purpose and check that parts actually leave it on screen.
  // Point the car at the barrier, let the suspension settle so it is not launched over the wall,
  // then fire it in at 150 km/h.
  await page.evaluate(() => {
    const g = window.__racing;
    const frame = g.path.frameAtDistance(200);
    frame.point.y = 0;
    window.__crashYaw = Math.atan2(frame.tangent.x, frame.tangent.z) + Math.PI / 2;
    g.playerVehicle.resetTo(frame.point, window.__crashYaw);
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const yaw = window.__crashYaw;
    window.__racing.playerVehicle.body.setLinvel({ x: Math.sin(yaw) * 42, y: 0, z: Math.cos(yaw) * 42 }, true);
  });
  await page.waitForFunction(() => window.__racing.playerVehicle.telemetry.brokenParts > 0, null, { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "artifacts/crash-damage.png" });
  const crash = await page.evaluate(() => ({
    broken: window.__racing.playerVehicle.telemetry.brokenParts,
    damage: window.__racing.playerVehicle.telemetry.damage,
    debris: window.__racing.debris.count,
    wingVisible: window.__racing.playerVehicle.meshes.frontWing.visible,
    // The HUD has to say so too, or the player has no way to know what is bent.
    readout: document.querySelector('[data-el="damagepct"]').textContent,
    critical: document.querySelector('[data-el="damage"]').classList.contains("critical"),
    goneMarkers: document.querySelectorAll('[data-el="damage"] .gone').length,
  }));
  assert.ok(crash.broken > 0, "a 150 km/h barrier hit should break something: " + JSON.stringify(crash));
  assert.ok(crash.debris > 0, "broken parts must appear as debris in the scene: " + JSON.stringify(crash));
  assert.equal(crash.wingVisible, false, "a broken front wing must stop being drawn on the car");
  assert.notEqual(crash.readout, "0%", "the damage panel must report the hit: " + JSON.stringify(crash));
  assert.equal(crash.critical, true, "a wrecked car should light the panel up");
  assert.ok(crash.goneMarkers > 0, "the panel must mark the parts that have gone");
  await page.keyboard.press("KeyR");
  await page.waitForTimeout(400);
  const repaired = await page.evaluate(() => ({
    broken: window.__racing.playerVehicle.telemetry.brokenParts,
    wingVisible: window.__racing.playerVehicle.meshes.frontWing.visible,
    readout: document.querySelector('[data-el="damagepct"]').textContent,
    goneMarkers: document.querySelectorAll('[data-el="damage"] .gone').length,
  }));
  assert.equal(repaired.broken, 0, "the R recovery must put the car back together");
  assert.equal(repaired.wingVisible, true);
  assert.equal(repaired.readout, "0%", "a repaired car must read zero damage");
  assert.equal(repaired.goneMarkers, 0);

  const diagnostics = await page.evaluate(() => ({
    cars: window.__racing.raceManager.racers.length,
    playerCar: window.__racing.playerVehicle.car.id,
    reflectionProbe: !!window.__racing.scene.environment,
    environmentIntensity: window.__racing.scene.environmentIntensity,
    shells: [...new Set(window.__racing.aiEntries.map(e => e.vehicle.car.style))].sort(),
    playerShellOnGrid: window.__racing.aiEntries.filter(e => e.vehicle.car.id === window.__racing.playerVehicle.car.id).length,
    drawCalls: window.__racing.renderer.info.render.calls,
    triangles: window.__racing.renderer.info.render.triangles,
    ai: window.__racing.aiEntries.map(e => ({ name: e.racer.name, speed: e.vehicle.telemetry.speedKmh, progress: e.racer.distanceTraveled })),
  }));
  assert.equal(diagnostics.cars, 12);
  assert.equal(diagnostics.playerCar, "hornet-v8", "the picked car must be the one you drive");
  assert.equal(diagnostics.reflectionProbe, true, "the sky has to be baked into a reflection probe");
  assert.ok(diagnostics.environmentIntensity > 0);
  assert.ok(diagnostics.shells.length >= 3, "the grid must field a mixed set of shells: " + diagnostics.shells);
  assert.equal(diagnostics.playerShellOnGrid, 0, "no opponent should be driving your exact car");
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
  await mobile.waitForFunction(() => window.__racing && window.__racing.countdown === 0, null, { timeout: 90000 });
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

  // Race a lap of each new circuit for real: a layout can pass the geometry tests and still
  // break in the browser (missing kerbs, a barrier across the crossover, a scenery crash).
  const tours = {};
  for (const id of ["switchback-park", "infinity-drift"]) {
    const tour = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    tour.on("pageerror", error => errors.push(id + ": " + error.message));
    tour.on("console", message => { if (message.type() === "error") errors.push(id + ": " + message.text()); });
    await tour.goto("http://127.0.0.1:5173/");
    await tour.locator(`.track-card[data-track="${id}"]`).click();
    await tour.locator("#start-button").click();
    await tour.waitForFunction(() => window.__racing && window.__racing.countdown === 0, null, { timeout: 90000 });
    await tour.keyboard.down("KeyW");
    await tour.waitForTimeout(6000);
    await tour.keyboard.up("KeyW");
    tours[id] = await tour.evaluate(() => ({
      track: window.__racing.track.id,
      halfWidth: window.__racing.path.halfWidth,
      laps: window.__racing.track.laps,
      offTrack: window.__racing.path.projectPoint(window.__racing.playerVehicle.position()).distance,
      drawCalls: window.__racing.renderer.info.render.calls,
    }));
    assert.equal(tours[id].track, id, "the picked circuit must be the one that loads");
    await tour.screenshot({ path: `artifacts/track-${id}.png` });
    await tour.close();
  }

  // The pause screen has to offer a way back out of the race.
  const menuPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  menuPage.on("pageerror", error => errors.push("menu: " + error.message));
  await menuPage.goto("http://127.0.0.1:5173/");
  await menuPage.locator("#start-button").click();
  await menuPage.waitForFunction(() => window.__racing && window.__racing.countdown === 0, null, { timeout: 90000 });
  await menuPage.locator("#pause-button").click();
  await menuPage.locator("#menu-button").waitFor({ state: "visible" });
  await menuPage.locator("#menu-button").click();
  // The start screen is static markup, so wait for the cards the script builds rather than the button.
  await menuPage.locator(".track-card").first().waitFor({ state: "visible", timeout: 30000 });
  assert.equal(await menuPage.locator(".track-card").count(), 3, "leaving a race must land back on the track picker");
  assert.ok(await menuPage.locator("#start-button").isVisible());
  await menuPage.close();

  console.log(JSON.stringify({ errors, warnings, speed, crash, diagnostics, tours, menu: "passed", touch: "passed" }, null, 2));
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
