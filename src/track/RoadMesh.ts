import * as THREE from "three";
import { TrackPath } from "./TrackPath";
import { createAsphaltTexture } from "../utils/Textures";

/** Clearance from the edge of the asphalt to the face of the barrier wall. */
export const BARRIER_GAP = 4.5;
export const BARRIER_STEP = 8;

export function barrierOffset(path: TrackPath): number {
  return path.halfWidth + BARRIER_GAP;
}

/** Shared sampled barrier segments keep visible walls and collision shapes aligned. */
export function barrierSegments(path: TrackPath): { a: THREE.Vector3; b: THREE.Vector3 }[] {
  const result: { a: THREE.Vector3; b: THREE.Vector3 }[] = [];
  const count = Math.ceil(path.totalLength / BARRIER_STEP);
  const offset = barrierOffset(path);
  for (const side of [-1, 1]) {
    for (let i = 0; i < count; i++) {
      const u0 = (i / count) * path.totalLength;
      const u1 = ((i + 1) / count) * path.totalLength;
      const f0 = path.frameAtDistance(u0);
      const f1 = path.frameAtDistance(u1);
      const a = f0.point.addScaledVector(f0.right, side * offset);
      const b = f1.point.addScaledVector(f1.right, side * offset);
      // On a figure-eight the outer wall of one arm runs straight across the other arm's road.
      // Dropping those segments is what keeps the crossing drivable.
      if (path.overlapsRoadElsewhere(a, u0) || path.overlapsRoadElsewhere(b, u1)) continue;
      result.push({ a, b });
    }
  }
  return result;
}

export function buildRoadMesh(path: TrackPath): THREE.Group {
  const theme = path.def.theme;
  const halfWidth = path.halfWidth;
  const group = new THREE.Group();
  group.name = "circuit";
  const count = Math.ceil(path.totalLength / 1.8);

  /**
   * Lays a strip between two lateral offsets along the whole lap. `skipOverlap` drops the quads
   * that would paint kerb over the far side of a crossover.
   */
  function ribbon(left: number, right: number, height: number, material: THREE.Material,
                  striped = false, skipOverlap = false): void {
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [], colors: number[] = [];
    const a = new THREE.Color(theme.kerb[0]), b = new THREE.Color(theme.kerb[1]);
    const clear: boolean[] = [];
    for (let i = 0; i <= count; i++) {
      const u = (i / count) * path.totalLength;
      const frame = path.frameAtDistance(u);
      const y = height + path.surfaceBias(u);
      let blocked = false;
      for (const offset of [left, right]) {
        const p = frame.point.clone().addScaledVector(frame.right, offset);
        positions.push(p.x, y, p.z);
        uvs.push(offset === left ? 0 : 1, u / 8);
        const c = Math.floor(u / 3.5) % 2 === 0 ? a : b;
        colors.push(c.r, c.g, c.b);
        if (skipOverlap && path.overlapsRoadElsewhere(p, u)) blocked = true;
      }
      clear.push(!blocked);
    }
    for (let i = 0; i < count; i++) {
      if (!clear[i] || !clear[i + 1]) continue;
      const v = i * 2;
      indices.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    if (striped) geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  ribbon(-halfWidth, halfWidth, 0.018,
    new THREE.MeshStandardMaterial({ map: createAsphaltTexture(), color: "#ffffff", roughness: 0.98 }));
  const white = new THREE.MeshStandardMaterial({ color: "#f8fbff", roughness: 0.9 });
  const kerb = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  for (const side of [-1, 1]) {
    const edge = side * (halfWidth - 0.14);
    ribbon(edge - 0.09, edge + 0.09, 0.023, white, false, true);
    const a = side * halfWidth, b = side * (halfWidth + 0.85);
    ribbon(Math.min(a, b), Math.max(a, b), 0.03, kerb, true, true);
  }

  function marking(u: number, offset: number, width: number, length: number, material = white): void {
    const f = path.frameAtDistance(u);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, length), material);
    mesh.rotation.set(-Math.PI / 2, 0, 0);
    const holder = new THREE.Group();
    holder.position.copy(f.point).addScaledVector(f.right, offset);
    holder.position.y = 0.028 + path.surfaceBias(u);
    holder.rotation.y = Math.atan2(f.tangent.x, f.tangent.z);
    holder.add(mesh);
    group.add(holder);
  }
  const black = new THREE.MeshStandardMaterial({ color: "#171b22", roughness: 1 });
  const checkerCols = Math.round((halfWidth * 2) / 0.75);
  for (let col = 0; col < checkerCols; col++) for (let row = 0; row < 2; row++) {
    marking(row * 0.75, -halfWidth + (col + 0.5) * 0.75, 0.75, 0.75, (col + row) % 2 ? black : white);
  }
  for (let i = 0; i < 12; i++) {
    const u = -12 - Math.floor(i / 2) * 9 - (i % 2) * 2;
    const side = (i % 2 === 0 ? -1 : 1) * 3.1;
    marking(u + 2.8, side, 2.5, 0.12);
    marking(u + 2.1, side - 1.2, 0.12, 1.4);
    marking(u + 2.1, side + 1.2, 0.12, 1.4);
  }

  // A dashed lane line, merged into one geometry rather than a mesh per dash: a 2 km lap is 150+
  // dashes and each one as its own object would cost more draw calls than the rest of the track.
  if (theme.centerLine) {
    const positions: number[] = [], indices: number[] = [];
    const step = 13, dash = 5.5;
    for (let u = 0; u + dash < path.totalLength; u += step) {
      const f0 = path.frameAtDistance(u), f1 = path.frameAtDistance(u + dash);
      if (path.overlapsRoadElsewhere(f0.point.clone(), u)) continue;
      const v = positions.length / 3;
      for (const [f, uu] of [[f0, u], [f1, u + dash]] as const) {
        const y = 0.026 + path.surfaceBias(uu);
        for (const side of [-1, 1]) {
          const p = f.point.clone().addScaledVector(f.right, side * 0.11);
          positions.push(p.x, y, p.z);
        }
      }
      indices.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    group.add(new THREE.Mesh(geometry, white));
  }

  const segments = barrierSegments(path);
  const wall = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: "#dbe2e7", roughness: 0.85 }), segments.length);
  const base = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: "#1a242c", roughness: 0.85 }), segments.length);
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.055, 2.1, 0.055),
    new THREE.MeshStandardMaterial({ color: "#9caeb7", metalness: 0.5, roughness: 0.5 }), segments.length);
  const wirePositions: number[] = [];
  const dummy = new THREE.Object3D();
  segments.forEach(({ a, b }, i) => {
    dummy.position.copy(a).add(b).multiplyScalar(0.5);
    dummy.position.y = 0.52;
    dummy.rotation.set(0, Math.atan2(b.x - a.x, b.z - a.z), 0);
    dummy.scale.set(0.42, 1.04, a.distanceTo(b) + 0.05);
    dummy.updateMatrix(); wall.setMatrixAt(i, dummy.matrix);
    dummy.position.y = 0.19; dummy.scale.y = 0.38; dummy.scale.x = 0.44; dummy.scale.z += 0.02;
    dummy.updateMatrix(); base.setMatrixAt(i, dummy.matrix);
    dummy.position.copy(a); dummy.position.y = 1.9; dummy.scale.set(1, 1, 1);
    dummy.updateMatrix(); posts.setMatrixAt(i, dummy.matrix);
    if (!theme.catchFence) return;
    for (let y = 1.15; y <= 2.95; y += 0.3) wirePositions.push(a.x, y, a.z, b.x, y, b.z);
    for (let j = 0; j < 8; j++) {
      const p = a.clone().lerp(b, j / 8), q = a.clone().lerp(b, (j + 1) / 8);
      wirePositions.push(p.x, 1.05, p.z, q.x, 2.95, q.z, q.x, 1.05, q.z, p.x, 2.95, p.z);
    }
  });
  wall.receiveShadow = true;
  group.add(wall, base);
  if (theme.catchFence) {
    group.add(posts);
    const wireGeometry = new THREE.BufferGeometry();
    wireGeometry.setAttribute("position", new THREE.Float32BufferAttribute(wirePositions, 3));
    group.add(new THREE.LineSegments(wireGeometry, new THREE.LineBasicMaterial({ color: "#8b9ba1", transparent: true, opacity: 0.3 })));
  }

  // Stacked tyres against the wall: the thing that makes a paddock read as a drift arena.
  if (theme.tyreWallSpacing > 0) {
    const stacks: { x: number; z: number }[] = [];
    const offset = barrierOffset(path) - 1.4;
    for (let u = 0; u < path.totalLength; u += theme.tyreWallSpacing) {
      for (const side of [-1, 1]) {
        const f = path.frameAtDistance(u);
        const p = f.point.addScaledVector(f.right, side * offset);
        if (path.overlapsRoadElsewhere(p, u, 3)) continue;
        stacks.push({ x: p.x, z: p.z });
      }
    }
    const tyres = new THREE.InstancedMesh(new THREE.TorusGeometry(0.42, 0.19, 6, 12),
      new THREE.MeshStandardMaterial({ color: "#1d1f22", roughness: 1 }), stacks.length * 3);
    stacks.forEach((stack, i) => {
      for (let level = 0; level < 3; level++) {
        dummy.position.set(stack.x, 0.2 + level * 0.36, stack.z);
        dummy.rotation.set(-Math.PI / 2, 0, level * 0.7);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        tyres.setMatrixAt(i * 3 + level, dummy.matrix);
      }
    });
    tyres.castShadow = true;
    group.add(tyres);
  }
  return group;
}
