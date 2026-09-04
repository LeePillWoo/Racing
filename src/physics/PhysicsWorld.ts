import RAPIER from "@dimforge/rapier3d-compat";

let initialized = false;

/** Initializes the Rapier WASM module exactly once and returns the RAPIER namespace. */
export async function loadRapier(): Promise<typeof RAPIER> {
  if (!initialized) {
    await RAPIER.init();
    initialized = true;
  }
  return RAPIER;
}

export class PhysicsWorld {
  readonly RAPIER: typeof RAPIER;
  readonly world: RAPIER.World;
  private accumulator = 0;
  readonly fixedTimeStep = 1 / 120;

  constructor(rapier: typeof RAPIER) {
    this.RAPIER = rapier;
    this.world = new rapier.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = this.fixedTimeStep;
  }

  /** Advances the simulation by whole fixed steps, calling `beforeStep` before each one. */
  step(dt: number, beforeStep: (stepDt: number) => void, maxSubSteps = 8): void {
    this.accumulator += Math.min(dt, 0.25);
    let steps = 0;
    while (this.accumulator >= this.fixedTimeStep && steps < maxSubSteps) {
      beforeStep(this.fixedTimeStep);
      this.world.step();
      this.accumulator -= this.fixedTimeStep;
      steps++;
    }
  }
}
