// Turns four Fab car models into public/models/cars.glb: one node per shell, each cut into the
// parts the game moves on their own (body, front piece, rear piece, one wheel) and re-fitted to
// the shared chassis. Geometry only — the game paints every surface itself, by material name.
//
// The raw downloads are not in the repository. Fetch them with tools/fab-download.mjs into
// <downloads>/<folder>/ using the folder names in CARS below, then:
//   npm install --no-save @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions
//   node tools/build-cars.mjs <downloads> public/models/cars.glb          build
//   node tools/build-cars.mjs <downloads> public/models/cars.glb --list   also print every piece
// Listing ids for each folder are in public/models/CREDITS.md.
import { NodeIO, Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { weld, prune } from "@gltf-transform/functions";
import { join } from "node:path";

const [downloads, outFile, flag] = process.argv.slice(2);

// The chassis every shell has to fit, from src/vehicle/VehicleConfig.ts. The wheels sit where the
// physics puts them front to back; side to side each shell keeps its own track (see `fit`).
const WHEEL_RADIUS = 0.46, WHEEL_Y = -0.56, AXLE_FRONT = 1.55, AXLE_REAR = -1.45;

/** Preview colours only. The game ignores them and looks the material up by name. */
const KINDS = {
  paint: [0.7, 0.05, 0.08], accent: [0.9, 0.9, 0.9], carbon: [0.03, 0.035, 0.045], rubber: [0.02, 0.02, 0.022],
  metal: [0.3, 0.33, 0.36], chrome: [0.8, 0.83, 0.86], glass: [0.02, 0.04, 0.07], lamp: [0.8, 0.03, 0.05], light: [1, 0.95, 0.8],
};

/**
 * One entry per shell.
 *   yaw      degrees to turn the source so its nose points down +Z
 *   tire     picks out the tyre pieces; the four wheels are found from them. `node` is
 *            "parent/name", since exporters hang each material's mesh on a child of the part
 *   wheel    kind for each piece of a wheel
 *   body     [part, kind] for each remaining piece, or null to drop it. Coordinates are metres on
 *            the game chassis: +Z forward, origin at the chassis centre, road at about -1.02.
 *   slices   whole regions of the body that come away as one part: every body triangle whose
 *            centre (x, y, z) satisfies `where` moves to `part`; `where` also gets the kind
 *   exhaust  where the tailpipe is, for the boost flame
 *   lamps    brake lights to add as boxes [x, y, z, width, height] where the model has none
 */
const CARS = {
  formula: {
    file: "f1_b/low_poly_f1.glb", yaw: 0,
    tire: p => p.node.includes("_Tire/") && p.material === "Dark_Black" && p.tris > 700,
    wheel: p => p.material === "Bloody_Red" ? "accent" : p.tris > 700 ? "rubber" : "metal",
    body: p => {
      if (p.node.startsWith("Front Wing Base/")) return ["front", "carbon"];
      if (p.node.startsWith("Rear Wing/")) return ["rear", "carbon"];
      if (p.material === "BaseColor") return ["body", "paint"];
      if (p.material === "2ndColor" || p.material === "3rdColor") return ["body", "accent"];
      if (p.material === "Mirror") return ["body", "chrome"];
      if (["FRod/", "RRod/", "Exhaust/"].some(part => p.node.startsWith(part))) return ["body", "metal"];
      return ["body", "carbon"];
    },
    slices: [],
    lamps: [[0, -0.32, -2.43, 0.14, 0.1]], exhaust: [0, 0.02, -2.3],
  },
  hyper: {
    file: "hyper_b/low_poly_hypercar.glb", yaw: 0,
    tire: p => p.node.includes("_Tire/"),
    wheel: p => ({ Tire: "rubber", material: "metal", material_6: "chrome", Brake: "accent" }[p.material]),
    body: p => {
      if (p.node.startsWith("RearWing/")) return ["rear", "carbon"];
      if (p.material === "Body") return ["body", "paint"];
      if (p.material === "Glass") return ["body", "glass"];
      if (p.material === "Light") return ["body", "light"];
      // The spine that runs back from the roof is the one black piece that reads as livery.
      if (p.size[0] < 0.8 && p.size[2] > 1.5 && p.centre[1] > 0) return ["body", "accent"];
      return ["body", "carbon"];
    },
    slices: [{ part: "front", where: (x, y, z) => z > 2.02 }],
    lamps: [[-0.6, -0.08, -2.375, 0.62, 0.08], [0.6, -0.08, -2.375, 0.62, 0.08]], exhaust: [0, -0.62, -2.3],
  },
  gt: {
    file: "gt_b/mitsubishi_evo.glb", yaw: 0,
    tire: p => p.material === "Tires" && p.tris === 252,
    wheel: p => p.material === "Tires" ? "rubber" : "metal",
    body: p => {
      if (p.material === "Back.Lights") return ["body", "lamp"];
      if (p.material === "Front.Lights") return ["body", "light"];
      if (p.material === "Glass") return ["body", "glass"];
      if (p.material === "Silver") return ["body", "chrome"];
      if (p.material === "Tires") {
        return ["body", "carbon"];
      }
      // Paint: the roof panel is its own piece, which makes it a free two-tone.
      if (p.centre[1] > 0.6 && p.size[1] < 0.3 && p.size[2] > 1) return ["body", "accent"];
      return ["body", "paint"];
    },
    // The nose panel, and the wing with the tops of its struts: both are welded into the shell.
    slices: [{ part: "front", where: (x, y, z) => z > 2.12 }, { part: "rear", where: (x, y, z, kind) => kind !== "glass" && z < -1.93 && y > 0.56 }],
    lamps: [], exhaust: [-0.57, -0.61, -2.36],
  },
  muscle: {
    file: "gt_a/low_poly_sport_car.glb", yaw: 90,
    tire: p => /^wheel/.test(p.node) && p.material === "black" && p.tris > 300,
    wheel: p => p.material === "metal" ? "metal" : "rubber",
    body: p => {
      if (p.material === "red_light") return ["body", "lamp"];
      if (p.material === "lights") return ["body", "light"];
      if (p.material === "reflective_glass") return ["body", "glass"];
      if (p.material === "metal") return ["body", "chrome"];
      if (p.material === "black") return ["body", "carbon"];
      // The door mirrors are the only painted pieces apart from the shell itself.
      return p.tris < 100 ? ["body", "accent"] : ["body", "paint"];
    },
    slices: [{ part: "front", where: (x, y, z) => z > 2.0 }, { part: "rear", where: (x, y, z) => z < -2.02 }],
    lamps: [], exhaust: [0.6, -0.55, -2.46],
  },
};

function islandsOf(positions) {
  // Welded by position first: exporters split vertices on every hard edge and UV seam.
  const ids = new Map(), remap = new Uint32Array(positions.length / 3);
  for (let i = 0; i < remap.length; i++) {
    const key = `${positions[i * 3].toFixed(4)},${positions[i * 3 + 1].toFixed(4)},${positions[i * 3 + 2].toFixed(4)}`;
    if (!ids.has(key)) ids.set(key, ids.size);
    remap[i] = ids.get(key);
  }
  const parent = Uint32Array.from({ length: ids.size }, (_, i) => i);
  const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let t = 0; t < remap.length; t += 3) { const a = find(remap[t]); parent[find(remap[t + 1])] = a; parent[find(remap[t + 2])] = a; }
  const groups = new Map();
  for (let t = 0; t < remap.length; t += 3) {
    const root = find(remap[t]);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(t / 3);
  }
  return [...groups.values()];
}

/** A piece is one connected island of one material: triangle soup, positions and normals. */
function measure(piece) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < piece.positions.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], piece.positions[i + k]); max[k] = Math.max(max[k], piece.positions[i + k]);
  }
  piece.tris = piece.positions.length / 9;
  piece.centre = min.map((v, k) => (v + max[k]) / 2);
  piece.size = max.map((v, k) => v - min[k]);
  return piece;
}

async function readPieces(io, file, yawDeg) {
  const doc = await io.read(file), pieces = [];
  const yaw = yawDeg * Math.PI / 180, cos = Math.cos(yaw), sin = Math.sin(yaw);
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const m = node.getWorldMatrix();
    // Rotate a vector by the node's world matrix, then by the yaw that points the nose down +Z.
    const turn = (v, w) => {
      const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * w, y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * w;
      const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * w;
      return [x * cos + z * sin, y, -x * sin + z * cos];
    };
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute("POSITION"), normal = prim.getAttribute("NORMAL"), index = prim.getIndices();
      const count = index ? index.getCount() : position.getCount();
      const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), v = [];
      for (let i = 0; i < count; i++) {
        const at = index ? index.getScalar(i) : i;
        positions.set(turn(position.getElement(at, v), 1), i * 3);
        const n = turn(normal.getElement(at, v), 0), length = Math.hypot(...n) || 1;
        normals.set(n.map(c => c / length), i * 3);
      }
      for (const triangles of islandsOf(positions)) {
        const piece = { node: (node.getParentNode()?.getName() ?? "") + "/" + node.getName(), material: prim.getMaterial()?.getName() ?? "",
          positions: new Float32Array(triangles.length * 9), normals: new Float32Array(triangles.length * 9) };
        triangles.forEach((t, i) => {
          piece.positions.set(positions.subarray(t * 9, t * 9 + 9), i * 9);
          piece.normals.set(normals.subarray(t * 9, t * 9 + 9), i * 9);
        });
        pieces.push(measure(piece));
      }
    }
  }
  return pieces;
}

/** Moves a piece by `map` (a per-axis scale and offset) and corrects its normals for the stretch. */
function remap(piece, scale, offset) {
  for (let i = 0; i < piece.positions.length; i += 3) {
    let length = 0;
    for (let k = 0; k < 3; k++) {
      piece.positions[i + k] = piece.positions[i + k] * scale[k] + offset[k];
      piece.normals[i + k] /= scale[k]; length += piece.normals[i + k] ** 2;
    }
    length = Math.sqrt(length) || 1;
    for (let k = 0; k < 3; k++) piece.normals[i + k] /= length;
  }
  return measure(piece);
}

function box([x, y, z, width, height]) {
  // A thin slab facing backwards: two triangles are all a tail light needs.
  const w = width / 2, h = height / 2, corners = [[-w, -h], [w, -h], [w, h], [-w, -h], [w, h], [-w, h]];
  return measure({ node: "lamp", material: "lamp", positions: Float32Array.from(corners.flatMap(([cx, cy]) => [x + cx, y + cy, z])),
    normals: Float32Array.from(corners.flatMap(() => [0, 0, -1])) });
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const out = new Document();
const buffer = out.createBuffer();
const scene = out.createScene("cars");
const materials = Object.fromEntries(Object.entries(KINDS).map(([kind, color]) =>
  [kind, out.createMaterial(kind).setBaseColorFactor([...color, 1]).setRoughnessFactor(0.6).setMetallicFactor(0).setDoubleSided(true)]));

for (const [style, car] of Object.entries(CARS)) {
  const pieces = await readPieces(io, join(downloads, car.file), car.yaw);

  // Find the four wheels from their tyres, then fit the model to the chassis.
  const tyres = pieces.filter(car.tire);
  const midX = tyres.reduce((s, p) => s + p.centre[0], 0) / tyres.length, midZ = tyres.reduce((s, p) => s + p.centre[2], 0) / tyres.length;
  const wheels = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sz]) => {
    const own = tyres.filter(p => Math.sign(p.centre[0] - midX) === sx && Math.sign(p.centre[2] - midZ) === sz);
    if (own.length !== 1) throw new Error(`${style}: expected one tyre per corner, found ${own.length}`);
    return { centre: own[0].centre, radius: Math.max(own[0].size[1], own[0].size[2]) / 2, width: own[0].size[0], side: sx, end: sz };
  });
  const radius = wheels.reduce((s, w) => s + w.radius, 0) / 4;
  const track = wheels.reduce((s, w) => s + Math.abs(w.centre[0] - midX), 0) / 4;
  const frontZ = (wheels[0].centre[2] + wheels[1].centre[2]) / 2, rearZ = (wheels[2].centre[2] + wheels[3].centre[2]) / 2;
  const axleY = wheels.reduce((s, w) => s + w.centre[1], 0) / 4;
  // Width and height follow the wheel, so the tyres fill their arches and the car looks right
  // from behind, which is where the camera sits. Length follows the wheelbase, which is shorter
  // than any real car's: the shell is squeezed nose to tail, the one direction it shows least.
  const across = WHEEL_RADIUS / radius, along = (AXLE_FRONT - AXLE_REAR) / (frontZ - rearZ);
  const fit = [[across, across, along], [-midX * across, WHEEL_Y - axleY * across, AXLE_FRONT - frontZ * along]];
  console.log(`${style.padEnd(8)} wheel r ${radius.toFixed(3)}  scale across ${across.toFixed(3)} along ${along.toFixed(3)} (${(along / across).toFixed(2)})  track ${(track * across).toFixed(3)}`);

  // The wheel template is the right rear wheel: unsteered, and its outer face already points +X.
  const template = wheels.find(w => w.side === 1 && w.end === -1);
  const parts = { body: [], front: [], rear: [], wheel: [] };
  for (const piece of pieces) {
    // Part of a wheel if it fits inside that wheel's cylinder.
    const wheel = wheels.find(w => [1, 2].every(k => Math.abs(piece.centre[k] - w.centre[k]) + piece.size[k] / 2 < w.radius * 1.12)
      && Math.abs(piece.centre[0] - w.centre[0]) + piece.size[0] / 2 < w.width * 1.3);
    if (wheel) {
      if (wheel !== template) continue;
      const scale = WHEEL_RADIUS / wheel.radius, kind = car.wheel(piece);
      remap(piece, [scale, scale, scale], wheel.centre.map(c => -c * scale));
      parts.wheel.push({ piece, kind });
      continue;
    }
    remap(piece, ...fit);
    const verdict = car.body(piece);
    if (flag === "--list") console.log(`   ${piece.node.slice(0, 22).padEnd(22)} ${piece.material.slice(0, 14).padEnd(14)} ${String(piece.tris).padStart(5)}  c ${piece.centre.map(v => v.toFixed(2).padStart(6)).join("")}  s ${piece.size.map(v => v.toFixed(2).padStart(6)).join("")}  -> ${verdict}`);
    if (verdict) parts[verdict[0]].push({ piece, kind: verdict[1] });
  }
  for (const lamp of car.lamps) parts.body.push({ piece: box(lamp), kind: "lamp" });

  // Regions of the body that come away whole: move their triangles across, kind unchanged.
  for (const slice of car.slices) {
    for (const entry of [...parts.body]) {
      if (entry.kind === "lamp") continue;
      const keep = [], move = [], { positions, normals } = entry.piece;
      for (let t = 0; t < positions.length; t += 9) {
        const centre = [0, 1, 2].map(k => (positions[t + k] + positions[t + 3 + k] + positions[t + 6 + k]) / 3);
        (slice.where(...centre, entry.kind) ? move : keep).push(t);
      }
      if (move.length === 0) continue;
      const take = list => measure({ ...entry.piece, positions: Float32Array.from(list.flatMap(t => [...positions.subarray(t, t + 9)])),
        normals: Float32Array.from(list.flatMap(t => [...normals.subarray(t, t + 9)])) });
      parts[slice.part].push({ piece: take(move), kind: entry.kind });
      if (keep.length === 0) parts.body.splice(parts.body.indexOf(entry), 1);
      else entry.piece = take(keep);
    }
  }

  const root = out.createNode(style).setExtras({ track: track * across, exhaust: car.exhaust });
  scene.addChild(root);
  for (const [name, entries] of Object.entries(parts)) {
    if (entries.length === 0) throw new Error(`${style}: nothing ended up in "${name}"`);
    const mesh = out.createMesh(`${style}-${name}`);
    // One primitive per kind: that is one draw call per surface type on each part.
    for (const kind of new Set(entries.map(e => e.kind))) {
      if (!materials[kind]) throw new Error(`${style}/${name}: unknown kind "${kind}"`);
      const own = entries.filter(e => e.kind === kind).map(e => e.piece);
      const join3 = key => { const all = new Float32Array(own.reduce((s, p) => s + p[key].length, 0)); let at = 0; for (const p of own) { all.set(p[key], at); at += p[key].length; } return all; };
      mesh.addPrimitive(out.createPrimitive().setMaterial(materials[kind])
        .setAttribute("POSITION", out.createAccessor().setType("VEC3").setArray(join3("positions")).setBuffer(buffer))
        .setAttribute("NORMAL", out.createAccessor().setType("VEC3").setArray(join3("normals")).setBuffer(buffer)));
    }
    root.addChild(out.createNode(name).setMesh(mesh));
    const tris = entries.reduce((s, e) => s + e.piece.tris, 0);
    const lo = [0, 1, 2].map(k => Math.min(...entries.map(e => e.piece.centre[k] - e.piece.size[k] / 2)).toFixed(2));
    const hi = [0, 1, 2].map(k => Math.max(...entries.map(e => e.piece.centre[k] + e.piece.size[k] / 2)).toFixed(2));
    console.log(`   ${name.padEnd(6)} ${String(tris).padStart(6)} tris  ${lo} .. ${hi}  ${[...new Set(entries.map(e => e.kind))].join(", ")}`);
  }
}

await out.transform(weld(), prune());
await io.write(outFile, out);
console.log("wrote", outFile);
