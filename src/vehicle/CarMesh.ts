import * as THREE from "three";
import { VehicleConfig } from "./VehicleConfig";

export interface CarMeshSet {
  root: THREE.Group;
  wheels: THREE.Group[];
  brakeLights: THREE.Mesh[];
  bodyMaterial: THREE.MeshStandardMaterial;
}

function buildWheel(config: VehicleConfig): THREE.Group {
  const group = new THREE.Group();

  const tireGeo = new THREE.CylinderGeometry(config.wheelRadius, config.wheelRadius, config.wheelWidth, 20);
  tireGeo.rotateZ(Math.PI / 2);
  const tireMat = new THREE.MeshStandardMaterial({ color: "#161616", roughness: 0.85 });
  const tire = new THREE.Mesh(tireGeo, tireMat);
  tire.castShadow = true;
  tire.receiveShadow = true;
  group.add(tire);

  const rimGeo = new THREE.CylinderGeometry(config.wheelRadius * 0.6, config.wheelRadius * 0.6, config.wheelWidth * 1.02, 6);
  rimGeo.rotateZ(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: "#c9ccd1", roughness: 0.4, metalness: 0.7 });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  group.add(rim);

  return group;
}

/** Builds a simple low-poly arcade sports-car body plus four rolling/steering wheel pivots. */
export function buildCarMesh(config: VehicleConfig, color: THREE.ColorRepresentation): CarMeshSet {
  const root = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.55 });

  const lowerBody = new THREE.Mesh(
    new THREE.BoxGeometry(config.chassisHalfExtents.x * 2, config.chassisHalfExtents.y * 1.3, config.chassisHalfExtents.z * 1.85),
    bodyMaterial
  );
  lowerBody.position.set(0, -0.02, 0.05);
  lowerBody.castShadow = true;
  lowerBody.receiveShadow = true;
  root.add(lowerBody);

  const cabinMat = new THREE.MeshStandardMaterial({ color: "#12161c", roughness: 0.2, metalness: 0.2 });
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.42, 1.7), cabinMat);
  cabin.position.set(0, 0.42, -0.05);
  cabin.castShadow = true;
  root.add(cabin);

  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.65), bodyMaterial);
  nose.position.set(0, -0.02, config.chassisHalfExtents.z * 1.85 * 0.5 + 0.28);
  nose.castShadow = true;
  root.add(nose);

  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.32), bodyMaterial);
  spoiler.position.set(0, 0.52, -config.chassisHalfExtents.z * 1.85 * 0.5 - 0.05);
  const spoilerStand = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.22, 0.08), bodyMaterial);
  spoilerStand.position.set(0, 0.4, -config.chassisHalfExtents.z * 1.85 * 0.5 - 0.02);
  root.add(spoiler, spoilerStand);

  const headlightMat = new THREE.MeshStandardMaterial({ color: "#fff4d1", emissive: "#fff2c0", emissiveIntensity: 1.4 });
  const headlightGeo = new THREE.BoxGeometry(0.22, 0.1, 0.06);
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(headlightGeo, headlightMat);
    hl.position.set(sx * 0.55, 0.05, config.chassisHalfExtents.z * 1.85 * 0.5 + 0.58);
    root.add(hl);
  }

  const brakeLightMat = new THREE.MeshStandardMaterial({ color: "#3a0000", emissive: "#ff1414", emissiveIntensity: 0.15 });
  const brakeLightGeo = new THREE.BoxGeometry(0.24, 0.14, 0.06);
  const brakeLights: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const bl = new THREE.Mesh(brakeLightGeo, brakeLightMat.clone());
    bl.position.set(sx * 0.58, 0.15, -config.chassisHalfExtents.z * 1.85 * 0.5 - 0.05);
    root.add(bl);
    brakeLights.push(bl);
  }

  const wheels: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const w = buildWheel(config);
    root.add(w);
    wheels.push(w);
  }

  return { root, wheels, brakeLights, bodyMaterial };
}
