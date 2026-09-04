import * as THREE from "three";
import { TrackPath, ROAD_HALF_WIDTH, SHOULDER_WIDTH } from "./TrackPath";
import { createSandTexture, createWaterNoiseTexture } from "../utils/Textures";

const SKY_VERTEX = /* glsl */ `
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  varying vec3 vWorldPosition;
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 bottomColor;
  uniform vec3 sunDirection;
  uniform float sunSize;
  void main() {
    float h = normalize(vWorldPosition).y;
    vec3 sky = mix(horizonColor, topColor, smoothstep(0.0, 0.7, h));
    sky = mix(bottomColor, sky, smoothstep(-0.05, 0.05, h));
    float sunDot = max(dot(normalize(vWorldPosition), normalize(sunDirection)), 0.0);
    float sunDisc = smoothstep(1.0 - sunSize, 1.0 - sunSize * 0.35, sunDot);
    float sunGlow = pow(sunDot, 8.0) * 0.35;
    vec3 sunColor = vec3(1.0, 0.86, 0.66);
    sky += sunColor * (sunDisc * 1.4 + sunGlow);
    gl_FragColor = vec4(sky, 1.0);
  }
`;

export interface EnvironmentHandles {
  sunLight: THREE.DirectionalLight;
  update(dt: number, elapsed: number): void;
  followSun(target: THREE.Vector3): void;
}

// Must stay comfortably inside the camera's far clip plane (2500, see Game.ts). At the view
// center, projected depth approaches the full radial distance, so a sphere near/beyond `far`
// gets clipped there first — showing as a black patch in the middle of an otherwise fine sky.
const SKY_RADIUS = 1800;

function buildSky(scene: THREE.Scene, sunDirection: THREE.Vector3): void {
  const geometry = new THREE.SphereGeometry(SKY_RADIUS, 24, 16);
  const material = new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    uniforms: {
      topColor: { value: new THREE.Color("#2f6fb3") },
      horizonColor: { value: new THREE.Color("#bcd9e8") },
      bottomColor: { value: new THREE.Color("#d9c9a3") },
      sunDirection: { value: sunDirection },
      sunSize: { value: 0.018 },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(geometry, material);
  sky.name = "sky";
  scene.add(sky);
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

function buildDunesAndProps(scene: THREE.Scene, path: TrackPath): void {
  const rand = mulberry32(2024);
  const safeMargin = ROAD_HALF_WIDTH + SHOULDER_WIDTH + 14;

  const duneGeo = new THREE.SphereGeometry(1, 10, 7);
  const duneMat = new THREE.MeshStandardMaterial({ color: "#d3b06f", roughness: 1 });
  const duneMesh = new THREE.InstancedMesh(duneGeo, duneMat, 140);
  duneMesh.castShadow = false;
  duneMesh.receiveShadow = true;

  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: "#8a7a63", roughness: 0.95, flatShading: true });
  const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, 90);
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;

  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 3.2, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: "#6b4a2f", roughness: 0.9 });
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, 60);
  trunkMesh.castShadow = true;

  const leafGeo = new THREE.ConeGeometry(1.6, 1.4, 6);
  const leafMat = new THREE.MeshStandardMaterial({ color: "#3f7a3a", roughness: 0.8 });
  const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, 60);
  leafMesh.castShadow = true;

  const dummy = new THREE.Object3D();
  const bounds = 780;

  let duneCount = 0;
  let rockCount = 0;
  let palmCount = 0;

  for (let i = 0; i < 4000 && (duneCount < 140 || rockCount < 90 || palmCount < 60); i++) {
    const x = (rand() * 2 - 1) * bounds;
    const z = (rand() * 2 - 1) * bounds + 150;
    const p = new THREE.Vector3(x, 0, z);
    const { distance } = path.projectPoint(p);
    if (distance < safeMargin) continue;

    const nearOcean = x > 470 && x < 640;
    const isCoastal = nearOcean && rand() < 0.6;

    if (isCoastal && palmCount < 60) {
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
    } else if (rand() < 0.55 && duneCount < 140) {
      dummy.position.set(x, -0.6 - rand() * 0.4, z);
      const scale = 4 + rand() * 9;
      dummy.scale.set(scale, scale * (0.32 + rand() * 0.18), scale);
      dummy.rotation.set(0, rand() * Math.PI, 0);
      dummy.updateMatrix();
      duneMesh.setMatrixAt(duneCount, dummy.matrix);
      duneCount++;
    } else if (rockCount < 90) {
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
  for (const m of [duneMesh, rockMesh, trunkMesh, leafMesh]) {
    m.instanceMatrix.needsUpdate = true;
    scene.add(m);
  }
}

export function buildEnvironment(scene: THREE.Scene, path: TrackPath): EnvironmentHandles {
  const sunDirection = new THREE.Vector3(-0.55, 0.62, -0.35).normalize();
  scene.fog = new THREE.Fog(0xcdd9dd, 260, 1100);

  buildSky(scene, sunDirection);
  buildGround(scene);
  const ocean = buildOcean(scene);
  buildDunesAndProps(scene, path);

  const sunLight = new THREE.DirectionalLight(0xfff2da, 3.1);
  sunLight.position.copy(sunDirection).multiplyScalar(260);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 20;
  sunLight.shadow.camera.far = 420;
  sunLight.shadow.camera.left = -90;
  sunLight.shadow.camera.right = 90;
  sunLight.shadow.camera.top = 90;
  sunLight.shadow.camera.bottom = -90;
  sunLight.shadow.bias = -0.0015;
  sunLight.shadow.normalBias = 0.02;
  scene.add(sunLight);
  scene.add(sunLight.target);

  const hemi = new THREE.HemisphereLight(0xbfe3ff, 0xcaa568, 0.9);
  scene.add(hemi);

  const sunOffset = sunDirection.clone().multiplyScalar(260);

  return {
    sunLight,
    update(dt, _elapsed) {
      ocean.update(dt);
    },
    followSun(target: THREE.Vector3) {
      sunLight.position.set(target.x + sunOffset.x, target.y + sunOffset.y, target.z + sunOffset.z);
      sunLight.target.position.copy(target);
      sunLight.target.updateMatrixWorld();
    },
  };
}
