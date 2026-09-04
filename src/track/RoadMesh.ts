import * as THREE from "three";
import { ROAD_HALF_WIDTH, TrackPath } from "./TrackPath";
import { createAsphaltTexture, createRoadMarkingTexture } from "../utils/Textures";

const CURB_WIDTH = 0.9;
const CURB_HEIGHT = 0.06;

/** Builds the drivable road ribbon, painted lane markings, and striped curbs along both edges. */
export function buildRoadMesh(path: TrackPath): THREE.Group {
  const group = new THREE.Group();
  group.name = "road";

  const samples = path.getSamplePoints();
  const stride = 2;
  const usedIndices: number[] = [];
  for (let i = 0; i < samples.length - 1; i += stride) usedIndices.push(i);

  const roadPositions: number[] = [];
  const roadNormals: number[] = [];
  const roadUvs: number[] = [];
  const roadIndices: number[] = [];

  const curbLeftPositions: number[] = [];
  const curbLeftNormals: number[] = [];
  const curbLeftColors: number[] = [];
  const curbLeftIndices: number[] = [];
  const curbRightPositions: number[] = [];
  const curbRightNormals: number[] = [];
  const curbRightColors: number[] = [];
  const curbRightIndices: number[] = [];

  const up = new THREE.Vector3(0, 1, 0);
  let vAcc = 0;
  const stripeColorA = new THREE.Color("#c94141");
  const stripeColorB = new THREE.Color("#e7e2d6");

  for (let s = 0; s < usedIndices.length; s++) {
    const i = usedIndices[s];
    const next = samples[(i + stride) % samples.length];
    const cur = samples[i];
    const tangent = new THREE.Vector3().subVectors(next, cur).normalize();
    const right = new THREE.Vector3().crossVectors(tangent, up).normalize();

    if (s > 0) vAcc += cur.distanceTo(samples[usedIndices[s - 1]]);

    const roadLeft = new THREE.Vector3().copy(cur).addScaledVector(right, -ROAD_HALF_WIDTH);
    const roadRight = new THREE.Vector3().copy(cur).addScaledVector(right, ROAD_HALF_WIDTH);
    roadPositions.push(roadLeft.x, roadLeft.y + 0.01, roadLeft.z, roadRight.x, roadRight.y + 0.01, roadRight.z);
    roadNormals.push(0, 1, 0, 0, 1, 0);
    const vCoord = vAcc / 8;
    roadUvs.push(0, vCoord, 1, vCoord);

    const curbOuterL = new THREE.Vector3().copy(cur).addScaledVector(right, -(ROAD_HALF_WIDTH + CURB_WIDTH));
    const curbOuterR = new THREE.Vector3().copy(cur).addScaledVector(right, ROAD_HALF_WIDTH + CURB_WIDTH);
    const stripe = Math.floor(vAcc / 4) % 2 === 0 ? stripeColorA : stripeColorB;

    curbLeftPositions.push(
      roadLeft.x, roadLeft.y + 0.01, roadLeft.z,
      curbOuterL.x, curbOuterL.y + CURB_HEIGHT, curbOuterL.z
    );
    curbLeftNormals.push(0, 1, 0, 0, 1, 0);
    curbLeftColors.push(stripe.r, stripe.g, stripe.b, stripe.r, stripe.g, stripe.b);

    curbRightPositions.push(
      roadRight.x, roadRight.y + 0.01, roadRight.z,
      curbOuterR.x, curbOuterR.y + CURB_HEIGHT, curbOuterR.z
    );
    curbRightNormals.push(0, 1, 0, 0, 1, 0);
    curbRightColors.push(stripe.r, stripe.g, stripe.b, stripe.r, stripe.g, stripe.b);
  }

  const quadCount = usedIndices.length - 1;
  for (let s = 0; s < quadCount; s++) {
    const a = s * 2;
    const b = s * 2 + 1;
    const c = s * 2 + 2;
    const d = s * 2 + 3;
    roadIndices.push(a, c, b, b, c, d);
    curbLeftIndices.push(a, c, b, b, c, d);
    curbRightIndices.push(a, c, b, b, c, d);
  }

  const roadGeom = new THREE.BufferGeometry();
  roadGeom.setAttribute("position", new THREE.Float32BufferAttribute(roadPositions, 3));
  roadGeom.setAttribute("normal", new THREE.Float32BufferAttribute(roadNormals, 3));
  roadGeom.setAttribute("uv", new THREE.Float32BufferAttribute(roadUvs, 2));
  roadGeom.setIndex(roadIndices);

  const asphalt = createAsphaltTexture();
  asphalt.repeat.set(1, 1);
  const roadMat = new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.95, metalness: 0.02 });
  const roadMesh = new THREE.Mesh(roadGeom, roadMat);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  const markingGeom = new THREE.BufferGeometry();
  markingGeom.setAttribute("position", new THREE.Float32BufferAttribute(roadPositions, 3));
  markingGeom.setAttribute("normal", new THREE.Float32BufferAttribute(roadNormals, 3));
  markingGeom.setAttribute("uv", new THREE.Float32BufferAttribute(roadUvs, 2));
  markingGeom.setIndex(roadIndices);
  const markingTex = createRoadMarkingTexture();
  markingTex.repeat.set(1, vAcc / 8);
  const markingMat = new THREE.MeshBasicMaterial({
    map: markingTex,
    transparent: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const markingMesh = new THREE.Mesh(markingGeom, markingMat);
  markingMesh.position.y += 0.002;
  group.add(markingMesh);

  function buildCurb(positions: number[], normals: number[], colors: number[], indices: number[]): THREE.Mesh {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geom.setIndex(indices);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    return mesh;
  }

  group.add(buildCurb(curbLeftPositions, curbLeftNormals, curbLeftColors, curbLeftIndices));
  group.add(buildCurb(curbRightPositions, curbRightNormals, curbRightColors, curbRightIndices));

  return group;
}
