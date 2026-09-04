export interface VehicleConfig {
  chassisHalfExtents: { x: number; y: number; z: number };
  chassisMass: number;
  chassisCenterOfMassOffsetY: number;
  spawnHeight: number;

  wheelRadius: number;
  wheelWidth: number;
  trackHalfWidth: number;
  wheelBaseFront: number;
  wheelBaseRear: number;
  /**
   * Wheel hardpoint Y, relative to the body origin. Must sit at or below the chassis collider's
   * bottom face (chassisCenterOfMassOffsetY - chassisHalfExtents.y) so the wheel raycast starts
   * in free space instead of embedded inside the chassis's own collider — otherwise the car rides
   * on its belly and the suspension never sees ground contact.
   */
  connectionPointY: number;

  suspensionRestLength: number;
  maxSuspensionTravel: number;
  suspensionStiffness: number;
  suspensionCompression: number;
  suspensionRelaxation: number;
  maxSuspensionForce: number;

  wheelFrictionSlip: number;
  baseSideFrictionStiffness: number;
  handbrakeRearFrictionMultiplier: number;

  maxEngineForceRear: number;
  maxEngineForceFront: number;
  reverseForceFraction: number;
  topSpeedMs: number;
  maxBrakeForce: number;
  handbrakeForce: number;
  rollingResistance: number;

  maxSteerLowSpeed: number; // radians
  maxSteerHighSpeed: number; // radians
  steerHighSpeedThreshold: number; // m/s
  steerResponse: number; // per-second smoothing rate

  driftAssistTorque: number;
  driftAssistMinSpeed: number;
}

export const DEFAULT_VEHICLE_CONFIG: VehicleConfig = {
  chassisHalfExtents: { x: 0.95, y: 0.38, z: 2.05 },
  chassisMass: 1180,
  chassisCenterOfMassOffsetY: -0.24,
  spawnHeight: 1.5,

  wheelRadius: 0.34,
  wheelWidth: 0.3,
  trackHalfWidth: 0.98,
  wheelBaseFront: 1.55,
  wheelBaseRear: -1.45,
  connectionPointY: -0.64,

  suspensionRestLength: 0.32,
  maxSuspensionTravel: 0.16,
  suspensionStiffness: 28,
  suspensionCompression: 0.6,
  suspensionRelaxation: 0.72,
  maxSuspensionForce: 100000,

  wheelFrictionSlip: 1000,
  baseSideFrictionStiffness: 2.2,
  handbrakeRearFrictionMultiplier: 0.42,

  maxEngineForceRear: 5400,
  maxEngineForceFront: 0,
  reverseForceFraction: 0.55,
  topSpeedMs: 55, // ~198 km/h
  maxBrakeForce: 55,
  handbrakeForce: 90,
  rollingResistance: 0.35,

  maxSteerLowSpeed: 0.58,
  maxSteerHighSpeed: 0.16,
  steerHighSpeedThreshold: 34,
  steerResponse: 7,

  driftAssistTorque: 1100,
  driftAssistMinSpeed: 6,
};

/**
 * Arcade tire lateral grip curve: builds up to a peak just past a small slip angle
 * (confident, sticky cornering), breaks away sharply past that (drift onset), then
 * settles onto a controllable plateau instead of falling to zero (so a drift can be held).
 */
export function tireLateralGripCurve(slipAngleRad: number): number {
  const deg = Math.abs(slipAngleRad) * (180 / Math.PI);
  if (deg < 5) {
    return 0.75 + (deg / 5) * 0.35; // 0.75 -> 1.10 peak
  }
  if (deg < 16) {
    const t = (deg - 5) / 11;
    return 1.1 + t * (0.45 - 1.1); // 1.10 -> 0.45 breakaway
  }
  const t = Math.min(1, (deg - 16) / 20);
  return 0.45 - t * 0.08; // settle around 0.37-0.45 sliding plateau
}
