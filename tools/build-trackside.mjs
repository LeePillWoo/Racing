// Turns the raw Fab downloads into public/models/trackside.glb: picks the parts the game uses,
// normalises each to metres with its origin at bottom-centre, decimates, and shrinks textures to WebP.
//
// The raw downloads are not in the repository (tens of megabytes each). Fetch them with
// tools/fab-download.mjs into <downloads>/<folder>/ using the folder names in ASSETS below, then:
//   npm install --no-save @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
//   node tools/build-trackside.mjs <downloads> public/models/trackside.glb
// Listing ids for each folder are in public/models/CREDITS.md.
import { NodeIO, Document, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, weld, simplify, textureCompress, clearNodeParent, mergeDocuments, unpartition } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import { join } from "node:path";

const [downloads, outFile] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;

/**
 * name:      node name in the output file
 * file:      source GLB under <downloads>
 * nodes:     source node names that together make up this asset
 * size:      target size in metres along `axis` ("y" = height, "x" = width)
 * ratio:     fraction of triangles to keep (1 = leave alone)
 * texture:   max texture edge in pixels
 * keepMaps:  texture slots to keep besides base colour
 * cutout:    alpha-tested foliage; stays double sided
 */
const ASSETS = [
  { name: "spruce-a", file: "trees_spruce/low_poly_trees_free.glb", nodes: ["Tree_0"], size: 11, texture: 1024, keepMaps: [], cutout: true },
  { name: "spruce-b", file: "trees_spruce/low_poly_trees_free.glb", nodes: ["Tree-1_1"], size: 11, texture: 1024, keepMaps: [], cutout: true },
  { name: "spruce-c", file: "trees_spruce/low_poly_trees_free.glb", nodes: ["Tree-2_2"], size: 11, texture: 1024, keepMaps: [], cutout: true },
  { name: "tree-pine", file: "trees_summer/lodbillboard_summer_trees_pack.glb", nodes: ["PineBillboard"], size: 17, texture: 512, keepMaps: [], cutout: true },
  { name: "tree-maple", file: "trees_summer/lodbillboard_summer_trees_pack.glb", nodes: ["MapleFall"], size: 11, texture: 512, keepMaps: [], cutout: true },
  { name: "tree-crab", file: "trees_summer/lodbillboard_summer_trees_pack.glb", nodes: ["Crabapple"], size: 8, texture: 512, keepMaps: [], cutout: true },
  { name: "cone", file: "cone/traffic_cone.glb", nodes: ["Cone01", "Object002"], size: 0.72, ratio: 0.05, texture: 256, keepMaps: [] },
  { name: "tires", file: "tires/game_ready_free_car_tires.glb", nodes: ["Car_Tire_01", "Car_Tire_02", "Car_Tire_03"], size: 0.82, ratio: 0.09, error: 0.05, texture: 512, keepMaps: ["Normal", "MetallicRoughness"] },
  { name: "barrier", file: "barrier/concrete_barrier_04.glb", nodes: ["Concrete-Barrier_0"], size: 0.95, ratio: 0.1, error: 0.04, texture: 512, keepMaps: ["Normal"] },
  { name: "fence", file: "fence_barricade/fence_barricade_02.glb", nodes: ["Fence-Barricade_02_0"], size: 1.1, ratio: 0.35, texture: 256, keepMaps: [], doubleSided: true, metal: true },
  { name: "hoarding", file: "traffic_barrier/traffic_barrier.glb", nodes: ["RootNode"], size: 1.05, ratio: 0.5, texture: 256, keepMaps: [] },
  { name: "tent", file: "tent/fbx.glb", nodes: ["Tent_M_Tent_0"], size: 3.3, ratio: 0.018, texture: 512, keepMaps: [], doubleSided: true },
  { name: "tower", file: "light_tower/portable_light_tower.glb", nodes: ["Light2.obj.cleaner.materialmerger.gles"], size: 9.5, ratio: 0.03, error: 0.08, texture: 512, keepMaps: ["Emissive", "MetallicRoughness"] },
  { name: "bleacher", file: "bleacher/bleacher.glb", nodes: ["Seat_0", "Frame_1"], size: 2.55, texture: 512, keepMaps: ["Normal", "MetallicRoughness"], doubleSided: true },
];

const target = new Document();
target.createBuffer();
const targetScene = target.createScene("trackside");
target.getRoot().setDefaultScene(targetScene);

for (const asset of ASSETS) {
  const doc = await io.read(join(downloads, asset.file));
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const holder = doc.createNode(asset.name);
  for (const name of asset.nodes) {
    const matches = root.listNodes().filter(node => node.getName() === name);
    if (!matches.length) throw new Error(`${asset.name}: no node named ${name}`);
    for (const node of matches) { clearNodeParent(node); scene.removeChild(node); holder.addChild(node); }
  }
  for (const child of scene.listChildren()) child.dispose();
  scene.addChild(holder);

  // Metres, standing on the origin.
  const bounds = getBounds(holder);
  const scale = asset.size / (bounds.max[1] - bounds.min[1]);
  holder.setScale([scale, scale, scale]);
  holder.setTranslation([-(bounds.min[0] + bounds.max[0]) / 2 * scale, -bounds.min[1] * scale, -(bounds.min[2] + bounds.max[2]) / 2 * scale]);

  await doc.transform(prune());
  for (const material of root.listMaterials()) {
    material.setName(asset.name + "/" + material.getName());
    for (const slot of ["Normal", "MetallicRoughness", "Occlusion", "Emissive"]) {
      if (!asset.keepMaps.includes(slot)) material[`set${slot}Texture`](null);
    }
    // A glTF without a metal/rough map falls back to the factors, and exporters leave metallic at 1.
    if (!asset.keepMaps.includes("MetallicRoughness")) {
      material.setMetallicFactor(asset.metal ? 0.8 : 0).setRoughnessFactor(asset.metal ? 0.45 : 0.8);
    }
    if (asset.cutout) material.setAlphaMode("MASK").setAlphaCutoff(0.45).setDoubleSided(true);
    else material.setAlphaMode("OPAQUE").setDoubleSided(!!asset.doubleSided);
  }
  const steps = [dedup(), weld()];
  if (asset.ratio && asset.ratio < 1) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: asset.ratio, error: asset.error ?? 0.02, lockBorder: false }));
  steps.push(prune(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [asset.texture, asset.texture], quality: 82 }));
  await doc.transform(...steps);

  const tris = root.listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((s, p) => s + (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3, 0), 0);
  const size = getBounds(holder);
  console.log(asset.name.padEnd(11), String(Math.round(tris)).padStart(6), "tris ",
    size.max.map((v, i) => (v - size.min[i]).toFixed(2)).join(" x "), "m ",
    root.listTextures().map(t => `${t.getSize()?.join("x")}:${Math.round(t.getImage().byteLength / 1024)}k`).join(" "));

  mergeDocuments(target, doc);
}

// mergeDocuments brings every source in as its own scene; fold them into one.
for (const scene of target.getRoot().listScenes()) {
  if (scene === targetScene) continue;
  for (const node of scene.listChildren()) { scene.removeChild(node); targetScene.addChild(node); }
  scene.dispose();
}
await target.transform(dedup(), prune(), unpartition());
await io.write(outFile, target);
console.log("wrote", outFile);
