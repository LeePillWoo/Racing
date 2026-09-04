import * as THREE from "three";
import { TrackPath } from "../track/TrackPath";
import type { InputState } from "../core/InputManager";
import type { Racer } from "../race/RaceManager";
import { clamp, lerp, smoothstep } from "../utils/MathUtils";

export interface AIPersonality {
  laneSeed: number;
  laneAmplitude: number;
  topSpeedFactor: number; // 0..1+ relative aggressiveness
  cornerBravery: number; // 0..1, higher = brakes later / carries more corner speed
}

export class AIController {
  private hint = -1;
  private stuckTimer = 0;

  constructor(
    private readonly path: TrackPath,
    private readonly racer: Racer,
    private readonly personality: AIPersonality,
    private readonly playerRacer: Racer,
    private readonly onStuck: (racer: Racer) => void
  ) {}

  sample(dt: number): InputState {
    const vehicle = this.racer.vehicle;
    const pos = vehicle.position();
    const { u, index } = this.path.projectPoint(pos, this.hint);
    this.hint = index;

    const speedMs = Math.max(0, vehicle.telemetry.forwardSpeedMs);
    const lookahead = clamp(7 + speedMs * 1.05, 9, 42);

    const nearFrame = this.path.frameAtDistance(u + lookahead * 0.55);
    const targetFrame = this.path.frameAtDistance(u + lookahead);
    const farFrame = this.path.frameAtDistance(u + lookahead * 1.9);

    const laneOffset = Math.sin(u * 0.012 + this.personality.laneSeed) * this.personality.laneAmplitude;
    const targetPoint = targetFrame.point.clone().addScaledVector(targetFrame.right, laneOffset);

    const toTarget = targetPoint.clone().sub(pos);
    const invQuat = vehicle.quaternion().clone().invert();
    const local = toTarget.applyQuaternion(invQuat);
    const angle = Math.atan2(local.x, Math.max(0.001, local.z));
    const steer = clamp(angle * 1.7, -1, 1);

    const turnAngle = nearFrame.tangent.angleTo(farFrame.tangent);
    const curvature = smoothstep(0.04, 0.55, turnAngle);
    const rubberBand = clamp(
      1 + (this.playerRacer.distanceTraveled - this.racer.distanceTraveled) * 0.0012,
      0.85,
      1.18
    );
    const cornerSpeedMs = lerp(20, 11, this.personality.cornerBravery === 0 ? 0.5 : curvature) * (0.7 + this.personality.cornerBravery * 0.3);
    const straightSpeedMs = 46 * this.personality.topSpeedFactor * rubberBand;
    const targetSpeed = lerp(straightSpeedMs, cornerSpeedMs, curvature);

    let throttle = 0;
    let brake = 0;
    if (speedMs < targetSpeed - 1) {
      throttle = 1;
    } else if (speedMs > targetSpeed + 1) {
      brake = clamp((speedMs - targetSpeed) / 8, 0.15, 1);
    }

    const handbrake = curvature > 0.7 && Math.abs(steer) > 0.55 && speedMs > 9;

    if (speedMs < 0.8 && throttle > 0) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 2.5) {
        this.stuckTimer = 0;
        this.onStuck(this.racer);
      }
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - dt * 2);
    }

    return {
      throttle,
      brake,
      steer,
      handbrake,
      resetRequested: false,
      cameraToggleRequested: false,
    };
  }
}

export function randomAIPersonality(seed: number): AIPersonality {
  const r = (n: number) => {
    const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  return {
    laneSeed: r(1) * Math.PI * 2,
    laneAmplitude: 1.2 + r(2) * 2.2,
    topSpeedFactor: 0.88 + r(3) * 0.22,
    cornerBravery: 0.35 + r(4) * 0.55,
  };
}
