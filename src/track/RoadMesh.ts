import * as THREE from "three";
import { ROAD_HALF_WIDTH, TrackPath } from "./TrackPath";
import { createAsphaltTexture } from "../utils/Textures";

export const BARRIER_OFFSET = ROAD_HALF_WIDTH + 4.5;
export const BARRIER_STEP = 8;

/** Shared sampled barrier segments keep visible walls and collision shapes aligned. */
export function barrierSegments(path: TrackPath): { a: THREE.Vector3; b: THREE.Vector3 }[] {
  const result: { a: THREE.Vector3; b: THREE.Vector3 }[] = [];
  const count = Math.ceil(path.totalLength / BARRIER_STEP);
  for (const side of [-1, 1]) {
    for (let i = 0; i < count; i++) {
      const f0 = path.frameAtDistance(i / count * path.totalLength);
      const f1 = path.frameAtDistance((i + 1) / count * path.totalLength);
      result.push({
        a: f0.point.addScaledVector(f0.right, side * BARRIER_OFFSET),
        b: f1.point.addScaledVector(f1.right, side * BARRIER_OFFSET),
      });
    }
  }
  return result;
}

export function buildRoadMesh(path: TrackPath): THREE.Group {
  const group = new THREE.Group();
  group.name = "circuit";
  const count = Math.ceil(path.totalLength / 1.8);

  function ribbon(left: number, right: number, height: number, material: THREE.Material, striped = false): void {
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [], colors: number[] = [];
    const red = new THREE.Color("#e33740"), white = new THREE.Color("#f6f8fa");
    for (let i = 0; i <= count; i++) {
      const u = i / count * path.totalLength;
      const frame = path.frameAtDistance(u);
      for (const offset of [left, right]) {
        const p = frame.point.clone().addScaledVector(frame.right, offset);
        positions.push(p.x, height, p.z);
        uvs.push(offset === left ? 0 : 1, u / 8);
        const c = Math.floor(u / 3.5) % 2 === 0 ? red : white;
        colors.push(c.r, c.g, c.b);
      }
      if (i < count) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
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
  ribbon(-ROAD_HALF_WIDTH, ROAD_HALF_WIDTH, 0.018,
    new THREE.MeshStandardMaterial({ map: createAsphaltTexture(), color: "#ffffff", roughness: 0.98 }));
  const white = new THREE.MeshStandardMaterial({ color: "#f8fbff", roughness: 0.9 });
  const curb = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  for (const side of [-1, 1]) {
    const edge = side * (ROAD_HALF_WIDTH - 0.14);
    ribbon(edge - 0.09, edge + 0.09, 0.023, white);
    const a = side * ROAD_HALF_WIDTH, b = side * (ROAD_HALF_WIDTH + 0.85);
    ribbon(Math.min(a, b), Math.max(a, b), 0.03, curb, true);
  }

  function marking(u: number, offset: number, width: number, length: number, material = white): void {
    const f = path.frameAtDistance(u);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, length), material);
    mesh.rotation.set(-Math.PI / 2, 0, 0);
    const holder = new THREE.Group();
    holder.position.copy(f.point).addScaledVector(f.right, offset);
    holder.position.y = 0.028;
    holder.rotation.y = Math.atan2(f.tangent.x, f.tangent.z);
    holder.add(mesh);
    group.add(holder);
  }
  const black = new THREE.MeshStandardMaterial({ color: "#171b22", roughness: 1 });
  for (let col = 0; col < 24; col++) for (let row = 0; row < 2; row++) {
    marking(row * 0.75, -ROAD_HALF_WIDTH + (col + 0.5) * 0.75, 0.75, 0.75, (col + row) % 2 ? black : white);
  }
  for (let i = 0; i < 12; i++) {
    const u = -12 - Math.floor(i / 2) * 9 - (i % 2) * 2;
    const side = (i % 2 === 0 ? -1 : 1) * 3.1;
    marking(u + 2.8, side, 2.5, 0.12);
    marking(u + 2.1, side - 1.2, 0.12, 1.4);
    marking(u + 2.1, side + 1.2, 0.12, 1.4);
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
    for (let y = 1.15; y <= 2.95; y += 0.3) wirePositions.push(a.x, y, a.z, b.x, y, b.z);
    for (let j = 0; j < 8; j++) {
      const p = a.clone().lerp(b, j / 8), q = a.clone().lerp(b, (j + 1) / 8);
      wirePositions.push(p.x, 1.05, p.z, q.x, 2.95, q.z, q.x, 1.05, q.z, p.x, 2.95, p.z);
    }
  });
  wall.receiveShadow = true;
  group.add(wall, base, posts);
  const wireGeometry = new THREE.BufferGeometry();
  wireGeometry.setAttribute("position", new THREE.Float32BufferAttribute(wirePositions, 3));
  group.add(new THREE.LineSegments(wireGeometry, new THREE.LineBasicMaterial({ color: "#8b9ba1", transparent: true, opacity: 0.3 })));
  return group;
}
