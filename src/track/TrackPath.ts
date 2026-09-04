import * as THREE from "three";

/**
 * Closed control points for the circuit centerline: a desert inland loop that
 * sweeps out to a long coastal straight along the ocean. Units are meters, flat
 * on Y so the physics ground plane stays trivially simple.
 */
const CONTROL_POINTS: Array<[number, number]> = [
  [0, 0],
  [55, -18],
  [130, -34],
  [215, -30],
  [275, -2],
  [300, 55],
  [292, 120],
  [250, 168],
  [180, 178],
  [120, 150],
  [95, 95],
  [60, 70],
  [10, 82],
  [-45, 120],
  [-95, 190],
  [-100, 260],
  [-60, 310],
  [10, 320],
  [70, 295],
  [95, 330],
  [80, 385],
  [15, 415],
  [-70, 405],
  [-150, 355],
  [-195, 275],
  [-205, 180],
  [-190, 95],
  [-150, 35],
  [-95, 5],
  [-50, -8],
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
    const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
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
    const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
    return { point, tangent, right, u: wrapped };
  }

  /**
   * Finds the arc-length position of the closest sample to `worldPos`, searching a window
   * around `hintIndex` for O(1) amortized cost per car per frame. Returns the sample index too,
   * so callers can pass it back in as the next hint.
   */
  projectPoint(worldPos: THREE.Vector3, hintIndex = -1, windowSize = 90): { u: number; index: number; distance: number } {
    const n = this.samplePoints.length;
    let searchStart = 0;
    let searchEnd = n;
    let wrap = false;
    if (hintIndex >= 0) {
      searchStart = hintIndex - windowSize;
      searchEnd = hintIndex + windowSize;
      wrap = true;
    }

    let bestIndex = 0;
    let bestDistSq = Infinity;
    const span = wrap ? searchEnd - searchStart : n;
    for (let k = 0; k < span; k++) {
      const i = wrap ? (((searchStart + k) % n) + n) % n : k;
      const d = this.samplePoints[i].distanceToSquared(worldPos);
      if (d < bestDistSq) {
        bestDistSq = d;
        bestIndex = i;
      }
    }

    return { u: this.sampleCumLength[bestIndex], index: bestIndex, distance: Math.sqrt(bestDistSq) };
  }

  getSamplePoints(): readonly THREE.Vector3[] {
    return this.samplePoints;
  }
}
