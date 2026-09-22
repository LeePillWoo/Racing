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

/**
 * One material per surface *kind*, not per part.
 *
 * The split is what sells the car: sprayed panels are a clearcoat over colour and pick up the sky,
 * while rubber, carbon and moulded trim are rough and reflect nothing. Keeping the list this short
 * matters too — parts are batched by material, so every extra material is another draw call on
 * every one of the twelve cars.
 */
interface Palette {
  /** Sprayed bodywork: glossy, lacquered, reflective. */
  paint: THREE.MeshPhysicalMaterial;
  /** Second livery colour, same lacquer. */
  accent: THREE.MeshPhysicalMaterial;
  /** Bare carbon and moulded plastic: matte, no highlight to speak of. */
  carbon: THREE.MeshStandardMaterial;
  /** Rubber. The most matte thing on the car. */
  rubber: THREE.MeshStandardMaterial;
  /** Machined suspension and brackets. */
  metal: THREE.MeshStandardMaterial;
  /** Polished bumpers, pipes and stacks. */
  chrome: THREE.MeshStandardMaterial;
  /** Dark glass, near mirror. */
  glass: THREE.MeshStandardMaterial;
}

interface Shell {
  root: THREE.Group;
  frontWing: THREE.Group;
  rearWing: THREE.Group;
  lamps: THREE.Mesh[];
}

function box(parent: THREE.Object3D, material: THREE.Material, size: number[], position: number[], rounded = false): THREE.Mesh {
  // A generous bevel is not decoration here: a sharp box mirrors one flat colour per face, while
  // a rounded edge sweeps the whole reflection across itself and is what makes paint look wet.
  const geometry = rounded
    ? new RoundedBoxGeometry(size[0], size[1], size[2], 3, Math.min(...size) * 0.32)
    : new THREE.BoxGeometry(size[0], size[1], size[2]);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** A box tilted about X, for windscreens, canards and wedge panels. */
function slab(parent: THREE.Object3D, material: THREE.Material, size: number[], position: number[], pitch: number, roll = 0): THREE.Mesh {
  const mesh = box(parent, material, size, position);
  mesh.rotation.set(pitch, 0, roll);
  return mesh;
}

function tube(parent: THREE.Object3D, material: THREE.Material, radius: number, length: number, position: number[], axis: "x" | "y" | "z", segments = 10): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, segments), material);
  if (axis === "x") mesh.rotation.z = Math.PI / 2;
  if (axis === "z") mesh.rotation.x = Math.PI / 2;
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function rod(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material): void {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 8), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  mesh.castShadow = true;
  parent.add(mesh);
}

/** Wing-mirror on a stalk, which every car that is not a single seater wants. */
function mirror(parent: THREE.Object3D, mat: Palette, x: number, y: number, z: number): void {
  rod(parent, new THREE.Vector3(x * 0.72, y, z), new THREE.Vector3(x, y + 0.05, z - 0.04), 0.022, mat.metal);
  box(parent, mat.paint, [0.17, 0.11, 0.07], [x, y + 0.07, z - 0.04], true);
  box(parent, mat.glass, [0.13, 0.08, 0.015], [x, y + 0.07, z - 0.08]);
}

/** Louvred vent: a run of thin slats, the cheapest detail that reads as a real panel. */
function louvres(parent: THREE.Object3D, material: THREE.Material, count: number, size: number[], position: number[], step: number, pitch = -0.35): void {
  for (let i = 0; i < count; i++) {
    slab(parent, material, size, [position[0], position[1] + i * step * 0.24, position[2] + i * step], pitch);
  }
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

/** Grooved slick on a machined rim, with a drilled disc and a caliper behind the spokes. */
function buildWheel(config: VehicleConfig, rear: boolean, mat: Palette): THREE.Group {
  const root = new THREE.Group();
  const width = config.wheelWidth * (rear ? 1.18 : 1);
  const radius = config.wheelRadius;
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 32), mat.rubber);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  root.add(tire);
  // Shoulder blocks share the tyre material rather than getting their own: each wheel is batched
  // on its own so it can steer and spin, so a material used here costs four draw calls per car.
  for (let i = 0; i < 18; i++) {
    const block = box(root, mat.rubber, [width * 0.94, 0.03, 0.09], [0, 0, 0]);
    block.position.set(0, Math.cos((i / 18) * Math.PI * 2) * radius * 0.99, Math.sin((i / 18) * Math.PI * 2) * radius * 0.99);
    block.rotation.x = -(i / 18) * Math.PI * 2;
  }
  const disc = tube(root, mat.metal, radius * 0.66, width * 0.16, [0, 0, 0], "x", 24);
  disc.receiveShadow = true;
  box(root, mat.accent, [width * 0.3, 0.2, 0.34], [0, radius * 0.5, -0.06]);
  for (const side of [-1, 1]) {
    const face = tube(root, mat.metal, radius * 0.56, 0.03, [side * (width / 2 + 0.012), 0, 0], "x", 18);
    face.castShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.81, 0.016, 6, 32), mat.accent);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = side * (width / 2 + 0.018);
    root.add(ring);
    const nut = tube(root, mat.metal, 0.055, 0.05, [side * (width / 2 + 0.03), 0, 0], "x", 8);
    nut.castShadow = true;
    for (let i = 0; i < 10; i++) {
      const spoke = box(root, mat.metal, [0.022, 0.05, radius * 0.78], [side * (width / 2 + 0.026), 0, 0]);
      spoke.rotation.x = (i * Math.PI) / 5;
    }
  }
  batchParts(root);
  return root;
}

/** Open-wheel single seater: bargeboards, halo, multi-element wings and exposed suspension. */
function buildFormulaShell(shell: Shell, mat: Palette, config: VehicleConfig): void {
  const { root, frontWing, rearWing } = shell;
  const wheelY = config.connectionPointY - config.suspensionRestLength;
  box(root, mat.carbon, [1.7, 0.075, 3.9], [0, -0.36, -0.12]);
  box(root, mat.paint, [0.69, 0.49, 2.7], [0, -0.03, -0.12], true);
  for (const side of [-1, 1]) {
    box(root, mat.paint, [0.51, 0.38, 1.75], [side * 0.59, -0.1, -0.55], true);
    box(root, mat.carbon, [0.38, 0.2, 0.025], [side * 0.6, -0.03, 0.34]);
    box(root, mat.accent, [0.065, 0.028, 1.58], [side * 0.67, 0.102, -0.61]);
    // Bargeboards and floor edge, the busiest part of a modern car.
    slab(root, mat.carbon, [0.03, 0.26, 0.62], [side * 0.72, -0.16, 0.62], 0, side * 0.22);
    slab(root, mat.carbon, [0.03, 0.2, 0.5], [side * 0.82, -0.2, 0.34], 0, side * 0.3);
    box(root, mat.carbon, [0.24, 0.02, 1.9], [side * 0.74, -0.33, -0.5]);
    for (let i = 0; i < 3; i++) box(root, mat.carbon, [0.02, 0.12, 0.3], [side * 0.86, -0.27, -0.2 - i * 0.42]);
    // Sidepod inlet and its cooling louvres.
    box(root, mat.carbon, [0.3, 0.26, 0.05], [side * 0.59, -0.08, 0.44]);
    louvres(root, mat.carbon, 4, [0.3, 0.015, 0.1], [side * 0.6, 0.02, -0.9], 0.13);
    rod(root, new THREE.Vector3(side * 0.2, 0.2, -1.5), new THREE.Vector3(side * 0.5, 0.06, -1.86), 0.02, mat.metal);
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
  // Engine cover spine and shark fin.
  box(root, mat.paint, [0.1, 0.24, 1.25], [0, 0.3, -1.2], true);
  box(root, mat.accent, [0.03, 0.3, 0.9], [0, 0.46, -1.4]);

  box(root, mat.carbon, [0.48, 0.1, 0.67], [0, 0.245, 0.06], true);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.18, 20, 12), mat.accent);
  helmet.position.set(0, 0.39, 0.06);
  helmet.castShadow = true;
  root.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.184, 16, 8, 0, Math.PI * 2, Math.PI * 0.36, Math.PI * 0.23), mat.glass);
  visor.position.copy(helmet.position);
  root.add(visor);
  const haloCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.25, 0.39, -0.29), new THREE.Vector3(-0.29, 0.51, 0.06),
    new THREE.Vector3(0, 0.52, 0.48), new THREE.Vector3(0.29, 0.51, 0.06),
    new THREE.Vector3(0.25, 0.39, -0.29),
  ]);
  root.add(new THREE.Mesh(new THREE.TubeGeometry(haloCurve, 24, 0.035, 8, false), mat.metal));
  rod(root, new THREE.Vector3(0, 0.22, 0.58), new THREE.Vector3(0, 0.52, 0.48), 0.03, mat.metal);
  box(root, mat.paint, [0.28, 0.58, 0.35], [0, 0.39, -0.61], true);
  box(root, mat.carbon, [0.17, 0.2, 0.028], [0, 0.53, -0.42]);
  tube(root, mat.chrome, 0.05, 0.22, [0, 0.62, -0.5], "y", 8);      // roll hoop camera
  tube(root, mat.chrome, 0.085, 0.3, [0, 0.1, -2.12], "z", 10);     // exhaust

  // Two-element front wing with endplates and turning vanes.
  box(frontWing, mat.paint, [2.48, 0.09, 0.5], [0, -0.29, 2.14]);
  box(frontWing, mat.accent, [2.22, 0.065, 0.18], [0, -0.18, 2.0]);
  slab(frontWing, mat.carbon, [2.3, 0.03, 0.22], [0, -0.21, 2.32], -0.3);
  for (const side of [-1, 1]) {
    box(frontWing, mat.paint, [0.065, 0.26, 0.62], [side * 1.2, -0.18, 2.12]);
    slab(frontWing, mat.carbon, [0.04, 0.12, 0.36], [side * 1.12, -0.08, 2.02], 0, side * 0.5);
    box(root, mat.metal, [0.07, 0.86, 0.15], [side * 0.52, 0.06, -1.9]);
    box(rearWing, mat.paint, [0.07, 0.5, 0.67], [side * 1.01, 0.5, -1.92]);
  }
  box(rearWing, mat.paint, [2.06, 0.11, 0.57], [0, 0.68, -1.92]);
  box(rearWing, mat.accent, [1.94, 0.05, 0.13], [0, 0.51, -1.75]);
  slab(rearWing, mat.carbon, [1.9, 0.03, 0.2], [0, 0.78, -2.1], 0.4);
  for (let i = -2; i <= 2; i++) box(root, mat.carbon, [0.055, 0.24, 0.57], [i * 0.24, -0.34, -1.96]);

  for (const side of [-1, 1]) {
    for (const z of [config.wheelBaseFront, config.wheelBaseRear]) {
      for (const anchorZ of [-0.35, 0.35]) {
        rod(root, new THREE.Vector3(side * 0.34, -0.15, z + anchorZ), new THREE.Vector3(side * config.trackHalfWidth, wheelY + 0.05, z), 0.025, mat.metal);
      }
      rod(root, new THREE.Vector3(side * 0.3, 0.09, z - 0.2), new THREE.Vector3(side * config.trackHalfWidth, wheelY + 0.07, z), 0.023, mat.metal);
      rod(root, new THREE.Vector3(side * 0.3, -0.02, z + 0.02), new THREE.Vector3(side * config.trackHalfWidth, wheelY + 0.26, z), 0.02, mat.metal);
    }
    box(root, mat.paint, [0.17, 0.1, 0.22], [side * 0.54, 0.29, 0.4], true);
  }
  shell.lamps.push(box(root, lampMaterial(), [0.16, 0.14, 0.04], [0, -0.11, -2.26]));
}

/** Closed-cockpit GT racer: fendered, roofed, vented, with a splitter and a swan-neck wing. */
function buildGtShell(shell: Shell, mat: Palette, config: VehicleConfig): void {
  const { root, frontWing, rearWing } = shell;
  box(root, mat.carbon, [1.86, 0.09, 4.3], [0, -0.44, -0.05]);
  box(root, mat.paint, [1.9, 0.46, 3.95], [0, -0.16, -0.05], true);
  box(root, mat.paint, [1.52, 0.44, 1.95], [0, 0.28, -0.42], true);
  box(root, mat.accent, [1.44, 0.07, 1.55], [0, 0.49, -0.48]);
  box(root, mat.carbon, [0.5, 0.06, 0.58], [0, 0.53, -0.1]);              // roof scoop
  box(root, mat.carbon, [0.34, 0.1, 0.4], [0, 0.56, 0.12]);
  slab(root, mat.glass, [1.4, 0.52, 0.09], [0, 0.26, 0.56], -0.52);
  slab(root, mat.glass, [1.36, 0.46, 0.08], [0, 0.26, -1.36], 0.48);      // rear screen
  for (const side of [-1, 1]) {
    box(root, mat.glass, [0.05, 0.3, 1.5], [side * 0.76, 0.26, -0.42]);
    box(root, mat.paint, [0.58, 0.5, 1.3], [side * 0.98, -0.18, config.wheelBaseFront]);
    box(root, mat.paint, [0.62, 0.52, 1.35], [side * 1.0, -0.17, config.wheelBaseRear]);
    box(root, mat.carbon, [0.1, 0.24, 1.5], [side * 1.0, -0.32, -0.05]);
    box(root, mat.accent, [0.24, 0.13, 0.05], [side * 0.62, 0.0, 2.02]);
    box(root, mat.glass, [0.26, 0.11, 0.04], [side * 0.62, 0.0, 2.05]);   // headlight lens
    shell.lamps.push(box(root, lampMaterial(), [0.4, 0.12, 0.05], [side * 0.55, 0.05, -2.14]));
    // Arch vents, dive planes, door handle and mirror: the GT car's signature clutter.
    louvres(root, mat.carbon, 3, [0.42, 0.02, 0.1], [side * 0.99, 0.02, 1.32], 0.15);
    slab(root, mat.carbon, [0.34, 0.03, 0.2], [side * 1.02, -0.2, 1.92], -0.22, side * 0.24);
    slab(root, mat.carbon, [0.3, 0.03, 0.17], [side * 1.0, -0.06, 1.86], -0.22, side * 0.24);
    box(root, mat.carbon, [0.06, 0.05, 0.2], [side * 0.98, 0.02, -0.72]);
    mirror(root, mat, side * 1.02, 0.14, 0.72);
    tube(root, mat.chrome, 0.06, 0.26, [side * 0.5, -0.28, -2.18], "z", 8);
    box(root, mat.carbon, [0.14, 0.02, 1.1], [side * 0.5, 0.06, 1.2]);    // bonnet strake
  }
  box(root, mat.accent, [0.46, 0.03, 2.0], [0, 0.09, 0.85]);
  box(root, mat.carbon, [1.1, 0.1, 0.34], [0, -0.06, 2.02]);
  box(root, mat.carbon, [0.9, 0.06, 0.26], [0, 0.11, 1.42]);              // bonnet vent
  slab(root, mat.paint, [1.86, 0.1, 1.05], [0, 0.03, 1.55], 0.16);
  box(root, mat.accent, [0.5, 0.4, 0.02], [0, 0.18, -2.06]);              // number panel

  box(frontWing, mat.carbon, [2.1, 0.07, 0.62], [0, -0.46, 2.2]);
  box(frontWing, mat.accent, [1.98, 0.05, 0.17], [0, -0.41, 2.4]);
  for (const side of [-1, 1]) {
    box(frontWing, mat.carbon, [0.06, 0.2, 0.62], [side * 1.02, -0.36, 2.2]);
    slab(frontWing, mat.carbon, [0.3, 0.025, 0.2], [side * 0.88, -0.38, 2.3], -0.25);
    box(root, mat.metal, [0.07, 0.5, 0.12], [side * 0.74, 0.4, -1.98]);
    box(rearWing, mat.carbon, [0.07, 0.34, 0.56], [side * 0.96, 0.66, -2.02]);
  }
  box(rearWing, mat.paint, [1.96, 0.09, 0.56], [0, 0.72, -2.02]);
  box(rearWing, mat.accent, [1.8, 0.04, 0.14], [0, 0.66, -1.85]);
  slab(rearWing, mat.carbon, [1.86, 0.03, 0.18], [0, 0.8, -2.18], 0.38);
  for (let i = -2; i <= 2; i++) box(root, mat.carbon, [0.06, 0.22, 0.5], [i * 0.3, -0.42, -2.12]);
}

/** Low mid-engined hypercar: a wedge with a canopy, engine louvres and a huge swan wing. */
function buildHyperShell(shell: Shell, mat: Palette, config: VehicleConfig): void {
  const { root, frontWing, rearWing } = shell;
  box(root, mat.carbon, [1.8, 0.08, 4.35], [0, -0.46, -0.05]);
  box(root, mat.paint, [1.84, 0.4, 4.05], [0, -0.24, -0.1], true);
  slab(root, mat.paint, [1.7, 0.1, 1.9], [0, -0.02, 1.15], 0.2);
  box(root, mat.paint, [1.34, 0.3, 1.5], [0, 0.11, -0.35], true);
  slab(root, mat.glass, [1.2, 0.46, 0.08], [0, 0.12, 0.42], -0.66);
  box(root, mat.glass, [1.0, 0.06, 1.15], [0, 0.27, -0.28]);
  box(root, mat.accent, [0.34, 0.03, 2.4], [0, 0.0, 0.7]);
  box(root, mat.carbon, [0.5, 0.14, 0.5], [0, 0.3, -0.95]);               // roof snorkel
  for (const side of [-1, 1]) {
    box(root, mat.paint, [0.5, 0.42, 1.2], [side * 0.98, -0.24, config.wheelBaseFront]);
    box(root, mat.paint, [0.56, 0.48, 1.3], [side * 1.0, -0.2, config.wheelBaseRear]);
    box(root, mat.carbon, [0.14, 0.26, 1.0], [side * 0.92, -0.2, -0.45]);
    box(root, mat.accent, [0.3, 0.09, 0.05], [side * 0.6, -0.1, 2.0]);
    box(root, mat.glass, [0.32, 0.07, 0.04], [side * 0.6, -0.1, 2.03]);
    shell.lamps.push(box(root, lampMaterial(), [0.46, 0.09, 0.05], [side * 0.52, -0.02, -2.1]));
    box(root, mat.metal, [0.09, 0.62, 0.13], [side * 0.7, 0.3, -1.94]);
    box(rearWing, mat.carbon, [0.08, 0.42, 0.6], [side * 1.0, 0.72, -1.98]);
    // Dive planes, arch vents and a quad exhaust exit.
    slab(root, mat.carbon, [0.32, 0.025, 0.2], [side * 1.0, -0.3, 1.88], -0.24, side * 0.26);
    louvres(root, mat.carbon, 3, [0.4, 0.02, 0.1], [side * 0.97, -0.08, 1.3], 0.14);
    louvres(root, mat.carbon, 4, [0.12, 0.02, 0.24], [side * 0.86, -0.08, -1.2], 0.1, 0);
    for (const dx of [0.1, -0.1]) tube(root, mat.chrome, 0.055, 0.2, [side * 0.34 + dx * side, -0.16, -2.16], "z", 8);
    mirror(root, mat, side * 0.95, 0.02, 0.58);
  }
  for (let i = -1; i <= 1; i++) box(root, mat.carbon, [1.1, 0.03, 0.12], [0, 0.03 + i * 0.05, -1.1 + i * 0.22]);
  box(root, mat.carbon, [1.3, 0.08, 0.3], [0, -0.42, -2.06]);             // diffuser tray
  for (let i = -2; i <= 2; i++) box(root, mat.carbon, [0.05, 0.2, 0.46], [i * 0.28, -0.38, -2.1]);

  box(frontWing, mat.carbon, [2.16, 0.06, 0.7], [0, -0.48, 2.22]);
  box(frontWing, mat.accent, [2.0, 0.05, 0.15], [0, -0.43, 2.44]);
  for (const side of [-1, 1]) {
    box(frontWing, mat.carbon, [0.06, 0.22, 0.7], [side * 1.05, -0.38, 2.22]);
    slab(frontWing, mat.carbon, [0.34, 0.025, 0.22], [side * 0.8, -0.4, 2.34], -0.26);
  }
  box(rearWing, mat.paint, [2.0, 0.08, 0.62], [0, 0.82, -1.98]);
  box(rearWing, mat.accent, [1.86, 0.04, 0.15], [0, 0.76, -1.78]);
  slab(rearWing, mat.carbon, [1.9, 0.03, 0.2], [0, 0.9, -2.14], 0.42);
}

/** Front-engined muscle car: chrome, a blown hood scoop, side pipes and a duckbill spoiler. */
function buildMuscleShell(shell: Shell, mat: Palette, config: VehicleConfig): void {
  const { root, frontWing, rearWing } = shell;
  box(root, mat.carbon, [1.86, 0.1, 4.2], [0, -0.42, -0.05]);
  box(root, mat.paint, [1.9, 0.58, 4.0], [0, -0.06, -0.05], true);
  box(root, mat.paint, [1.56, 0.5, 1.7], [0, 0.44, -0.55], true);
  box(root, mat.carbon, [1.5, 0.06, 1.6], [0, 0.69, -0.58]);
  slab(root, mat.glass, [1.42, 0.5, 0.08], [0, 0.44, 0.33], -0.42);
  slab(root, mat.glass, [1.42, 0.44, 0.08], [0, 0.44, -1.42], 0.46);
  // Chrome bumpers and a slatted grille, which is what says "muscle" before anything else.
  box(root, mat.chrome, [1.82, 0.14, 0.16], [0, -0.12, 2.06]);
  box(root, mat.chrome, [1.82, 0.14, 0.16], [0, -0.12, -2.1]);
  box(root, mat.carbon, [1.3, 0.24, 0.08], [0, 0.08, 2.02]);
  for (let i = -3; i <= 3; i++) box(root, mat.chrome, [0.03, 0.2, 0.05], [i * 0.17, 0.08, 2.05]);
  for (const side of [-1, 1]) {
    box(root, mat.glass, [0.05, 0.34, 1.3], [side * 0.78, 0.44, -0.55]);
    box(root, mat.paint, [0.6, 0.62, 1.3], [side * 0.99, -0.08, config.wheelBaseFront]);
    box(root, mat.paint, [0.64, 0.66, 1.4], [side * 1.0, -0.06, config.wheelBaseRear]);
    box(root, mat.chrome, [0.06, 0.08, 1.24], [side * 1.0, 0.16, config.wheelBaseFront]);   // arch trim
    box(root, mat.chrome, [0.06, 0.08, 1.34], [side * 1.0, 0.18, config.wheelBaseRear]);
    tube(root, mat.chrome, 0.11, 0.1, [side * 0.6, 0.06, 2.06], "z", 12);                    // headlamp
    box(root, mat.glass, [0.17, 0.17, 0.03], [side * 0.6, 0.06, 2.1]);
    shell.lamps.push(box(root, lampMaterial(), [0.44, 0.15, 0.05], [side * 0.56, 0.08, -2.16]));
    rod(root, new THREE.Vector3(side * 0.98, -0.3, 1.1), new THREE.Vector3(side * 1.02, -0.3, -1.5), 0.075, mat.chrome);
    tube(root, mat.chrome, 0.085, 0.24, [side * 1.02, -0.3, -1.66], "z", 10);
    box(root, mat.carbon, [0.06, 0.05, 0.2], [side * 0.98, 0.3, -0.7]);                      // door handle
    louvres(root, mat.carbon, 3, [0.3, 0.02, 0.1], [side * 0.55, 0.28, 1.72], 0.13);         // bonnet vents
    mirror(root, mat, side * 1.0, 0.3, 0.52);
  }
  // Blown engine standing proud of the bonnet, with velocity stacks and a belt drive.
  box(root, mat.carbon, [0.86, 0.34, 0.9], [0, 0.42, 1.12]);
  box(root, mat.chrome, [0.7, 0.16, 0.7], [0, 0.66, 1.12]);
  box(root, mat.carbon, [0.18, 0.34, 0.1], [0, 0.5, 1.6]);
  tube(root, mat.chrome, 0.1, 0.12, [0, 0.62, 1.62], "x", 12);
  for (const x of [-0.22, 0, 0.22]) for (const z of [0.92, 1.32]) {
    tube(root, mat.chrome, 0.1, 0.2, [x, 0.82, z], "y", 12);
  }
  box(root, mat.accent, [1.6, 0.03, 0.4], [0, 0.24, 1.86]);
  box(root, mat.accent, [0.42, 0.02, 2.3], [0, 0.36, 0.55]);                                  // bonnet stripe
  box(root, mat.metal, [1.12, 0.08, 0.08], [0, 0.66, -1.05]);                                 // roll bar
  for (const side of [-1, 1]) rod(root, new THREE.Vector3(side * 0.56, 0.66, -1.05), new THREE.Vector3(side * 0.56, 0.1, -1.4), 0.035, mat.metal);

  box(frontWing, mat.carbon, [2.04, 0.08, 0.5], [0, -0.42, 2.18]);
  box(frontWing, mat.accent, [1.9, 0.06, 0.14], [0, -0.36, 2.36]);
  for (const side of [-1, 1]) box(frontWing, mat.carbon, [0.07, 0.24, 0.5], [side * 0.99, -0.32, 2.18]);
  box(rearWing, mat.paint, [1.88, 0.1, 0.46], [0, 0.34, -2.04]);
  box(rearWing, mat.accent, [1.74, 0.04, 0.12], [0, 0.4, -2.1]);
  for (const side of [-1, 1]) box(rearWing, mat.paint, [0.1, 0.24, 0.42], [side * 0.9, 0.21, -2.02]);
}

function lampMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: "#e52e3a", emissive: "#ff1010", emissiveIntensity: 0.15, roughness: 0.4 });
}

const SHELLS: Record<CarStyle, (shell: Shell, mat: Palette, config: VehicleConfig) => void> = {
  formula: buildFormulaShell,
  gt: buildGtShell,
  hyper: buildHyperShell,
  muscle: buildMuscleShell,
};

function buildPalette(paint: CarPaint): Palette {
  // Lacquer over colour: a clearcoat is what makes a sprayed panel read as sprayed rather than
  // as plastic, and the low roughness is what lets the baked sky show up in it at all.
  // Two layers, as on a real car: a pigment coat that stays matte enough to keep its colour, and
  // a lacquer over it that does the shining. Pushing the pigment layer glossy instead just floods
  // it with sky light and the paint washes out to pastel.
  const sprayed = (color: THREE.ColorRepresentation): THREE.MeshPhysicalMaterial =>
    new THREE.MeshPhysicalMaterial({
      color, roughness: 0.44, metalness: 0.06,
      clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.5,
    });
  return {
    paint: sprayed(paint.body),
    accent: sprayed(paint.accent),
    carbon: new THREE.MeshStandardMaterial({ color: "#171c25", roughness: 0.92, metalness: 0.04, envMapIntensity: 0.25 }),
    rubber: new THREE.MeshStandardMaterial({ color: "#1a1b1e", roughness: 0.99, metalness: 0, envMapIntensity: 0.1 }),
    metal: new THREE.MeshStandardMaterial({ color: "#7e8a96", roughness: 0.28, metalness: 0.95, envMapIntensity: 2.4 }),
    chrome: new THREE.MeshStandardMaterial({ color: "#eef4f8", roughness: 0.05, metalness: 1, envMapIntensity: 3.4 }),
    glass: new THREE.MeshStandardMaterial({ color: "#0f1720", roughness: 0.04, metalness: 0.95, envMapIntensity: 3.2 }),
  };
}

/** Z-forward racer; suspension and tire locations match the physics chassis whatever the shell. */
export function buildCarMesh(config: VehicleConfig, paint: CarPaint, style: CarStyle = "formula"): CarMeshSet {
  const root = new THREE.Group();
  root.name = "racer-" + style;
  const mat = buildPalette(paint);
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
    const wheel = buildWheel(config, i >= 2, mat);
    wheel.position.set((i % 2 === 0 ? -1 : 1) * config.trackHalfWidth, wheelY, i < 2 ? config.wheelBaseFront : config.wheelBaseRear);
    root.add(wheel);
    return wheel;
  });
  batchParts(root, new Set(shell.lamps));
  return { root, wheels, brakeLights: shell.lamps, bodyMaterial: mat.paint, frontWing, rearWing };
}
