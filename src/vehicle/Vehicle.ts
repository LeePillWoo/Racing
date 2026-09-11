import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { DEFAULT_VEHICLE_CONFIG, VehicleConfig, tireLateralGripCurve } from "./VehicleConfig";
import { ExhaustFlame } from "../vfx/ExhaustFlame";
import { Drivetrain } from "./Drivetrain";
import { DriftSystem } from "./DriftSystem";
import { findWallContact } from "./WallBounce";
import { buildCarMesh, CarMeshSet } from "./CarMesh";
import { clamp, damp, lerp, smoothstep } from "../utils/MathUtils";
import type { InputState } from "../core/InputManager";

const WHEEL_FL = 0;
const WHEEL_FR = 1;
const WHEEL_RL = 2;
const WHEEL_RR = 3;
const FRONT_WHEELS = [WHEEL_FL, WHEEL_FR];
const REAR_WHEELS = [WHEEL_RL, WHEEL_RR];

interface WheelLocal {
  x: number;
  z: number;
}

/** Per-wheel contact state, published each step for the skid mark and tyre smoke effects. */
export interface WheelContactState {
  grounded: boolean;
  x: number;
  y: number;
  z: number;
  slipDeg: number;
  isRear: boolean;
}

export interface VehicleTelemetry {
  speedKmh: number;
  forwardSpeedMs: number;
  isDrifting: boolean;
  maxSlipDeg: number;
  /** "R", "N" during a shift, otherwise the gear number. */
  gear: string;
  rpm: number;
  rpmFraction: number;
  /** Score of the drift chain in progress; banked into driftScoreTotal when it ends. */
  driftScore: number;
  driftChain: number;
  driftScoreTotal: number;
  boostRemainingSec: number;
  boosting: boolean;
}

const IDLE_TELEMETRY: VehicleTelemetry = {
  speedKmh: 0, forwardSpeedMs: 0, isDrifting: false, maxSlipDeg: 0, gear: "N",
  rpm: 0, rpmFraction: 0, driftScore: 0, driftChain: 1, driftScoreTotal: 0,
  boostRemainingSec: 0, boosting: false,
};

export class Vehicle {
  readonly config: VehicleConfig;
  private readonly exhaust = new ExhaustFlame();
  readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  readonly meshes: CarMeshSet;

  private readonly rapier: typeof RAPIER;
  private readonly world: RAPIER.World;
  private readonly chassisCollider: RAPIER.Collider;
  private readonly chassisColliderHandle: number;
  private touchingWall = false;
  private wallRecoveryTime = 0;
  private wallNormalX = 0;
  private wallNormalZ = 0;
  /**
   * Chassis velocity as of the previous step, before the solver resolved anything. Contacts are
   * only reported on the step *after* the solver has already cancelled the closing speed, so
   * this is what the rebound has to be sized from.
   */
  private previousVelocityX = 0;
  private previousVelocityZ = 0;
  /** Impact speed of the most recent wall hit, consumed by the camera shake. */
  private pendingImpact = 0;
  private readonly wheelLocal: WheelLocal[];
  private readonly drivetrain: Drivetrain;
  private readonly drift: DriftSystem;
  /** Reused rather than reallocated: this is written every wheel, every substep. */
  private readonly wheelContactStates: WheelContactState[] = [0, 1, 2, 3].map(i => ({
    grounded: false, x: 0, y: 0, z: 0, slipDeg: 0, isRear: i === WHEEL_RL || i === WHEEL_RR,
  }));
  private currentSteerAngle = 0;
  private visualPitch = 0;
  private readonly wheelSpin = [0, 0, 0, 0];
  private readonly previousWheelSpin = [0, 0, 0, 0];
  private lastTelemetry: VehicleTelemetry = { ...IDLE_TELEMETRY };

  constructor(
    rapier: typeof RAPIER,
    world: RAPIER.World,
    scene: THREE.Scene,
    spawnPosition: THREE.Vector3,
    spawnYawRad: number,
    color: THREE.ColorRepresentation,
    config: VehicleConfig = DEFAULT_VEHICLE_CONFIG
  ) {
    this.rapier = rapier;
    this.world = world;
    this.config = config;

    const bodyDesc = rapier.RigidBodyDesc.dynamic()
      .setTranslation(spawnPosition.x, spawnPosition.y, spawnPosition.z)
      .setRotation({ x: 0, y: Math.sin(spawnYawRad / 2), z: 0, w: Math.cos(spawnYawRad / 2) })
      .setLinearDamping(config.linearDamping)
      .setAngularDamping(config.angularDamping)
      .setCanSleep(false)
      .setCcdEnabled(true)
      // Only yaw (world Y) is allowed to rotate freely — pitch/roll are physically locked out.
      // The track is flat, so real cars would only ever pitch/roll from an unwanted rollover
      // anyway; constraining it outright (a standard arcade-kart-racer trick) keeps the car always
      // drivable instead of chasing rollover tuning through counter-torques.
      .restrictRotations(false, true, false);
    this.body = world.createRigidBody(bodyDesc);

    const colliderDesc = rapier.ColliderDesc.cuboid(config.chassisHalfExtents.x, config.chassisHalfExtents.y, config.chassisHalfExtents.z)
      .setTranslation(0, config.chassisCenterOfMassOffsetY, 0)
      .setMass(config.chassisMass)
      .setFriction(config.chassisFriction)
      .setFrictionCombineRule(rapier.CoefficientCombineRule.Min)
      .setRestitution(config.chassisRestitution);
    const collider = world.createCollider(colliderDesc, this.body);
    this.chassisCollider = collider;
    this.chassisColliderHandle = collider.handle;

    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    // NOTE: rapier3d-compat's indexForwardAxis setter accessor is misnamed "setIndexForwardAxis"
    // in the current typings/build, so the natural `controller.indexForwardAxis = 2` throws
    // (getter-only property). The WASM default is already up=1/forward=2, matching our Z-forward
    // convention below, so we simply leave it untouched instead of poking the buggy accessor.

    this.wheelLocal = [
      { x: -config.trackHalfWidth, z: config.wheelBaseFront },
      { x: config.trackHalfWidth, z: config.wheelBaseFront },
      { x: -config.trackHalfWidth, z: config.wheelBaseRear },
      { x: config.trackHalfWidth, z: config.wheelBaseRear },
    ];

    for (const w of this.wheelLocal) {
      this.controller.addWheel(
        { x: w.x, y: config.connectionPointY, z: w.z },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        config.suspensionRestLength,
        config.wheelRadius
      );
    }

    for (let i = 0; i < 4; i++) {
      this.controller.setWheelSuspensionStiffness(i, config.suspensionStiffness);
      this.controller.setWheelSuspensionCompression(i, config.suspensionCompression);
      this.controller.setWheelSuspensionRelaxation(i, config.suspensionRelaxation);
      this.controller.setWheelMaxSuspensionTravel(i, config.maxSuspensionTravel);
      this.controller.setWheelMaxSuspensionForce(i, config.maxSuspensionForce);
      this.controller.setWheelFrictionSlip(i, config.tireFrictionFront);
      this.controller.setWheelSideFrictionStiffness(i, config.baseSideFrictionStiffness);
    }

    this.drivetrain = new Drivetrain(config.drivetrain, config.wheelRadius);
    this.drift = new DriftSystem(config.drift);

    this.meshes = buildCarMesh(config, color);
    this.meshes.root.add(this.exhaust.root);
    scene.add(this.meshes.root);
  }

  /**
   * Arcade wall response. The solver alone leaves a car pinned against a barrier — it kills the
   * closing speed and then friction and the driver's own throttle hold it there. Instead the
   * rebound is applied explicitly on the frame contact begins, with a floor under it so even a
   * slow nudge frees the car, plus a steady outward push and a yaw kick for the knock.
   */
  private applyWallResponse(): void {
    const config = this.config;
    const contact = findWallContact(this.world, this.chassisCollider, this.body);
    if (!contact) {
      this.touchingWall = false;
      return;
    }
    const { normalX, normalZ } = contact;
    // On the first frame of contact the solver has already eaten the closing speed, so size the
    // rebound from the velocity the car carried in. After that, use the live velocity.
    const approachSpeed = this.touchingWall
      ? contact.approachSpeed
      : -(this.previousVelocityX * normalX + this.previousVelocityZ * normalZ);

    if (!this.touchingWall && approachSpeed > config.wallBounceMinSpeed) {
      const rebound = clamp(approachSpeed * config.wallBounceRestitution, config.wallBounceMinRebound, config.wallBounceMaxRebound);
      // Match the capped outward speed, including any bounce already supplied by the solver.
      const velocity = this.body.linvel();
      const outwardSpeed = velocity.x * normalX + velocity.z * normalZ;
      const impulse = this.body.mass() * (rebound - outwardSpeed);
      this.body.applyImpulse({ x: normalX * impulse, y: 0, z: normalZ * impulse }, true);

      const kick = clamp(approachSpeed * config.wallImpactYawKick, 0, config.maxWallImpactYawKick);
      // Scale the kick by how glancing the hit is. A square hit should rebound straight back onto
      // the track; it is the angled hits, where one corner lands first, that should slew the car.
      const forward = this.forwardVector();
      const noseInto = clamp(-(forward.x * normalX + forward.z * normalZ), -1, 1);
      const glancing = Math.sqrt(Math.max(0, 1 - noseInto * noseInto));
      const side = Math.sign(forward.x * normalZ - forward.z * normalX) || 1;
      this.body.applyTorqueImpulse({ x: 0, y: side * kick * glancing, z: 0 }, true);
      this.pendingImpact = Math.max(this.pendingImpact, approachSpeed);
    }

    this.wallRecoveryTime = 0.7;
    this.wallNormalX = normalX;
    this.wallNormalZ = normalZ;
    this.touchingWall = true;
    this.body.addForce({ x: normalX * config.wallSeparationForce, y: 0, z: normalZ * config.wallSeparationForce }, true);
  }

  /** Impact speed of the last wall hit, in m/s; reading it clears the value. */
  consumeImpact(): number {
    const impact = this.pendingImpact;
    this.pendingImpact = 0;
    return impact;
  }

  private isOwnCollider = (collider: RAPIER.Collider): boolean => collider.handle !== this.chassisColliderHandle;

  private queryFilterPredicate = (collider: RAPIER.Collider): boolean => this.isOwnCollider(collider);

  /** One fixed physics substep: apply driver input, update tire grip curve, then step the vehicle controller. */
  physicsStep(dt: number, input: InputState): void {
    const config = this.config;
    // Rapier retains user forces/torques until explicitly cleared.
    this.body.resetForces(false);
    this.body.resetTorques(false);
    this.wallRecoveryTime = Math.max(0, this.wallRecoveryTime - dt);
    this.applyWallResponse();
    if (this.wallRecoveryTime > 0) {
      const angularVelocity = this.body.angvel();
      this.body.setAngvel({ x: angularVelocity.x, y: clamp(angularVelocity.y, -1.3, 1.3), z: angularVelocity.z }, true);
    }
    const linvel = this.body.linvel();
    const angvel = this.body.angvel();
    const rot = this.body.rotation();
    const quat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
    const linvelVec = new THREE.Vector3(linvel.x, linvel.y, linvel.z);
    const forwardSpeed = linvelVec.dot(forward);
    const speed = linvelVec.length();
    const noseIntoWall = -(forward.x * this.wallNormalX + forward.z * this.wallNormalZ);
    const wallDriveScale = this.wallRecoveryTime > 0 ? 1 - smoothstep(0.1, 0.7, noseIntoWall) : 1;

    // --- steering ---
    const steerLimit = lerp(
      config.maxSteerLowSpeed,
      config.maxSteerHighSpeed,
      smoothstep(0, config.steerHighSpeedThreshold, Math.abs(forwardSpeed))
    );
    // input.steer is +1 for right, but a positive yaw rotation about +Y turns the +Z forward
    // axis toward +X, which is the car's left — so the driver-facing sign is inverted here.
    const targetSteer = -input.steer * steerLimit;
    this.currentSteerAngle = damp(this.currentSteerAngle, targetSteer, config.steerResponse, dt);
    for (const i of FRONT_WHEELS) this.controller.setWheelSteering(i, this.currentSteerAngle);
    for (const i of REAR_WHEELS) this.controller.setWheelSteering(i, 0);

    // --- per-wheel arcade tire grip curve ---
    const com = this.body.worldCom();
    const comVec = new THREE.Vector3(com.x, com.y, com.z);
    let maxRearSlip = 0;
    let grounded = false;
    for (let i = 0; i < 4; i++) {
      const isFront = i === WHEEL_FL || i === WHEEL_FR;
      const steer = isFront ? this.currentSteerAngle : 0;
      const wheelForward = forward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), steer);
      const wheelRight = right.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), steer);

      const local = this.wheelLocal[i];
      const hardPoint = new THREE.Vector3(local.x, config.connectionPointY, local.z).applyQuaternion(quat).add(
        new THREE.Vector3(this.body.translation().x, this.body.translation().y, this.body.translation().z)
      );
      const r = hardPoint.clone().sub(comVec);
      const angvelVec = new THREE.Vector3(angvel.x, angvel.y, angvel.z);
      const velAtPoint = linvelVec.clone().add(angvelVec.clone().cross(r));

      const wheelForwardSpeed = velAtPoint.dot(wheelForward);
      const wheelSideSpeed = velAtPoint.dot(wheelRight);
      const slipAngle = Math.atan2(wheelSideSpeed, Math.abs(wheelForwardSpeed) + 1.5);
      const gripMultiplier = tireLateralGripCurve(slipAngle);

      const isRear = i === WHEEL_RL || i === WHEEL_RR;
      const handbrakeMul = isRear && input.handbrake ? config.handbrakeRearFrictionMultiplier : 1;
      const axleFriction = isRear ? config.tireFrictionRear : config.tireFrictionFront;
      // Friction coefficient, not constraint stiffness: this caps how much lateral force the
      // tyre can make, so exceeding it lets the wheel slide progressively instead of the
      // all-or-nothing behaviour the stiffness parameter gives.
      this.controller.setWheelFrictionSlip(i, axleFriction * gripMultiplier * handbrakeMul);

      if (isRear) maxRearSlip = Math.max(maxRearSlip, Math.abs(slipAngle));

      const wheelGrounded = this.controller.wheelIsInContact(i);
      if (wheelGrounded) grounded = true;
      const state = this.wheelContactStates[i];
      state.grounded = wheelGrounded;
      state.slipDeg = Math.max(Math.abs(slipAngle) * (180 / Math.PI), isRear && input.handbrake && speed > 1 ? 32 * smoothstep(1, 8, speed) : 0);
      const contactPoint = wheelGrounded ? this.controller.wheelContactPoint(i) : null;
      if (contactPoint) {
        state.x = contactPoint.x;
        state.y = contactPoint.y;
        state.z = contactPoint.z;
      } else {
        state.grounded = false;
      }
    }

    // --- drift scoring, which feeds the boost multiplier the engine reads below ---
    this.drift.update(dt, maxRearSlip, speed, grounded, input.boost && !input.handbrake && input.brake === 0 && forwardSpeed > -0.5 && wallDriveScale > 0.9);
    const driftState = this.drift.state;

    // --- throttle / brake / reverse ---
    let brakeAll = 0;
    let throttleCmd = 0;
    let reverseCmd = false;
    if (input.brake > 0) {
      if (forwardSpeed > 0.5 || input.throttle > 0) {
        brakeAll = config.maxBrakeForce * input.brake;
      } else {
        reverseCmd = true;
        throttleCmd = input.brake;
      }
    } else if (input.throttle > 0 || driftState.boosting) {
      if (forwardSpeed < -0.5) brakeAll = config.maxBrakeForce * input.throttle * wallDriveScale;
      else throttleCmd = driftState.boosting ? 1 : input.throttle;
    } else {
      brakeAll = config.rollingResistance;
    }

    if (input.handbrake) throttleCmd = 0;
    if (!reverseCmd) throttleCmd *= wallDriveScale;
    const engineForce = this.drivetrain.update(dt, forwardSpeed, throttleCmd, reverseCmd, driftState.boostMultiplier);
    // Rapier applies the value per wheel, so split the axle's total between the driven pair.
    const perWheelForce = engineForce / REAR_WHEELS.length;
    for (const i of REAR_WHEELS) this.controller.setWheelEngineForce(i, perWheelForce);
    for (const i of FRONT_WHEELS) this.controller.setWheelEngineForce(i, 0);
    for (let i = 0; i < 4; i++) this.controller.setWheelBrake(i, brakeAll);

    if (input.handbrake) {
      for (const i of REAR_WHEELS) this.controller.setWheelBrake(i, config.handbrakeForce);
    }

    if (driftState.boosting) {
      const thrust = config.chassisMass * config.boostAcceleration;
      this.body.addForce({ x: forward.x * thrust, y: 0, z: forward.z * thrust }, true);
    }
    // --- aerodynamic drag: what actually sets top speed now that gearing sets the drive force ---
    if (speed > 0.1) {
      const dragMagnitude = config.aeroDragCoefficient * speed * speed;
      this.body.addForce(
        { x: (-linvelVec.x / speed) * dragMagnitude, y: 0, z: (-linvelVec.z / speed) * dragMagnitude },
        true
      );
    }

    // --- drift handling aids ---
    // How far into a slide the car is; every aid below fades in with it so grip driving is untouched.
    const rearSlipDeg = (maxRearSlip * 180) / Math.PI;
    const driftBlend = smoothstep(config.drift.exitSlipDeg * 0.6, config.drift.entrySlipDeg * 1.5, rearSlipDeg);
    const speedGate = smoothstep(config.driftAssistMinSpeed * 0.5, config.driftAssistMinSpeed, speed);
    const wheelBase = config.wheelBaseFront - config.wheelBaseRear;
    let assistTorque = 0;

    if (driftBlend > 0 && speedGate > 0) {
      // Bicycle-model yaw rate the steering angle is asking for, versus what the car is doing.
      // Driving the error to zero lets the driver hold an angle instead of fighting the slide,
      // and it self-corrects on counter-steer because the requested rate flips sign with it.
      //
      // The request is capped at the rotation the tyres can actually hold at this speed
      // (a = v * yawRate must stay within mu * g). Without that cap the geometric request runs
      // far past the grip limit at speed and the assist torques the car into a spin.
      const gripYawRate = (config.tireFrictionRear * 9.81 * config.yawAssistGripMargin) / Math.max(6, speed);
      const yawLimit = Math.min(config.maxAssistYawRate, gripYawRate);
      const desiredYawRate = clamp((forwardSpeed / wheelBase) * Math.tan(this.currentSteerAngle), -yawLimit, yawLimit);
      const yawError = desiredYawRate - angvel.y;
      assistTorque =
        clamp(yawError * config.yawAssistGain, -config.maxYawAssistTorque, config.maxYawAssistTorque) *
        driftBlend *
        speedGate;

      // Sliding sideways otherwise scrubs off all the entry speed; feed a little of it back along
      // the heading so a held drift stays quick enough to be worth taking.
      if (forwardSpeed > 1 && !input.handbrake && this.wallRecoveryTime === 0) {
        const scrub = Math.abs(linvelVec.dot(right));
        const thrust = Math.min(scrub * config.driftThrustPerScrub, config.maxDriftThrust) * driftBlend;
        this.body.addForce({ x: forward.x * thrust, y: 0, z: forward.z * thrust }, true);
      }
    }

    // Spin protection stays active even outside a drift, so a hit or a bad kerb cannot pirouette.
    const spinExcess = Math.abs(angvel.y) - config.spinYawRateLimit;
    if (spinExcess > 0) assistTorque -= Math.sign(angvel.y) * spinExcess * config.spinDampGain;
    if (assistTorque !== 0) this.body.addTorque({ x: 0, y: assistTorque, z: 0 }, true);

    // Let the initial knock clear the wall, then settle only the outward component.
    // Tangential travel and a driver deliberately reversing away remain available.
    if (this.wallRecoveryTime > 0 && this.wallRecoveryTime < 0.6 && grounded && !input.handbrake && !reverseCmd && noseIntoWall > 0.1) {
      const outwardSpeed = linvel.x * this.wallNormalX + linvel.z * this.wallNormalZ;
      const excess = Math.max(0, outwardSpeed - 0.5);
      const impulse = this.body.mass() * excess * (1 - Math.exp(-5 * dt));
      this.body.applyImpulse({ x: -this.wallNormalX * impulse, y: 0, z: -this.wallNormalZ * impulse }, true);
    }
    this.previousVelocityX = linvel.x;
    this.previousVelocityZ = linvel.z;

    this.controller.updateVehicle(dt, undefined, undefined, this.queryFilterPredicate);
    // Locked rear tyres scrub speed even when lateral grip is reduced for a slide.
    // Cap the impulse at the current horizontal momentum so braking cannot reverse the car.
    const rearGrounded = REAR_WHEELS.some(i => this.controller.wheelIsInContact(i));
    if (input.handbrake && rearGrounded) {
      const velocity = this.body.linvel();
      const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
      if (horizontalSpeed > 0.001) {
        const impulse = this.body.mass() * Math.min(horizontalSpeed, config.handbrakeDeceleration * dt);
        this.body.applyImpulse({ x: -velocity.x / horizontalSpeed * impulse, y: 0, z: -velocity.z / horizontalSpeed * impulse }, true);
      }
    }
    for (let i = 0; i < 4; i++) {
      const spin = this.controller.wheelRotation(i) ?? 0;
      if (!(input.handbrake && i >= 2)) this.wheelSpin[i] += spin - this.previousWheelSpin[i];
      this.previousWheelSpin[i] = spin;
    }
    // Visual weight transfer pivots around the rear axle; physics stays upright and steerable.
    const targetPitch = driftState.boosting && grounded ? 0.065 * smoothstep(0, 8, Math.max(0, forwardSpeed)) : 0;
    this.visualPitch = damp(this.visualPitch, targetPitch, targetPitch > this.visualPitch ? 10 : 6, dt);
    this.brakeLightsOn = brakeAll > config.rollingResistance + 0.01 || input.handbrake;

    this.exhaust.update(dt, driftState.boosting);
    this.lastTelemetry = {
      speedKmh: Math.abs(forwardSpeed) * 3.6,
      forwardSpeedMs: forwardSpeed,
      isDrifting: driftState.active,
      maxSlipDeg: rearSlipDeg,
      gear: this.drivetrain.gearLabel,
      rpm: this.drivetrain.rpm,
      rpmFraction: this.drivetrain.rpmFraction,
      driftScore: driftState.score,
      driftChain: driftState.chain,
      driftScoreTotal: driftState.bankedScore,
      boostRemainingSec: driftState.boostRemainingSec,
      boosting: driftState.boosting,
    };
  }

  /** Syncs the three.js meshes to the latest physics state. Call once per render frame (after physics steps). */
  syncVisuals(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.meshes.root.position.set(t.x, t.y, t.z);
    this.meshes.root.quaternion.set(r.x, r.y, r.z, r.w);
    const pivot = new THREE.Vector3(0, 0, this.config.wheelBaseRear);
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -this.visualPitch);
    const offset = pivot.clone().sub(pivot.clone().applyQuaternion(tilt)).applyQuaternion(this.meshes.root.quaternion);
    this.meshes.root.position.add(offset);
    this.meshes.root.quaternion.multiply(tilt);

    for (let i = 0; i < 4; i++) {
      const local = this.wheelLocal[i];
      const susLength = this.controller.wheelSuspensionLength(i) ?? this.config.suspensionRestLength;
      const wheelMesh = this.meshes.wheels[i];
      wheelMesh.position.set(local.x, this.config.connectionPointY - susLength, local.z);

      const steer = this.controller.wheelSteering(i) ?? 0;
      const spin = this.wheelSpin[i];
      const qSteer = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), steer);
      const qSpin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), spin);
      wheelMesh.quaternion.copy(qSteer).multiply(qSpin);
    }

    for (const bl of this.meshes.brakeLights) {
      const mat = bl.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = this.brakeLightsOn ? 9 : 0.15;
    }
  }

  private brakeLightsOn = false;

  get telemetry(): VehicleTelemetry {
    return this.lastTelemetry;
  }

  get wheelContacts(): readonly WheelContactState[] {
    return this.wheelContactStates;
  }

  position(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  quaternion(): THREE.Quaternion {
    const r = this.body.rotation();
    return new THREE.Quaternion(r.x, r.y, r.z, r.w);
  }

  forwardVector(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, 1).applyQuaternion(this.quaternion());
  }

  linearVelocity(): THREE.Vector3 {
    const v = this.body.linvel();
    return new THREE.Vector3(v.x, v.y, v.z);
  }

  /** Yaw rate about world +Y in rad/s; positive turns the car left. */
  yawRate(): number {
    return this.body.angvel().y;
  }

  resetTo(position: THREE.Vector3, yawRad: number): void {
    this.body.setTranslation({ x: position.x, y: position.y + this.config.spawnHeight, z: position.z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yawRad / 2), z: 0, w: Math.cos(yawRad / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.currentSteerAngle = 0;
    this.visualPitch = 0;
    this.wheelSpin.fill(0);
    for (let i = 0; i < 4; i++) this.previousWheelSpin[i] = this.controller.wheelRotation(i) ?? 0;
    this.brakeLightsOn = false;
    this.touchingWall = false;
    this.wallRecoveryTime = 0;
    this.wallNormalX = 0;
    this.wallNormalZ = 0;
    this.pendingImpact = 0;
    this.previousVelocityX = 0;
    this.previousVelocityZ = 0;
    this.drivetrain.reset();
    this.drift.reset();
    this.exhaust.update(0, false);
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelSteering(i, 0);
      this.controller.setWheelEngineForce(i, 0);
      this.controller.setWheelBrake(i, 0);
    }
    this.lastTelemetry = { ...IDLE_TELEMETRY, boostRemainingSec: this.drift.state.boostRemainingSec };
  }
}
