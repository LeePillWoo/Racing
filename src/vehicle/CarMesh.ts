import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { VehicleConfig } from "./VehicleConfig";

export interface CarMeshSet {
  root: THREE.Group;
  wheels: THREE.Group[];
  brakeLights: THREE.Mesh[];
  bodyMaterial: THREE.MeshStandardMaterial;
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

function rod(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material): void {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 8), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  mesh.castShadow = true;
  parent.add(mesh);
}


/** Batch rigid parts by material while retaining independent wheel and brake-light transforms. */
function batchParts(parent: THREE.Group, excluded?: THREE.Object3D): void {
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const child of [...parent.children]) {
    if (!(child instanceof THREE.Mesh) || child === excluded || Array.isArray(child.material)) continue;
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

function buildWheel(config: VehicleConfig, rear: boolean): THREE.Group {
  const root = new THREE.Group();
  const width = config.wheelWidth * (rear ? 1.18 : 1);
  const rubber = new THREE.MeshStandardMaterial({ color: "#202125", roughness: 0.86 });
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(config.wheelRadius, config.wheelRadius, width, 32), rubber);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  root.add(tire);
  const rimMat = new THREE.MeshStandardMaterial({ color: "#42464e", metalness: 0.65, roughness: 0.35 });
  const ringMat = new THREE.MeshStandardMaterial({ color: "#f0d349", roughness: 0.7 });
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

/** Z-forward open-wheel racer; suspension and tire locations match the physics chassis. */
export function buildCarMesh(config: VehicleConfig, color: THREE.ColorRepresentation): CarMeshSet {
  const root = new THREE.Group();
  root.name = "formula-car";
  const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.34, metalness: 0.24 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).getHex() === 0x145acb ? "#ffdb19" : "#f4f7f9", roughness: 0.38, metalness: 0.12 });
  const carbon = new THREE.MeshStandardMaterial({ color: "#171c25", roughness: 0.68, metalness: 0.15 });
  const suspension = new THREE.MeshStandardMaterial({ color: "#527a99", roughness: 0.4, metalness: 0.6 });

  box(root, carbon, [1.7, 0.075, 3.9], [0, -0.36, -0.12]);
  box(root, bodyMaterial, [0.69, 0.49, 2.7], [0, -0.03, -0.12], true);
  for (const side of [-1, 1]) {
    box(root, bodyMaterial, [0.51, 0.38, 1.75], [side * 0.59, -0.1, -0.55], true);
    box(root, carbon, [0.38, 0.2, 0.025], [side * 0.6, -0.03, 0.34]);
    box(root, accent, [0.065, 0.028, 1.58], [side * 0.67, 0.102, -0.61]);
  }

  // Tapered nose, rising towards the cockpit.
  const noseGeo = new THREE.CylinderGeometry(0.17, 0.34, 1.9, 4, 1);
  noseGeo.rotateY(Math.PI / 4);
  noseGeo.rotateX(Math.PI / 2);
  const nose = new THREE.Mesh(noseGeo, accent);
  nose.scale.y = 0.62;
  nose.position.set(0, -0.04, 1.2);
  nose.castShadow = true;
  root.add(nose);
  box(root, accent, [0.48, 0.025, 1.5], [0, 0.228, -0.77], true);

  // Open cockpit, helmet, visor and protective halo.
  box(root, carbon, [0.48, 0.1, 0.67], [0, 0.245, 0.06], true);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.18, 20, 12), accent);
  helmet.position.set(0, 0.39, 0.06);
  helmet.castShadow = true;
  root.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.184, 16, 8, 0, Math.PI * 2, Math.PI * 0.36, Math.PI * 0.23), carbon);
  visor.position.copy(helmet.position);
  root.add(visor);
  const haloCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.25, 0.39, -0.29), new THREE.Vector3(-0.29, 0.51, 0.06),
    new THREE.Vector3(0, 0.52, 0.48), new THREE.Vector3(0.29, 0.51, 0.06),
    new THREE.Vector3(0.25, 0.39, -0.29),
  ]);
  const halo = new THREE.Mesh(new THREE.TubeGeometry(haloCurve, 20, 0.035, 6, false), suspension);
  root.add(halo);
  rod(root, new THREE.Vector3(0, 0.22, 0.58), new THREE.Vector3(0, 0.52, 0.48), 0.03, suspension);
  box(root, bodyMaterial, [0.28, 0.58, 0.35], [0, 0.39, -0.61], true);
  box(root, carbon, [0.17, 0.2, 0.028], [0, 0.53, -0.42]);

  // Wide, stacked aero wings and upright endplates.
  box(root, bodyMaterial, [2.48, 0.09, 0.5], [0, -0.29, 2.14]);
  box(root, accent, [2.22, 0.065, 0.18], [0, -0.18, 2.0]);
  for (const side of [-1, 1]) {
    box(root, bodyMaterial, [0.065, 0.26, 0.62], [side * 1.2, -0.18, 2.12]);
    box(root, suspension, [0.07, 0.86, 0.15], [side * 0.52, 0.06, -1.9]);
    box(root, bodyMaterial, [0.07, 0.5, 0.67], [side * 1.01, 0.5, -1.92]);
  }
  box(root, bodyMaterial, [2.06, 0.11, 0.57], [0, 0.68, -1.92]);
  box(root, accent, [1.94, 0.05, 0.13], [0, 0.51, -1.75]);
  for (let i = -2; i <= 2; i++) box(root, carbon, [0.055, 0.24, 0.57], [i * 0.24, -0.34, -1.96]);

  const wheelY = config.connectionPointY - config.suspensionRestLength;
  for (const side of [-1, 1]) {
    for (const z of [config.wheelBaseFront, config.wheelBaseRear]) {
      for (const anchorZ of [-0.35, 0.35]) {
        rod(root, new THREE.Vector3(side * 0.34, -0.15, z + anchorZ), new THREE.Vector3(side * config.trackHalfWidth, wheelY + 0.05, z), 0.025, suspension);
      }
      rod(root, new THREE.Vector3(side * 0.3, 0.09, z - 0.2), new THREE.Vector3(side * config.trackHalfWidth, wheelY + 0.07, z), 0.023, suspension);
    }
    box(root, bodyMaterial, [0.17, 0.1, 0.22], [side * 0.54, 0.29, 0.4], true);
  }

  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.04),
    new THREE.MeshStandardMaterial({ color: "#e52e3a", emissive: "#ff1010", emissiveIntensity: 0.15 }));
  lamp.position.set(0, -0.11, -2.26);
  root.add(lamp);

  const wheels = Array.from({ length: 4 }, (_, i) => {
    const wheel = buildWheel(config, i >= 2);
    wheel.position.set((i % 2 === 0 ? -1 : 1) * config.trackHalfWidth, wheelY, i < 2 ? config.wheelBaseFront : config.wheelBaseRear);
    root.add(wheel);
    return wheel;
  });
  batchParts(root, lamp);
  return { root, wheels, brakeLights: [lamp], bodyMaterial };
}
