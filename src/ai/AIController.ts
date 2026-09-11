import * as THREE from "three";
import { TrackPath, ROAD_HALF_WIDTH } from "../track/TrackPath";
import { RacingLine } from "./RacingLine";
import type { InputState } from "../core/InputManager";
import type { Racer } from "../race/RaceManager";
import { clamp, damp, lerp } from "../utils/MathUtils";

/**
 * Driving styles. Sampling every trait independently produces a field of averages that all
 * behave much the same; picking a style first and jittering inside it keeps the drivers
 * recognisably different from each other.
 */
export type AIArchetype = "late-braker" | "smooth" | "charger" | "drifter" | "cruiser" | "erratic";

export interface AIPersonality {
  archetype: AIArchetype;
  /** Phase and size of a slow weave applied on top of the racing line, so the pack is not a train. */
  laneSeed: number;
  laneAmplitude: number;
  /** 0..1 blend from the track centerline toward the full racing line. */
  lineAdherence: number;
  /** Multiplies the planned speed profile. */
  paceFactor: number;
  /** Extra speed carried into a braking zone; higher brakes later. */
  brakingBravery: number;
  /** Willingness to pull out of the slipstream and commit to a pass. */
  aggression: number;
  /** Steering loop gains. Low damping gives a nervous, weaving car; high damping a planted one. */
  steerGain: number;
  steerDamping: number;
  /** How far up the road the driver looks, as a multiplier. Low aims early, clipping apexes. */
  lookaheadFactor: number;
  /** Throttle held when already at the target speed; low coasts, high drives through corners. */
  throttleFeather: number;
  /**
   * How slow a corner has to be before this driver yanks the handbrake, as a fraction of the
   * way from the circuit's slowest corner to its fastest. Relative rather than absolute, so a
   * "drifts the slow stuff" driver behaves the same on a fast circuit as on a twisty one.
   * Zero means never.
   */
  handbrakeCornerFraction: number;
  /**
   * Scales how far the driver swings away from the centerline through corners, on top of
   * lineAdherence. Positive exaggerates the wide-in/wide-out arc, negative cuts a straighter,
   * flatter line. This is what makes two cars visibly take different paths through the same bend.
   */
  cornerBias: number;
  /** Speed a handbrake-happy driver deliberately carries into a slow corner, as a multiplier. */
  cornerEntryBoost: number;
  /** Amplitude and rate of a slow wobble in pace, so a driver is not metronomic. */
  paceWobble: number;
  paceWobbleRate: number;
}

interface ArchetypeSpec {
  paceFactor: [number, number];
  brakingBravery: [number, number];
  lineAdherence: [number, number];
  aggression: [number, number];
  laneAmplitude: [number, number];
  steerGain: [number, number];
  steerDamping: [number, number];
  lookaheadFactor: [number, number];
  throttleFeather: [number, number];
  handbrakeCornerFraction: [number, number];
  cornerBias: [number, number];
  cornerEntryBoost: [number, number];
  paceWobble: [number, number];
}

const ARCHETYPES: Record<AIArchetype, ArchetypeSpec> = {
  // Hangs on to the brakes, so it is fast into corners and untidy on the way out.
  "late-braker": {
    paceFactor: [0.98, 1.06], brakingBravery: [0.85, 1.0], lineAdherence: [0.7, 0.85],
    aggression: [0.6, 0.9], laneAmplitude: [0.3, 0.8], steerGain: [2.2, 2.6],
    steerDamping: [0.26, 0.34], lookaheadFactor: [0.85, 0.95], throttleFeather: [0.25, 0.4],
    handbrakeCornerFraction: [0, 0], cornerBias: [-0.15, 0.1], cornerEntryBoost: [1, 1], paceWobble: [0.02, 0.05],
  },
  // Glued to the racing line, minimal inputs, quick without ever looking hurried.
  smooth: {
    paceFactor: [0.97, 1.04], brakingBravery: [0.45, 0.65], lineAdherence: [0.93, 1.0],
    aggression: [0.25, 0.5], laneAmplitude: [0.1, 0.4], steerGain: [1.8, 2.1],
    steerDamping: [0.4, 0.5], lookaheadFactor: [1.05, 1.2], throttleFeather: [0.4, 0.55],
    handbrakeCornerFraction: [0, 0], cornerBias: [0.05, 0.2], cornerEntryBoost: [1, 1], paceWobble: [0.01, 0.03],
  },
  // Big pace, big elbows, runs wide lines to force a way past.
  charger: {
    paceFactor: [1.02, 1.1], brakingBravery: [0.7, 0.95], lineAdherence: [0.6, 0.8],
    aggression: [0.85, 1.0], laneAmplitude: [0.6, 1.4], steerGain: [2.3, 2.8],
    steerDamping: [0.22, 0.3], lookaheadFactor: [0.8, 0.95], throttleFeather: [0.45, 0.6],
    handbrakeCornerFraction: [0, 0], cornerBias: [0.22, 0.45], cornerEntryBoost: [1, 1], paceWobble: [0.03, 0.07],
  },
  // Throws it sideways into the slow stuff. Showy and a little slower for it.
  drifter: {
    paceFactor: [0.94, 1.02], brakingBravery: [0.6, 0.85], lineAdherence: [0.65, 0.85],
    aggression: [0.5, 0.8], laneAmplitude: [0.5, 1.2], steerGain: [2.4, 2.9],
    steerDamping: [0.2, 0.28], lookaheadFactor: [0.75, 0.9], throttleFeather: [0.5, 0.7],
    handbrakeCornerFraction: [0.22, 0.36], cornerBias: [-0.1, 0.15], cornerEntryBoost: [1.12, 1.25], paceWobble: [0.03, 0.07],
  },
  // Tidy but tentative: leaves margin everywhere and defends rather than attacks.
  cruiser: {
    paceFactor: [0.88, 0.95], brakingBravery: [0.3, 0.5], lineAdherence: [0.75, 0.9],
    aggression: [0.15, 0.35], laneAmplitude: [0.2, 0.6], steerGain: [1.7, 2.0],
    steerDamping: [0.42, 0.55], lookaheadFactor: [1.1, 1.3], throttleFeather: [0.3, 0.45],
    handbrakeCornerFraction: [0, 0], cornerBias: [-0.35, -0.15], cornerEntryBoost: [1, 1], paceWobble: [0.02, 0.05],
  },
  // Quick on its day, scruffy on others; wanders around the road and changes its mind.
  erratic: {
    paceFactor: [0.9, 1.05], brakingBravery: [0.4, 0.95], lineAdherence: [0.5, 0.75],
    aggression: [0.4, 0.95], laneAmplitude: [1.0, 2.2], steerGain: [2.5, 3.0],
    steerDamping: [0.18, 0.26], lookaheadFactor: [0.7, 1.0], throttleFeather: [0.2, 0.6],
    handbrakeCornerFraction: [0, 0.2], cornerBias: [-0.4, 0.5], cornerEntryBoost: [1, 1.12], paceWobble: [0.08, 0.16],
  },
};

const ARCHETYPE_ORDER: AIArchetype[] = ["late-braker", "smooth", "charger", "drifter", "cruiser", "erratic"];

const UP = new THREE.Vector3(0, 1, 0);

/** How far ahead a car looks for a slower opponent it needs to avoid. */
const AVOID_RANGE = 26;
const AVOID_HALF_WIDTH = 3.3;
const MAX_AVOID_OFFSET = 5.2;
/**
 * Ceiling on the racing line, weave and avoidance offsets *combined*. Each is individually sane
 * but they stack, and without this the aimed-at point can sit beyond the kerb.
 */
const MAX_TRACK_OFFSET = ROAD_HALF_WIDTH - 1.8;
/** Car-following: chassis length, the gap to hold behind a car, and how hard to chase that gap. */
const CAR_LENGTH = 4.4;
const DESIRED_GAP = 4;
const GAP_GAIN = 1.5;
/**
 * A car pinned this far below its plan for this long is wedged against someone and cannot free
 * itself; recovery is the only way out. Deliberately slow so ordinary traffic never triggers it.
 */
const PINNED_SPEED_FRACTION = 0.4;
const PINNED_SECONDS = 3.5;
/**
 * The handbrake is pulled in short bursts with a cooldown, never held. Held through a corner it
 * simply spins the car; a stab rotates it and lets the driver gather it up again.
 */
const HANDBRAKE_BURST_SEC = 0.35;
const HANDBRAKE_COOLDOWN_SEC = 4;

export class AIController {
  private hint = -1;
  private stuckTimer = 0;
  private avoidOffset = 0;
  private clock = 0;
  private handbrakeTimer = 0;
  private handbrakeCooldown = 0;
  /** Corner speed below which this driver reaches for the handbrake; 0 = never. */
  private readonly handbrakeBelowSpeed: number;

  constructor(
    private readonly path: TrackPath,
    private readonly line: RacingLine,
    private readonly racer: Racer,
    private readonly personality: AIPersonality,
    private readonly field: readonly Racer[],
    private readonly onStuck: (racer: Racer) => void
  ) {
    this.handbrakeBelowSpeed =
      personality.handbrakeCornerFraction <= 0
        ? 0
        : line.slowestSpeed + (line.fastestSpeed - line.slowestSpeed) * personality.handbrakeCornerFraction;
  }

  sample(dt: number): InputState {
    const personality = this.personality;
    const vehicle = this.racer.vehicle;
    const pos = vehicle.position();
    const { u, index, distance } = this.path.projectPoint(pos, this.hint);
    this.hint = index;
    this.clock += dt;

    const speedMs = Math.max(0, vehicle.telemetry.forwardSpeedMs);
    const forward = vehicle.forwardVector();
    const right = new THREE.Vector3().crossVectors(forward, UP).normalize();

    const plannedSpeed = this.planSpeed(u, speedMs);
    const avoidance = this.planAvoidance(pos, forward, right, speedMs, dt);
    const steer = this.planSteer(u, speedMs, pos, vehicle.yawRate(), avoidance.offset);

    // Slow to a car-follow pace when a pass is not on, instead of driving into the gearbox ahead.
    const cappedSpeed = Math.min(plannedSpeed, avoidance.speedCap);
    let throttle = 0;
    let brake = 0;
    if (speedMs < cappedSpeed - 0.8) {
      throttle = clamp((cappedSpeed - speedMs) / 4, 0.35, 1);
    } else if (speedMs > cappedSpeed + 0.8) {
      brake = clamp((speedMs - cappedSpeed) / 7, 0.18, 1);
    } else {
      // Feather rather than coast at the target, so engine braking does not bleed the car below
      // its corner speed. How much throttle that takes is part of the driver's style.
      throttle = personality.throttleFeather;
    }

    const handbrake = this.updateHandbrake(dt, plannedSpeed, speedMs, steer);

    this.updateStuck(dt, speedMs, throttle, distance, cappedSpeed);

    return {
      throttle,
      brake,
      steer,
      handbrake,
      boost: !handbrake && brake === 0 && Math.abs(steer) < 0.16 && speedMs > 12 &&
        cappedSpeed > speedMs + 3 && vehicle.telemetry.boostRemainingSec > 0.5 &&
        Math.sin(this.clock * 0.7 + personality.laneSeed) > 0.5 - personality.aggression * 0.5,
      resetRequested: false,
      cameraToggleRequested: false,
    };
  }

  /**
   * Drivers with a taste for it pitch the car sideways into the slow corners rather than braking
   * it all away. Costs them time, but it is unmistakable from the outside.
   */
  private updateHandbrake(dt: number, plannedSpeed: number, speedMs: number, steer: number): boolean {
    this.handbrakeCooldown = Math.max(0, this.handbrakeCooldown - dt);
    if (this.handbrakeTimer > 0) {
      this.handbrakeTimer = Math.max(0, this.handbrakeTimer - dt);
      return this.handbrakeTimer > 0;
    }
    const wantsIt =
      this.handbrakeBelowSpeed > 0 &&
      this.handbrakeCooldown === 0 &&
      plannedSpeed < this.handbrakeBelowSpeed &&
      speedMs > 14 &&
      Math.abs(steer) > 0.22;
    if (!wantsIt) return false;
    this.handbrakeTimer = HANDBRAKE_BURST_SEC;
    this.handbrakeCooldown = HANDBRAKE_COOLDOWN_SEC;
    return true;
  }

  /**
   * Reads the precomputed profile a little way ahead so braking starts before the corner, and
   * scans a speed-dependent window so a long braking zone is never entered too fast.
   */
  private planSpeed(u: number, speedMs: number): number {
    const personality = this.personality;
    // Roughly the distance needed to shed speed, which is how far ahead the plan must reach.
    const brakingHorizon = clamp(8 + (speedMs * speedMs) / 26, 12, 95) * (2 - personality.brakingBravery);
    const ahead = this.line.minSpeedWithin(u + 4, brakingHorizon);
    const here = this.line.speedLimitAt(u);
    // Blend so a car is not pinned to the slowest point of a long corner all the way through it.
    const planned = Math.min(here, lerp(ahead, here, 0.25));
    // A slow wobble on top of the base pace, so a driver drifts in and out of form over a lap
    // instead of lapping like a metronome.
    const wobble = 1 + Math.sin(this.clock * personality.paceWobbleRate + personality.laneSeed) * personality.paceWobble;
    // Handbrake drivers deliberately arrive too fast for the corner; the slide is how they get
    // the car turned. Without the extra entry speed there is nothing for the handbrake to break
    // loose, and the stab does nothing.
    const entryBoost = this.handbrakeBelowSpeed > 0 && planned < this.handbrakeBelowSpeed ? personality.cornerEntryBoost : 1;
    return planned * personality.paceFactor * wobble * entryBoost;
  }

  /** 0 on the fastest part of the circuit, 1 at its slowest corner. */
  private cornerSharpness(speedLimit: number): number {
    const span = this.line.fastestSpeed - this.line.slowestSpeed;
    if (span < 1e-6) return 0;
    return clamp((this.line.fastestSpeed - speedLimit) / span, 0, 1);
  }

  private planSteer(
    u: number,
    speedMs: number,
    pos: THREE.Vector3,
    yawRate: number,
    avoidOffset: number
  ): number {
    const personality = this.personality;
    // Looking closer clips apexes early and makes the car dart; looking further is smoother and
    // later-apexing. It is the single biggest visual difference between two drivers.
    const lookahead = clamp((7.5 + speedMs * 0.92) * personality.lookaheadFactor, 8, 44);
    const sample = this.line.sampleAt(u + lookahead);
    const center = this.path.frameAtDistance(u + lookahead);

    // Everything that moves the car sideways is one offset from the centerline, so the total can
    // be held inside the track. Avoidance is budgeted first and the racing line gets the room
    // that is left: clipping them together instead would cancel exactly the dodge a car needs in
    // a corner, where the line is already out at the edge.
    const avoid = clamp(avoidOffset, -MAX_TRACK_OFFSET, MAX_TRACK_OFFSET);
    const lineRoom = MAX_TRACK_OFFSET - Math.abs(avoid);
    const weave = Math.sin(u * 0.011 + personality.laneSeed) * personality.laneAmplitude;
    // The bias rides on the racing line's own excursion, so it always pushes wider or flatter
    // relative to the corner rather than blindly to one side of the road.
    const lineScale = personality.lineAdherence + personality.cornerBias * this.cornerSharpness(sample.speedLimit);
    const offset = avoid + clamp(sample.offset * lineScale + weave, -lineRoom, lineRoom);
    const target = center.point.clone().addScaledVector(center.right, offset);

    const toTarget = target.sub(pos);
    const invQuat = this.racer.vehicle.quaternion().invert();
    const local = toTarget.applyQuaternion(invQuat);
    // -local.x because the car's local +X points left; angle is then positive for "turn right".
    const angle = Math.atan2(-local.x, Math.max(0.5, local.z));
    const rightYawRate = -yawRate;
    return clamp(angle * personality.steerGain - rightYawRate * personality.steerDamping, -1, 1);
  }

  /**
   * Looks for cars in the corridor directly ahead and builds a lateral offset that steps around
   * them, plus a speed cap for when there is no room to go. The offset is smoothed over time so
   * the car commits to one side instead of flickering between them.
   */
  private planAvoidance(
    pos: THREE.Vector3,
    forward: THREE.Vector3,
    right: THREE.Vector3,
    speedMs: number,
    dt: number
  ): { offset: number; speedCap: number } {
    let desiredOffset = 0;
    let speedCap = Infinity;

    for (const other of this.field) {
      if (other === this.racer || other.finished) continue;
      const rel = other.vehicle.position().sub(pos);
      const ahead = rel.dot(forward);
      if (ahead <= 0 || ahead > AVOID_RANGE) continue;
      const lateral = rel.dot(right);
      if (Math.abs(lateral) > AVOID_HALF_WIDTH) continue;
      // A car pulling away up the road is not an obstacle; chasing it sideways only costs lap
      // time. Anything close still gets a reaction regardless of how fast it is going.
      if (ahead > 8 && other.vehicle.telemetry.forwardSpeedMs > speedMs + 2) continue;

      const urgency = 1 - ahead / AVOID_RANGE;
      // Step toward whichever side the opponent is not on; ties break left so two cars meeting
      // head-on in the same corridor do not both pick the same escape route.
      const side = lateral >= 0 ? -1 : 1;
      desiredOffset += side * urgency * MAX_AVOID_OFFSET * (0.55 + this.personality.aggression * 0.45);

      // Car-following: aim for a gap rather than simply matching pace. Matching pace turns the
      // grid into a concertina — every car inherits the speed of the one ahead and the field
      // crawls — whereas letting the allowance grow with the gap lets a queue stretch and clear.
      if (Math.abs(lateral) < 2.4) {
        const gap = ahead - CAR_LENGTH;
        const allowed = Math.max(0, other.vehicle.telemetry.forwardSpeedMs) + (gap - DESIRED_GAP) * GAP_GAIN;
        speedCap = Math.min(speedCap, Math.max(5, allowed));
      }
    }

    desiredOffset = clamp(desiredOffset, -MAX_AVOID_OFFSET, MAX_AVOID_OFFSET);
    this.avoidOffset = damp(this.avoidOffset, desiredOffset, 3.2, dt);
    return { offset: this.avoidOffset, speedCap };
  }

  private updateStuck(
    dt: number,
    speedMs: number,
    throttle: number,
    distanceFromCenter: number,
    targetSpeed: number
  ): void {
    const halted = speedMs < 0.8 && throttle > 0;
    // Cars that wedge into each other keep rolling at a few m/s while flat out, so a
    // speed-near-zero test never catches them; compare against what the car is asking for.
    const pinned = throttle > 0.5 && speedMs < targetSpeed * PINNED_SPEED_FRACTION;
    if (halted || pinned || distanceFromCenter > 11.5) {
      this.stuckTimer += dt;
      if (this.stuckTimer > (halted ? 2.5 : PINNED_SECONDS)) {
        this.stuckTimer = 0;
        this.onStuck(this.racer);
        this.hint = -1;
        this.avoidOffset = 0;
      }
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - dt * 2);
    }
  }
}

export function randomAIPersonality(seed: number): AIPersonality {
  const r = (n: number): number => {
    const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  // Deal the styles round-robin so a 12-car grid always fields every one of them, then jitter
  // within the style so two drivers who share it still are not clones.
  const archetype = ARCHETYPE_ORDER[(Math.floor(seed) - 1 + ARCHETYPE_ORDER.length * 4) % ARCHETYPE_ORDER.length];
  const spec = ARCHETYPES[archetype];
  const pick = (range: [number, number], n: number): number => range[0] + r(n) * (range[1] - range[0]);
  return {
    archetype,
    laneSeed: r(1) * Math.PI * 2,
    laneAmplitude: pick(spec.laneAmplitude, 2),
    lineAdherence: pick(spec.lineAdherence, 3),
    paceFactor: pick(spec.paceFactor, 4),
    brakingBravery: pick(spec.brakingBravery, 5),
    aggression: pick(spec.aggression, 6),
    steerGain: pick(spec.steerGain, 7),
    steerDamping: pick(spec.steerDamping, 8),
    lookaheadFactor: pick(spec.lookaheadFactor, 9),
    throttleFeather: pick(spec.throttleFeather, 10),
    handbrakeCornerFraction: pick(spec.handbrakeCornerFraction, 11),
    cornerBias: pick(spec.cornerBias, 14),
    cornerEntryBoost: pick(spec.cornerEntryBoost, 15),
    paceWobble: pick(spec.paceWobble, 12),
    paceWobbleRate: 0.18 + r(13) * 0.5,
  };
}
