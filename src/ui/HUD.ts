import { TrackPath } from "../track/TrackPath";
import type { Racer } from "../race/RaceManager";
import { Speedometer } from "./Speedometer";
import { MiniMap } from "./MiniMap";
import { msToClock } from "../utils/MathUtils";

export interface HUDUpdateData {
  speedKmh: number;
  gear: "R" | "N" | "D";
  isDrifting: boolean;
  currentLapMs: number;
  bestLapMs: number | null;
  lapNumber: number;
  totalLaps: number;
  rank: number;
  totalRacers: number;
  standings: Racer[];
  dt: number;
}

export class HUD {
  private readonly root: HTMLElement;
  private readonly speedo = new Speedometer();
  private readonly minimap: MiniMap;
  private readonly speedValueEl: HTMLElement;
  private readonly gearEl: HTMLElement;
  private readonly lapTimeEl: HTMLElement;
  private readonly bestLapEl: HTMLElement;
  private readonly lapCountEl: HTMLElement;
  private readonly positionEl: HTMLElement;
  private readonly standingsEl: HTMLElement;
  private readonly driftEl: HTMLElement;
  private readonly fpsEl: HTMLElement;
  private finishOverlay: HTMLElement | null = null;

  constructor(container: HTMLElement, path: TrackPath) {
    this.minimap = new MiniMap(path);
    this.root = document.createElement("div");
    this.root.className = "hud-layer";
    this.root.innerHTML = `
      <div class="hud-top-left">
        <div class="hud-panel hud-laptime">
          <span class="label">LAP TIME</span>
          <span data-el="laptime">0:00.000</span>
          <div class="hud-sublap" data-el="bestlap">BEST --:--.---</div>
        </div>
      </div>
      <div class="hud-panel hud-lapcount" data-el="lapcount">LAP 1 / 3</div>
      <div class="hud-panel hud-standings">
        <span class="label">STANDINGS</span>
        <div data-el="standings"></div>
      </div>
      <div class="hud-panel hud-position" data-el="position">1<span style="font-size:0.9rem;opacity:0.6"> / 6</span></div>
      <div class="drift-indicator" data-el="drift">DRIFT!</div>
      <div class="hud-bottom-right">
        <div class="minimap-wrap" data-el="minimap-slot"></div>
        <div class="speedo" data-el="speedo-slot">
          <div class="speedo-readout">
            <div class="speedo-value" data-el="speedval">0</div>
            <div class="speedo-unit">KM/H</div>
            <div class="speedo-gear" data-el="gear">D</div>
          </div>
        </div>
      </div>
      <div class="fps-counter" data-el="fps">60 FPS</div>
    `;
    container.appendChild(this.root);

    this.root.querySelector('[data-el="minimap-slot"]')!.appendChild(this.minimap.element);
    const speedoSlot = this.root.querySelector('[data-el="speedo-slot"]')!;
    speedoSlot.insertBefore(this.speedo.element, speedoSlot.firstChild);

    this.speedValueEl = this.root.querySelector('[data-el="speedval"]')!;
    this.gearEl = this.root.querySelector('[data-el="gear"]')!;
    this.lapTimeEl = this.root.querySelector('[data-el="laptime"]')!;
    this.bestLapEl = this.root.querySelector('[data-el="bestlap"]')!;
    this.lapCountEl = this.root.querySelector('[data-el="lapcount"]')!;
    this.positionEl = this.root.querySelector('[data-el="position"]')!;
    this.standingsEl = this.root.querySelector('[data-el="standings"]')!;
    this.driftEl = this.root.querySelector('[data-el="drift"]')!;
    this.fpsEl = this.root.querySelector('[data-el="fps"]')!;
  }

  update(data: HUDUpdateData): void {
    this.speedo.render(data.speedKmh, data.dt);
    this.speedValueEl.textContent = Math.round(this.speedo.value).toString();
    this.gearEl.textContent = data.gear;

    this.lapTimeEl.textContent = msToClock(data.currentLapMs);
    this.bestLapEl.textContent = data.bestLapMs !== null ? `BEST ${msToClock(data.bestLapMs)}` : "BEST --:--.---";
    this.lapCountEl.textContent = `LAP ${Math.min(data.lapNumber + 1, data.totalLaps)} / ${data.totalLaps}`;

    this.positionEl.innerHTML = `${data.rank}<span style="font-size:0.9rem;opacity:0.6"> / ${data.totalRacers}</span>`;

    this.driftEl.classList.toggle("active", data.isDrifting);

    this.standingsEl.innerHTML = data.standings
      .map(
        (r) =>
          `<div class="standing-row ${r.isPlayer ? "is-player" : ""}">
            <span class="standing-rank">${r.rank}</span>
            <span class="standing-name">${r.name}</span>
          </div>`
      )
      .join("");

    this.minimap.render(data.standings);
  }

  setFps(fps: number): void {
    this.fpsEl.textContent = `${Math.round(fps)} FPS`;
  }

  showFinish(results: Racer[]): void {
    if (this.finishOverlay) return;
    const overlay = document.createElement("div");
    overlay.className = "finish-overlay";
    overlay.innerHTML = `
      <div class="finish-card">
        <h2>레이스 종료</h2>
        <p>최종 순위</p>
        <div>${results
          .map(
            (r, i) =>
              `<div class="standing-row ${r.isPlayer ? "is-player" : ""}" style="justify-content:center;font-size:1.05rem;">
                <span class="standing-rank">${i + 1}</span><span class="standing-name" style="flex:none;margin-left:8px;">${r.name}</span>
              </div>`
          )
          .join("")}</div>
        <button id="finish-restart" style="margin-top:20px;appearance:none;border:none;cursor:pointer;padding:12px 34px;font-size:1rem;font-weight:700;border-radius:999px;color:#10131a;background:linear-gradient(90deg,#ffd27a,#ff8a5c);">다시 시작</button>
      </div>
    `;
    this.root.appendChild(overlay);
    this.finishOverlay = overlay;
    overlay.querySelector("#finish-restart")!.addEventListener("click", () => location.reload());
  }
}
