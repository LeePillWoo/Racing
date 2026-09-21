import * as THREE from "three";

/**
 * Crash damage. Every impact is read off the chassis' own velocity change over one physics step,
 * which is the one signal that covers walls, kerbs and other cars without a second contact query
 * and without touching the rebound the solver and WallBounce already agree on.
 *
 * Where the hit landed decides what breaks. The impact direction is resolved into the four corners
 * of the car, so a square nose-on shunt splits its energy between both front corners and mostly
 * costs you the front wing, while clipping a barrier with one corner concentrates everything there
 * and rips that wheel off. Boost makes whatever you hit hurt more.
 */

export interface DamageConfig {
  /** Speed lost in one step below which a knock does nothing at all. */
  minImpactMs: number;
  /** Speed lost in one step that writes a full unit of damage into a corner taking it square on. */
  fullImpactMs: number;
  /** Multiplies damage taken while the boost is lit. */
  boostMultiplier: number;
  /** Corner damage at which that wheel leaves the car. */
  wheelBreak: number;
  /** Mean damage across an axle's two corners at which that wing lets go. */
  wingBreak: number;
  /** Ceiling on one impact, so a single freak step cannot destroy the whole car. */
  maxSeverity: number;
}

export const DEFAULT_DAMAGE: DamageConfig = {
  minImpactMs: 4.5,
  fullImpactMs: 17,
  boostMultiplier: 1.8,
  wheelBreak: 1,
  wingBreak: 0.62,
  maxSeverity: 1.35,
};

export type CarPart = "wheel-0" | "wheel-1" | "wheel-2" | "wheel-3" | "front-wing" | "rear-wing";

export const WHEEL_PARTS: CarPart[] = ["wheel-0", "wheel-1", "wheel-2", "wheel-3"];

/**
 * Corner directions in chassis-local XZ, matching the wheel hardpoint layout in Vehicle:
 * index 0/1 are the front pair, 2/3 the rear, even indices on -X and odd on +X.
 */
const CORNERS = [0, 1, 2, 3].map(i => {
  const x = i % 2 === 0 ? -1 : 1;
  const z = i < 2 ? 1 : -1;
  return { x: x * Math.SQRT1_2, z: z * Math.SQRT1_2 };
});

export class DamageModel {
  /** Accumulated damage per corner, 0 = pristine. Unbounded above the break threshold. */
  readonly corners = [0, 0, 0, 0];
  private readonly brokenParts = new Set<CarPart>();
  /** Severity of the most recent impact that did any damage, for the caller's crash effects. */
  lastImpact = 0;

  constructor(private readonly config: DamageConfig = DEFAULT_DAMAGE) {}

  get broken(): ReadonlySet<CarPart> {
    return this.brokenParts;
  }

  has(part: CarPart): boolean {
    return this.brokenParts.has(part);
  }

  /** Worst corner damage, 0..1+, for a damage readout. */
  get worstCorner(): number {
    return Math.max(...this.corners);
  }

  /**
   * Feeds one step of chassis motion in. `deltaV` is how the velocity moved and decides which
   * corner took the blow; `speedLost` is how much speed that step scrubbed and decides how hard.
   *
   * Reading severity off the speed lost rather than off the raw velocity change is what keeps
   * this honest: an engine or a boost shoving the car along changes its velocity without hurting
   * it, and a genuine graze that barely scrubs anything should cost paint rather than a wheel.
   * `forward` and `right` are the chassis' local axes in world space.
   */
  register(
    deltaVx: number,
    deltaVz: number,
    speedLost: number,
    forward: THREE.Vector3,
    right: THREE.Vector3,
    boosting: boolean
  ): CarPart[] {
    const config = this.config;
    const magnitude = Math.hypot(deltaVx, deltaVz);
    if (speedLost <= config.minImpactMs || magnitude < 1e-6) return [];
    let severity = (speedLost - config.minImpactMs) / (config.fullImpactMs - config.minImpactMs);
    severity = Math.min(severity, config.maxSeverity);
    if (boosting) severity *= config.boostMultiplier;
    this.lastImpact = severity;

    // The car is thrown along deltaV, so the blow arrived from the opposite direction.
    const localX = -(deltaVx * right.x + deltaVz * right.z) / magnitude;
    const localZ = -(deltaVx * forward.x + deltaVz * forward.z) / magnitude;

    const broken: CarPart[] = [];
    for (let i = 0; i < 4; i++) {
      // Deliberately not normalised across corners: a square hit gives both corners 0.71 of the
      // severity and neither may break, while a corner-on hit gives one corner the lot.
      const share = Math.max(0, localX * CORNERS[i].x + localZ * CORNERS[i].z);
      if (share <= 0) continue;
      this.corners[i] += severity * share;
      const wheel = WHEEL_PARTS[i];
      if (this.corners[i] >= config.wheelBreak && !this.brokenParts.has(wheel)) {
        this.brokenParts.add(wheel);
        broken.push(wheel);
      }
    }
    for (const [part, a, b] of [["front-wing", 0, 1], ["rear-wing", 2, 3]] as const) {
      if (this.brokenParts.has(part)) continue;
      if ((this.corners[a] + this.corners[b]) / 2 >= config.wingBreak) {
        this.brokenParts.add(part);
        broken.push(part);
      }
    }
    return broken;
  }

  reset(): void {
    this.corners.fill(0);
    this.brokenParts.clear();
    this.lastImpact = 0;
  }
}

/** Grip a corner keeps once its wheel is gone: the car is dragging a bare hub along the road. */
export const BROKEN_WHEEL_GRIP = 0.09;
/** Grip an axle keeps once its wing has been torn off. */
export const BROKEN_WING_GRIP = 0.88;
