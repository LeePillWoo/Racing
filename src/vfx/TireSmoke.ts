import * as THREE from "three";

const VERTEX_SHADER = `
  attribute float size;
  attribute float alpha;
  varying float vAlpha;
  void main() {
    vAlpha = alpha;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    // Perspective size falloff, so puffs shrink with distance like the rest of the scene.
    gl_PointSize = size * (210.0 / -viewPosition.z);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const FRAGMENT_SHADER = `
  uniform sampler2D map;
  uniform vec3 tint;
  varying float vAlpha;
  void main() {
    vec4 texel = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(tint, texel.a * vAlpha);
    if (gl_FragColor.a < 0.01) discard;
  }
`;

/**
 * Pooled tyre smoke for the whole field.
 *
 * Per-particle size needs a custom shader — PointsMaterial only has one size for the whole
 * system — but the simulation stays on the CPU because a few hundred puffs is nothing and it
 * keeps spawning a matter of calling one method.
 */
export class TireSmoke {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  /** Spawn opacity; the fade is computed from this each frame rather than compounding. */
  private readonly baseAlpha: Float32Array;
  private readonly velocities: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private next = 0;

  /** @param texture Soft round sprite for a single puff; supplied by the caller so this class
   * stays free of canvas work and can run headless. */
  constructor(texture: THREE.Texture, private readonly maxParticles = 420) {
    this.positions = new Float32Array(maxParticles * 3);
    this.velocities = new Float32Array(maxParticles * 3);
    this.sizes = new Float32Array(maxParticles);
    this.alphas = new Float32Array(maxParticles);
    this.baseAlpha = new Float32Array(maxParticles);
    this.life = new Float32Array(maxParticles);
    this.maxLife = new Float32Array(maxParticles);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("size", new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute("alpha", new THREE.BufferAttribute(this.alphas, 1));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        tint: { value: new THREE.Color("#d8d2c6") },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.points.name = "tire-smoke";
  }

  /** @param strength 0..1, scaling how big and long-lived the puff is. */
  spawn(x: number, y: number, z: number, strength: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.maxParticles;
    const p = i * 3;
    this.positions[p] = x + (Math.random() - 0.5) * 0.35;
    this.positions[p + 1] = y + 0.1;
    this.positions[p + 2] = z + (Math.random() - 0.5) * 0.35;
    this.velocities[p] = (Math.random() - 0.5) * 1.1;
    this.velocities[p + 1] = 0.7 + Math.random() * 0.9;
    this.velocities[p + 2] = (Math.random() - 0.5) * 1.1;
    this.sizes[i] = 0.45 + strength * 0.55;
    // Deliberately faint: smoke reads as haze when many thin puffs overlap, and as a row of
    // grey blobs when each one is solid enough to see on its own.
    this.baseAlpha[i] = 0.12 + strength * 0.2;
    this.alphas[i] = this.baseAlpha[i];
    this.maxLife[i] = 0.6 + strength * 0.7;
    this.life[i] = this.maxLife[i];
  }

  update(dt: number): void {
    for (let i = 0; i < this.maxParticles; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const p = i * 3;
      if (this.life[i] <= 0) {
        this.alphas[i] = 0;
        continue;
      }
      this.positions[p] += this.velocities[p] * dt;
      this.positions[p + 1] += this.velocities[p + 1] * dt;
      this.positions[p + 2] += this.velocities[p + 2] * dt;
      // Puffs slow as they expand and thin out over their life.
      const drag = Math.exp(-1.6 * dt);
      this.velocities[p] *= drag;
      this.velocities[p + 1] *= drag;
      this.velocities[p + 2] *= drag;
      const remaining = this.life[i] / this.maxLife[i];
      this.sizes[i] += dt * 1.15;
      // Hold full opacity briefly so a puff reads as solid, then fade out over the rest.
      this.alphas[i] = this.baseAlpha[i] * Math.min(1, remaining / 0.75);
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.size.needsUpdate = true;
    this.geometry.attributes.alpha.needsUpdate = true;
  }
}
