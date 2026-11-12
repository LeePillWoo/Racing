import * as THREE from "three";
import { TrackPath } from "./TrackPath";
import { GroundPatch, TrackTheme, groundAt } from "./TrackCatalog";
import { barrierOffset } from "./RoadMesh";
import { CROWD_PALETTE, dressTrackside, instances, loadTrackside, pose, prop } from "./Trackside";
import { createGrassTexture, createSandTexture, createWaterNoiseTexture, createAsphaltTexture } from "../utils/Textures";

export interface EnvironmentHandles {
  sunLight: THREE.DirectionalLight;
  update(dt: number, elapsed: number): void;
  followSun(target: THREE.Vector3): void;
}

/** Unit vector towards the sun. Shared by the sky, the light and the reflection probe, which all have to agree. */
function sunDirection(sun: TrackTheme["sun"], minElevation = 0): THREE.Vector3 {
  const elevation = THREE.MathUtils.degToRad(Math.max(sun.elevation, minElevation));
  const azimuth = THREE.MathUtils.degToRad(sun.azimuth);
  return new THREE.Vector3(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth));
}

/** Smooth 2D value noise in 0..1, for anything that should clump rather than scatter evenly. */
function noise(x: number, z: number): number {
  const hash = (i: number, j: number): number => { const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return v - Math.floor(v); };
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix, iz), hash(ix + 1, iz), sx),
    THREE.MathUtils.lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), sx), sz);
}

/**
 * A ridge line circling the whole site, drawn as a flat silhouette that dissolves into the haze
 * at its foot. The ground is a flat plane, and without something standing on its far edge the
 * horizon is a ruled line where green meets sky.
 */
function ridge(cx: number, cz: number, radius: number, low: number, high: number, crest: THREE.Color, haze: THREE.Color, seed: number): THREE.Mesh {
  const steps = 260, positions: number[] = [], colors: number[] = [], indices: number[] = [];
  for (let i = 0; i <= steps; i++) {
    // Sampled around a circle in noise space, so the last column meets the first without a seam.
    const angle = ((i % steps) / steps) * Math.PI * 2, c = Math.cos(angle), n = Math.sin(angle);
    const peak = low + (high - low) * (noise(c * 3 + seed, n * 3 + seed) * 0.55 + noise(c * 9 + seed, n * 9 - seed) * 0.3
      + noise(c * 27 - seed, n * 27 + seed) * 0.15);
    positions.push(cx + c * radius, -2, cz + n * radius, cx + c * radius, peak, cz + n * radius);
    colors.push(haze.r, haze.g, haze.b, crest.r, crest.g, crest.b);
    if (i < steps) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  // Unlit, with its haze baked into the vertex colours rather than left to the scene fog, which
  // at this range would paint the whole ridge the exact colour of the sky behind it.
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false }));
}

function random(seed: number): () => number {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
}

function block(parent: THREE.Object3D, material: THREE.Material, size: number[], pos: number[]): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh); return mesh;
}

function sign(text: string, width: number, height: number, background = "#102c4b"): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 1024; canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = background; ctx.fillRect(0, 0, 1024, 128);
  ctx.fillStyle = "#e5f34b"; ctx.fillRect(0, 0, 14, 128);
  ctx.fillStyle = "#ffffff"; ctx.font = "bold 55px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, 512, 67);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
}

function grandstand(scene: THREE.Scene, path: TrackPath, u: number, side: number, banner: string): void {
  const f = path.frameAtDistance(u);
  const root = new THREE.Group();
  root.position.copy(f.point).addScaledVector(f.right, side * (barrierOffset(path) + 14.5));
  root.rotation.y = Math.atan2(f.tangent.x, f.tangent.z);
  scene.add(root);
  const concrete = new THREE.MeshStandardMaterial({ color: "#aebec8", roughness: 0.9 });
  const roof = new THREE.MeshStandardMaterial({ color: "#edf3f6", metalness: 0.25, roughness: 0.5 });
  const seat = new THREE.MeshStandardMaterial({ color: "#2c5e85", roughness: 0.8 });
  for (let row = 0; row < 7; row++) {
    block(root, concrete, [1.5, 0.55 + row * 0.55, 58], [side * row * 1.3, (0.55 + row * 0.55) / 2, 0]);
    block(root, seat, [0.75, 0.16, 57], [side * row * 1.3, 0.7 + row * 0.55, 0]);
  }
  const rand = random(Math.floor(u + 4000));
  const crowd = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.16, 0.32, 2, 5),
    new THREE.MeshStandardMaterial({ roughness: 1 }), 7 * 65);
  const dummy = new THREE.Object3D();
  for (let row = 0; row < 7; row++) for (let i = 0; i < 65; i++) {
    const index = row * 65 + i;
    dummy.position.set(side * row * 1.3, 1.06 + row * 0.55, -28 + i * 0.87);
    dummy.scale.set(1, 0.85 + rand() * 0.35, 1); dummy.updateMatrix();
    crowd.setMatrixAt(index, dummy.matrix);
    crowd.setColorAt(index, new THREE.Color(CROWD_PALETTE[Math.floor(rand() * CROWD_PALETTE.length)]));
  }
  root.add(crowd);
  for (const z of [-29, 0, 29]) block(root, concrete, [0.18, 6.2, 0.18], [side * 8.4, 3.1, z]);
  block(root, roof, [11.5, 0.18, 61], [side * 4, 6.15, 0]);
  const board = sign(banner, 48, 1.1);
  board.position.set(-side * 1.2, 0.7, 0); board.rotation.y = -side * Math.PI / 2; root.add(board);
}

/** A low pit/paddock building alongside the start straight — the beige shed every kart circuit has. */
function pitBuilding(scene: THREE.Scene, path: TrackPath, u: number, side: number, banner: string): void {
  const f = path.frameAtDistance(u);
  const root = new THREE.Group();
  root.position.copy(f.point).addScaledVector(f.right, side * (barrierOffset(path) + 17));
  root.rotation.y = Math.atan2(f.tangent.x, f.tangent.z);
  scene.add(root);
  const wall = new THREE.MeshStandardMaterial({ color: "#f0e0bc", roughness: 0.95 });
  const roof = new THREE.MeshStandardMaterial({ color: "#c8b183", roughness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: "#3c5f77", roughness: 0.3, metalness: 0.4 });
  block(root, wall, [14, 6, 74], [0, 3, 0]);
  block(root, roof, [16.5, 0.6, 77], [0, 6.3, 0]);
  for (let i = 0; i < 9; i++) block(root, glass, [0.3, 1.9, 6], [-side * 7.1, 4.2, -32 + i * 8]);
  const board = sign(banner, 40, 1.5);
  board.position.set(-side * 7.3, 1.8, 0); board.rotation.y = -side * Math.PI / 2; root.add(board);
}

/**
 * Everything painted on the terrain shares one trick: a polygon offset that pushes it away from
 * the camera in depth. The road sits only a couple of centimetres above the ground plane, and at
 * the grazing angle a chase camera looks down the road that is far below the depth buffer can
 * resolve — without this the 2.4 km ground plane wins and the asphalt disappears under grass.
 */
function pushBack<T extends THREE.Material>(material: T, order: number): T {
  material.polygonOffset = true;
  material.polygonOffsetFactor = order;
  material.polygonOffsetUnits = order;
  return material;
}

function patchMaterial(kind: GroundPatch["kind"]): THREE.MeshStandardMaterial {
  if (kind === "water") {
    const map = createWaterNoiseTexture(); map.repeat.set(9, 9);
    return pushBack(new THREE.MeshStandardMaterial({ map, color: "#2f8fc4", roughness: 0.18, metalness: 0.28 }), 4);
  }
  if (kind === "sand") {
    const map = createSandTexture(); map.repeat.set(16, 16);
    return pushBack(new THREE.MeshStandardMaterial({ map, roughness: 1 }), 4);
  }
  if (kind === "paddock") {
    const map = createAsphaltTexture(); map.repeat.set(70, 70);
    return pushBack(new THREE.MeshStandardMaterial({ map, color: "#7d7f88", roughness: 1 }), 6);
  }
  const map = createGrassTexture(); map.repeat.set(24, 24);
  return pushBack(new THREE.MeshStandardMaterial({ map, roughness: 1 }), 4);
}

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 top;
uniform vec3 bottom;
uniform vec3 glow;
uniform vec3 sunColor;
uniform vec3 sunDir;
uniform vec3 cloudLit;
uniform vec3 cloudShade;
uniform float cover;
uniform float time;
varying vec3 vDirection;
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p){
  float n=0.0, a=0.5;
  for(int i=0;i<5;i++){n+=a*noise(p);p=p*2.03+vec2(7.1,3.4);a*=0.5;}
  return n;
}
void main(){
  vec3 d=normalize(vDirection);
  float h=max(d.y,0.0);
  float toSun=max(dot(d,sunDir),0.0);
  vec3 color=mix(bottom,top,pow(h,0.4));
  // Haze hugging the horizon, thickest under the sun, then the sun's own halo, corona and disc.
  color=mix(color,glow,pow(1.0-h,7.0)*(0.3+0.7*toSun*toSun));
  color+=glow*pow(toSun,14.0)*0.45;
  color+=sunColor*(pow(toSun,160.0)*0.55+smoothstep(0.99955,0.9998,toSun)*9.0);
  vec2 uv=d.xz/(h+0.26)*2.0+vec2(time,0.0);
  float shape=fbm(uv*2.4+fbm(uv*0.8));
  float cloud=smoothstep(cover,cover+0.25,shape)*smoothstep(0.015,0.12,h);
  // Thick cloud is its own shade; thin cloud between you and the sun lights up from behind.
  float thick=smoothstep(cover,cover+0.5,shape);
  vec3 cloudColor=mix(cloudLit,cloudShade,thick*0.8)+sunColor*pow(toSun,5.0)*(1.0-thick)*0.6;
  color=mix(color,cloudColor,cloud*0.93);
  gl_FragColor=vec4(color,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Candela of one floodlight at full burn: enough to pool on the road under a 9 m mast. */
const FLOOD_CANDELA = 1100;

export async function buildEnvironment(scene: THREE.Scene, path: TrackPath, renderer: THREE.WebGLRenderer): Promise<EnvironmentHandles> {
  const theme = path.def.theme;
  const library = await loadTrackside();
  const sunDir = sunDirection(theme.sun);
  renderer.toneMappingExposure = theme.exposure;
  scene.background = new THREE.Color(theme.background);
  scene.fog = new THREE.Fog(theme.fog.color, theme.fog.near, theme.fog.far);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 20), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      time: { value: 0 }, cover: { value: theme.clouds.cover }, sunDir: { value: sunDir },
      top: { value: new THREE.Color(theme.skyTop) }, bottom: { value: new THREE.Color(theme.skyBottom) },
      glow: { value: new THREE.Color(theme.horizonGlow) }, sunColor: { value: new THREE.Color(theme.sun.color) },
      cloudLit: { value: new THREE.Color(theme.clouds.lit) }, cloudShade: { value: new THREE.Color(theme.clouds.shade) },
    },
    vertexShader: "varying vec3 vDirection; void main(){vDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    fragmentShader: SKY_FRAGMENT,
  }));
  sky.name = 'daylight-sky';
  // Drawn first, so the hills beyond the dome's radius still land on top of it.
  sky.renderOrder = -1;
  scene.add(sky);

  // Bake this circuit's own sky into a reflection probe. Car paint, chrome and glass are polished
  // enough to show what is above them, and without a probe they have nothing to show: they go flat
  // grey and read as plastic. One prefiltered pass at load costs nothing per frame afterwards.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const probeScene = new THREE.Scene();
  probeScene.add(new THREE.Mesh(sky.geometry, sky.material));
  // A sun disc in the probe, far bigger and brighter than the one in the sky. Without one the
  // reflection is a smooth gradient and a flat panel mirrors a single flat colour — technically a
  // reflection, but it reads as matte paint. The hot spot is what sweeps across the bodywork as a car turns.
  // Kept modest: with the sun low, a flat tail panel mirrors the disc straight into the chase camera,
  // and a disc as hot as the old overhead one turns the whole car into a bloom flare.
  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(100, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.sun.color).multiplyScalar(theme.sun.intensity * 3), toneMapped: false }));
  sunDisc.position.copy(sunDir).multiplyScalar(1250);
  probeScene.add(sunDisc);
  const probe = pmrem.fromScene(probeScene, 0, 10, 4000);
  scene.environment = probe.texture;
  // Low, because the probe lights every standard material in the scene and the sun and hemisphere
  // light already carry the exposure. The cars ask for more through their own envMapIntensity.
  scene.environmentIntensity = 0.35;
  pmrem.dispose();

  // Scatter across the actual footprint of this circuit, not a fixed box around the origin.
  const samples = path.getSamplePoints();
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of samples) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const spanX = maxX - minX + 380, spanZ = maxZ - minZ + 380;
  const midX = (minX + maxX) / 2, midZ = (minZ + maxZ) / 2;

  const terrain = theme.terrain === "sand" ? createSandTexture() : createGrassTexture();
  terrain.repeat.set(220, 220);
  // One tile repeated 220 times reads as wallpaper from the chase camera. A slow drift between
  // lush and sun-dried, carried in vertex colour, breaks the repeat up for the cost of a few
  // thousand vertices.
  const groundGeometry = new THREE.PlaneGeometry(2400, 2400, 80, 80);
  const groundPosition = groundGeometry.getAttribute("position"), tint: number[] = [];
  for (let i = 0; i < groundPosition.count; i++) {
    const x = groundPosition.getX(i), y = groundPosition.getY(i);
    const dry = noise(x * 0.0045 + 9, y * 0.0045 + 9) * 0.7 + noise(x * 0.019, y * 0.019) * 0.3;
    tint.push(0.8 + dry * 0.32, 0.92 + dry * 0.1, 0.86 - dry * 0.2);
  }
  groundGeometry.setAttribute("color", new THREE.Float32BufferAttribute(tint, 3));
  const ground = new THREE.Mesh(groundGeometry,
    pushBack(new THREE.MeshStandardMaterial({ map: terrain, roughness: 1, vertexColors: true }), 8));
  ground.rotation.x = -Math.PI / 2; ground.position.set(midX, 0, midZ); ground.receiveShadow = true;
  scene.add(ground);

  const haze = new THREE.Color(theme.fog.color);
  const crest = new THREE.Color(theme.hills);
  scene.add(ridge(midX, midZ, 1400, 150, 340, crest.clone().lerp(haze, 0.62), haze, 11),
    ridge(midX, midZ, 1000, 40, 115, crest.clone().lerp(haze, 0.25), crest.clone().lerp(haze, 0.8), 3));

  // Ground patches: lakes, sand plateaus, the black paddock apron. Stacked a few millimetres
  // apart in list order so a later patch always wins over an earlier one without z-fighting.
  const water: THREE.Mesh[] = [];
  theme.patches.forEach((patch, i) => {
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 64), patchMaterial(patch.kind));
    mesh.scale.set(patch.rx, patch.rz, 1);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(patch.x, 0.004 + i * 0.003, patch.z);
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (patch.kind === "water") water.push(mesh);
  });

  // Woods rather than an orchard: a tree only stands where a slow noise field says there is a
  // stand of them, which leaves clearings and sightlines instead of an even sprinkle. Three
  // modelled spruces carry the close range; crossed-quad broadleaves fill in the mass behind them.
  const rand = random(71), treeCount = theme.trees * 11;
  const kinds = ["spruce-a", "spruce-b", "spruce-c", "tree-pine", "tree-maple", "tree-crab"];
  const stands: THREE.Matrix4[][] = kinds.map(() => []);
  const clearance = barrierOffset(path) + 26;
  for (let attempt = 0, placed = 0; attempt < treeCount * 12 && placed < treeCount; attempt++) {
    const p = new THREE.Vector3(midX + (rand() - 0.5) * spanX, 0, midZ + (rand() - 0.5) * spanZ);
    if (rand() > THREE.MathUtils.smoothstep(noise(p.x * 0.007 + 40, p.z * 0.007 + 40), 0.26, 0.56)) continue;
    const fromRoad = path.projectPoint(p).distance;
    if (groundAt(theme, p.x, p.z) !== "grass" || fromRoad < clearance) continue;
    // The modelled trees go where the camera passes close; past that a billboard reads the same.
    const kind = (fromRoad < clearance + 70 && rand() < 0.4 ? 0 : 3) + Math.floor(rand() * 3);
    stands[kind].push(pose(p.x, p.z, rand() * Math.PI * 2, 0.75 + rand() * 0.7));
    placed++;
  }
  stands.forEach((poses, kind) => {
    // Grouped by 160 m cell so each instanced run is one patch of woodland that can be culled.
    const cell = (m: THREE.Matrix4): number => Math.floor(m.elements[12] / 160) * 1000 + Math.floor(m.elements[14] / 160);
    poses.sort((a, b) => cell(a) - cell(b));
    scene.add(instances(prop(library, kinds[kind]), poses));
  });
  for (const stand of theme.grandstands) grandstand(scene, path, stand.u, stand.side, theme.banner);
  if (theme.pitBuilding) pitBuilding(scene, path, theme.pitBuilding.u, theme.pitBuilding.side, theme.banner);

  const lamps = dressTrackside(scene, path, library);
  // The lamp heads glow with the towers' own emissive map; a few real lights follow the player
  // from mast to mast (see followSun) rather than every tower on the lap paying for one.
  const lampHead = prop(library, "tower")[0].material as THREE.MeshStandardMaterial;
  lampHead.emissive.set("#fff0d2");
  lampHead.emissiveIntensity = theme.floodlight * 6;
  const floods = theme.floodlight > 0 ? Array.from({ length: 4 }, () => new THREE.PointLight("#ffe3b8", 0, 0, 2)) : [];
  if (floods.length > 0) scene.add(...floods);

  const f = path.frameAtDistance(8), gantry = new THREE.Group();
  gantry.position.copy(f.point); gantry.rotation.y = Math.atan2(f.tangent.x, f.tangent.z);
  const steel = new THREE.MeshStandardMaterial({ color: "#e1e8ed", roughness: 0.5, metalness: 0.4 });
  const post = path.halfWidth + 3;
  block(gantry, steel, [0.35, 6, 0.35], [-post, 3, 0]);
  block(gantry, steel, [0.35, 6, 0.35], [post, 3, 0]);
  block(gantry, steel, [post * 2 + 0.5, 0.25, 0.4], [0, 6, 0]);
  const banner = sign(theme.banner, post * 2, 1.35);
  banner.rotation.y = Math.PI;
  banner.position.set(0, 5.3, -0.24); gantry.add(banner); scene.add(gantry);
  for (let i = 0; i < 5; i++) {
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshStandardMaterial({ color: "#252b2d", roughness: 0.4 }));
    light.position.set((i - 2) * 0.62, 4.25, -0.2); gantry.add(light);
  }

  const balloons: THREE.Group[] = [];
  for (let i = 0; i < theme.balloons; i++) {
    const balloon = new THREE.Group(), radius = 4.2 + rand() * 2;
    const materials = ["#f3f0db", i % 2 ? "#e04a56" : "#225898"].map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
    for (let panel = 0; panel < 12; panel++) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 4, 12, panel / 12 * Math.PI * 2, Math.PI / 6, 0, Math.PI * 0.88), materials[panel % 2]);
      mesh.scale.y = 1.25; balloon.add(mesh);
    }
    block(balloon, new THREE.MeshStandardMaterial({ color: "#82613a" }), [1.3, 0.9, 1.1], [0, -radius * 1.5, 0]);
    balloon.position.set(midX - 170 + i * 92, 65 + rand() * 45, midZ + 160 + rand() * 210);
    scene.add(balloon); balloons.push(balloon);
  }
  const sunLight = new THREE.DirectionalLight(theme.sun.color, theme.sun.intensity);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunLight.shadow.camera, { near: 5, far: 240, left: -55, right: 55, top: 55, bottom: -55 });
  sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.05;
  scene.add(sunLight, sunLight.target,
    new THREE.HemisphereLight(theme.hemisphere.sky, theme.hemisphere.ground, theme.hemisphere.intensity));
  // The light never drops below 12 degrees even when the sun in the sky does. Any lower and one
  // shadow-map texel covers metres of ground, and the whole road crawls with acne.
  const offset = sunDirection(theme.sun, 12).multiplyScalar(110);
  return {
    sunLight,
    update(dt, elapsed) {
      (sky.material as THREE.ShaderMaterial).uniforms.time.value += dt * 0.018;
      balloons.forEach((balloon, i) => { balloon.rotation.y = elapsed * 0.025 + i; });
      for (const lake of water) {
        const map = (lake.material as THREE.MeshStandardMaterial).map;
        if (map) { map.offset.x = elapsed * 0.012; map.offset.y = elapsed * 0.008; }
      }
    },
    followSun(target) {
      sunLight.position.copy(target).add(offset);
      sunLight.target.position.copy(target); sunLight.target.updateMatrixWorld();
      sky.position.set(target.x, 0, target.z);
      if (floods.length === 0) return;
      // Hand the lights to the masts nearest the player. Each fades out with distance, so by the
      // time a mast drops out of the nearest four it is already dark and nothing pops.
      lamps.sort((a, b) => a.distanceToSquared(target) - b.distanceToSquared(target));
      floods.forEach((light, i) => {
        const lamp = lamps[i];
        if (!lamp) { light.intensity = 0; return; }
        light.position.copy(lamp);
        light.intensity = theme.floodlight * FLOOD_CANDELA * (1 - THREE.MathUtils.smoothstep(lamp.distanceTo(target), 70, 150));
      });
    },
  };
}
