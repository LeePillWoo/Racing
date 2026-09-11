import { clamp } from "../utils/MathUtils";

export interface DriftConfig {
  /** Rear slip angle that opens a drift, and the lower angle that keeps one alive. */
  entrySlipDeg: number;
  exitSlipDeg: number;
  /** Past this the car is spinning, not drifting: the chain is forfeited. */
  spinSlipDeg: number;
  minSpeedMs: number;
  /** Slip may dip below the exit angle for this long without breaking the chain. */
  breakGraceSec: number;
  /** Points per second at the reference angle and speed, before the chain multiplier. */
  scoreRate: number;
  referenceSlipDeg: number;
  referenceSpeedMs: number;
  /** Seconds of sustained drift needed for each multiplier step. */
  chainStepSec: number;
  maxChain: number;
  /** Boost awarded when a chain is banked, and the ceiling it accumulates to. */
  boostSecPerPoint: number;
  maxBoostSec: number;
  /** Engine torque multiplier while the boost is burning. */
  boostTorqueMultiplier: number;
}

export const DEFAULT_DRIFT: DriftConfig = {
  entrySlipDeg: 11,
  exitSlipDeg: 7,
  spinSlipDeg: 72,
  minSpeedMs: 7,
  breakGraceSec: 0.45,
  scoreRate: 62,
  referenceSlipDeg: 26,
  referenceSpeedMs: 28,
  chainStepSec: 1.4,
  maxChain: 5,
  // A single clean corner banks roughly 50 points, which should feel worth about a second of push.
  boostSecPerPoint: 0.02,
  maxBoostSec: 3.2,
  boostTorqueMultiplier: 1.75,
};

export interface DriftState {
  active: boolean;
  /** Score of the chain currently being built; banked and cleared when the drift ends. */
  score: number;
  /** Everything banked from completed chains. */
  bankedScore: number;
  chain: number;
  slipDeg: number;
  boostRemainingSec: number;
  boosting: boolean;
  /** Torque multiplier to hand to the drivetrain. */
  boostMultiplier: number;
  /** True on the frame a chain is banked, so callers can fire feedback. */
  justBanked: boolean;
  lastBankedScore: number;
}

/**
 * Scores sustained slides and converts them into a short engine boost. The reward lands when the
 * chain is banked rather than during the slide, so a drift costs speed up front and pays it back
 * on corner exit — which is what makes chaining corners worth the risk.
 */
export class DriftSystem {
  private active = false;
  private score = 0;
  private banked = 0;
  private chain = 1;
  private driftTime = 0;
  private graceTimer = 0;
  private boostRemaining: number;
  private boosting = false;
  private rechargeDelay = 0;
  private slipDeg = 0;
  private justBanked = false;
  private lastBanked = 0;

  constructor(private readonly config: DriftConfig = DEFAULT_DRIFT) { this.boostRemaining = config.maxBoostSec; }

  /**
   * Drops the chain in progress and stops burning boost. Stored fuel and banked score are kept:
   * this runs when a car is recovered onto the track, and wiping the session score for a spin
   * would punish the player twice for the same mistake.
   */
  reset(): void {
    this.active = false;
    this.score = 0;
    this.chain = 1;
    this.driftTime = 0;
    this.graceTimer = 0;
    this.boosting = false;
    this.rechargeDelay = 0;
    this.slipDeg = 0;
    this.justBanked = false;
  }

  private endChain(forfeit: boolean): void {
    if (!forfeit && this.score > 0) {
      this.banked += this.score;
      this.lastBanked = this.score;
      this.justBanked = true;
      this.boostRemaining = Math.min(
        this.config.maxBoostSec,
        this.boostRemaining + this.score * this.config.boostSecPerPoint
      );
    }
    this.active = false;
    this.score = 0;
    this.chain = 1;
    this.driftTime = 0;
    this.graceTimer = 0;
  }

  /**
   * @param rearSlipRad Largest rear-wheel slip angle this step, in radians.
   * @param grounded    Whether any wheel is on the ground; airborne slip should not score.
   */
  update(dt: number, rearSlipRad: number, speedMs: number, grounded: boolean, boostRequested = false): void {
    const config = this.config;
    this.justBanked = false;
    this.boosting = boostRequested && grounded && this.boostRemaining > 0;
    if (this.boosting) {
      this.boostRemaining = Math.max(0, this.boostRemaining - dt);
      this.rechargeDelay = 1.2;
    } else {
      this.rechargeDelay = Math.max(0, this.rechargeDelay - dt);
      if (this.rechargeDelay === 0) this.boostRemaining = Math.min(config.maxBoostSec, this.boostRemaining + dt * 0.38);
    }
    this.slipDeg = Math.abs(rearSlipRad) * (180 / Math.PI);

    const fastEnough = speedMs >= config.minSpeedMs && grounded;

    if (this.active && this.slipDeg > config.spinSlipDeg) {
      this.endChain(true);
      return;
    }

    if (!this.active) {
      if (fastEnough && this.slipDeg >= config.entrySlipDeg) {
        this.active = true;
        this.score = 0;
        this.chain = 1;
        this.driftTime = 0;
        this.graceTimer = 0;
      }
      return;
    }

    if (fastEnough && this.slipDeg >= config.exitSlipDeg) {
      this.graceTimer = 0;
      this.driftTime += dt;
      this.chain = Math.min(config.maxChain, 1 + Math.floor(this.driftTime / config.chainStepSec));
      const angleFactor = clamp(this.slipDeg / config.referenceSlipDeg, 0, 2);
      const speedFactor = clamp(speedMs / config.referenceSpeedMs, 0, 1.8);
      this.score += config.scoreRate * dt * angleFactor * speedFactor * this.chain;
    } else {
      this.graceTimer += dt;
      if (this.graceTimer > config.breakGraceSec) this.endChain(false);
    }
  }

  get state(): DriftState {
    const boosting = this.boosting;
    return {
      active: this.active,
      score: this.score,
      bankedScore: this.banked,
      chain: this.chain,
      slipDeg: this.slipDeg,
      boostRemainingSec: this.boostRemaining,
      boosting,
      boostMultiplier: boosting ? this.config.boostTorqueMultiplier : 1,
      justBanked: this.justBanked,
      lastBankedScore: this.lastBanked,
    };
  }
}
