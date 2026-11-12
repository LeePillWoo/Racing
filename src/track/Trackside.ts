import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { TrackPath } from "./TrackPath";
import { groundAt } from "./TrackCatalog";
import { barrierOffset, barrierSegments } from "./RoadMesh";

/** One draw call's worth of a prop: everything in it that shares a material, in metres, standing on the origin. */
export interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

/** The props in `public/models/trackside.glb`, by node name. Sources and licences are in CREDITS.md. */
export type TracksideLibrary = Map<string, Part[]>;

export const CROWD_PALETTE = ["#edf1ea", "#233f67", "#e75555", "#f4c55e", "#558e9e", "#3c3948"];

export async function loadTrackside(): Promise<TracksideLibrary> {
  const gltf = await new GLTFLoader().loadAsync(import.meta.env.BASE_URL + "models/trackside.glb");
  gltf.scene.updateMatrixWorld(true);
  const library: TracksideLibrary = new Map();
  for (const asset of gltf.scene.children) {
    // Bake each mesh's transform into its vertices and weld what shares a material, so a prop is
    // a handful of geometries that can be instanced with nothing but a placement matrix.
    const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
    asset.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
      const list = byMaterial.get(node.material) ?? [];
      list.push(geometry); byMaterial.set(node.material, list);
    });
    library.set(asset.name, [...byMaterial].map(([material, geometries]) => ({
      material, geometry: geometries.length > 1 ? mergeGeometries(geometries)! : geometries[0],
    })));
  }
  // The billboard trees are two crossed quads. Lit by their real normals one quad is in full sun
  // and the other in shade, and the cross shows; pointing every normal up lights both the same.
  for (const name of ["tree-pine", "tree-maple", "tree-crab"]) {
    for (const { geometry, material } of prop(library, name)) {
      const normal = geometry.getAttribute("normal");
      for (let i = 0; i < normal.count; i++) normal.setXYZ(i, 0, 1, 0);
      // Photographed in shade: next to the spruces they come out near black without a lift.
      (material as THREE.MeshStandardMaterial).color.setScalar(1.15);
    }
  }
  return library;
}

export function prop(library: TracksideLibrary, name: string): Part[] {
  const parts = library.get(name);
  if (!parts) throw new Error(`trackside.glb has no "${name}"`);
  return parts;
}

/** Placement for a prop standing upright on flat ground. */
export function pose(x: number, z: number, yaw: number, scale: number | [number, number, number] = 1, y = 0): THREE.Matrix4 {
  const s = typeof scale === "number" ? [scale, scale, scale] : scale;
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), new THREE.Vector3(s[0], s[1], s[2]));
}

/** Yaw that turns a prop's +Z to face along `dir`. */
function yawFacing(dir: THREE.Vector3): number { return Math.atan2(dir.x, dir.z); }
/** Yaw that lays a prop's long (+X) axis along `dir`. */
function yawAlong(dir: THREE.Vector3): number { return Math.atan2(-dir.z, dir.x); }

/**
 * Instanced copies of a prop, cut into runs of 96. An InstancedMesh is culled as a whole, so one
 * mesh holding every barrier on a 2.8 km lap would be drawn in full — twice, with the shadow
 * pass — no matter where the camera looks. Short runs let the far side of the circuit drop out.
 */
export function instances(parts: Part[], poses: THREE.Matrix4[], castShadow = true): THREE.Group {
  const group = new THREE.Group();
  for (let start = 0; start < poses.length; start += 96) {
    const run = poses.slice(start, start + 96);
    for (const { geometry, material } of parts) {
      const mesh = new THREE.InstancedMesh(geometry, material, run.length);
      run.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.castShadow = castShadow; mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  return group;
}

function random(seed: number): () => number {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
}

/** Lays out everything that stands beside the road. Returns where the floodlight lamps ended up. */
export function dressTrackside(scene: THREE.Scene, path: TrackPath, library: TracksideLibrary): THREE.Vector3[] {
  const theme = path.def.theme, wall = barrierOffset(path), length = path.totalLength;
  const rand = random(9001);
  const group = new THREE.Group();
  group.name = "trackside";
  scene.add(group);

  /** Clear of every stretch of road (not just the one it was placed from) and not in a lake. */
  const free = (p: THREE.Vector3, margin: number): boolean =>
    path.projectPoint(p).distance > wall + margin && groundAt(theme, p.x, p.z) !== "water";
  /** How far the road turns over `span` metres centred on `u`; positive turns towards `right`. */
  const turn = (u: number, span: number): number => {
    const a = path.frameAtDistance(u - span / 2), b = path.frameAtDistance(u + span / 2);
    return Math.asin(THREE.MathUtils.clamp(b.tangent.dot(a.right), -1, 1));
  };
  const lapGap = (a: number, b: number): number => {
    const gap = Math.abs(a - b) % length;
    return Math.min(gap, length - gap);
  };

  // Concrete barriers along the same segments the colliders use, squeezed to the collider's depth
  // so a car stops where the concrete appears to be.
  const barrier = prop(library, "barrier");
  const barrierPoses: THREE.Matrix4[] = [];
  for (const { a, b } of barrierSegments(path)) {
    const span = a.distanceTo(b), count = Math.max(1, Math.round(span / 3.9));
    const along = b.clone().sub(a).normalize();
    for (let i = 0; i < count; i++) {
      const p = a.clone().lerp(b, (i + 0.5) / count);
      barrierPoses.push(pose(p.x, p.z, yawAlong(along), [(span / count + 0.04) / 3.77, 1.08, 0.72]));
    }
  }
  group.add(instances(barrier, barrierPoses));

  // Tyre stacks pack the outside of every tight corner, where a car that runs wide ends up.
  const tyrePoses: THREE.Matrix4[] = [];
  for (let u = 0; u < length; u += 1.3) {
    const bend = turn(u, 10);
    if (Math.abs(bend) < 0.12) continue;
    const f = path.frameAtDistance(u);
    const p = f.point.clone().addScaledVector(f.right, -Math.sign(bend) * (wall - 0.62));
    if (path.overlapsRoadElsewhere(p, u, 3)) continue;
    tyrePoses.push(pose(p.x, p.z, rand() * Math.PI * 2, 0.95 + rand() * 0.1));
  }
  group.add(instances(prop(library, "tires"), tyrePoses));

  // Floodlight towers, alternating sides down the lap.
  const lamps: THREE.Vector3[] = [], towerPoses: THREE.Matrix4[] = [];
  for (let u = 35, i = 0; u < length; u += 160, i++) {
    const f = path.frameAtDistance(u), side = i % 2 ? 1 : -1;
    const p = f.point.clone().addScaledVector(f.right, side * (wall + 3.4));
    if (!free(p, 2.4)) continue;
    towerPoses.push(pose(p.x, p.z, yawFacing(f.right.clone().multiplyScalar(-side))));
    lamps.push(new THREE.Vector3(p.x, 9, p.z));
  }
  group.add(instances(prop(library, "tower"), towerPoses));

  // Spectator pods on the straights: three bleachers behind a run of crowd fence, a marquee, a
  // couple of marshal boards and cones. Kept off the grandstands and the pit building.
  const bleacherPoses: THREE.Matrix4[] = [], fencePoses: THREE.Matrix4[] = [], tentPoses: THREE.Matrix4[] = [];
  const boardPoses: THREE.Matrix4[] = [], conePoses: THREE.Matrix4[] = [], seats: THREE.Vector3[] = [];
  const taken = [...theme.grandstands, ...(theme.pitBuilding ? [theme.pitBuilding] : [])];
  for (let u = 100, i = 0; u < length - 60; u += 150, i++) {
    const f = path.frameAtDistance(u), side = i % 2 ? -1 : 1;
    if (Math.abs(turn(u, 36)) > 0.3) continue;
    if (taken.some(t => t.side === side && lapGap(t.u, u) < 62)) continue;
    const out = f.right.clone().multiplyScalar(side), toTrack = out.clone().negate();
    const at = (along: number, depth: number): THREE.Vector3 =>
      f.point.clone().addScaledVector(f.tangent, along).addScaledVector(out, wall + depth);
    if (![-14, 0, 14].every(along => free(at(along, 9), 5))) continue;

    for (const along of [-4.4, 0, 4.4]) {
      const p = at(along, 9);
      const matrix = pose(p.x, p.z, yawFacing(toTrack));
      bleacherPoses.push(matrix);
      // Four benches stepping up and back from the front rail, as measured off the model.
      for (let row = 0; row < 4; row++) for (let seat = -4; seat <= 4; seat++) {
        if (rand() < 0.28) continue;
        seats.push(new THREE.Vector3(seat * 0.45, 0.89 + row * 0.397, 0.59 - row * 0.38).applyMatrix4(matrix));
      }
    }
    for (let along = -8.2; along <= 8.3; along += 2.05) {
      const p = at(along, 5.6);
      fencePoses.push(pose(p.x, p.z, yawAlong(f.tangent)));
    }
    const tent = at(12, 8.5);
    tentPoses.push(pose(tent.x, tent.z, yawFacing(toTrack)));
    for (const along of [-11, -13]) {
      const p = at(along, 5.6);
      boardPoses.push(pose(p.x, p.z, yawAlong(f.tangent)));
    }
    for (const along of [9.6, 11.2, 12.8, 14.4]) {
      const p = at(along, 5.2);
      conePoses.push(pose(p.x, p.z, rand() * Math.PI * 2));
    }
  }
  group.add(instances(prop(library, "bleacher"), bleacherPoses), instances(prop(library, "fence"), fencePoses),
    instances(prop(library, "tent"), tentPoses), instances(prop(library, "hoarding"), boardPoses),
    instances(prop(library, "cone"), conePoses));

  if (seats.length > 0) {
    const crowd = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.16, 0.32, 2, 5),
      new THREE.MeshStandardMaterial({ roughness: 1 }), seats.length);
    const dummy = new THREE.Object3D();
    seats.forEach((seat, i) => {
      dummy.position.copy(seat); dummy.scale.set(1, 0.85 + rand() * 0.35, 1); dummy.updateMatrix();
      crowd.setMatrixAt(i, dummy.matrix);
      crowd.setColorAt(i, new THREE.Color(CROWD_PALETTE[Math.floor(rand() * CROWD_PALETTE.length)]));
    });
    group.add(crowd);
  }
  return lamps;
}
