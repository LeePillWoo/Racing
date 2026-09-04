import * as THREE from "three";

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  return { canvas, ctx };
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

/** Repeating asphalt texture with subtle speckle grain and a dashed center line + solid edge lines. */
export function createAsphaltTexture(): THREE.CanvasTexture {
  const size = 512;
  const { canvas, ctx } = makeCanvas(size);
  const rand = mulberry32(1337);

  ctx.fillStyle = "#3a3d42";
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 9000; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const g = 0.15 + rand() * 0.12;
    ctx.fillStyle = `rgba(${g * 255 * 0.9},${g * 255 * 0.95},${g * 255},${0.25 + rand() * 0.3})`;
    ctx.fillRect(x, y, 1 + rand() * 1.6, 1 + rand() * 1.6);
  }

  // subtle darker tire-wear streaks
  ctx.strokeStyle = "rgba(20,21,24,0.25)";
  ctx.lineWidth = 26;
  ctx.beginPath();
  ctx.moveTo(size * 0.32, 0);
  ctx.lineTo(size * 0.32, size);
  ctx.moveTo(size * 0.68, 0);
  ctx.lineTo(size * 0.68, size);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Road centerline + edge marking texture, meant to be stretched once along the ribbon length (V) and once across width (U). */
export function createRoadMarkingTexture(): THREE.CanvasTexture {
  const w = 128;
  const h = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);

  // edge lines
  ctx.fillStyle = "rgba(240,235,220,0.9)";
  ctx.fillRect(6, 0, 5, h);
  ctx.fillRect(w - 11, 0, 5, h);

  // dashed center line
  ctx.fillStyle = "rgba(235,200,90,0.85)";
  const dash = h / 16;
  for (let i = 0; i < 16; i += 2) {
    ctx.fillRect(w / 2 - 3, i * dash, 6, dash * 0.6);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Fine desert sand texture: warm base tone with dune ripple noise. */
export function createSandTexture(): THREE.CanvasTexture {
  const size = 512;
  const { canvas, ctx } = makeCanvas(size);
  const rand = mulberry32(77);

  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, "#d9b878");
  grad.addColorStop(1, "#c9a35f");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 4000; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const g = rand();
    ctx.fillStyle = `rgba(${120 + g * 90},${95 + g * 80},${55 + g * 50},${0.12 + rand() * 0.2})`;
    ctx.fillRect(x, y, 1 + rand() * 2.5, 1 + rand() * 2.5);
  }

  ctx.strokeStyle = "rgba(150,115,65,0.12)";
  ctx.lineWidth = 3;
  for (let i = 0; i < 22; i++) {
    ctx.beginPath();
    const y = rand() * size;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(size * 0.33, y + (rand() - 0.5) * 40, size * 0.66, y + (rand() - 0.5) * 40, size, y);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Soft scrolling noise used to fake water ripple shimmer via UV animation. */
export function createWaterNoiseTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size);
  const rand = mulberry32(4242);
  ctx.fillStyle = "#0b3b52";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2200; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const g = rand();
    ctx.fillStyle = `rgba(${180 + g * 60},${220 + g * 30},${235},${0.05 + g * 0.18})`;
    const r = 0.6 + rand() * 2.2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** Radial soft dot used as a billboard sprite for dust / smoke particles. */
export function createSoftDotTexture(): THREE.CanvasTexture {
  const size = 64;
  const { canvas, ctx } = makeCanvas(size);
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.5)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
