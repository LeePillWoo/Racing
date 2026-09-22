import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { VehicleConfig } from "./VehicleConfig";

/** Which shell goes over the shared chassis. Every style drives identically; only the shape changes. */
export type CarStyle = "formula" | "gt" | "hyper" | "muscle";

export interface CarPaint {
  body: THREE.ColorRepresentation;
  accent: THREE.ColorRepresentation;
}

export interface CarMeshSet {
  root: THREE.Group;
  wheels: THREE.Group[];
  brakeLights: THREE.Mesh[];
  bodyMaterial: THREE.MeshStandardMaterial;
  /**
   * The two aero surfaces, kept as their own sub-groups rather than merged into the body batch so
   * a crash can rip one off. Everything else is welded together and stays with the chassis.
   */
  frontWing: THREE.Group;
  rearWing: THREE.Group;
}

interface Palette {
  body: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  carbon: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
}

interface Shell {
  root: THREE.Group;
  frontWing: THREE.Group;
  rearWing: THREE.Group;
  lamps: THREE.Mesh[];
}

function box(parent: THREE.Object3D, material: THREE.Material, size: number[], position: number[], rounded = false): THREE.Mesh {
  const geometry = rounded
    ? new RoundedBoxGeometry(size[0], size[1], size[2], 2, Math.min(...size) * 0.18)
    : new THREE.BoxGeometry(size[0], size[1], size[2]);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** A box tilted about X, for windscreens and wedge panels. */
function slab(parent: THREE.Object3D, material: THREE.Material, size: number[], position: number[], pitch: number): THREE.Mesh {
  const mesh = box(parent, material, size, position);
  mesh.rotation.x = pitch;
  return mesh;
}

function rod(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material): void {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 8), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  mesh.castShadow = true;
  parent.add(mesh);
}

/** Batch rigid parts by material while retaining independent wheel and brake-light transforms. */
function batchParts(parent: THREE.Group, excluded: ReadonlySet<THREE.Object3D> = new Set()): void {
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const child of [...parent.children]) {
    if (!(child instanceof THREE.Mesh) || excluded.has(child) || Array.isArray(child.material)) continue;
    child.updateMatrix();
    const geometry = (child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone()).applyMatrix4(child.matrix);
    const list = batches.get(child.material) ?? [];
    list.push(geometry); batches.set(child.material, list);
    parent.remove(child);
    child.geometry.dispose();
  }
  for (const [material, parts] of batches) {
    const geometry = mergeGeometries(parts);
    if (!geometry) throw new Error("Unable to batch car geometry");
    parts.forEach(part => part.dispose());
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
  }
}

function buildWheel(config: VehicleConfig, rear: boolean, rimColor: THREE.ColorRepresentation): THREE.Group {
  const root = new THREE.Group();
  const width = config.wheelWidth * (rear ? 1.18 : 1);
  const rubber = new THREE.MeshStandardMaterial({ color: "#202125", roughness: 0.86 });
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(config.wheelRadius, config.wheelRadius, width, 32), rubber);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  root.add(tire);
  const rimMat = new THREE.MeshStandardMaterial({ color: "#42464e", metalness: 0.65, roughness: 0.35 });
  const ringMat = new THREE.MeshStandardMaterial({ color: rimColor, roughness: 0.7 });
  for (const side of [-1, 1]) {
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(config.wheelRadius * 0.54, config.wheelRadius * 0.54, 0.02, 16), rimMat);
    rim.rotation.z = Math.PI / 2;
    rim.position.x = side * (width / 2 + 0.012);
    root.add(rim);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(config.wheelRadius * 0.81, 0.014, 5, 32), ringMat);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = side * (width / 2 + 0.018);
    root.add(ring);
    for (let i = 0; i < 6; i++) {
      const spoke = box(root, rimMat, [0.025, 0.036, config.wheelRadius * 0.8], [side * (width / 2 + 0.025), 0, 0]);
      spoke.rotation.x = i * Math.PI / 3;
    }
  }
  batchParts(root);
  return root;
}

/** Open-wheel single seater: the original car, unchanged. */
function buildFormulaShell(shell: Shell, mat: Palette, config: VehicleConfig): void {
  const { root, frontWing, rearWing } = shell;
  const wheelY = config.connectionPointY - config.suspensionRestLength;
  box(root, mat.carbon, [1.7, 0.075, 3.9], [0, -0.36, -0.12]);
  box(root, mat.body, [0.69, 0.49, 2.7], [0, -0.03, -0.12], true);
  for (const side of [-1, 1]) {
    box(root, mat.body, [0.51, 0.38, 1.75], [side * 0.59, -0.1, -0.55], true);
    box(root, mat.carbon, [0.38, 0.2, 0.025], [side * 0.6, -0.03, 0.34]);
    box(root, mat.accent, [0.065, 0.028, 1.58], [side * 0.67, 0.102, -0.61]);
  }

  const noseGeo = new THREE.CylinderGeometry(0.17, 0.34, 1.9, 4, 1);
  noseGeo.rotateY(Math.PI / 4);
  noseGeo.rotateX(Math.PI / 2);
  const nose = new THREE.Mesh(noseGeo, mat.accent);
  nose.scale.y = 0.62;
  nose.position.set(0, -0.04, 1.2);
  nose.castShadow = true;
  root.add(nose);
  box(root, mat.accent, [0.48, 0.025, 1.5], [0, 0.228, -0.77], true);

  box(root, mat.carbon, [0.48, 0.1, 0.67], [0, 0.245, 0.06], true);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.18, 20, 12), mat.accent);
  helmet.position.set(0, 0.39, 0.06);
  helmet.castShadow = true;
  root.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.184, 16, 8, 0, Math.PI * 2, Math.PI * 0.36, Math.PI * 0.23), mat.carbon);
  visor.position.copy(helmet.position);
  root.add(visor);
  const haloCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.25, 0.39, -0.29), new THREE.Vector3(-0.29, 0.51, 0.06),
    new THREE.Vector3(0, 0.52, 0.48), new THREE.Vector3(0.29, 0.51, 0.06),
    new THREE.Vector3(0.25, 0.39, -0.29),
  ]);
  root.add(new THREE.Mesh(new THREE.TubeGeometry(haloCurve, 20, 0.035, 6, false), mat.metal));
  rod(root, new THREE.Vector3(0, 0.22, 0.58), new THREE.Vector3(0, 0.52, 0.48), 0.03, mat.metal);
  box(root, mat.body, [0.28, 0.58, 0.35], [0, 0.39, -0.61], true);
  box(root, mat.carbon, [0.17, 0.2, 0.028], [0, 0.53, -0.42]);

  box(frontWing, mat.body, [2.48, 0.09, 0.5], [0, -0.29, 2.14]);
  box(frontWing, mat.accent, [2.22, 0.065, 0.18], [0, -0.18, 2.0]);
  for (const side of [-1, 1]) {
    box(frontWing, mat.body, [0.065, 0.26, 0.62], [side * 1.2, -0.18, 2.12]);
    box(root, mat.metal, [0.07, 0.86, 0.15], [side * 0.52, 0.06, -1.9]);
    box(rearWing, mat.body, [0.07, 0.5, 0.67], [side * 1.01, 0.5, -1.92]);
  }
  box(rearWing, mat.body, [2.06, 0.11, 0.57], [0, 0.68, -1.92]);
  box(rearWing, mat.accent, [1.94, 0.05, 0.13], [0, 0.51, -1.75]);
  for (let i = -2; i <= 2; i++) box(root, mat.carbon, [0.055, 0.24, 0.57], [i * 0.24, -0.34, -1.96]);

  for (const side of [-1, 1]) {
    for (const z of [config.wheelBaseFront, config.wheelBaseRear]) {
      for (const anchorZ of [-0.35, 0.35]) {
        rod(root, new THREE.Vector3(side * 0.34, -0.15, z + anchorZ), new THREE.Vector3(side * config.trackHalfWidth, wheelY + 0.05, z), 0.025, mat.metal);
      }
      rod(root, new THREE.Vector3(side * 0.3, 0.09, z - 0.2), new THREE.Vector3(side * config.trackHalfWidth, wheelY + 0.07, z), 0.023, mat.metal);
    }
    box(root, mat.body, [0.17, 0.1, 0.22], [side * 0.54, 0.29, 0.4], true);
  }
  shell.lamps.push(box(root, lampMaterial(), [0.16, 0.14, 0.04], [0, -0.11, -2.26]));
}

/** Closed-cockpit GT racer: fendered, roofed, with a splitter and a swan-neck rear wing. */
function buildGtShell(shell: Shell, mat: Palette, config: VehicleConfig): void {
  const { root, frontWing, rearWing } = shell;
  box(root, mat.carbon, [1.86, 0.09, 4.3], [0, -0.44, -0.05]);
  box(root, mat.body, [1.9, 0.46, 3.95], [0, -0.16, -0.05], true);
  box(root, mat.body, [1.52, 0.44, 1.95], [0, 0.28, -0.42], true);
  box(root, mat.accent, [1.44, 0.07, 1.55], [0, 0.49, -0.48]);
  // Glasshouse: a raked screen, flat side windows and a wrapped rear light bar.
  slab(root, mat.glass, [1.4, 0.52, 0.09], [0, 0.26, 0.56], -0.52);
  for (const side of [-1, 1]) {
    box(root, mat.glass, [0.05, 0.3, 1.5], [side * 0.76, 0.26, -0.42]);
    box(root, mat.body, [0.58, 0.5, 1.3], [side * 0.98, -0.18, config.wheelBaseFront]);
    box(root, mat.body, [0.62, 0.52, 1.35], [side * 1.0, -0.17, config.wheelBaseRear]);
    box(root, mat.carbon, [0.1, 0.24, 1.5], [side * 1.0, -0.32, -0.05]);
    box(root, mat.accent, [0.24, 0.13, 0.05], [side * 0.62, 0.0, 2.02]);
    shell.lamps.push(box(root, lampMaterial(), [0.4, 0.12, 0.05], [side * 0.55, 0.05, -2.14]));
  }
  box(root, mat.accent, [0.46, 0.03, 2.0], [0, 0.09, 0.85]);
  box(root, mat.carbon, [1.1, 0.1, 0.34], [0, -0.06, 2.02]);
  slab(root, mat.body, [1.86, 0.1, 1.05], [0, 0.03, 1.55], 0.16);

  box(frontWing, mat.carbon, [2.1, 0.07, 0.62], [0, -0.46, 2.2]);
  box(frontWing, mat.accent, [1.98, 0.05, 0.17], [0, -0.41, 2.4]);
  for (const side of [-1, 1]) {
    box(frontWing, mat.carbon, [0.06, 0.2, 0.62], [side * 1.02, -0.36, 2.2]);
    box(root, mat.metal, [0.07, 0.5, 0.12], [side * 0.74, 0.4, -1.98]);
    box(rearWing, mat.carbon, [0.07, 0.34, 0.56], [side * 0.96, 0.66, -2.02]);
  }
  box(rearWing, mat.body, [1.96, 0.09, 0.56], [0, 0.72, -2.02]);
  box(rearWing, mat.accent, [1.8, 0.04, 0.14], [0, 0.66, -1.85]);
  for (let i = -2; i <= 2; i++) box(root, mat.carbon, [0.06, 0.22, 0.5], [i * 0.3, -0.42, -2.12]);
}

/** Low mid-engined hypercar: a wedge with a canopy and an oversized swan wing. */
function buildHyperShell(shell: Shell, mat: Palette, config: VehicleConfig): void {
  const { root, frontWing, rearWing } = shell;
  box(root, mat.carbon, [1.8, 0.08, 4.35], [0, -0.46, -0.05]);
  box(root, mat.body, [1.84, 0.4, 4.05], [0, -0.24, -0.1], true);
  slab(root, mat.body, [1.7, 0.1, 1.9], [0, -0.02, 1.15], 0.2);
  box(root, mat.body, [1.34, 0.3, 1.5], [0, 0.11, -0.35], true);
  slab(root, mat.glass, [1.2, 0.46, 0.08], [0, 0.12, 0.42], -0.66);
  box(root, mat.glass, [1.0, 0.06, 1.15], [0, 0.27, -0.28]);
  box(root, mat.accent, [0.34, 0.03, 2.4], [0, 0.0, 0.7]);
  for (const side of [-1, 1]) {
    box(root, mat.body, [0.5, 0.42, 1.2], [side * 0.98, -0.24, config.wheelBaseFront]);
    box(root, mat.body, [0.56, 0.48, 1.3], [side * 1.0, -0.2, config.wheelBaseRear]);
    box(root, mat.carbon, [0.14, 0.26, 1.0], [side * 0.92, -0.2, -0.45]);
    box(root, mat.accent, [0.3, 0.09, 0.05], [side * 0.6, -0.1, 2.0]);
    shell.lamps.push(box(root, lampMaterial(), [0.46, 0.09, 0.05], [side * 0.52, -0.02, -2.1]));
    box(root, mat.metal, [0.09, 0.62, 0.13], [side * 0.7, 0.3, -1.94]);
    box(rearWing, mat.carbon, [0.08, 0.42, 0.6], [side * 1.0, 0.72, -1.98]);
  }
  // Engine bay louvres, which is where a mid-engined car shows its hardware.
  for (let i = -1; i <= 1; i++) box(root, mat.carbon, [1.1, 0.03, 0.12], [0, 0.03 + i * 0.05, -1.1 + i * 0.22]);

  box(frontWing, mat.carbon, [2.16, 0.06, 0.7], [0, -0.48, 2.22]);
  box(frontWing, mat.accent, [2.0, 0.05, 0.15], [0, -0.43, 2.44]);
  for (const side of [-1, 1]) box(frontWing, mat.carbon, [0.06, 0.22, 0.7], [side * 1.05, -0.38, 2.22]);
  box(rearWing, mat.body, [2.0, 0.08, 0.62], [0, 0.82, -1.98]);
  box(rearWing, mat.accent, [1.86, 0.04, 0.15], [0, 0.76, -1.78]);
}

/** Front-engined muscle car: tall, square, with a blown hood scoop and a duckbill spoiler. */
function buildMuscleShell(shell: Shell, mat: Palette, config: VehicleConfig): void {
  const { root, frontWing, rearWing } = shell;
  box(root, mat.carbon, [1.86, 0.1, 4.2], [0, -0.42, -0.05]);
  box(root, mat.body, [1.9, 0.58, 4.0], [0, -0.06, -0.05], true);
  box(root, mat.body, [1.56, 0.5, 1.7], [0, 0.44, -0.55], true);
  box(root, mat.carbon, [1.5, 0.06, 1.6], [0, 0.69, -0.58]);
  slab(root, mat.glass, [1.42, 0.5, 0.08], [0, 0.44, 0.33], -0.42);
  slab(root, mat.glass, [1.42, 0.44, 0.08], [0, 0.44, -1.42], 0.46);
  for (const side of [-1, 1]) {
    box(root, mat.glass, [0.05, 0.34, 1.3], [side * 0.78, 0.44, -0.55]);
    box(root, mat.body, [0.6, 0.62, 1.3], [side * 0.99, -0.08, config.wheelBaseFront]);
    box(root, mat.body, [0.64, 0.66, 1.4], [side * 1.0, -0.06, config.wheelBaseRear]);
    box(root, mat.accent, [0.26, 0.15, 0.06], [side * 0.6, 0.06, 2.04]);
    shell.lamps.push(box(root, lampMaterial(), [0.44, 0.15, 0.05], [side * 0.56, 0.08, -2.16]));
    // Side pipes, the loudest thing on the car.
    rod(root, new THREE.Vector3(side * 0.98, -0.3, 1.1), new THREE.Vector3(side * 1.02, -0.3, -1.5), 0.075, mat.metal);
  }
  // Blown engine standing proud of the bonnet, with velocity stacks.
  box(root, mat.carbon, [0.86, 0.34, 0.9], [0, 0.42, 1.12]);
  box(root, mat.metal, [0.7, 0.16, 0.7], [0, 0.66, 1.12]);
  for (const x of [-0.22, 0, 0.22]) for (const z of [0.92, 1.32]) {
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.2, 10), mat.metal);
    stack.position.set(x, 0.82, z);
    stack.castShadow = true;
    root.add(stack);
  }
  box(root, mat.accent, [1.6, 0.03, 0.4], [0, 0.24, 1.86]);

  box(frontWing, mat.carbon, [2.04, 0.08, 0.5], [0, -0.42, 2.18]);
  box(frontWing, mat.accent, [1.9, 0.06, 0.14], [0, -0.36, 2.36]);
  for (const side of [-1, 1]) box(frontWing, mat.carbon, [0.07, 0.24, 0.5], [side * 0.99, -0.32, 2.18]);
  box(rearWing, mat.body, [1.88, 0.1, 0.46], [0, 0.34, -2.04]);
  for (const side of [-1, 1]) box(rearWing, mat.body, [0.1, 0.24, 0.42], [side * 0.9, 0.21, -2.02]);
}

function lampMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: "#e52e3a", emissive: "#ff1010", emissiveIntensity: 0.15 });
}

const SHELLS: Record<CarStyle, (shell: Shell, mat: Palette, config: VehicleConfig) => void> = {
  formula: buildFormulaShell,
  gt: buildGtShell,
  hyper: buildHyperShell,
  muscle: buildMuscleShell,
};

/** Z-forward racer; suspension and tire locations match the physics chassis whatever the shell. */
export function buildCarMesh(config: VehicleConfig, paint: CarPaint, style: CarStyle = "formula"): CarMeshSet {
  const root = new THREE.Group();
  root.name = "racer-" + style;
  const mat: Palette = {
    body: new THREE.MeshStandardMaterial({ color: paint.body, roughness: 0.34, metalness: 0.24 }),
    accent: new THREE.MeshStandardMaterial({ color: paint.accent, roughness: 0.38, metalness: 0.12 }),
    carbon: new THREE.MeshStandardMaterial({ color: "#171c25", roughness: 0.68, metalness: 0.15 }),
    metal: new THREE.MeshStandardMaterial({ color: "#527a99", roughness: 0.4, metalness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ color: "#20303f", roughness: 0.16, metalness: 0.5 }),
  };
  const frontWing = new THREE.Group();
  frontWing.name = "front-wing";
  const rearWing = new THREE.Group();
  rearWing.name = "rear-wing";
  root.add(frontWing, rearWing);
  const shell: Shell = { root, frontWing, rearWing, lamps: [] };
  SHELLS[style](shell, mat, config);
  batchParts(frontWing);
  batchParts(rearWing);

  const wheelY = config.connectionPointY - config.suspensionRestLength;
  const wheels = Array.from({ length: 4 }, (_, i) => {
    const wheel = buildWheel(config, i >= 2, paint.accent);
    wheel.position.set((i % 2 === 0 ? -1 : 1) * config.trackHalfWidth, wheelY, i < 2 ? config.wheelBaseFront : config.wheelBaseRear);
    root.add(wheel);
    return wheel;
  });
  batchParts(root, new Set(shell.lamps));
  return { root, wheels, brakeLights: shell.lamps, bodyMaterial: mat.body, frontWing, rearWing };
}
