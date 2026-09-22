import * as THREE from "three";

/**
 * Crash damage. Every impact is read off the chassis' own velocity change over one physics step,
 * which is the one signal that covers walls, kerbs and other cars without a second contact query
 * and without touching the rebound the solver and WallBounce already agree on.
 *
 * Where the hit landed decides what suffers. The impact direction is resolved into the four corners
 * of the car, so a square nose-on shunt splits its energy between both front corners while clipping
 * a barrier with one corner concentrates everything there. Boost makes whatever you hit hurt more.
 *
 * Damage arrives in two stages. A part first works loose — a wheel sits cambered and shakes, a wing
 * droops and drags — and only a later hit tears it off. One impact can never do both: the ceiling on
 * a single hit is deliberately below the threshold that detaches anything, so no one loses a wheel
 * to a single touch and there is always a warning stage to drive carefully on.
 */

export interface DamageConfig {
  /** Speed lost in one step below which a knock does nothing at all. */
  minImpactMs: number;
  /** Speed lost in one step that writes a full unit of damage into a corner taking it square on. */
  fullImpactMs: number;
  /** Multiplies damage taken while the boost is lit. */
  boostMultiplier: number;
  /** Corner damage at which that wheel starts hanging off its hub. */
  wheelLoose: number;
  /** Corner damage at which that wheel leaves the car for good. */
  wheelBreak: number;
  /** Mean damage across an axle's two corners at which that wing starts dragging. */
  wingLoose: number;
  /** Mean damage across an axle's two corners at which that wing lets go. */
  wingBreak: number;
  /**
   * Ceiling on one impact. Must stay below every break threshold: that is what guarantees a part
   * cannot go from intact to gone in a single hit, however hard the hit was.
   */
  maxSeverity: number;
}

export const DEFAULT_DAMAGE: DamageConfig = {
  minImpactMs: 7,
  fullImpactMs: 17,
  boostMultiplier: 1.8,
  wheelLoose: 0.55,
  wheelBreak: 1.6,
  wingLoose: 0.45,
  wingBreak: 1.2,
  maxSeverity: 1,
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
  private readonly looseParts = new Set<CarPart>();
  /** Severity of the most recent impact that did any damage, for the caller's crash effects. */
  lastImpact = 0;

  constructor(private readonly config: DamageConfig = DEFAULT_DAMAGE) {}

  get broken(): ReadonlySet<CarPart> {
    return this.brokenParts;
  }

  has(part: CarPart): boolean {
    return this.brokenParts.has(part);
  }

  /** True while a part is hanging on but no longer straight. A detached part is not loose. */
  isLoose(part: CarPart): boolean {
    return this.looseParts.has(part) && !this.brokenParts.has(part);
  }

  /** Worst corner damage, 0..1+, in raw units. */
  get worstCorner(): number {
    return Math.max(...this.corners);
  }

  /**
   * How far a corner is toward losing its wheel, 0..1. This, not the raw figure, is what a gauge
   * should show: 100% has to mean "the next hit here takes it off", not an arbitrary unit.
   */
  cornerFraction(index: number): number {
    return Math.min(1, this.corners[index] / this.config.wheelBreak);
  }

  get worstFraction(): number {
    return Math.max(...this.corners.map((_, i) => this.cornerFraction(i)));
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
    if (boosting) severity *= config.boostMultiplier;
    // Clamped last, so the ceiling is a real ceiling. Clamping before the boost let a boosted
    // nose-on hit reach 1.98 and tear the wing off in one go, which is the whole thing this
    // ceiling exists to prevent.
    severity = Math.min(severity, config.maxSeverity);
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
      if (this.corners[i] >= config.wheelLoose) this.looseParts.add(wheel);
      if (this.corners[i] >= config.wheelBreak && !this.brokenParts.has(wheel)) {
        this.brokenParts.add(wheel);
        broken.push(wheel);
      }
    }
    for (const [part, a, b, loose, gone] of [
      ["front-wing", 0, 1, config.wingLoose, config.wingBreak],
      ["rear-wing", 2, 3, config.wingLoose, config.wingBreak],
    ] as const) {
      if (this.brokenParts.has(part)) continue;
      const axle = (this.corners[a] + this.corners[b]) / 2;
      if (axle >= loose) this.looseParts.add(part);
      if (axle >= gone) {
        this.brokenParts.add(part);
        broken.push(part);
      }
    }
    return broken;
  }

  reset(): void {
    this.corners.fill(0);
    this.brokenParts.clear();
    this.looseParts.clear();
    this.lastImpact = 0;
  }
}

/** Grip a corner keeps once its wheel is gone: the car is dragging a bare hub along the road. */
export const BROKEN_WHEEL_GRIP = 0.09;
/** Grip a corner keeps while its wheel is only hanging loose — enough to limp, not to race. */
export const LOOSE_WHEEL_GRIP = 0.55;
/** Grip an axle keeps once its wing has been torn off. */
export const BROKEN_WING_GRIP = 0.88;
/** Grip an axle keeps while its wing is bent and dragging. */
export const LOOSE_WING_GRIP = 0.95;
