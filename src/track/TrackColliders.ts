import type RAPIER from "@dimforge/rapier3d-compat";

/**
 * A single large flat static collider under the whole play area. The track itself has no
 * elevation changes, so one ground plane doubles as both the paved road and the open desert/
 * sand shoulders around it — grip differences between road and sand are purely a driving-feel
 * layer (tire grip curve + visuals), not separate geometry.
 */
export function buildGroundCollider(rapier: typeof RAPIER, world: RAPIER.World): void {
  const bodyDesc = rapier.RigidBodyDesc.fixed();
  const body = world.createRigidBody(bodyDesc);
  const colliderDesc = rapier.ColliderDesc.cuboid(900, 0.5, 900)
    .setTranslation(0, -0.5, 0)
    .setFriction(1.0)
    .setRestitution(0.0);
  world.createCollider(colliderDesc, body);
}
