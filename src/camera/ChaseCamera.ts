import * as THREE from "three";
import { Vehicle } from "../vehicle/Vehicle";
import { clamp, damp, lerp } from "../utils/MathUtils";

/** Smoothed third-person chase camera with speed-reactive FOV/distance and drift-aware framing. */
export class ChaseCamera {
  private readonly position = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly followDir = new THREE.Vector3(0, 0, 1);
  private shakeTime = 0;
  private shakeStrength = 0;
  private initialized = false;
  private farView = false;

  toggleFarView(): void {
    this.farView = !this.farView;
  }

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  snapTo(vehicle: Vehicle): void {
    const pos = vehicle.position();
    const forward = vehicle.forwardVector();
    this.followDir.copy(forward);
    this.position.copy(pos).addScaledVector(forward, -8.4).add(new THREE.Vector3(0, 3.1, 0));
    this.lookAt.copy(pos).addScaledVector(forward, 9).add(new THREE.Vector3(0, 0.35, 0));
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookAt);
    this.initialized = true;
  }

  triggerImpactShake(strength: number): void {
    this.shakeStrength = Math.max(this.shakeStrength, strength);
    this.shakeTime = 0.35;
  }

  update(dt: number, vehicle: Vehicle): void {
    const pos = vehicle.position();
    const forward = vehicle.forwardVector();
    const velocity = vehicle.linearVelocity();
    const speedMs = velocity.length();
    const speedFactor = clamp(speedMs / 42, 0, 1);

    let desiredDir = forward.clone();
    if (speedMs > 2.2) {
      const velDir = velocity.clone().normalize();
      const blend = vehicle.telemetry.isDrifting ? 0.5 : 0.12;
      desiredDir.lerp(velDir, blend);
      if (desiredDir.lengthSq() > 1e-6) desiredDir.normalize();
      else desiredDir.copy(forward);
    }

    if (!this.initialized) {
      this.snapTo(vehicle);
      return;
    }

    this.followDir.lerp(desiredDir, 1 - Math.exp(-6.5 * dt)).normalize();

    const farMul = this.farView ? 1.6 : 1;
    const distance = lerp(8.4, 9.1, speedFactor) * farMul;
    const height = lerp(3.1, 3.3, speedFactor) * farMul;
    const desiredPos = pos
      .clone()
      .addScaledVector(this.followDir, -distance)
      .add(new THREE.Vector3(0, height, 0));

    this.position.x = damp(this.position.x, desiredPos.x, 10, dt);
    this.position.y = damp(this.position.y, desiredPos.y, 8, dt);
    this.position.z = damp(this.position.z, desiredPos.z, 10, dt);

    const desiredLookAt = pos.clone().addScaledVector(forward, 9).add(new THREE.Vector3(0, 0.35, 0));
    this.lookAt.x = damp(this.lookAt.x, desiredLookAt.x, 12, dt);
    this.lookAt.y = damp(this.lookAt.y, desiredLookAt.y, 12, dt);
    this.lookAt.z = damp(this.lookAt.z, desiredLookAt.z, 12, dt);

    let renderPos = this.position;
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      const s = this.shakeStrength * (this.shakeTime / 0.35);
      renderPos = this.position.clone().add(
        new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s)
      );
      if (this.shakeTime === 0) this.shakeStrength = 0;
    }

    this.camera.position.copy(renderPos);
    this.camera.lookAt(this.lookAt);

    const targetFov = lerp(56, 64, Math.pow(speedFactor, 0.85));
    this.camera.fov = damp(this.camera.fov, targetFov, 3, dt);
    this.camera.updateProjectionMatrix();
  }
}
