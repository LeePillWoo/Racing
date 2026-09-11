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
const { engineTorqueNm, Drivetrain, DEFAULT_DRIVETRAIN } = await import("../src/vehicle/Drivetrain.ts");
const TOP_GEAR = DEFAULT_DRIVETRAIN.forwardRatios.length;
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
const gearAfter3s = car.telemetry.gear;
simulate(12, { ...idle, throttle: 1 });
console.log(JSON.stringify({ topSpeedMs: car.telemetry.forwardSpeedMs, gear: car.telemetry.gear, rpm: Math.round(car.telemetry.rpm) }));
check("gearbox reaches top gear and drag caps it short of the limiter", () => {
  assert.ok(Number(gearAfter3s) >= 2, "gear after 3s: " + gearAfter3s);
  // Every ratio must be usable: if the car cannot pull top gear against drag it is a dead gear.
  assert.equal(car.telemetry.gear, String(TOP_GEAR), "must reach top gear at full throttle");
  assert.ok(car.telemetry.forwardSpeedMs > 40, "top speed: " + car.telemetry.forwardSpeedMs);
  assert.ok(car.telemetry.rpmFraction < 0.95, "top speed should be set by drag, not by the limiter");
});
car.resetTo(new THREE.Vector3(0, 0, 0), 0); simulate(1);
check("reset returns the gearbox to first", () => { assert.equal(car.telemetry.gear, "1"); });
simulate(3, { ...idle, throttle: 1 });
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

check("torque curve peaks mid-range and the limiter cuts drive at the redline", () => {
  const peak = engineTorqueNm(DEFAULT_DRIVETRAIN.redlineRpm * 0.55, DEFAULT_DRIVETRAIN);
  assert.ok(Math.abs(peak - DEFAULT_DRIVETRAIN.peakTorqueNm) < 1e-6);
  assert.ok(engineTorqueNm(DEFAULT_DRIVETRAIN.idleRpm, DEFAULT_DRIVETRAIN) < peak);
  assert.ok(engineTorqueNm(DEFAULT_DRIVETRAIN.redlineRpm * 0.9, DEFAULT_DRIVETRAIN) < peak);
  assert.equal(engineTorqueNm(DEFAULT_DRIVETRAIN.redlineRpm, DEFAULT_DRIVETRAIN), 0);
});
check("each gear delivers less force than the one below, and shifting cuts torque briefly", () => {
  const forceInGear = [];
  for (let gear = 1; gear <= TOP_GEAR; gear++) {
    const box = new Drivetrain(DEFAULT_DRIVETRAIN, 0.46);
    // Walk the speed up until the box settles in the gear we want to measure.
    let speed = 1, force = 0;
    for (let i = 0; i < 40000 && box.gearIndex < gear; i++) { force = box.update(1 / 120, speed, 1, false); speed += 0.02; }
    for (let i = 0; i < 60; i++) force = box.update(1 / 120, speed, 1, false);
    assert.equal(box.gearIndex, gear, "expected to reach gear " + gear);
    forceInGear.push(force);
  }
  for (let i = 1; i < forceInGear.length; i++) {
    assert.ok(forceInGear[i] < forceInGear[i - 1], "gear " + (i + 1) + " must pull less than gear " + i);
  }
  const shifting = new Drivetrain(DEFAULT_DRIVETRAIN, 0.46);
  shifting.update(1 / 120, 3, 1, false);
  assert.ok(shifting.update(1 / 120, 3, 1, true) === 0 && shifting.isShifting, "clutch must open on a gear change");
});

const { DriftSystem, DEFAULT_DRIFT } = await import("../src/vehicle/DriftSystem.ts");
const deg = d => (d * Math.PI) / 180;
check("a held slide banks a score and pays out boost, a spin forfeits it", () => {
  const drift = new DriftSystem(DEFAULT_DRIFT);
  for (let i = 0; i < 210; i++) drift.update(1 / 60, 0, 30, true, true);
  for (let i = 0; i < 180; i++) drift.update(1 / 60, deg(30), 30, true);
  assert.ok(drift.state.active && drift.state.score > 0);
  assert.ok(drift.state.chain > 1, "a sustained drift must build a chain multiplier");
  for (let i = 0; i < 60; i++) drift.update(1 / 60, deg(1), 30, true);
  assert.ok(!drift.state.active && drift.state.bankedScore > 0, "chain should bank on exit");
  assert.ok(drift.state.boostRemainingSec > 0 && !drift.state.boosting, "banking must store boost until requested");
  drift.update(1 / 60, 0, 30, true, true);
  assert.ok(drift.state.boosting && drift.state.boostMultiplier > 1);

  const spun = new DriftSystem(DEFAULT_DRIFT);
  for (let i = 0; i < 120; i++) spun.update(1 / 60, deg(30), 30, true);
  spun.update(1 / 60, deg(120), 30, true);
  assert.equal(spun.state.bankedScore, 0, "spinning out must forfeit the chain");
  assert.ok(!spun.state.boosting);
});
check("a brief grip recovery does not break the chain", () => {
  const drift = new DriftSystem(DEFAULT_DRIFT);
  for (let i = 0; i < 120; i++) drift.update(1 / 60, deg(30), 30, true);
  const chain = drift.state.chain;
  for (let i = 0; i < 12; i++) drift.update(1 / 60, deg(2), 30, true); // 0.2s, inside the grace window
  assert.ok(drift.state.active, "the chain must survive a dip shorter than breakGraceSec");
  assert.equal(drift.state.chain, chain);
});

// The DriftSystem unit tests above only prove the scorer reacts to slip angles. This one proves
// the car can actually produce them: with unlimited tyre friction it carved impossible arcs and
// the rear never stepped out, so drifting was unreachable no matter what the scorer did.
const driftPhysics = new PhysicsWorld(rapier);
driftPhysics.world.createCollider(rapier.ColliderDesc.cuboid(3000, 0.5, 3000).setTranslation(0, -0.5, 0));
const driftCar = new Vehicle(rapier, driftPhysics.world, new THREE.Scene(), new THREE.Vector3(0, 1.15, 0), 0, "#fff");
const driveFor = (seconds, input, onStep) => {
  const merged = { ...idle, ...input };
  for (let i = 0; i < seconds * 120; i++) {
    driftPhysics.step(1 / 120, dt => driftCar.physicsStep(dt, merged));
    onStep?.(merged);
  }
};
/** Signed body slip: positive means the nose points left of travel, so the rear is out to the right. */
const bodySlipDeg = () => {
  const v = driftCar.linearVelocity();
  if (v.length() < 1) return 0;
  const fwd = driftCar.forwardVector();
  const rightW = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  return (Math.atan2(v.dot(rightW), v.dot(fwd)) * 180) / Math.PI;
};

driveFor(4.5, { throttle: 1 });
let gripSlipPeak = 0, gripDriftFrames = 0;
driveFor(3, { throttle: 0.55, steer: 0.5 }, () => {
  gripSlipPeak = Math.max(gripSlipPeak, driftCar.telemetry.maxSlipDeg);
  if (driftCar.telemetry.isDrifting) gripDriftFrames++;
});
const gripCornerSpeed = driftCar.telemetry.speedKmh;
check("cornering on the limit grips instead of sliding", () => {
  assert.ok(gripDriftFrames === 0, "steady cornering must not register as a drift");
  assert.ok(gripSlipPeak < 6, "rear slip while gripping: " + gripSlipPeak.toFixed(1) + " deg");
  assert.ok(gripCornerSpeed > 80, "a grip corner should hold speed, got " + gripCornerSpeed.toFixed(0) + " km/h");
});

driftCar.resetTo(new THREE.Vector3(0, 0, 0), 0);
driveFor(4.5, { throttle: 1 });
driveFor(0.5, { throttle: 0.5, steer: 0.8, handbrake: true });
let driftFrames = 0, peakSlip = 0;
// Boost is granted the moment the chain banks and then burns down, so watch the peak across the
// whole run rather than whatever happens to be left at the end.
let peakBoost = 0;
const watchBoost = () => { peakBoost = Math.max(peakBoost, driftCar.telemetry.boostRemainingSec); };
// A driver catching the slide: counter-steer in proportion to how far the car has rotated.
driveFor(2.5, { throttle: 0.8 }, merged => {
  merged.steer = Math.max(-1, Math.min(1, bodySlipDeg() / 22));
  peakSlip = Math.max(peakSlip, Math.abs(bodySlipDeg()));
  if (driftCar.telemetry.isDrifting) driftFrames++;
  watchBoost();
});
const midDriftSpeed = driftCar.telemetry.speedKmh;
driveFor(1.5, { throttle: 0.8 }, watchBoost);
const driftTelemetry = driftCar.telemetry;
console.log(JSON.stringify({ peakSlip: +peakSlip.toFixed(1), driftFrames,
  banked: Math.round(driftTelemetry.driftScoreTotal), peakBoost: +peakBoost.toFixed(2),
  midDriftSpeed: Math.round(midDriftSpeed) }));
check("the handbrake produces a scoring slide that can be caught and pays out boost", () => {
  assert.ok(driftFrames > 60, "the car barely drifted: " + driftFrames + " frames");
  assert.ok(peakSlip > 15, "peak slide angle only " + peakSlip.toFixed(1) + " deg");
  assert.ok(driftTelemetry.driftScoreTotal > 0, "a caught drift must bank a score");
  assert.ok(peakBoost > 0.5, "a banked drift should be worth a real push, got " + peakBoost.toFixed(2) + "s");
  // A slide that scrubs the car to a standstill is a spin, not a drift worth chaining.
  assert.ok(midDriftSpeed > 45, "drift scrubbed too much speed: " + midDriftSpeed.toFixed(0) + " km/h");
});
driftPhysics.world.free();

const { RacingLine, DEFAULT_RACING_LINE_OPTIONS } = await import("../src/ai/RacingLine.ts");
const { ROAD_HALF_WIDTH } = await import("../src/track/TrackPath.ts");
const racingLine = new RacingLine(path);
check("the racing line stays on the road and its speed profile brakes for corners", () => {
  let maxOffCenter = 0;
  for (const point of racingLine.getPoints()) {
    maxOffCenter = Math.max(maxOffCenter, path.projectPoint(point).distance);
  }
  assert.ok(maxOffCenter <= DEFAULT_RACING_LINE_OPTIONS.maxOffset + 0.5, "line strays off the road: " + maxOffCenter);
  assert.ok(maxOffCenter < ROAD_HALF_WIDTH);
  assert.ok(maxOffCenter > 2, "a line that never leaves the centerline is not a racing line");

  const speeds = [];
  for (let u = 0; u < path.totalLength; u += 5) speeds.push(racingLine.speedLimitAt(u));
  const slowest = Math.min(...speeds), fastest = Math.max(...speeds);
  assert.ok(slowest < fastest * 0.75, "profile must slow well below top speed somewhere");
  assert.ok(slowest >= DEFAULT_RACING_LINE_OPTIONS.minSpeedMs - 1e-6);

  // The profile must be physically reachable: no step between samples may exceed braking limits.
  const spacing = path.totalLength / DEFAULT_RACING_LINE_OPTIONS.sampleCount;
  for (let u = 0; u < path.totalLength; u += spacing) {
    const here = racingLine.speedLimitAt(u), next = racingLine.speedLimitAt(u + spacing);
    const reachable = Math.sqrt(next * next + 2 * DEFAULT_RACING_LINE_OPTIONS.brakeDecelMs2 * spacing);
    assert.ok(here <= reachable + 0.2, "unbrakeable step at u=" + u);
  }
});

const { SkidMarks } = await import("../src/vfx/SkidMarks.ts");
const { TireSmoke } = await import("../src/vfx/TireSmoke.ts");
check("skid marks lay a trail, break when the wheel grips, and fade away", () => {
  const marks = new SkidMarks(64, 2);
  const liveVertices = () => {
    const c = marks.mesh.geometry.attributes.color.array;
    let n = 0;
    for (let i = 3; i < c.length; i += 4) if (c[i] > 0.01) n++;
    return n;
  };
  assert.equal(liveVertices(), 0);
  for (let i = 0; i < 10; i++) marks.emit(0, i * 0.5, 0, 0.2, 1);
  const laid = liveVertices();
  assert.ok(laid > 0, "a sliding wheel must leave a mark");

  // A gap in emission must break the ribbon rather than bridging it with one long quad.
  marks.update(0.3);
  const beforeJump = marks.mesh.geometry.attributes.position.array.slice();
  marks.emit(0, 400, 400, 0.2, 1);
  assert.deepEqual([...marks.mesh.geometry.attributes.position.array], [...beforeJump],
    "restarting after a break must not draw a quad across the gap");

  // Alpha is recomputed from the laid-down value, so fading must not compound frame to frame.
  const fresh = new SkidMarks(64, 2);
  for (let i = 0; i < 6; i++) fresh.emit(0, i * 0.5, 0, 0.2, 1);
  const alphaAt = () => fresh.mesh.geometry.attributes.color.array[3];
  fresh.update(0.5);
  const halfway = alphaAt();
  assert.ok(halfway > 0.4, "a mark should still be dark a quarter of the way through its life");
  for (let i = 0; i < 40; i++) fresh.update(0.05);
  assert.ok(alphaAt() < halfway, "marks must fade with age");
  for (let i = 0; i < 40; i++) fresh.update(0.05);
  assert.ok(alphaAt() <= 0.01, "marks must eventually clear: " + alphaAt());
});
check("tyre smoke spawns, thins out, and recycles its pool", () => {
  const smoke = new TireSmoke(new THREE.Texture(), 8);
  const alphas = smoke.points.geometry.attributes.alpha.array;
  const live = () => [...alphas].filter(a => a > 0.01).length;
  for (let i = 0; i < 4; i++) smoke.spawn(i, 0.2, 0, 1);
  smoke.update(1 / 60);
  assert.equal(live(), 4);
  const firstAlpha = alphas[0];
  const firstY = smoke.points.geometry.attributes.position.array[1];
  smoke.update(0.4);
  assert.ok(smoke.points.geometry.attributes.position.array[1] > firstY, "puffs should rise");
  assert.ok(alphas[0] < firstAlpha, "puffs should thin out as they age");
  for (let i = 0; i < 60; i++) smoke.update(0.05);
  assert.equal(live(), 0, "expired puffs must free their slots");
  // Overfilling must wrap rather than grow the pool.
  for (let i = 0; i < 20; i++) smoke.spawn(i, 0.2, 0, 1);
  assert.equal(alphas.length, 8);
});

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
const ai = new AIController(path, racingLine, aiRacer, randomAIPersonality(1), race.racers,
  r => { recoveries++; race.resetRacerToTrack(r); });
let lapFrames = 0;
for (let i = 0; i < 120 * 60 && aiRacer.highestLapFloor < 1; i++) {
  const input = ai.sample(1 / 60);
  circuitPhysics.step(1 / 60, dt => aiCar.physicsStep(dt, input));
  race.update(1000 / 60);
  lapFrames++;
}
const lapSeconds = lapFrames / 60;
console.log(JSON.stringify({ aiLaps: aiRacer.highestLapFloor, recoveries, lapSeconds: Number(lapSeconds.toFixed(2)),
  avgSpeedKmh: Number(((path.totalLength / lapSeconds) * 3.6).toFixed(1)), speed: aiCar.telemetry.speedKmh }));
check("AI completes a circuit with track barriers", () => { assert.ok(aiRacer.highestLapFloor >= 1); assert.ok(recoveries < 5); });
check("AI laps at a competitive pace on the racing line", () => {
  assert.ok(recoveries === 0, "a clean lap should need no recovery, got " + recoveries);
  const avgSpeedMs = path.totalLength / lapSeconds;
  assert.ok(avgSpeedMs > 24, "average lap speed too slow: " + avgSpeedMs.toFixed(1) + " m/s");
});
// A full grid, because every AI bug that mattered only showed up in traffic: cars aiming past
// the kerb, and cars wedging together and shuffling round the lap at walking pace.
const { DEFAULT_VEHICLE_CONFIG } = await import("../src/vehicle/VehicleConfig.ts");
const packPhysics = new PhysicsWorld(rapier);
buildGroundCollider(rapier, packPhysics.world, path);
const packScene = new THREE.Scene();
const packRace = new RaceManager(path, 1);
const pack = [];
let packRecoveries = 0;
for (let i = 0; i < 8; i++) {
  const frame = path.frameAtDistance(-12 - Math.floor(i / 2) * 9 - (i % 2) * 2);
  const position = frame.point.clone().addScaledVector(frame.right, (i % 2 === 0 ? -1 : 1) * 3.1);
  position.y = DEFAULT_VEHICLE_CONFIG.spawnHeight;
  const vehicle = new Vehicle(rapier, packPhysics.world, packScene, position,
    Math.atan2(frame.tangent.x, frame.tangent.z), "#fff");
  pack.push({ vehicle, racer: packRace.addRacer("p" + i, "P" + i, false, vehicle, "#fff") });
}
pack.forEach((entry, i) => {
  entry.personality = randomAIPersonality(i + 1);
  entry.driftFrames = 0;
  entry.handbrakeFrames = 0;
  entry.controller = new AIController(path, racingLine, entry.racer, entry.personality,
    packRace.racers, r => { packRecoveries++; packRace.resetRacerToTrack(r); });
});
const held = { ...idle, handbrake: true };
for (let i = 0; i < 100; i++) packPhysics.step(1 / 120, dt => pack.forEach(e => e.vehicle.physicsStep(dt, held)));
let packFrames = 0;
for (; packFrames < 60 * 100 && packRace.racers.some(r => r.highestLapFloor < 1); packFrames++) {
  const inputs = pack.map(e => e.controller.sample(1 / 60));
  packPhysics.step(1 / 60, dt => pack.forEach((e, i) => e.vehicle.physicsStep(dt, inputs[i])));
  packRace.update(1000 / 60);
  pack.forEach((e, i) => {
    if (inputs[i].handbrake) e.handbrakeFrames++;
    if (e.vehicle.telemetry.isDrifting) e.driftFrames++;
  });
}
const packLaps = packRace.racers.map(r => (r.lapTimesMs[0] ?? Infinity) / 1000);
console.log(JSON.stringify({ packFinished: packLaps.filter(Number.isFinite).length, packRecoveries,
  packFastest: Math.min(...packLaps).toFixed(2), packSlowest: Math.max(...packLaps).toFixed(2) }));
check("a full grid races a lap without wedging into a crawling pile-up", () => {
  assert.equal(packLaps.filter(Number.isFinite).length, pack.length, "every car must complete the lap");
  // Cars that lock together still roll along at a few m/s, so a lap time far off the pace is the
  // symptom to guard against, not a car sitting at zero.
  assert.ok(Math.max(...packLaps) < 75, "slowest lap in traffic: " + Math.max(...packLaps).toFixed(1) + "s");
  assert.ok(packRecoveries <= 8, "too many recoveries needed: " + packRecoveries);
});

// The field used to run identical lines at identical speeds. Guard the thing that fixed it:
// distinct styles that actually reach the controls, not just distinct numbers in a struct.
const styles = pack.map(e => e.personality.archetype);
const slidersOnGrid = pack.filter(e => e.handbrakeFrames > 0);
console.log(JSON.stringify({ styles: [...new Set(styles)].sort(),
  handbrakeUsers: slidersOnGrid.length,
  driftSeconds: pack.map(e => +(e.driftFrames / 60).toFixed(1)) }));
check("the grid fields visibly different driving styles", () => {
  assert.ok(new Set(styles).size >= 4, "only " + new Set(styles).size + " styles across " + pack.length + " cars");
  assert.ok(slidersOnGrid.length >= 1, "no driver ever reached for the handbrake");
  assert.ok(slidersOnGrid.length < pack.length, "every driver drifting is as uniform as none doing it");
  assert.ok(slidersOnGrid.every(e => e.driftFrames > 0), "a handbrake stab should actually break traction");
});
packPhysics.world.free();

const barrierFrame = path.frameAtDistance(40);
aiCar.resetTo(barrierFrame.point.clone().addScaledVector(barrierFrame.right, 10), Math.PI / 2);
for (let i = 0; i < 240; i++) circuitPhysics.step(1 / 120, dt => aiCar.physicsStep(dt, { ...idle, throttle: 1 }));
check("trackside barrier stops a car instead of allowing passage", () => { assert.ok(path.projectPoint(aiCar.position()).distance < 13.6); });
circuitPhysics.world.free();

// Hitting a barrier should cost a driver time, not end the run: a brush along the wall must
// keep almost all of the speed, and even a square hit has to bounce the car back onto the road.
function crashIntoBarrier(angleDeg) {
  const world = new PhysicsWorld(rapier);
  buildGroundCollider(rapier, world.world, path);
  const frame = path.frameAtDistance(60);
  const spawn = frame.point.clone();
  spawn.y = DEFAULT_VEHICLE_CONFIG.spawnHeight;
  const car = new Vehicle(rapier, world.world, new THREE.Scene(), spawn,
    Math.atan2(frame.tangent.x, frame.tangent.z) + (angleDeg * Math.PI) / 180, "#fff");
  let approach = 0, rebound = 0, hit = false, since = 0, minOffAfter = Infinity;
  for (let i = 0; i < 12 * 120; i++) {
    // Release the throttle on contact, so this measures the bounce and not the engine pushing
    // the car back into the wall.
    world.step(1 / 120, dt => car.physicsStep(dt, hit ? idle : { ...idle, throttle: 1 }));
    const speed = car.linearVelocity().length();
    const off = path.projectPoint(car.position()).distance;
    if (!hit) {
      if (off > 8.4) { hit = true; approach = speed; }
    } else if (++since > 30) {
      rebound = Math.max(rebound, speed);
      minOffAfter = Math.min(minOffAfter, off);
      if (since > 2.5 * 120) break;
    }
  }
  world.world.free();
  return { approach, rebound, minOffAfter, kept: rebound / Math.max(approach, 0.01) };
}
const graze = crashIntoBarrier(15);
const square = crashIntoBarrier(90);
console.log(JSON.stringify({
  graze: { approach: +graze.approach.toFixed(1), kept: +graze.kept.toFixed(2) },
  square: { approach: +square.approach.toFixed(1), kept: +square.kept.toFixed(2), minOffAfter: +square.minOffAfter.toFixed(1) },
}));
check("barrier contact deflects the car instead of stopping the run", () => {
  assert.ok(graze.kept > 0.85, "a glancing hit scrubbed too much speed, kept " + (graze.kept * 100).toFixed(0) + "%");
  assert.ok(square.kept > 0.5, "a square hit should throw most of the speed back, kept " + (square.kept * 100).toFixed(0) + "%");
  // The point of the rebound is that a head-on mistake puts you back on the track, not parked
  // against the barrier with the throttle doing nothing.
  assert.ok(square.minOffAfter < 4, "a square hit must carry the car back across the road, got " + square.minOffAfter.toFixed(1) + "m");
});


check("manual boost accelerates, depletes, recharges and respects braking", () => {
  const measure = boost => {
    const physics = new PhysicsWorld(rapier);
    physics.world.createCollider(rapier.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
    const car = new Vehicle(rapier, physics.world, new THREE.Scene(), new THREE.Vector3(0, 1.15, 0), 0, "#fff");
    for (let i = 0; i < 100; i++) physics.step(1 / 120, dt => car.physicsStep(dt, idle));
    for (let i = 0; i < 240; i++) physics.step(1 / 120, dt => car.physicsStep(dt, { ...idle, throttle: 1, boost }));
    const speed = car.telemetry.forwardSpeedMs;
    physics.step(1 / 60, dt => car.physicsStep(dt, { ...idle, brake: 1, boost: true }));
    assert.equal(car.telemetry.boosting, false);
    physics.world.free();
    return speed;
  };
  const normal = measure(false), boosted = measure(true);
  assert.ok(boosted > normal * 1.25, "boost should provide a clear acceleration advantage: " + boosted + " vs " + normal);
  const tank = new DriftSystem();
  for (let i = 0; i < 240; i++) tank.update(1 / 60, 0, 20, true, true);
  assert.equal(tank.state.boostRemainingSec, 0);
  assert.equal(tank.state.boosting, false);
  for (let i = 0; i < 180; i++) tank.update(1 / 60, 0, 20, true, false);
  assert.ok(tank.state.boostRemainingSec > 0.5);
  assert.equal(tank.state.boosting, false);
});
check("head-on cars rebound and can drive again", () => {
  const physics = new PhysicsWorld(rapier);
  physics.world.createCollider(rapier.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
  const cars = [0, 1].map(i => new Vehicle(rapier, physics.world, new THREE.Scene(), new THREE.Vector3(0, 1.15, i * 20), i * Math.PI, "#fff"));
  for (let i = 0; i < 100; i++) physics.step(1 / 120, dt => cars.forEach(c => c.physicsStep(dt, idle)));
  cars[0].body.setLinvel({ x: 0, y: 0, z: 18 }, true);
  cars[1].body.setLinvel({ x: 0, y: 0, z: -18 }, true);
  let bounced = false;
  for (let i = 0; i < 120; i++) {
    physics.step(1 / 120, dt => cars.forEach(c => c.physicsStep(dt, idle)));
    if (cars[0].linearVelocity().z < -2 && cars[1].linearVelocity().z > 2) bounced = true;
  }
  assert.ok(bounced, "both cars must separate after the impact");
  for (let i = 0; i < 120; i++) physics.step(1 / 120, dt => cars[0].physicsStep(dt, { ...idle, throttle: 1, steer: 1 }));
  assert.ok(cars[0].linearVelocity().length() > 2);
  physics.world.free();
});

check("handbrake locks rear wheel visuals and rapidly slows even against throttle", () => {
  const physics = new PhysicsWorld(rapier);
  physics.world.createCollider(rapier.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
  const car = new Vehicle(rapier, physics.world, new THREE.Scene(), new THREE.Vector3(0, 1.15, 0), 0, "#fff");
  const step = (count, input) => { for (let i = 0; i < count; i++) physics.step(1 / 120, dt => car.physicsStep(dt, { ...idle, ...input })); car.syncVisuals(); };
  step(100, {}); step(480, { throttle: 1 });
  const before = car.linearVelocity().length();
  const rear = car.meshes.wheels[2].quaternion.clone();
  const front = car.meshes.wheels[0].quaternion.clone();
  step(120, { throttle: 1, handbrake: true, boost: true });
  const after = car.linearVelocity().length();
  assert.ok(before - after > 10, "handbrake must shed over 36 km/h in one second: " + before + " -> " + after);
  assert.ok(rear.angleTo(car.meshes.wheels[2].quaternion) < 1e-6, "rear wheels must stay locked");
  assert.ok(front.angleTo(car.meshes.wheels[0].quaternion) > 0.01, "front wheels must keep rolling");
  assert.equal(car.telemetry.boosting, false);
  assert.ok(car.wheelContacts[2].grounded && car.wheelContacts[2].slipDeg > 9, "locked tyres must emit marks and smoke even while braking straight");
  step(20, { throttle: 1 });
  assert.ok(rear.angleTo(car.meshes.wheels[2].quaternion) > 0.01, "rear wheels must resume rolling on release");
  step(600, { handbrake: true, throttle: 1 });
  assert.ok(car.linearVelocity().length() < 0.3, "holding the handbrake must stop and hold the car");
  physics.world.free();
});
check("stronger boost lifts the nose while rear tyres remain planted and settles on release", () => {
  const physics = new PhysicsWorld(rapier);
  physics.world.createCollider(rapier.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
  const car = new Vehicle(rapier, physics.world, new THREE.Scene(), new THREE.Vector3(0, 1.15, 0), 0, "#fff");
  const step = (count, boost) => { for (let i = 0; i < count; i++) physics.step(1 / 120, dt => car.physicsStep(dt, { ...idle, boost })); car.syncVisuals(); car.meshes.root.updateMatrixWorld(true); };
  step(100, false); step(120, true);
  assert.ok(car.telemetry.forwardSpeedMs > 20, "boost from rest must reach over 72 km/h within one second");
  const front = car.meshes.wheels[0].getWorldPosition(new THREE.Vector3());
  const rear = car.meshes.wheels[2].getWorldPosition(new THREE.Vector3());
  assert.ok(front.y - rear.y > 0.15 && front.y - rear.y < 0.3, "nose should rise slightly: " + (front.y - rear.y));
  assert.ok(Math.abs(rear.y - car.config.wheelRadius) < 0.08, "rear tyres should stay on the road");
  assert.ok(car.forwardVector().y === 0, "visual tilt must not destabilize physics");
  step(120, false);
  assert.ok(Math.abs(car.meshes.wheels[0].getWorldPosition(new THREE.Vector3()).y - car.meshes.wheels[2].getWorldPosition(new THREE.Vector3()).y) < 0.02);
  physics.world.free();
});
console.log("Completed " + checks.length + " regression checks.");
