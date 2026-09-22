import "./style.css";
import { Game } from "./core/Game";
import { TRACKS, TrackDef } from "./track/TrackCatalog";
import { TrackPath } from "./track/TrackPath";
import { CARS, CarModel } from "./vehicle/CarCatalog";
import type { CarStyle } from "./vehicle/CarMesh";

/** Draws a circuit's outline into a card-sized canvas, so the picker shows the actual layout. */
function drawThumb(canvas: HTMLCanvasElement, path: TrackPath): void {
  const size = 132;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const points = path.getSamplePoints();
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const pad = 11;
  const scale = Math.min((size - pad * 2) / (maxX - minX), (size - pad * 2) / (maxZ - minZ));
  const offX = (size - (maxX - minX) * scale) / 2, offY = (size - (maxZ - minZ) * scale) / 2;
  ctx.lineJoin = ctx.lineCap = "round";
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = offX + (p.x - minX) * scale, y = offY + (p.z - minZ) * scale;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.strokeStyle = "#e9f1f8"; ctx.lineWidth = 7; ctx.stroke();
  ctx.strokeStyle = "#1d2c3d"; ctx.lineWidth = 4.2; ctx.stroke();
  const start = points[0];
  ctx.fillStyle = "#e5f34b";
  ctx.fillRect(offX + (start.x - minX) * scale - 3, offY + (start.z - minZ) * scale - 3, 6, 6);
}

/**
 * A side-profile silhouette of each shell, drawn flat in 2D. A real 3D preview would mean a second
 * renderer and a second scene on a screen that has to appear instantly; a 60-line sketch says
 * "open-wheel" or "muscle car" just as clearly.
 */
function drawCarThumb(canvas: HTMLCanvasElement, model: CarModel): void {
  const w = 132, h = 63;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const body = String(model.paint.body), accent = String(model.paint.accent);
  const ground = 50, wheelR = 9;
  const plate = (x: number, y: number, width: number, height: number, color: string, radius = 3) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fill();
  };
  const shells: Record<CarStyle, () => void> = {
    formula: () => {
      plate(24, 34, 84, 9, body, 4);
      plate(96, 30, 26, 6, body, 3);          // nose
      plate(112, 38, 16, 4, accent, 2);       // front wing
      plate(4, 20, 6, 18, body, 2);           // rear wing pylon
      plate(2, 17, 24, 5, accent, 2);
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(66, 30, 6, 0, Math.PI * 2); ctx.fill();
    },
    gt: () => {
      plate(12, 28, 112, 16, body, 5);
      plate(40, 14, 54, 15, body, 6);
      plate(46, 17, 42, 9, "#22303d", 3);     // glasshouse
      plate(6, 12, 22, 5, accent, 2);         // rear wing
      plate(8, 17, 5, 11, body, 2);
      plate(116, 42, 14, 4, accent, 2);       // splitter
    },
    hyper: () => {
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(14, 44); ctx.lineTo(24, 30); ctx.lineTo(74, 22);
      ctx.lineTo(112, 30); ctx.lineTo(128, 42); ctx.lineTo(128, 46); ctx.lineTo(14, 46);
      ctx.closePath(); ctx.fill();
      plate(52, 19, 40, 8, "#22303d", 4);     // canopy
      plate(4, 10, 26, 5, accent, 2);         // swan wing
      plate(10, 15, 5, 13, body, 2);
      plate(118, 44, 12, 4, accent, 2);
    },
    muscle: () => {
      plate(10, 26, 116, 19, body, 4);
      plate(36, 10, 56, 18, body, 5);
      plate(42, 13, 44, 11, "#22303d", 3);
      plate(96, 14, 20, 12, "#2c3038", 2);    // blower
      plate(100, 9, 12, 6, accent, 2);
      plate(6, 20, 26, 5, accent, 2);         // duckbill
    },
  };
  shells[model.style]();
  ctx.fillStyle = "#15202c";
  for (const x of [34, 100]) { ctx.beginPath(); ctx.arc(x, ground, wheelR, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = accent;
  for (const x of [34, 100]) { ctx.beginPath(); ctx.arc(x, ground, wheelR * 0.42, 0, Math.PI * 2); ctx.fill(); }
}

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById("viewport") as HTMLCanvasElement;
  const uiRoot = document.getElementById("ui-root") as HTMLElement;
  const loadingScreen = document.getElementById("loading-screen")!;
  const loadingBarFill = document.getElementById("loading-bar-fill")!;
  const loadingLabel = document.getElementById("loading-label")!;
  const startScreen = document.getElementById("start-screen")!;
  const startButton = document.getElementById("start-button") as HTMLButtonElement;
  const trackSelect = document.getElementById("track-select")!;
  const raceSpecs = document.getElementById("race-specs")!;
  const blurb = document.getElementById("track-blurb")!;
  const brandTrack = document.getElementById("brand-track")!;
  const carSelect = document.getElementById("car-select")!;

  let selected: TrackDef = TRACKS[0];
  let selectedCar: CarModel = CARS[0];
  const cards = new Map<string, HTMLButtonElement>();
  const carCards = new Map<string, HTMLButtonElement>();

  function select(track: TrackDef, lengthKm: string): void {
    selected = track;
    cards.forEach((card, id) => {
      const on = id === track.id;
      card.classList.toggle("selected", on);
      card.setAttribute("aria-checked", String(on));
    });
    blurb.textContent = track.blurb;
    brandTrack.textContent = track.subtitle;
    raceSpecs.innerHTML =
      `<div><b>12</b><span>DRIVERS</span></div>` +
      `<div><b>${String(track.laps).padStart(2, "0")}</b><span>LAPS</span></div>` +
      `<div><b>${lengthKm}</b><span>KM / LAP</span></div>`;
  }

  function selectCar(model: CarModel): void {
    selectedCar = model;
    carCards.forEach((card, id) => {
      const on = id === model.id;
      card.classList.toggle("selected", on);
      card.setAttribute("aria-checked", String(on));
    });
  }

  for (const model of CARS) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "car-card";
    card.dataset.car = model.id;
    card.setAttribute("role", "radio");
    const thumb = document.createElement("canvas");
    thumb.className = "car-thumb";
    drawCarThumb(thumb, model);
    const name = document.createElement("span");
    name.className = "car-name";
    name.textContent = model.name;
    const sub = document.createElement("span");
    sub.className = "car-sub";
    sub.textContent = model.blurb;
    card.append(thumb, name, sub);
    card.addEventListener("click", () => selectCar(model));
    carCards.set(model.id, card);
    carSelect.append(card);
  }
  selectCar(selectedCar);

  const lengths = new Map<string, string>();
  for (const track of TRACKS) {
    // A coarse sampling is plenty for a 132 px thumbnail and keeps the picker instant.
    const path = new TrackPath(track, 600);
    lengths.set(track.id, (path.totalLength / 1000).toFixed(2));
    const card = document.createElement("button");
    card.type = "button";
    card.className = "track-card";
    card.dataset.track = track.id;
    card.setAttribute("role", "radio");
    const thumb = document.createElement("canvas");
    thumb.className = "track-thumb";
    drawThumb(thumb, path);
    card.append(thumb);
    const name = document.createElement("span");
    name.className = "track-name";
    name.textContent = track.name;
    const sub = document.createElement("span");
    sub.className = "track-sub";
    sub.textContent = `${track.subtitle} · ${lengths.get(track.id)} km`;
    card.append(name, sub);
    card.addEventListener("click", () => select(track, lengths.get(track.id)!));
    cards.set(track.id, card);
    trackSelect.append(card);
  }
  select(selected, lengths.get(selected.id)!);

  startButton.addEventListener("click", async () => {
    startButton.disabled = true;
    startScreen.classList.add("hidden");
    loadingScreen.classList.remove("hidden");
    const game = new Game(canvas, uiRoot, selected, selectedCar);
    if (import.meta.env.DEV) Object.assign(window, { __racing: game });
    try {
      await game.load((fraction, label) => {
        loadingBarFill.style.width = `${Math.round(fraction * 100)}%`;
        loadingLabel.textContent = label;
      });
    } catch (err) {
      console.error(err);
      loadingLabel.textContent = `오류가 발생했습니다: ${(err as Error).message}`;
      return;
    }
    loadingScreen.classList.add("hidden");
    canvas.focus();
    game.start();
  });
}

bootstrap().catch((err) => {
  console.error(err);
  const label = document.getElementById("loading-label");
  if (label) label.textContent = `오류가 발생했습니다: ${(err as Error).message}`;
});
