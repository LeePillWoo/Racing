import type RAPIER from "@dimforge/rapier3d-compat";
import type { TrackPath } from "./TrackPath";
import { barrierSegments } from "./RoadMesh";

export function buildGroundCollider(rapier: typeof RAPIER, world: RAPIER.World, path: TrackPath): void {
  world.createCollider(rapier.ColliderDesc.cuboid(1000, 0.5, 1000).setTranslation(0, -0.5, 0).setFriction(1));
  for (const { a, b } of barrierSegments(path)) {
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    world.createCollider(rapier.ColliderDesc.cuboid(0.21, 0.52, (a.distanceTo(b) + 0.05) / 2)
      .setTranslation((a.x + b.x) / 2, 0.52, (a.z + b.z) / 2)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      .setFriction(0.15).setRestitution(0.05));
  }
}
