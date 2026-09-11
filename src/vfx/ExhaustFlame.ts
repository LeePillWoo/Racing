import * as THREE from "three";

/** Attached to the exhaust: two additive tapered layers with a hot blue core. */
export class ExhaustFlame {
  readonly root = new THREE.Group();
  private readonly plume = new THREE.Group();
  private time = 0;

  constructor() {
    this.root.name = "exhaust-flame";
    this.root.position.set(0, 0.12, -2.22);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.25, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: "#303440", metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide }));
    pipe.rotation.x = Math.PI / 2;
    this.root.add(pipe, this.plume);
    for (const [radius, length, color, opacity] of [
      [0.28, 2.3, 0xff7020, 0.7], [0.14, 1.25, 0x9eeeff, 0.95],
    ]) {
      const geometry = new THREE.ConeGeometry(radius, length, 12);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, 0, -length / 2 - 0.12);
      const flame = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      }));
      this.plume.add(flame);
    }
    this.plume.visible = false;
  }

  update(dt: number, boosting: boolean): void {
    this.time += dt;
    this.plume.visible = boosting;
    const pulse = 1 + Math.sin(this.time * 79) * 0.16 + Math.sin(this.time * 127) * 0.09;
    this.plume.scale.set(1 / Math.sqrt(pulse), 1 / Math.sqrt(pulse), pulse);
  }
}
