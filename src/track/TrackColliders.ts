import type RAPIER from "@dimforge/rapier3d-compat";
import type { TrackPath } from "./TrackPath";
import { barrierSegments } from "./RoadMesh";

const BARRIER_FRICTION = 0.04;
/** Low on purpose: Vehicle.applyWallResponse supplies the rebound, this only resolves overlap. */
const BARRIER_RESTITUTION = 0.1;

export function buildGroundCollider(rapier: typeof RAPIER, world: RAPIER.World, path: TrackPath): void {
  world.createCollider(rapier.ColliderDesc.cuboid(1000, 0.5, 1000).setTranslation(0, -0.5, 0).setFriction(1));
  for (const { a, b } of barrierSegments(path)) {
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    world.createCollider(rapier.ColliderDesc.cuboid(0.21, 0.52, (a.distanceTo(b) + 0.05) / 2)
      .setTranslation((a.x + b.x) / 2, 0.52, (a.z + b.z) / 2)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      // Min friction so a glancing hit slides along the wall instead of snagging and ending
      // the lap. The rebound itself is applied in code, not here.
      .setFriction(BARRIER_FRICTION)
      .setFrictionCombineRule(rapier.CoefficientCombineRule.Min)
      .setRestitution(BARRIER_RESTITUTION));
  }
}
