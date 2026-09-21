import "./style.css";
import { Game } from "./core/Game";
import { TRACKS, TrackDef } from "./track/TrackCatalog";
import { TrackPath } from "./track/TrackPath";

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

  let selected: TrackDef = TRACKS[0];
  const cards = new Map<string, HTMLButtonElement>();

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
    const game = new Game(canvas, uiRoot, selected);
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
