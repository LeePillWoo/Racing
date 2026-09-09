import * as THREE from "three";

/**
 * Closed control points for the circuit centerline: a parkland Grand Prix loop that
 * opens onto a long grandstand-lined start straight. Units are meters, flat
 * on Y so the physics ground plane stays trivially simple.
 */
const CONTROL_POINTS: Array<[number, number]> = [
  [0, 0], [0, 75], [0, 165], [35, 230], [130, 255],
  [200, 210], [210, 125], [160, 65], [175, -30], [265, -100],
  [245, -185], [160, -220], [80, -185], [40, -115], [0, -80],
];

export const ROAD_HALF_WIDTH = 9;
export const SHOULDER_WIDTH = 6;

export interface TrackFrame {
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  u: number;
}

/** Wraps a closed Catmull-Rom spline with dense arc-length sampling for fast projection/lookahead queries. */
export class TrackPath {
  readonly curve: THREE.CatmullRomCurve3;
  readonly totalLength: number;
  private readonly sampleCount: number;
  private readonly samplePoints: THREE.Vector3[] = [];
  private readonly sampleCumLength: number[] = [];

  constructor(sampleCount = 2400) {
    const points = CONTROL_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.curve = new THREE.CatmullRomCurve3(points, true, "catmullrom", 0.5);
    this.sampleCount = sampleCount;

    const raw = this.curve.getPoints(sampleCount);
    let acc = 0;
    this.sampleCumLength.push(0);
    this.samplePoints.push(raw[0]);
    for (let i = 1; i < raw.length; i++) {
      acc += raw[i].distanceTo(raw[i - 1]);
      this.samplePoints.push(raw[i]);
      this.sampleCumLength.push(acc);
    }
    this.totalLength = acc;
  }

  private frameAtSample(index: number): TrackFrame {
    const n = this.samplePoints.length - 1;
    const i0 = ((index % n) + n) % n;
    const i1 = (i0 + 1) % n;
    const point = this.samplePoints[i0];
    const tangent = new THREE.Vector3().subVectors(this.samplePoints[i1], point).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), tangent).normalize();
    return { point: point.clone(), tangent, right, u: this.sampleCumLength[i0] };
  }

  /** Arc-length -> world frame (position, tangent, right vector), wrapping around the loop. */
  frameAtDistance(u: number): TrackFrame {
    const wrapped = ((u % this.totalLength) + this.totalLength) % this.totalLength;
    let lo = 0;
    let hi = this.sampleCumLength.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.sampleCumLength[mid] < wrapped) lo = mid + 1;
      else hi = mid;
    }
    const index = Math.max(0, lo - 1);
    const segStart = this.sampleCumLength[index];
    const segEnd = this.sampleCumLength[Math.min(index + 1, this.sampleCumLength.length - 1)];
    const segLen = Math.max(1e-5, segEnd - segStart);
    const t = (wrapped - segStart) / segLen;
    const a = this.frameAtSample(index);
    const b = this.frameAtSample(index + 1);
    const point = a.point.lerp(b.point, t);
    const tangent = a.tangent.lerp(b.tangent, t).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), tangent).normalize();
    return { point, tangent, right, u: wrapped };
  }

  /**
   * Finds the arc-length position of the closest sample to `worldPos`, searching a window
   * around `hintIndex` for O(1) amortized cost per car per frame. Returns the sample index too,
   * so callers can pass it back in as the next hint.
   */
  projectPoint(worldPos: THREE.Vector3, hintIndex = -1, windowSize = 90): { u: number; index: number; distance: number } {
    const n = this.sampleCount;
    let bestIndex = 0, bestU = 0, bestDistSq = Infinity;
    const inspect = (index: number): void => {
      const i = ((index % n) + n) % n;
      const a = this.samplePoints[i], b = this.samplePoints[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const lengthSq = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((worldPos.x - a.x) * dx + (worldPos.z - a.z) * dz) / Math.max(lengthSq, 1e-9)));
      const ex = worldPos.x - a.x - dx * t, ez = worldPos.z - a.z - dz * t;
      const d = ex * ex + ez * ez;
      if (d < bestDistSq) {
        bestDistSq = d; bestIndex = i;
        bestU = this.sampleCumLength[i] + t * (this.sampleCumLength[i + 1] - this.sampleCumLength[i]);
      }
    };
    if (hintIndex >= 0) {
      for (let k = hintIndex - windowSize; k <= hintIndex + windowSize; k++) inspect(k);
    }
    if (hintIndex < 0 || bestDistSq > 35 * 35) {
      for (let k = 0; k < n; k++) inspect(k);
    }
    return { u: bestU % this.totalLength, index: bestIndex, distance: Math.sqrt(bestDistSq) };
  }

  getSamplePoints(): readonly THREE.Vector3[] {
    return this.samplePoints;
  }
}
