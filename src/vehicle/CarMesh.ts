import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { VehicleConfig } from "./VehicleConfig";
import { createTireTreadTexture } from "../utils/Textures";

export interface CarMeshSet {
  root: THREE.Group;
  wheels: THREE.Group[];
  brakeLights: THREE.Mesh[];
  bodyMaterial: THREE.MeshStandardMaterial;
}

const treadTexture = createTireTreadTexture();

function buildWheel(config: VehicleConfig): THREE.Group {
  const group = new THREE.Group();

  const tireGeo = new THREE.CylinderGeometry(config.wheelRadius, config.wheelRadius, config.wheelWidth, 24, 1, false);
  tireGeo.rotateZ(Math.PI / 2);
  const tireMat = new THREE.MeshStandardMaterial({
    color: "#161616",
    roughness: 0.95,
    metalness: 0,
    map: treadTexture,
  });
  const tire = new THREE.Mesh(tireGeo, tireMat);
  tire.castShadow = true;
  tire.receiveShadow = true;
  group.add(tire);

  // Sidewall ring (slightly recessed disc on each face) for a bit of tire-profile depth.
  const sidewallMat = new THREE.MeshStandardMaterial({ color: "#101010", roughness: 0.9, metalness: 0 });
  const sidewallGeo = new THREE.RingGeometry(config.wheelRadius * 0.62, config.wheelRadius * 0.97, 24);
  for (const sx of [-1, 1]) {
    const sw = new THREE.Mesh(sidewallGeo, sidewallMat);
    sw.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    sw.position.x = sx * (config.wheelWidth / 2 + 0.001);
    group.add(sw);
  }

  const rimGeo = new THREE.CylinderGeometry(config.wheelRadius * 0.58, config.wheelRadius * 0.58, config.wheelWidth * 1.03, 6);
  rimGeo.rotateZ(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: "#d8dbe0", roughness: 0.28, metalness: 0.92 });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  group.add(rim);

  // A few spokes for a forged-wheel silhouette instead of a flat disc.
  const spokeGeo = new THREE.BoxGeometry(config.wheelWidth * 0.9, config.wheelRadius * 0.12, config.wheelRadius * 0.5);
  const spokeCount = 5;
  for (let i = 0; i < spokeCount; i++) {
    const spoke = new THREE.Mesh(spokeGeo, rimMat);
    const angle = (i / spokeCount) * Math.PI * 2;
    spoke.position.set(0, Math.sin(angle) * config.wheelRadius * 0.3, Math.cos(angle) * config.wheelRadius * 0.3);
    spoke.rotation.x = angle;
    group.add(spoke);
  }

  const hubMat = new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.4, metalness: 0.8 });
  const hubGeo = new THREE.CylinderGeometry(config.wheelRadius * 0.16, config.wheelRadius * 0.16, config.wheelWidth * 1.06, 12);
  hubGeo.rotateZ(Math.PI / 2);
  group.add(new THREE.Mesh(hubGeo, hubMat));

  return group;
}

function buildWheelArch(config: VehicleConfig, material: THREE.Material, sideSign: number, z: number): THREE.Mesh {
  const archRadius = config.wheelRadius * 1.22;
  // Half-ring (arc = PI) swept from local +X, through +Y, to -X in the geometry's default XY
  // plane; rotating the mesh 90° about Y then re-projects that sweep into the Y-Z plane, i.e. a
  // silhouette that arcs up and over the wheel when viewed from the side — exactly a fender flare.
  const geo = new THREE.TorusGeometry(archRadius, config.wheelRadius * 0.16, 8, 16, Math.PI);
  const arch = new THREE.Mesh(geo, material);
  arch.rotation.y = Math.PI / 2;
  const archY = config.connectionPointY - config.suspensionRestLength * 0.55;
  arch.position.set(sideSign * config.trackHalfWidth, archY, z);
  arch.castShadow = true;
  arch.receiveShadow = true;
  return arch;
}

/** Builds a rounded, high-metalness arcade sports-car body with fender flares, plus four wheels. */
export function buildCarMesh(config: VehicleConfig, color: THREE.ColorRepresentation): CarMeshSet {
  const root = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.88 });
  const bodyLength = config.chassisHalfExtents.z * 1.85;
  const bodyWidth = config.chassisHalfExtents.x * 2;

  const lowerBody = new THREE.Mesh(new RoundedBoxGeometry(bodyWidth, config.chassisHalfExtents.y * 1.3, bodyLength, 3, 0.1), bodyMaterial);
  lowerBody.position.set(0, -0.02, 0.05);
  lowerBody.castShadow = true;
  lowerBody.receiveShadow = true;
  root.add(lowerBody);

  const cabinMat = new THREE.MeshStandardMaterial({ color: "#12161c", roughness: 0.12, metalness: 0.4 });
  const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.05, 0.42, 1.7, 2, 0.08), cabinMat);
  cabin.position.set(0, 0.42, -0.05);
  cabin.castShadow = true;
  root.add(cabin);

  const nose = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.5, 0.65, 2, 0.1), bodyMaterial);
  nose.position.set(0, -0.02, bodyLength * 0.5 + 0.28);
  nose.castShadow = true;
  root.add(nose);

  // Front splitter / rear diffuser lips — small dark accents that break up the body color.
  const trimMat = new THREE.MeshStandardMaterial({ color: "#111214", roughness: 0.5, metalness: 0.3 });
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.18), trimMat);
  splitter.position.set(0, -0.32, bodyLength * 0.5 + 0.5);
  root.add(splitter);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.16), trimMat);
  diffuser.position.set(0, -0.3, -bodyLength * 0.5 - 0.04);
  root.add(diffuser);

  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.32), bodyMaterial);
  spoiler.position.set(0, 0.52, -bodyLength * 0.5 - 0.05);
  const spoilerStand = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.22, 0.08), bodyMaterial);
  spoilerStand.position.set(0, 0.4, -bodyLength * 0.5 - 0.02);
  root.add(spoiler, spoilerStand);
  spoiler.castShadow = true;

  const headlightMat = new THREE.MeshStandardMaterial({ color: "#fff4d1", emissive: "#fff2c0", emissiveIntensity: 5 });
  const headlightGeo = new THREE.BoxGeometry(0.22, 0.1, 0.06);
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(headlightGeo, headlightMat);
    hl.position.set(sx * 0.55, 0.05, bodyLength * 0.5 + 0.58);
    root.add(hl);
  }

  const brakeLightMat = new THREE.MeshStandardMaterial({ color: "#3a0000", emissive: "#ff1414", emissiveIntensity: 0.15 });
  const brakeLightGeo = new THREE.BoxGeometry(0.24, 0.14, 0.06);
  const brakeLights: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const bl = new THREE.Mesh(brakeLightGeo, brakeLightMat.clone());
    bl.position.set(sx * 0.58, 0.15, -bodyLength * 0.5 - 0.05);
    root.add(bl);
    brakeLights.push(bl);
  }

  // Wheel arches: sculpted fender flares over all four wheels, body-colored to match the shell.
  for (const sideSign of [-1, 1]) {
    root.add(buildWheelArch(config, bodyMaterial, sideSign, config.wheelBaseFront));
    root.add(buildWheelArch(config, bodyMaterial, sideSign, config.wheelBaseRear));
  }

  const wheels: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const w = buildWheel(config);
    root.add(w);
    wheels.push(w);
  }

  return { root, wheels, brakeLights, bodyMaterial };
}
