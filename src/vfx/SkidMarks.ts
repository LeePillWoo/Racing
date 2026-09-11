import * as THREE from "three";

/** Sits just above the road ribbon (0.018) and its painted lines (0.023) to avoid z-fighting. */
const MARK_HEIGHT = 0.038;
/** Minimum travel before a new quad is laid, so a stationary wheel cannot spam degenerate ones. */
const MIN_SEGMENT_LENGTH = 0.22;
/** A wheel that stops slipping for longer than this breaks the ribbon instead of bridging a gap. */
const TRACK_BREAK_SEC = 0.12;

interface Emitter {
  x: number;
  z: number;
  idleTime: number;
  active: boolean;
}

/**
 * Pooled tyre marks for the whole field, drawn as a single mesh.
 *
 * The buffer is a ring: once it is full the oldest quad is overwritten, which bounds both memory
 * and draw cost no matter how long the race runs. Age is kept per quad so marks fade out rather
 * than vanishing the instant they are recycled.
 */
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly ages: Float32Array;
  /** Alpha the quad was laid down with; the fade scales this, never the already-faded value. */
  private readonly baseAlpha: Float32Array;
  private readonly alive: Uint8Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly emitters = new Map<number, Emitter>();
  private next = 0;

  constructor(
    private readonly maxSegments = 900,
    private readonly fadeSeconds = 14
  ) {
    this.positions = new Float32Array(maxSegments * 4 * 3);
    this.colors = new Float32Array(maxSegments * 4 * 4);
    this.ages = new Float32Array(maxSegments);
    this.baseAlpha = new Float32Array(maxSegments);
    this.alive = new Uint8Array(maxSegments);

    const indices = new Uint32Array(maxSegments * 6);
    for (let s = 0; s < maxSegments; s++) {
      const v = s * 4;
      indices.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], s * 6);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 4));
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    // The ring buffer scatters live quads through the array, so the whole range is always drawn;
    // dead quads are collapsed to zero area and simply rasterize nothing.
    this.geometry.setDrawRange(0, maxSegments * 6);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = "skid-marks";
  }

  /**
   * Extends one wheel's track to (x, z).
   *
   * @param key      Stable id for this wheel, so each one keeps its own ribbon.
   * @param strength 0..1 darkness of the mark.
   */
  emit(key: number, x: number, z: number, halfWidth: number, strength: number): void {
    let emitter = this.emitters.get(key);
    if (!emitter) {
      emitter = { x, z, idleTime: 0, active: true };
      this.emitters.set(key, emitter);
      return;
    }
    emitter.idleTime = 0;
    if (!emitter.active) {
      // Restarting after a break: anchor here rather than drawing a quad across the gap.
      emitter.active = true;
      emitter.x = x;
      emitter.z = z;
      return;
    }

    const dx = x - emitter.x;
    const dz = z - emitter.z;
    const length = Math.hypot(dx, dz);
    if (length > 8) { emitter.x = x; emitter.z = z; return; }
    if (length < MIN_SEGMENT_LENGTH) return;

    const nx = (-dz / length) * halfWidth;
    const nz = (dx / length) * halfWidth;
    this.pushQuad(emitter.x, emitter.z, x, z, nx, nz, strength);
    emitter.x = x;
    emitter.z = z;
  }

  breakTrail(key: number): void {
    const emitter = this.emitters.get(key);
    if (emitter) emitter.active = false;
  }

  private pushQuad(
    x0: number, z0: number, x1: number, z1: number,
    nx: number, nz: number, strength: number
  ): void {
    const segment = this.next;
    this.next = (this.next + 1) % this.maxSegments;
    this.ages[segment] = 0;
    this.alive[segment] = 1;

    const p = segment * 12;
    this.positions[p + 0] = x0 - nx; this.positions[p + 1] = MARK_HEIGHT; this.positions[p + 2] = z0 - nz;
    this.positions[p + 3] = x0 + nx; this.positions[p + 4] = MARK_HEIGHT; this.positions[p + 5] = z0 + nz;
    this.positions[p + 6] = x1 - nx; this.positions[p + 7] = MARK_HEIGHT; this.positions[p + 8] = z1 - nz;
    this.positions[p + 9] = x1 + nx; this.positions[p + 10] = MARK_HEIGHT; this.positions[p + 11] = z1 + nz;

    const alpha = 0.28 + strength * 0.5;
    this.baseAlpha[segment] = alpha;
    const c = segment * 16;
    for (let v = 0; v < 4; v++) {
      this.colors[c + v * 4 + 0] = 0.07;
      this.colors[c + v * 4 + 1] = 0.07;
      this.colors[c + v * 4 + 2] = 0.08;
      this.colors[c + v * 4 + 3] = alpha;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }

  update(dt: number): void {
    let touched = false;
    for (const emitter of this.emitters.values()) {
      if (!emitter.active) continue;
      emitter.idleTime += dt;
      if (emitter.idleTime > TRACK_BREAK_SEC) emitter.active = false;
    }
    for (let segment = 0; segment < this.maxSegments; segment++) {
      if (!this.alive[segment]) continue;
      this.ages[segment] += dt;
      const remaining = 1 - this.ages[segment] / this.fadeSeconds;
      const c = segment * 16;
      if (remaining <= 0) {
        this.alive[segment] = 0;
        // Collapse to a degenerate quad so the recycled slot draws nothing until reused.
        this.positions.fill(0, segment * 12, segment * 12 + 12);
        touched = true;
        continue;
      }
      if (remaining < 0.35) {
        const faded = this.baseAlpha[segment] * (remaining / 0.35);
        for (let v = 0; v < 4; v++) this.colors[c + v * 4 + 3] = faded;
        touched = true;
      }
    }
    if (touched) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.color.needsUpdate = true;
    }
  }
}
