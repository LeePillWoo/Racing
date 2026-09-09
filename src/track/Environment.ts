import * as THREE from "three";
import { TrackPath } from "./TrackPath";
import { createGrassTexture } from "../utils/Textures";

export interface EnvironmentHandles {
  sunLight: THREE.DirectionalLight;
  update(dt: number, elapsed: number): void;
  followSun(target: THREE.Vector3): void;
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

function grandstand(scene: THREE.Scene, path: TrackPath, u: number, side: number): void {
  const f = path.frameAtDistance(u);
  const root = new THREE.Group();
  root.position.copy(f.point).addScaledVector(f.right, side * 28);
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
  const palette = ["#edf1ea", "#233f67", "#e75555", "#f4c55e", "#558e9e", "#3c3948"];
  for (let row = 0; row < 7; row++) for (let i = 0; i < 65; i++) {
    const index = row * 65 + i;
    dummy.position.set(side * row * 1.3, 1.06 + row * 0.55, -28 + i * 0.87);
    dummy.scale.set(1, 0.85 + rand() * 0.35, 1); dummy.updateMatrix();
    crowd.setMatrixAt(index, dummy.matrix);
    crowd.setColorAt(index, new THREE.Color(palette[Math.floor(rand() * palette.length)]));
  }
  root.add(crowd);
  for (const z of [-29, 0, 29]) block(root, concrete, [0.18, 6.2, 0.18], [side * 8.4, 3.1, z]);
  block(root, roof, [11.5, 0.18, 61], [side * 4, 6.15, 0]);
  const board = sign("APEX  /  GRAND PRIX", 48, 1.1);
  board.position.set(-side * 1.2, 0.7, 0); board.rotation.y = -side * Math.PI / 2; root.add(board);
}

export function buildEnvironment(scene: THREE.Scene, path: TrackPath): EnvironmentHandles {
  scene.background = new THREE.Color("#b7e0f5");
  scene.fog = new THREE.Fog("#d6edf2", 260, 1050);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 20), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { time: { value: 0 }, top: { value: new THREE.Color("#38a7eb") }, bottom: { value: new THREE.Color("#d9f3ff") } },
    vertexShader: "varying vec3 vDirection; void main(){vDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    fragmentShader: "uniform vec3 top;\nuniform vec3 bottom;\nuniform float time;\nvarying vec3 vDirection;\nfloat hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }\nfloat noise(vec2 p){\n  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);\n  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);\n}\nfloat fbm(vec2 p){\n  float n=0.0, a=0.5;\n  for(int i=0;i<5;i++){n+=a*noise(p);p=p*2.03+vec2(7.1,3.4);a*=0.5;}\n  return n;\n}\nvoid main(){\n  vec3 d=normalize(vDirection);\n  float h=max(d.y,0.0);\n  vec3 color=mix(bottom,top,pow(h,0.32));\n  vec2 uv=d.xz/(h+0.26)*2.0+vec2(time,0.0);\n  float shape=fbm(uv*2.4+fbm(uv*0.8));\n  float cloud=smoothstep(0.43,0.68,shape)*smoothstep(0.015,0.12,h);\n  color=mix(color,vec3(1.2,1.23,1.25),cloud*0.93);\n  gl_FragColor=vec4(color,1.0);\n  #include <tonemapping_fragment>\n  #include <colorspace_fragment>\n}",
  }));
  sky.name = 'daylight-sky';
  scene.add(sky);
  const grass = createGrassTexture(); grass.repeat.set(110, 110);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000),
    new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);

  // Instanced vegetation keeps the trackside scenery inexpensive.
  const rand = random(71), treeCount = 210;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.24, 3.4, 6),
    new THREE.MeshStandardMaterial({ color: "#77604b", roughness: 1 }), treeCount);
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: "#45822f", roughness: 1 }), treeCount);
  const dummy = new THREE.Object3D();
  let placed = 0;
  for (let attempt = 0; attempt < 2200 && placed < treeCount; attempt++) {
    const p = new THREE.Vector3((rand() - 0.5) * 1050 + 110, 0, (rand() - 0.5) * 1050);
    if (path.projectPoint(p).distance < 48) continue;
    const scale = 0.8 + rand() * 1.4;
    dummy.position.copy(p); dummy.position.y = 1.7 * scale;
    dummy.scale.setScalar(scale); dummy.updateMatrix(); trunks.setMatrixAt(placed, dummy.matrix);
    dummy.position.y = 4.4 * scale; dummy.scale.set(1.8 * scale, 2.8 * scale, 1.8 * scale);
    dummy.rotation.y = rand() * Math.PI; dummy.updateMatrix(); crowns.setMatrixAt(placed, dummy.matrix);
    crowns.setColorAt(placed, new THREE.Color().setHSL(0.24 + rand() * 0.07, 0.45, 0.28 + rand() * 0.1));
    placed++;
  }
  trunks.count = crowns.count = placed; crowns.castShadow = true;
  scene.add(trunks, crowns);
  grandstand(scene, path, 32, -1); grandstand(scene, path, 105, -1); grandstand(scene, path, 118, 1);
  grandstand(scene, path, path.totalLength - 68, -1);

  const f = path.frameAtDistance(8), gantry = new THREE.Group();
  gantry.position.copy(f.point); gantry.rotation.y = Math.atan2(f.tangent.x, f.tangent.z);
  const steel = new THREE.MeshStandardMaterial({ color: "#e1e8ed", roughness: 0.5, metalness: 0.4 });
  block(gantry, steel, [0.35, 6, 0.35], [-12, 3, 0]);
  block(gantry, steel, [0.35, 6, 0.35], [12, 3, 0]);
  block(gantry, steel, [24.5, 0.25, 0.4], [0, 6, 0]);
  const banner = sign("APEX  /  FORMULA CIRCUIT", 23.5, 1.35);
  banner.rotation.y = Math.PI;
  banner.position.set(0, 5.3, -0.24); gantry.add(banner); scene.add(gantry);
  for (let i = 0; i < 5; i++) {
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshStandardMaterial({ color: "#252b2d", roughness: 0.4 }));
    light.position.set((i - 2) * 0.62, 4.25, -0.2); gantry.add(light);
  }

  const balloons: THREE.Group[] = [];
  for (let i = 0; i < 5; i++) {
    const balloon = new THREE.Group(), radius = 4.2 + rand() * 2;
    const materials = ["#f3f0db", i % 2 ? "#e04a56" : "#225898"].map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
    for (let panel = 0; panel < 12; panel++) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 4, 12, panel / 12 * Math.PI * 2, Math.PI / 6, 0, Math.PI * 0.88), materials[panel % 2]);
      mesh.scale.y = 1.25; balloon.add(mesh);
    }
    block(balloon, new THREE.MeshStandardMaterial({ color: "#82613a" }), [1.3, 0.9, 1.1], [0, -radius * 1.5, 0]);
    balloon.position.set(-170 + i * 92, 65 + rand() * 45, 160 + rand() * 210);
    scene.add(balloon); balloons.push(balloon);
  }
  const sunDirection = new THREE.Vector3(-0.45, 0.85, -0.3).normalize();
  const sunLight = new THREE.DirectionalLight("#fff8ed", 2.5);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunLight.shadow.camera, { near: 5, far: 240, left: -55, right: 55, top: 55, bottom: -55 });
  sunLight.shadow.bias = -0.0002; sunLight.shadow.normalBias = 0.025;
  scene.add(sunLight, sunLight.target, new THREE.HemisphereLight("#c5e7ff", "#779440", 1.6));
  const offset = sunDirection.multiplyScalar(110);
  return {
    sunLight,
    update(dt, elapsed) {
      (sky.material as THREE.ShaderMaterial).uniforms.time.value += dt * 0.018;
      balloons.forEach((balloon, i) => { balloon.rotation.y = elapsed * 0.025 + i; });
    },
    followSun(target) {
      sunLight.position.copy(target).add(offset);
      sunLight.target.position.copy(target); sunLight.target.updateMatrixWorld();
      sky.position.set(target.x, 0, target.z);
    },
  };
}
