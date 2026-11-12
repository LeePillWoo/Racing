import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
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
   * The two pieces a crash can work loose, kept as their own groups rather than welded into the
   * body: the wings on the cars that have them, the nose or tail panel on the ones that do not.
   */
  frontWing: THREE.Group;
  rearWing: THREE.Group;
  /**
   * Half the distance between the left and right wheels as drawn. The physics runs every car on
   * one wide track; a shell is narrower than that and draws its wheels where its arches are.
   */
  trackHalfWidth: number;
  /** Where the tailpipe sits on this shell, for the boost flame. */
  exhaust: THREE.Vector3;
}

/**
 * One material per surface *kind*, not per part.
 *
 * The split is what sells the car: sprayed panels are a clearcoat over colour and pick up the sky,
 * while rubber, carbon and moulded trim are rough and reflect nothing. Keeping the list this short
 * matters too — each part is one mesh per kind, so every extra material is another draw call on
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
  /** Machined suspension, rims and brackets. */
  metal: THREE.MeshStandardMaterial;
  /** Polished pipes, wheel nuts and mirror faces. */
  chrome: THREE.MeshStandardMaterial;
  /** Dark glass, near mirror. */
  glass: THREE.MeshStandardMaterial;
  /** Headlamp lenses, faintly lit. */
  light: THREE.MeshStandardMaterial;
}

/** One surface of one part: its geometry, and which palette entry (or "lamp") paints it. */
interface Surface {
  geometry: THREE.BufferGeometry;
  kind: string;
}

/** A shell as it comes out of `public/models/cars.glb`, already fitted to the chassis. */
interface ShellModel {
  body: Surface[];
  front: Surface[];
  rear: Surface[];
  /** A single right-hand wheel, centred on its own axle. */
  wheel: Surface[];
  track: number;
  exhaust: number[];
}

let models: Map<string, ShellModel> | undefined;

/**
 * Loads the four shells. Has to finish before the first `buildCarMesh`. The models carry no
 * textures — every surface is painted here, by kind — so the same file parses under Node for the
 * regression tests, which hand it over as a buffer. Sources and licences are in CREDITS.md.
 */
export async function loadCarModels(source: string | ArrayBuffer = import.meta.env.BASE_URL + "models/cars.glb"): Promise<void> {
  const loader = new GLTFLoader();
  const gltf = typeof source === "string" ? await loader.loadAsync(source) : await loader.parseAsync(source, "");
  models = new Map();
  for (const shell of gltf.scene.children) {
    const part = (name: string): Surface[] => {
      const surfaces: Surface[] = [];
      // The loader renames repeats, so the second shell's "body" arrives as "body_1".
      shell.children.find(child => child.name.split("_")[0] === name)?.traverse(node => {
        if (node instanceof THREE.Mesh) surfaces.push({ geometry: node.geometry, kind: node.material.name });
      });
      return surfaces;
    };
    models.set(shell.name, {
      body: part("body"), front: part("front"), rear: part("rear"), wheel: part("wheel"),
      track: shell.userData.track, exhaust: shell.userData.exhaust,
    });
  }
}

function lampMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: "#e52e3a", emissive: "#ff1010", emissiveIntensity: 0.15, roughness: 0.4, side: THREE.DoubleSide });
}

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
  const palette: Palette = {
    paint: sprayed(paint.body),
    accent: sprayed(paint.accent),
    carbon: new THREE.MeshStandardMaterial({ color: "#171c25", roughness: 0.92, metalness: 0.04, envMapIntensity: 0.25 }),
    rubber: new THREE.MeshStandardMaterial({ color: "#1a1b1e", roughness: 0.99, metalness: 0, envMapIntensity: 0.1 }),
    metal: new THREE.MeshStandardMaterial({ color: "#7e8a96", roughness: 0.28, metalness: 0.95, envMapIntensity: 2.4 }),
    chrome: new THREE.MeshStandardMaterial({ color: "#eef4f8", roughness: 0.05, metalness: 1, envMapIntensity: 3.4 }),
    glass: new THREE.MeshStandardMaterial({ color: "#0f1720", roughness: 0.04, metalness: 0.95, envMapIntensity: 3.2 }),
    light: new THREE.MeshStandardMaterial({ color: "#fff4dc", emissive: "#ffe9b8", emissiveIntensity: 0.7, roughness: 0.3 }),
  };
  // The shells are modelled as open sheets — a wing is one layer, and a panel that has come away
  // shows the inside of the car — so every surface has to draw from both sides.
  for (const material of Object.values(palette)) material.side = THREE.DoubleSide;
  return palette;
}

/** Z-forward racer; the wheels sit where the physics chassis has them whatever the shell. */
export function buildCarMesh(config: VehicleConfig, paint: CarPaint, style: CarStyle = "formula"): CarMeshSet {
  const model = models?.get(style);
  if (!model) throw new Error(`No "${style}" shell: loadCarModels() has to finish before a car is built`);
  const mat = buildPalette(paint);
  const brakeLights: THREE.Mesh[] = [];
  const assemble = (group: THREE.Group, surfaces: Surface[]): THREE.Group => {
    for (const { geometry, kind } of surfaces) {
      // A tail light gets a material of its own: braking lights them one car at a time.
      const mesh = new THREE.Mesh(geometry, kind === "lamp" ? lampMaterial() : mat[kind as keyof Palette]);
      mesh.castShadow = true; mesh.receiveShadow = true;
      if (kind === "lamp") brakeLights.push(mesh);
      group.add(mesh);
    }
    return group;
  };
  const root = assemble(new THREE.Group(), model.body);
  root.name = "racer-" + style;
  const frontWing = assemble(new THREE.Group(), model.front);
  frontWing.name = "front-wing";
  const rearWing = assemble(new THREE.Group(), model.rear);
  rearWing.name = "rear-wing";
  root.add(frontWing, rearWing);

  const wheelY = config.connectionPointY - config.suspensionRestLength;
  const wheels = Array.from({ length: 4 }, (_, i) => {
    // The hub is what the chassis steers and spins; the tyre inside it is the one modelled wheel,
    // turned round on the left-hand side so its face still points outwards.
    const hub = new THREE.Group(), tyre = assemble(new THREE.Group(), model.wheel);
    if (i % 2 === 0) tyre.rotation.y = Math.PI;
    hub.add(tyre);
    hub.position.set((i % 2 === 0 ? -1 : 1) * model.track, wheelY, i < 2 ? config.wheelBaseFront : config.wheelBaseRear);
    root.add(hub);
    return hub;
  });
  return {
    root, wheels, brakeLights, bodyMaterial: mat.paint, frontWing, rearWing,
    trackHalfWidth: model.track, exhaust: new THREE.Vector3().fromArray(model.exhaust),
  };
}
