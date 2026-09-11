import * as THREE from "three";
import { TrackPath, ROAD_HALF_WIDTH } from "../track/TrackPath";
import { clamp } from "../utils/MathUtils";

export interface RacingLineOptions {
  sampleCount: number;
  /** How far the line may stray from the centerline, in meters. */
  maxOffset: number;
  /** Curvature-smoothing iterations. More means a straighter, later-apexing line. */
  iterations: number;
  /** Per-iteration blend toward the smoothed position; below 1 for stability. */
  relaxation: number;
  /** Lateral grip the speed profile assumes, in g. */
  lateralG: number;
  /** Deceleration and acceleration the profile plans for, in m/s^2. */
  brakeDecelMs2: number;
  accelMs2: number;
  maxSpeedMs: number;
  minSpeedMs: number;
}

export const DEFAULT_RACING_LINE_OPTIONS: RacingLineOptions = {
  sampleCount: 720,
  maxOffset: ROAD_HALF_WIDTH - 2.6,
  iterations: 260,
  relaxation: 0.3,
  lateralG: 1.5,
  brakeDecelMs2: 16,
  accelMs2: 9,
  maxSpeedMs: 53,
  minSpeedMs: 12,
};

export interface RacingLineSample {
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  /** Signed distance from the centerline along `right`. */
  offset: number;
  speedLimit: number;
}

/**
 * Precomputes a minimum-curvature line through the circuit plus the fastest speed profile that
 * line supports. The profile already accounts for braking into and accelerating out of every
 * corner, so a controller can simply read the target speed at its current position instead of
 * guessing a braking point from local curvature.
 */
export class RacingLine {
  readonly totalLength: number;
  private readonly count: number;
  private readonly spacing: number;
  private readonly points: THREE.Vector3[] = [];
  private readonly tangents: THREE.Vector3[] = [];
  private readonly rights: THREE.Vector3[] = [];
  private readonly offsets: number[];
  private readonly speeds: number[];
  /** Range of the finished speed profile, for callers that want to talk in "slow corner" terms. */
  readonly slowestSpeed: number;
  readonly fastestSpeed: number;

  constructor(path: TrackPath, options: Partial<RacingLineOptions> = {}) {
    const opts = { ...DEFAULT_RACING_LINE_OPTIONS, ...options };
    this.totalLength = path.totalLength;
    this.count = opts.sampleCount;
    this.spacing = this.totalLength / this.count;

    const centers: THREE.Vector3[] = [];
    const centerRights: THREE.Vector3[] = [];
    for (let i = 0; i < this.count; i++) {
      const frame = path.frameAtDistance(i * this.spacing);
      centers.push(frame.point.clone());
      centerRights.push(frame.right.clone());
    }

    this.offsets = new Array(this.count).fill(0);
    this.relaxOffsets(centers, centerRights, opts);

    for (let i = 0; i < this.count; i++) {
      this.points.push(centers[i].clone().addScaledVector(centerRights[i], this.offsets[i]));
    }
    for (let i = 0; i < this.count; i++) {
      const next = this.points[(i + 1) % this.count];
      const prev = this.points[(i - 1 + this.count) % this.count];
      const tangent = new THREE.Vector3().subVectors(next, prev).normalize();
      this.tangents.push(tangent);
      // Same handedness as TrackPath.frameAtDistance().right, so `offset` means the same thing
      // here as everywhere else that positions cars relative to the centerline.
      this.rights.push(new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), tangent).normalize());
    }

    this.speeds = this.buildSpeedProfile(opts);
    this.slowestSpeed = Math.min(...this.speeds);
    this.fastestSpeed = Math.max(...this.speeds);
  }

  /**
   * Iteratively pulls each sample toward the midpoint of its neighbours, constrained to the track
   * normal and to the drivable width. That converges on the minimum-curvature path: the line
   * straightens through chicanes and swings wide-in-wide through single corners on its own.
   */
  private relaxOffsets(centers: THREE.Vector3[], rights: THREE.Vector3[], opts: RacingLineOptions): void {
    const n = this.count;
    const scratch = new THREE.Vector3();
    for (let iter = 0; iter < opts.iterations; iter++) {
      const previous = this.offsets.slice();
      for (let i = 0; i < n; i++) {
        const iPrev = (i - 1 + n) % n;
        const iNext = (i + 1) % n;
        const prev = scratch.copy(centers[iPrev]).addScaledVector(rights[iPrev], previous[iPrev]);
        const midX = (prev.x + centers[iNext].x + rights[iNext].x * previous[iNext]) / 2;
        const midZ = (prev.z + centers[iNext].z + rights[iNext].z * previous[iNext]) / 2;
        const desired = (midX - centers[i].x) * rights[i].x + (midZ - centers[i].z) * rights[i].z;
        this.offsets[i] = clamp(
          previous[i] + (desired - previous[i]) * opts.relaxation,
          -opts.maxOffset,
          opts.maxOffset
        );
      }
    }
  }

  /** Discrete curvature at sample i from the circumscribed circle of its neighbours. */
  private curvatureAt(i: number): number {
    const n = this.count;
    const a = this.points[(i - 1 + n) % n];
    const b = this.points[i];
    const c = this.points[(i + 1) % n];
    const abx = b.x - a.x, abz = b.z - a.z;
    const bcx = c.x - b.x, bcz = c.z - b.z;
    const acx = c.x - a.x, acz = c.z - a.z;
    const ab = Math.hypot(abx, abz);
    const bc = Math.hypot(bcx, bcz);
    const ac = Math.hypot(acx, acz);
    if (ab < 1e-6 || bc < 1e-6 || ac < 1e-6) return 0;
    // Twice the triangle area via the cross product gives 1/R = 4*area / (|ab||bc||ac|).
    const cross = abx * bcz - abz * bcx;
    return Math.abs(2 * cross) / (ab * bc * ac);
  }

  private buildSpeedProfile(opts: RacingLineOptions): number[] {
    const n = this.count;
    const speeds = new Array<number>(n);
    const gripAccel = opts.lateralG * 9.81;
    for (let i = 0; i < n; i++) {
      const curvature = this.curvatureAt(i);
      const cornerSpeed = curvature > 1e-6 ? Math.sqrt(gripAccel / curvature) : Infinity;
      speeds[i] = clamp(cornerSpeed, opts.minSpeedMs, opts.maxSpeedMs);
    }
    // Two wrapped passes each way: backward propagates braking zones into the preceding straight,
    // forward caps how fast the car can actually be going on corner exit. Two laps of the loop are
    // enough for the constraint to travel all the way around a closed circuit.
    for (let pass = 0; pass < 2; pass++) {
      for (let k = n - 1; k >= 0; k--) {
        const i = k % n;
        const next = speeds[(i + 1) % n];
        speeds[i] = Math.min(speeds[i], Math.sqrt(next * next + 2 * opts.brakeDecelMs2 * this.spacing));
      }
      for (let k = 0; k < n; k++) {
        const i = k % n;
        const prev = speeds[(i - 1 + n) % n];
        speeds[i] = Math.min(speeds[i], Math.sqrt(prev * prev + 2 * opts.accelMs2 * this.spacing));
      }
    }
    return speeds;
  }

  private indexAt(u: number): number {
    const wrapped = ((u % this.totalLength) + this.totalLength) % this.totalLength;
    return wrapped / this.spacing;
  }

  sampleAt(u: number): RacingLineSample {
    const f = this.indexAt(u);
    const i0 = Math.floor(f) % this.count;
    const i1 = (i0 + 1) % this.count;
    const t = f - Math.floor(f);
    return {
      point: this.points[i0].clone().lerp(this.points[i1], t),
      tangent: this.tangents[i0].clone().lerp(this.tangents[i1], t).normalize(),
      right: this.rights[i0].clone().lerp(this.rights[i1], t).normalize(),
      offset: this.offsets[i0] + (this.offsets[i1] - this.offsets[i0]) * t,
      speedLimit: this.speeds[i0] + (this.speeds[i1] - this.speeds[i0]) * t,
    };
  }

  speedLimitAt(u: number): number {
    const f = this.indexAt(u);
    const i0 = Math.floor(f) % this.count;
    const i1 = (i0 + 1) % this.count;
    const t = f - Math.floor(f);
    return this.speeds[i0] + (this.speeds[i1] - this.speeds[i0]) * t;
  }

  /** Slowest planned speed between `u` and `u + aheadMeters`, for an extra safety margin. */
  minSpeedWithin(u: number, aheadMeters: number): number {
    const steps = Math.max(1, Math.ceil(aheadMeters / this.spacing));
    const start = Math.floor(this.indexAt(u));
    let min = Infinity;
    for (let k = 0; k <= steps; k++) {
      const speed = this.speeds[(start + k) % this.count];
      if (speed < min) min = speed;
    }
    return min;
  }

  /** Racing-line points in order, for debugging or minimap overlays. */
  getPoints(): readonly THREE.Vector3[] {
    return this.points;
  }
}
