import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import ts from "typescript";

// Load project TypeScript directly without emitting test builds into src.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && context.parentURL) {
      const path = resolve(dirname(fileURLToPath(context.parentURL)), specifier);
      if (existsSync(path + ".ts")) return { url: pathToFileURL(path + ".ts").href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".ts")) return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
    }).outputText };
    return next(url, context);
  }
});
const THREE = await import("three");
const { TrackPath } = await import("../src/track/TrackPath.ts");
const { RaceManager } = await import("../src/race/RaceManager.ts");
const { loadRapier, PhysicsWorld } = await import("../src/physics/PhysicsWorld.ts");
const { Vehicle } = await import("../src/vehicle/Vehicle.ts");
const path = new TrackPath();
const checks = [];
function check(name, run) { run(); checks.push(name); console.log("PASS " + name); }

check("track frame and continuous projection across the start line", () => {
  assert.ok(path.frameAtDistance(0).point.distanceTo(path.frameAtDistance(path.totalLength).point) < 1e-6);
  for (const u of [-0.15, 0.15, 93.27, path.totalLength - 0.05]) {
    const frame = path.frameAtDistance(u);
    const projection = path.projectPoint(frame.point.clone().addScaledVector(frame.right, 2));
    let diff = Math.abs(projection.u - frame.u); diff = Math.min(diff, path.totalLength - diff);
    assert.ok(diff < 0.15, "projection must not quantize to a sample");
    assert.ok(frame.right.dot(new THREE.Vector3(0,1,0).cross(frame.tangent)) > 0.999);
  }
});
function fakeVehicle(u) {
  let position = path.frameAtDistance(u).point;
  return { position: () => position.clone(), setU: u => { position = path.frameAtDistance(u).point; },
    resetTo: p => { position = p.clone(); } };
}
check("grid ranking uses actual starting position", () => {
  const race = new RaceManager(path, 3);
  const back = race.addRacer("back", "Back", true, fakeVehicle(-60), "#fff");
  const front = race.addRacer("front", "Front", false, fakeVehicle(-12), "#fff");
  race.update(0);
  assert.equal(front.rank, 1); assert.equal(back.rank, 2);
});
check("laps cross the shared finish line, reverse crossings do not add laps, finish freezes time", () => {
  const race = new RaceManager(path, 3), vehicle = fakeVehicle(-12);
  const racer = race.addRacer("p", "P", true, vehicle, "#fff");
  for (let u = -10; u < path.totalLength - 2; u += 5) { vehicle.setU(u); race.update(100); }
  assert.equal(racer.highestLapFloor, 0);
  vehicle.setU(path.totalLength + 1); race.update(100);
  assert.equal(racer.highestLapFloor, 1);
  vehicle.setU(path.totalLength - 2); race.update(100);
  vehicle.setU(path.totalLength + 2); race.update(100);
  assert.equal(racer.highestLapFloor, 1);
  for (let u = path.totalLength + 7; u < path.totalLength * 3 + 6; u += 5) { vehicle.setU(u); race.update(100); }
  assert.equal(racer.finished, true); assert.equal(racer.lapTimesMs.length, 3);
  const frozen = race.currentLapMs(racer); race.update(5000);
  assert.equal(race.currentLapMs(racer), frozen);
});
check("off-track teleport does not award race progress", () => {
  const race = new RaceManager(path, 3), vehicle = fakeVehicle(-12);
  const racer = race.addRacer("p", "P", true, vehicle, "#fff");
  vehicle.setU(300); race.update(16);
  assert.ok(Math.abs(racer.distanceTraveled + 12) < 0.1);
});
check("same-frame finish uses crossing time instead of registration order", () => {
  const race = new RaceManager(path, 1);
  const late = race.addRacer("late", "Late", false, fakeVehicle(-2), "#fff");
  const early = race.addRacer("early", "Early", false, fakeVehicle(-1), "#fff");
  late.distanceTraveled = path.totalLength - 2; early.distanceTraveled = path.totalLength - 1;
  late.vehicle.setU(1); early.vehicle.setU(2); race.update(100);
  assert.equal(early.finishOrder, 1); assert.equal(late.finishOrder, 2);
});

const rapier = await loadRapier();
const physics = new PhysicsWorld(rapier);
physics.world.createCollider(rapier.ColliderDesc.cuboid(1000, 0.5, 1000).setTranslation(0, -0.5, 0));
const car = new Vehicle(rapier, physics.world, new THREE.Scene(), new THREE.Vector3(0, 1.15, 0), 0, "#145acb");
const idle = { throttle: 0, brake: 0, steer: 0, handbrake: false, resetRequested: false, cameraToggleRequested: false };
function simulate(seconds, input = idle) {
  for (let i = 0; i < seconds * 120; i++) physics.step(1/120, dt => car.physicsStep(dt, input));
}
simulate(1);
check("suspension settles above ground with wheel contact", () => {
  assert.ok(car.position().y > 0.6 && car.position().y < 1.4);
  assert.ok(car.controller.wheelIsInContact(0));
});
simulate(3, { ...idle, throttle: 1 });
check("throttle accelerates forward", () => { assert.ok(car.telemetry.forwardSpeedMs > 10); });
simulate(1, { ...idle, throttle: 1, steer: 0.45 });
check("right steering turns toward the car's right (negative X)", () => { assert.ok(car.forwardVector().x < -0.05); });
car.resetTo(new THREE.Vector3(0,0,0), 0); simulate(1);
simulate(3, { ...idle, brake: 1 });
check("reverse continues beyond the former 0.6 m/s cutoff", () => {
  assert.ok(car.telemetry.forwardSpeedMs < -2, "reverse speed: " + car.telemetry.forwardSpeedMs);
});
simulate(2, { ...idle, throttle: 1 });
check("throttle brakes reverse before moving forward", () => { assert.ok(car.telemetry.forwardSpeedMs > 0); });
car.body.addTorque({ x: 0, y: 1000, z: 0 }, true);
car.resetTo(new THREE.Vector3(0,0,0), 0); simulate(1);
check("reset clears accumulated torque, velocity and steering", () => {
  assert.ok(Math.abs(car.body.angvel().y) < 0.01);
  assert.ok(Math.abs(car.controller.wheelSteering(0)) < 0.001);
});
check("physics cannot accumulate an unbounded catch-up backlog", () => {
  assert.ok(physics.step(5, () => {}) <= 8 / 120 + 1e-8);
  assert.equal(physics.step(0, () => {}), 0);
});
physics.world.free();

const { AIController, randomAIPersonality } = await import("../src/ai/AIController.ts");
const { buildGroundCollider } = await import("../src/track/TrackColliders.ts");
const circuitPhysics = new PhysicsWorld(rapier);
buildGroundCollider(rapier, circuitPhysics.world, path);
const spawn = path.frameAtDistance(-12);
spawn.point.y = 1.15;
const aiCar = new Vehicle(rapier, circuitPhysics.world, new THREE.Scene(), spawn.point,
  Math.atan2(spawn.tangent.x, spawn.tangent.z), "#b0d52c");
const race = new RaceManager(path, 3);
const aiRacer = race.addRacer("ai", "AI", false, aiCar, "#b0d52c");
let recoveries = 0;
const ai = new AIController(path, aiRacer, randomAIPersonality(1), aiRacer, r => { recoveries++; race.resetRacerToTrack(r); });
for (let i = 0; i < 120 * 60 && aiRacer.highestLapFloor < 1; i++) {
  const input = ai.sample(1 / 60);
  circuitPhysics.step(1 / 60, dt => aiCar.physicsStep(dt, input));
  race.update(1000 / 60);
}
console.log(JSON.stringify({ aiLaps: aiRacer.highestLapFloor, recoveries, progress: aiRacer.distanceTraveled, position: aiCar.position(), speed: aiCar.telemetry.speedKmh }));
check("AI completes a circuit with track barriers", () => { assert.ok(aiRacer.highestLapFloor >= 1); assert.ok(recoveries < 5); });
const barrierFrame = path.frameAtDistance(40);
aiCar.resetTo(barrierFrame.point.clone().addScaledVector(barrierFrame.right, 10), Math.PI / 2);
for (let i = 0; i < 240; i++) circuitPhysics.step(1 / 120, dt => aiCar.physicsStep(dt, { ...idle, throttle: 1 }));
check("trackside barrier stops a car instead of allowing passage", () => { assert.ok(path.projectPoint(aiCar.position()).distance < 13.6); });
circuitPhysics.world.free();

console.log("Completed " + checks.length + " regression checks.");
