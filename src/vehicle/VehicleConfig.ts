import { DEFAULT_DRIFT, DriftConfig } from "./DriftSystem";
import { DEFAULT_DRIVETRAIN, DrivetrainConfig } from "./Drivetrain";

export interface VehicleConfig {
  chassisHalfExtents: { x: number; y: number; z: number };
  chassisMass: number;
  chassisCenterOfMassOffsetY: number;
  chassisFriction: number;
  /** Bounciness in car-to-car contact. Wall hits use the barrier's higher value instead. */
  chassisRestitution: number;
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

  /**
   * Peak tyre friction coefficient per axle, which is what caps lateral force and therefore
   * decides when a tyre lets go. The rear is deliberately a little lower than the front so the
   * car leans toward oversteer and a slide is something the driver can provoke on purpose.
   */
  tireFrictionFront: number;
  tireFrictionRear: number;
  /**
   * Lateral constraint stiffness. Left constant: in Rapier this behaves almost as an on/off
   * switch (a small value still pins the wheel laterally, zero spins the car), so grip is
   * modulated through the friction coefficients above instead.
   */
  baseSideFrictionStiffness: number;
  handbrakeRearFrictionMultiplier: number;

  drivetrain: DrivetrainConfig;
  drift: DriftConfig;

  /** Reference top speed, used by the AI speed profile rather than by the engine model. */
  topSpeedMs: number;
  maxBrakeForce: number;
  handbrakeForce: number;
  rollingResistance: number;

  /** Rapier body damping. Kept low so aeroDragCoefficient sets the high-speed limit instead. */
  linearDamping: number;
  angularDamping: number;
  /** Quadratic drag: force = coefficient * speed^2, opposing travel. */
  aeroDragCoefficient: number;

  maxSteerLowSpeed: number; // radians
  maxSteerHighSpeed: number; // radians
  steerHighSpeedThreshold: number; // m/s
  steerResponse: number; // per-second smoothing rate

  /** Yaw-rate assist: torque per rad/s of error between the requested and actual rotation. */
  yawAssistGain: number;
  maxYawAssistTorque: number;
  maxAssistYawRate: number; // rad/s
  /**
   * Headroom the assist is allowed above the grip-limited yaw rate. Must stay near 1: the
   * steering geometry can ask for a rotation the tyres cannot support, and an assist that chases
   * it torques the car straight into a spin.
   */
  yawAssistGripMargin: number;
  /** Above this yaw rate the car is spinning; excess is damped out. */
  spinYawRateLimit: number; // rad/s
  spinDampGain: number;
  /** Forward push while sliding, per m/s of lateral scrub, so drifts keep momentum. */
  driftThrustPerScrub: number;
  maxDriftThrust: number;
  driftAssistMinSpeed: number;

  /** Share of the impact speed thrown back when the chassis meets a wall. */
  wallBounceRestitution: number;
  /** Closing speed below which a touch is a scrape, not a bounce. */
  wallBounceMinSpeed: number;
  /** Floor on the rebound so even a crawl into the wall frees the car instead of pinning it. */
  wallBounceMinRebound: number;
  /** Steady outward push while touching, so the car can never stay glued to the barrier. */
  wallSeparationForce: number;
  /** Yaw kick per m/s of impact, which makes a hit read as a knock rather than a dead stop. */
  wallImpactYawKick: number;
  maxWallImpactYawKick: number;
}

export const DEFAULT_VEHICLE_CONFIG: VehicleConfig = {
  chassisHalfExtents: { x: 0.84, y: 0.22, z: 2.2 },
  chassisMass: 780,
  chassisCenterOfMassOffsetY: -0.08,
  chassisFriction: 0.2,
  chassisRestitution: 0.65,
  spawnHeight: 1.15,

  wheelRadius: 0.46,
  wheelWidth: 0.43,
  trackHalfWidth: 1.14,
  wheelBaseFront: 1.55,
  wheelBaseRear: -1.45,
  connectionPointY: -0.32,

  suspensionRestLength: 0.24,
  maxSuspensionTravel: 0.16,
  suspensionStiffness: 28,
  suspensionCompression: 0.6,
  suspensionRelaxation: 0.72,
  maxSuspensionForce: 100000,

  tireFrictionFront: 1.7,
  tireFrictionRear: 1.9,
  baseSideFrictionStiffness: 2.2,
  handbrakeRearFrictionMultiplier: 0.22,

  drivetrain: DEFAULT_DRIVETRAIN,
  drift: DEFAULT_DRIFT,

  topSpeedMs: 53, // ~191 km/h, where drive force and drag balance in top gear
  maxBrakeForce: 55,
  handbrakeForce: 90,
  rollingResistance: 0.35,

  linearDamping: 0.02,
  angularDamping: 1.2,
  aeroDragCoefficient: 0.52,

  maxSteerLowSpeed: 0.58,
  maxSteerHighSpeed: 0.16,
  steerHighSpeedThreshold: 34,
  steerResponse: 7,

  yawAssistGain: 2600,
  maxYawAssistTorque: 6500,
  maxAssistYawRate: 1.9,
  yawAssistGripMargin: 1.15,
  spinYawRateLimit: 2.2,
  spinDampGain: 3500,
  driftThrustPerScrub: 90,
  maxDriftThrust: 2600,
  driftAssistMinSpeed: 6,

  wallBounceRestitution: 0.55,
  wallBounceMinSpeed: 0.6,
  wallBounceMinRebound: 3.2,
  wallSeparationForce: 5200,
  wallImpactYawKick: 260,
  maxWallImpactYawKick: 2200,
};

/**
 * Arcade tyre grip curve, as a fraction of the axle's peak friction coefficient. Grip builds to
 * its peak just past a small slip angle, then eases off onto a high plateau.
 *
 * The falloff past the peak is deliberately shallow. This multiplies a *force limit*, so a steep
 * drop is self-reinforcing: less grip means more slip, which takes away more grip, and the car
 * snaps into an unrecoverable spin the moment a tyre steps out. A gentle slope lets a slide
 * settle at an angle the driver can hold and steer out of.
 */
export function tireLateralGripCurve(slipAngleRad: number): number {
  const deg = Math.abs(slipAngleRad) * (180 / Math.PI);
  if (deg < 6) {
    return 0.8 + (deg / 6) * 0.2; // 0.80 -> 1.00 peak
  }
  if (deg < 20) {
    const t = (deg - 6) / 14;
    return 1.0 - t * 0.12; // 1.00 -> 0.88 breakaway
  }
  const t = Math.min(1, (deg - 20) / 25);
  return 0.88 - t * 0.06; // 0.88 -> 0.82 sliding plateau
}
