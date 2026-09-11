import type RAPIER from "@dimforge/rapier3d-compat";

export interface WallContact {
  /** Unit normal in the XZ plane, pointing away from the wall and back toward the car. */
  normalX: number;
  normalZ: number;
  /** How fast the chassis is closing on the surface, in m/s. Negative means moving away. */
  approachSpeed: number;
}

/**
 * Finds the wall the chassis is currently touching, if any.
 *
 * Only contacts with static geometry count, and only those whose normal is roughly horizontal:
 * that excludes the ground and kerbs the wheels already handle, and leaves car-to-car contact to
 * the solver so two cars cannot trade escalating impulses with each other.
 */
export function findWallContact(
  world: RAPIER.World,
  chassis: RAPIER.Collider,
  body: RAPIER.RigidBody
): WallContact | null {
  const position = body.translation();
  let sumX = 0;
  let sumZ = 0;
  let found = 0;

  world.contactPairsWith(chassis, other => {
    if (other.parent()?.isDynamic()) return;
    world.contactPair(chassis, other, manifold => {
      const normal = manifold.normal();
      if (Math.abs(normal.y) > 0.5) return;
      let x = normal.x;
      let z = normal.z;
      const length = Math.hypot(x, z);
      if (length < 1e-4) return;
      x /= length;
      z /= length;
      // The manifold's winding depends on collider ordering, so re-orient it using the offset
      // from the obstacle to the chassis rather than trusting its sign.
      const obstacle = other.translation();
      if (x * (position.x - obstacle.x) + z * (position.z - obstacle.z) < 0) {
        x = -x;
        z = -z;
      }
      sumX += x;
      sumZ += z;
      found++;
    });
  });

  if (found === 0) return null;
  const length = Math.hypot(sumX, sumZ);
  if (length < 1e-4) return null;
  const normalX = sumX / length;
  const normalZ = sumZ / length;
  const velocity = body.linvel();
  return {
    normalX,
    normalZ,
    approachSpeed: -(velocity.x * normalX + velocity.z * normalZ),
  };
}
