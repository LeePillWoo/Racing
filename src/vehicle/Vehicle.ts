import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { DEFAULT_VEHICLE_CONFIG, VehicleConfig, tireLateralGripCurve } from "./VehicleConfig";
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

export interface VehicleTelemetry {
  speedKmh: number;
  forwardSpeedMs: number;
  isDrifting: boolean;
  maxSlipDeg: number;
  gear: "R" | "N" | "D";
}

export class Vehicle {
  readonly config: VehicleConfig;
  readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  readonly meshes: CarMeshSet;

  private readonly rapier: typeof RAPIER;
  private readonly chassisColliderHandle: number;
  private readonly wheelLocal: WheelLocal[];
  private currentSteerAngle = 0;
  private lastTelemetry: VehicleTelemetry = { speedKmh: 0, forwardSpeedMs: 0, isDrifting: false, maxSlipDeg: 0, gear: "N" };

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
    this.config = config;

    const bodyDesc = rapier.RigidBodyDesc.dynamic()
      .setTranslation(spawnPosition.x, spawnPosition.y, spawnPosition.z)
      .setRotation({ x: 0, y: Math.sin(spawnYawRad / 2), z: 0, w: Math.cos(spawnYawRad / 2) })
      .setLinearDamping(0.15)
      .setAngularDamping(1.2)
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
      .setFriction(0.4)
      .setRestitution(0.05);
    const collider = world.createCollider(colliderDesc, this.body);
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
      this.controller.setWheelFrictionSlip(i, config.wheelFrictionSlip);
      this.controller.setWheelSideFrictionStiffness(i, config.baseSideFrictionStiffness);
    }

    this.meshes = buildCarMesh(config, color);
    scene.add(this.meshes.root);
  }

  private isOwnCollider = (collider: RAPIER.Collider): boolean => collider.handle !== this.chassisColliderHandle;

  private queryFilterPredicate = (collider: RAPIER.Collider): boolean => this.isOwnCollider(collider);

  /** One fixed physics substep: apply driver input, update tire grip curve, then step the vehicle controller. */
  physicsStep(dt: number, input: InputState): void {
    const config = this.config;
    // Rapier retains user forces/torques until explicitly cleared.
    this.body.resetForces(false);
    this.body.resetTorques(false);
    const linvel = this.body.linvel();
    const angvel = this.body.angvel();
    const rot = this.body.rotation();
    const quat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
    const linvelVec = new THREE.Vector3(linvel.x, linvel.y, linvel.z);
    const forwardSpeed = linvelVec.dot(forward);
    const speed = linvelVec.length();

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

    // --- throttle / brake / reverse ---
    let engineForce = 0;
    let brakeAll = 0;
    if (input.brake > 0) {
      if (forwardSpeed > 0.5 || input.throttle > 0) {
        brakeAll = config.maxBrakeForce * input.brake;
      } else {
        const reversePower = clamp(1 - Math.abs(forwardSpeed) / 10, 0, 1);
        engineForce = -config.maxEngineForceRear * config.reverseForceFraction * input.brake * reversePower;
      }
    } else if (input.throttle > 0) {
      if (forwardSpeed < -0.5) {
        brakeAll = config.maxBrakeForce * input.throttle;
      } else {
        const powerFactor = Math.max(0, 1 - clamp(forwardSpeed / config.topSpeedMs, 0, 1));
        engineForce = config.maxEngineForceRear * input.throttle * powerFactor;
      }
    } else {
      brakeAll = config.rollingResistance;
    }

    for (const i of REAR_WHEELS) {
      this.controller.setWheelEngineForce(i, engineForce);
    }
    for (const i of FRONT_WHEELS) {
      this.controller.setWheelEngineForce(i, 0);
    }
    for (let i = 0; i < 4; i++) this.controller.setWheelBrake(i, brakeAll);

    if (input.handbrake) {
      for (const i of REAR_WHEELS) this.controller.setWheelBrake(i, config.handbrakeForce);
    }

    // --- per-wheel arcade tire grip curve ---
    const com = this.body.worldCom();
    const comVec = new THREE.Vector3(com.x, com.y, com.z);
    let maxRearSlip = 0;
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
      this.controller.setWheelSideFrictionStiffness(i, config.baseSideFrictionStiffness * gripMultiplier * handbrakeMul);

      if (isRear) maxRearSlip = Math.max(maxRearSlip, Math.abs(slipAngle));
    }

    // --- drift-assist yaw torque (arcade helper to make slides controllable) ---
    const driftThresholdRad = (8 * Math.PI) / 180;
    if (maxRearSlip > driftThresholdRad && speed > config.driftAssistMinSpeed && Math.abs(input.steer) > 0.05) {
      this.body.addTorque({ x: 0, y: -input.steer * config.driftAssistTorque, z: 0 }, true);
    }

    this.controller.updateVehicle(dt, undefined, undefined, this.queryFilterPredicate);
    this.brakeLightsOn = brakeAll > config.rollingResistance + 0.01 || input.handbrake;

    this.lastTelemetry = {
      speedKmh: Math.abs(forwardSpeed) * 3.6,
      forwardSpeedMs: forwardSpeed,
      isDrifting: maxRearSlip > driftThresholdRad && speed > 4,
      maxSlipDeg: (maxRearSlip * 180) / Math.PI,
      gear: forwardSpeed > 0.5 ? "D" : forwardSpeed < -0.5 ? "R" : "N",
    };
  }

  /** Syncs the three.js meshes to the latest physics state. Call once per render frame (after physics steps). */
  syncVisuals(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.meshes.root.position.set(t.x, t.y, t.z);
    this.meshes.root.quaternion.set(r.x, r.y, r.z, r.w);

    for (let i = 0; i < 4; i++) {
      const local = this.wheelLocal[i];
      const susLength = this.controller.wheelSuspensionLength(i) ?? this.config.suspensionRestLength;
      const wheelMesh = this.meshes.wheels[i];
      wheelMesh.position.set(local.x, this.config.connectionPointY - susLength, local.z);

      const steer = this.controller.wheelSteering(i) ?? 0;
      const spin = this.controller.wheelRotation(i) ?? 0;
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

  resetTo(position: THREE.Vector3, yawRad: number): void {
    this.body.setTranslation({ x: position.x, y: position.y + this.config.spawnHeight, z: position.z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yawRad / 2), z: 0, w: Math.cos(yawRad / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.currentSteerAngle = 0;
    this.brakeLightsOn = false;
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelSteering(i, 0);
      this.controller.setWheelEngineForce(i, 0);
      this.controller.setWheelBrake(i, 0);
    }
    this.lastTelemetry = { speedKmh: 0, forwardSpeedMs: 0, isDrifting: false, maxSlipDeg: 0, gear: "N" };
  }
}
