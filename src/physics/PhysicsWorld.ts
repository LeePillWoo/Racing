import RAPIER from "@dimforge/rapier3d-compat";

let initialization: Promise<void> | undefined;
export async function loadRapier(): Promise<typeof RAPIER> {
  initialization ??= RAPIER.init();
  await initialization;
  return RAPIER;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  private accumulator = 0;
  readonly fixedTimeStep = 1 / 120;

  constructor(rapier: typeof RAPIER) {
    this.world = new rapier.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = this.fixedTimeStep;
  }

  /** Bound catch-up work and return actual simulated time for the race clock. */
  step(dt: number, beforeStep: (stepDt: number) => void, maxSubSteps = 8): number {
    this.accumulator = Math.min(this.accumulator + Math.max(0, dt), this.fixedTimeStep * maxSubSteps);
    let steps = 0;
    while (this.accumulator + 1e-10 >= this.fixedTimeStep && steps < maxSubSteps) {
      beforeStep(this.fixedTimeStep);
      this.world.step();
      this.accumulator = Math.max(0, this.accumulator - this.fixedTimeStep);
      steps++;
    }
    return steps * this.fixedTimeStep;
  }
}
