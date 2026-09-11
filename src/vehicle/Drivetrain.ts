import { clamp, damp, smoothstep } from "../utils/MathUtils";

export interface DrivetrainConfig {
  idleRpm: number;
  redlineRpm: number;
  /** Auto-shift thresholds. Kept well inside the redline so the limiter is only hit in top gear. */
  upshiftRpm: number;
  downshiftRpm: number;
  peakTorqueNm: number;
  forwardRatios: number[];
  reverseRatio: number;
  finalDrive: number;
  /** Driveline losses between crank and contact patch. */
  efficiency: number;
  /** Clutch-open window on a gear change; torque is cut for this long. */
  shiftTimeSec: number;
  /** Crank-referenced drag when coasting off-throttle, multiplied up by the current gearing. */
  engineBrakeNm: number;
  /** Needle smoothing rate; also smooths the torque the wheels see across a shift. */
  rpmResponse: number;
}

export const DEFAULT_DRIVETRAIN: DrivetrainConfig = {
  idleRpm: 950,
  redlineRpm: 7800,
  // Below the rpm the car can still pull in 5th against drag, otherwise top gear is unreachable.
  upshiftRpm: 6900,
  downshiftRpm: 3150,
  peakTorqueNm: 215,
  // Spaced so 1st tops out near 60 km/h and 6th near 195 km/h with the default 0.46 m wheel.
  forwardRatios: [5.8, 4.0, 3.05, 2.42, 1.96, 1.6],
  // Short enough that the rev limiter caps reverse near 60 km/h without a special-case clamp.
  reverseRatio: 6.2,
  finalDrive: 3.6,
  efficiency: 0.92,
  shiftTimeSec: 0.12,
  engineBrakeNm: 22,
  rpmResponse: 16,
};

/**
 * Normalized torque curve as (rpm / redline, torque / peakTorque) control points.
 * Torque builds off idle, peaks just past mid range, then falls away toward the limiter,
 * so each gear has a distinct pull and holding a gear too long visibly costs acceleration.
 */
const TORQUE_CURVE: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0.55],
  [0.15, 0.72],
  [0.35, 0.9],
  [0.55, 1.0],
  [0.75, 0.97],
  [0.9, 0.86],
  [1.0, 0.7],
];

const RPM_PER_RAD_PER_SEC = 60 / (2 * Math.PI);

export function engineTorqueNm(rpm: number, config: DrivetrainConfig): number {
  const x = clamp(rpm / config.redlineRpm, 0, 1);
  let factor = TORQUE_CURVE[TORQUE_CURVE.length - 1][1];
  for (let i = 1; i < TORQUE_CURVE.length; i++) {
    const [x1, y1] = TORQUE_CURVE[i];
    if (x <= x1) {
      const [x0, y0] = TORQUE_CURVE[i - 1];
      factor = y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      break;
    }
  }
  // Rev limiter: fade the last 250 rpm to zero rather than cutting hard, which would make the
  // car judder against the limiter in top gear where there is no higher gear to shift into.
  const limiter = 1 - smoothstep(config.redlineRpm - 250, config.redlineRpm, rpm);
  return factor * limiter * config.peakTorqueNm;
}

/**
 * Automatic gearbox and engine model. Converts a throttle request into a longitudinal force at
 * the driven wheels, so acceleration follows the torque curve and the gearing instead of the
 * flat "force fades linearly with speed" approximation it replaces.
 */
export class Drivetrain {
  /** 0 = reverse, 1..forwardRatios.length = forward gears. */
  private gear = 1;
  private shiftTimer = 0;
  private rpmValue: number;

  constructor(
    private readonly config: DrivetrainConfig,
    private readonly wheelRadius: number
  ) {
    this.rpmValue = config.idleRpm;
  }

  get rpm(): number {
    return this.rpmValue;
  }

  get rpmFraction(): number {
    return clamp(this.rpmValue / this.config.redlineRpm, 0, 1);
  }

  get gearIndex(): number {
    return this.gear;
  }

  get isShifting(): boolean {
    return this.shiftTimer > 0;
  }

  get topGear(): number {
    return this.config.forwardRatios.length;
  }

  reset(): void {
    this.gear = 1;
    this.shiftTimer = 0;
    this.rpmValue = this.config.idleRpm;
  }

  private ratioFor(gear: number): number {
    return gear === 0 ? this.config.reverseRatio : this.config.forwardRatios[gear - 1];
  }

  private rpmInGear(gear: number, forwardSpeed: number): number {
    const total = this.ratioFor(gear) * this.config.finalDrive;
    const wheelRadPerSec = Math.abs(forwardSpeed) / this.wheelRadius;
    return clamp(wheelRadPerSec * total * RPM_PER_RAD_PER_SEC, this.config.idleRpm, this.config.redlineRpm);
  }

  /** Label for the HUD: "R", "N" while the clutch is open, otherwise the gear number. */
  get gearLabel(): string {
    if (this.gear === 0) return "R";
    if (this.shiftTimer > 0) return "N";
    return String(this.gear);
  }

  private selectGear(forwardSpeed: number, wantReverse: boolean): void {
    if (wantReverse) {
      if (this.gear !== 0) {
        this.gear = 0;
        this.shiftTimer = this.config.shiftTimeSec;
      }
      return;
    }
    if (this.gear === 0) {
      this.gear = 1;
      this.shiftTimer = this.config.shiftTimeSec;
      return;
    }
    if (this.shiftTimer > 0) return;

    const config = this.config;
    // Only commit to a shift when the destination gear also sits inside the shift window,
    // otherwise the box hunts between two gears at a steady speed.
    if (this.gear < this.topGear && this.rpmValue > config.upshiftRpm) {
      if (this.rpmInGear(this.gear + 1, forwardSpeed) > config.downshiftRpm) {
        this.gear++;
        this.shiftTimer = config.shiftTimeSec;
      }
    } else if (this.gear > 1 && this.rpmValue < config.downshiftRpm) {
      if (this.rpmInGear(this.gear - 1, forwardSpeed) < config.upshiftRpm) {
        this.gear--;
        this.shiftTimer = config.shiftTimeSec;
      }
    }
  }

  /**
   * Advances the gearbox and returns the signed drive force at the wheels, in the same units as
   * Rapier's `setWheelEngineForce`. Positive drives the car along its forward axis.
   */
  update(dt: number, forwardSpeed: number, throttle: number, wantReverse: boolean, boostMultiplier = 1): number {
    const config = this.config;
    if (this.shiftTimer > 0) this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    this.selectGear(forwardSpeed, wantReverse);

    this.rpmValue = damp(this.rpmValue, this.rpmInGear(this.gear, forwardSpeed), config.rpmResponse, dt);

    const gearing = (this.ratioFor(this.gear) * config.finalDrive * config.efficiency) / this.wheelRadius;
    const clampedThrottle = clamp(throttle, 0, 1);

    let force = 0;
    if (this.shiftTimer <= 0 && clampedThrottle > 0) {
      force = engineTorqueNm(this.rpmValue, config) * clampedThrottle * boostMultiplier * gearing;
      if (this.gear === 0) force = -force;
    }

    // Engine braking, applied through the same channel as drive force so both share Rapier's
    // force units (the wheel *brake* channel uses a different, much smaller scale).
    if (Math.abs(forwardSpeed) > 0.5 && this.shiftTimer <= 0) {
      const drag = config.engineBrakeNm * gearing * this.rpmFraction * (1 - clampedThrottle);
      force -= Math.sign(forwardSpeed) * drag;
    }
    return force;
  }
}
