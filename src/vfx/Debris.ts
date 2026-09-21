import * as THREE from "three";

const GRAVITY = 22;
const GROUND_Y = 0.12;
const BOUNCE = 0.32;
const LIFETIME = 11;
const SHRINK_SEC = 0.7;
const MAX_ITEMS = 28;

interface DebrisItem {
  object: THREE.Object3D;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
}

/**
 * Parts that have come off a car: wheels and wings, tumbling away on their own ballistic arc.
 *
 * Deliberately not rigid bodies. Debris only has to look right for a few seconds in the mirror,
 * and giving each piece a Rapier body would put loose colliders on the racing line where they
 * would trip the next car through the corner.
 */
export class Debris {
  readonly group = new THREE.Group();
  private readonly items: DebrisItem[] = [];

  constructor() {
    this.group.name = "debris";
  }

  /**
   * Takes ownership of `object`, which must already be positioned in world space, and throws it
   * clear of a car travelling at `carVelocity`.
   */
  spawn(object: THREE.Object3D, carVelocity: THREE.Vector3, seed: number): void {
    // Deterministic jitter: the same crash looks the same on a replay, and no Math.random().
    const rand = (n: number): number => {
      const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    const velocity = carVelocity.clone().multiplyScalar(0.55);
    velocity.x += (rand(1) - 0.5) * 7;
    velocity.z += (rand(2) - 0.5) * 7;
    velocity.y = 2.5 + rand(3) * 4.5;
    this.group.add(object);
    this.items.push({
      object,
      velocity,
      spin: new THREE.Vector3((rand(4) - 0.5) * 12, (rand(5) - 0.5) * 12, (rand(6) - 0.5) * 12),
      age: 0,
    });
    while (this.items.length > MAX_ITEMS) this.retire(0);
  }

  private retire(index: number): void {
    const [item] = this.items.splice(index, 1);
    this.group.remove(item.object);
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      item.age += dt;
      if (item.age >= LIFETIME) { this.retire(i); continue; }

      item.velocity.y -= GRAVITY * dt;
      item.object.position.addScaledVector(item.velocity, dt);
      if (item.object.position.y <= GROUND_Y && item.velocity.y < 0) {
        item.object.position.y = GROUND_Y;
        item.velocity.y = -item.velocity.y * BOUNCE;
        item.velocity.x *= 0.7;
        item.velocity.z *= 0.7;
        item.spin.multiplyScalar(0.55);
        if (item.velocity.y < 0.6) item.velocity.y = 0;
      }
      item.object.rotateX(item.spin.x * dt);
      item.object.rotateY(item.spin.y * dt);
      item.object.rotateZ(item.spin.z * dt);
      // Shrink out of existence rather than fading: the materials are shared with the car that
      // shed the part, so touching opacity would make the whole car translucent.
      const remaining = LIFETIME - item.age;
      if (remaining < SHRINK_SEC) item.object.scale.setScalar(remaining / SHRINK_SEC);
    }
  }

  get count(): number {
    return this.items.length;
  }

  clear(): void {
    while (this.items.length) this.retire(0);
  }
}
