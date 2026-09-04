import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { TrackPath, ROAD_HALF_WIDTH, SHOULDER_WIDTH } from "./TrackPath";
import { createSandTexture, createWaterNoiseTexture, createCloudTexture } from "../utils/Textures";

export interface EnvironmentHandles {
  sunLight: THREE.DirectionalLight;
  update(dt: number, elapsed: number): void;
  followSun(target: THREE.Vector3): void;
}

// Must stay comfortably inside the camera's far clip plane (2500, see Game.ts). At the view
// center, projected depth approaches the full radial distance, so geometry near/beyond `far`
// gets clipped there first — showing as a black patch in the middle of an otherwise fine sky.
const SKY_SCALE = 1700;
const CLOUD_RADIUS = 900;

/** Physically-based Preetham sky dome (three/addons Sky) instead of a flat gradient. */
function buildSky(scene: THREE.Scene, sunDirection: THREE.Vector3): Sky {
  const sky = new Sky();
  sky.scale.setScalar(SKY_SCALE);
  sky.name = "sky";
  const uniforms = (sky.material as THREE.ShaderMaterial).uniforms;
  uniforms.turbidity.value = 3.2;
  uniforms.rayleigh.value = 1.15;
  uniforms.mieCoefficient.value = 0.0055;
  uniforms.mieDirectionalG.value = 0.86;
  uniforms.sunPosition.value.copy(sunDirection);
  scene.add(sky);
  return sky;
}

/** A soft, slowly-drifting cloud layer painted on the inside of a dome beneath the sky. */
function buildClouds(scene: THREE.Scene): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(CLOUD_RADIUS, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const cloudTex = createCloudTexture();
  const material = new THREE.MeshBasicMaterial({
    map: cloudTex,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    fog: false,
  });
  const clouds = new THREE.Mesh(geometry, material);
  clouds.name = "clouds";
  scene.add(clouds);
  return clouds;
}

function buildGround(scene: THREE.Scene): void {
  const size = 1600;
  const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const sandTex = createSandTexture();
  sandTex.repeat.set(size / 18, size / 18);
  const material = new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1, metalness: 0 });
  const ground = new THREE.Mesh(geometry, material);
  ground.receiveShadow = true;
  ground.name = "ground";
  scene.add(ground);
}

function buildOcean(scene: THREE.Scene): { mesh: THREE.Mesh; update(dt: number): void } {
  const geometry = new THREE.PlaneGeometry(1400, 1400, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const noiseTex = createWaterNoiseTexture();
  noiseTex.repeat.set(40, 40);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#0c4f74"),
    roughness: 0.22,
    metalness: 0.35,
    map: noiseTex,
    transparent: true,
    opacity: 0.92,
  });
  const ocean = new THREE.Mesh(geometry, material);
  ocean.position.set(560, -0.18, 190);
  ocean.name = "ocean";
  scene.add(ocean);
  return {
    mesh: ocean,
    update(dt: number) {
      noiseTex.offset.x += dt * 0.006;
      noiseTex.offset.y += dt * 0.004;
    },
  };
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DUNE_TARGET = 260;
const ROCK_TARGET = 190;
const PALM_TARGET = 100;
const CACTUS_TARGET = 150;

function buildDunesAndProps(scene: THREE.Scene, path: TrackPath): void {
  const rand = mulberry32(2024);
  const safeMargin = ROAD_HALF_WIDTH + SHOULDER_WIDTH + 14;

  const duneGeo = new THREE.SphereGeometry(1, 10, 7);
  const duneMat = new THREE.MeshStandardMaterial({ color: "#d3b06f", roughness: 1 });
  const duneMesh = new THREE.InstancedMesh(duneGeo, duneMat, DUNE_TARGET);
  duneMesh.castShadow = false;
  duneMesh.receiveShadow = true;

  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: "#8a7a63", roughness: 0.95, flatShading: true });
  const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, ROCK_TARGET);
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;

  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 3.2, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: "#6b4a2f", roughness: 0.9 });
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, PALM_TARGET);
  trunkMesh.castShadow = true;

  const leafGeo = new THREE.ConeGeometry(1.6, 1.4, 6);
  const leafMat = new THREE.MeshStandardMaterial({ color: "#3f7a3a", roughness: 0.8 });
  const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, PALM_TARGET);
  leafMesh.castShadow = true;

  const cactusTrunkGeo = new THREE.CapsuleGeometry(0.28, 1.4, 4, 8);
  const cactusMat = new THREE.MeshStandardMaterial({ color: "#4a7c4e", roughness: 0.85 });
  const cactusTrunkMesh = new THREE.InstancedMesh(cactusTrunkGeo, cactusMat, CACTUS_TARGET);
  cactusTrunkMesh.castShadow = true;
  cactusTrunkMesh.receiveShadow = true;

  const cactusArmGeo = new THREE.CapsuleGeometry(0.16, 0.7, 4, 8);
  const cactusArmMesh = new THREE.InstancedMesh(cactusArmGeo, cactusMat, CACTUS_TARGET);
  cactusArmMesh.castShadow = true;

  const dummy = new THREE.Object3D();
  const armDummy = new THREE.Object3D();
  const bounds = 780;

  let duneCount = 0;
  let rockCount = 0;
  let palmCount = 0;
  let cactusCount = 0;

  const targetTotal = DUNE_TARGET + ROCK_TARGET + PALM_TARGET + CACTUS_TARGET;
  for (let i = 0; i < targetTotal * 6 && duneCount + rockCount + palmCount + cactusCount < targetTotal; i++) {
    const x = (rand() * 2 - 1) * bounds;
    const z = (rand() * 2 - 1) * bounds + 150;
    const p = new THREE.Vector3(x, 0, z);
    const { distance } = path.projectPoint(p);
    if (distance < safeMargin) continue;

    const nearOcean = x > 470 && x < 640;
    const isCoastal = nearOcean && rand() < 0.65;
    const roll = rand();

    if (isCoastal && palmCount < PALM_TARGET) {
      dummy.position.set(x, 0, z);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      const scale = 0.8 + rand() * 0.6;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      trunkMesh.setMatrixAt(palmCount, dummy.matrix);
      dummy.position.y = 3.2 * scale * 0.5 + 0.6 * scale;
      dummy.updateMatrix();
      leafMesh.setMatrixAt(palmCount, dummy.matrix);
      palmCount++;
    } else if (!nearOcean && roll < 0.3 && cactusCount < CACTUS_TARGET) {
      const scale = 0.7 + rand() * 0.9;
      const yaw = rand() * Math.PI * 2;
      dummy.position.set(x, 0.7 * scale, z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      cactusTrunkMesh.setMatrixAt(cactusCount, dummy.matrix);

      const armSide = rand() < 0.5 ? -1 : 1;
      const armHeight = (0.5 + rand() * 0.5) * scale;
      armDummy.position.set(x + Math.cos(yaw) * 0.32 * scale * armSide, armHeight, z + Math.sin(yaw) * 0.32 * scale * armSide);
      armDummy.rotation.set(0, yaw, (armSide * Math.PI) / 2.4);
      armDummy.scale.setScalar(scale);
      armDummy.updateMatrix();
      cactusArmMesh.setMatrixAt(cactusCount, armDummy.matrix);
      cactusCount++;
    } else if (roll < 0.62 && duneCount < DUNE_TARGET) {
      dummy.position.set(x, -0.6 - rand() * 0.4, z);
      const scale = 4 + rand() * 9;
      dummy.scale.set(scale, scale * (0.32 + rand() * 0.18), scale);
      dummy.rotation.set(0, rand() * Math.PI, 0);
      dummy.updateMatrix();
      duneMesh.setMatrixAt(duneCount, dummy.matrix);
      duneCount++;
    } else if (rockCount < ROCK_TARGET) {
      dummy.position.set(x, 0.3 + rand() * 0.2, z);
      const scale = 0.5 + rand() * 1.4;
      dummy.scale.setScalar(scale);
      dummy.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
      dummy.updateMatrix();
      rockMesh.setMatrixAt(rockCount, dummy.matrix);
      rockCount++;
    }
  }

  duneMesh.count = duneCount;
  rockMesh.count = rockCount;
  trunkMesh.count = palmCount;
  leafMesh.count = palmCount;
  cactusTrunkMesh.count = cactusCount;
  cactusArmMesh.count = cactusCount;
  for (const m of [duneMesh, rockMesh, trunkMesh, leafMesh, cactusTrunkMesh, cactusArmMesh]) {
    m.instanceMatrix.needsUpdate = true;
    scene.add(m);
  }
}

export function buildEnvironment(scene: THREE.Scene, path: TrackPath): EnvironmentHandles {
  const sunDirection = new THREE.Vector3(-0.55, 0.62, -0.35).normalize();
  scene.fog = new THREE.Fog(0xcdd9dd, 260, 1100);

  buildSky(scene, sunDirection);
  const clouds = buildClouds(scene);
  buildGround(scene);
  const ocean = buildOcean(scene);
  buildDunesAndProps(scene, path);

  const sunLight = new THREE.DirectionalLight(0xfff2da, 3.1);
  sunLight.position.copy(sunDirection).multiplyScalar(260);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(4096, 4096);
  sunLight.shadow.camera.near = 20;
  sunLight.shadow.camera.far = 420;
  sunLight.shadow.camera.left = -90;
  sunLight.shadow.camera.right = 90;
  sunLight.shadow.camera.top = 90;
  sunLight.shadow.camera.bottom = -90;
  sunLight.shadow.bias = -0.0012;
  sunLight.shadow.normalBias = 0.025;
  sunLight.shadow.radius = 2.5;
  scene.add(sunLight);
  scene.add(sunLight.target);

  const hemi = new THREE.HemisphereLight(0xbfe3ff, 0xcaa568, 0.9);
  scene.add(hemi);

  const sunOffset = sunDirection.clone().multiplyScalar(260);

  return {
    sunLight,
    update(dt, _elapsed) {
      ocean.update(dt);
      clouds.rotation.y += dt * 0.004;
    },
    followSun(target: THREE.Vector3) {
      sunLight.position.set(target.x + sunOffset.x, target.y + sunOffset.y, target.z + sunOffset.z);
      sunLight.target.position.copy(target);
      sunLight.target.updateMatrixWorld();
    },
  };
}
