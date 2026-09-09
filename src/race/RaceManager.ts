import * as THREE from "three";
import { TrackPath, ROAD_HALF_WIDTH } from "../track/TrackPath";
import type { Vehicle } from "../vehicle/Vehicle";

export interface Racer {
  id: string; name: string; isPlayer: boolean; vehicle: Vehicle; color: THREE.ColorRepresentation;
  sampleHint: number; lastU: number; distanceTraveled: number; highestLapFloor: number;
  lapStartTimeMs: number; lapTimesMs: number[]; bestLapMs: number | null;
  finished: boolean; finishTimeMs: number | null; finishOrder: number | null; rank: number;
}
export interface RaceEvents {
  onLapCompleted?: (racer: Racer, lapMs: number, lapNumber: number) => void;
  onRaceFinished?: (racer: Racer, place: number) => void;
}

export class RaceManager {
  readonly racers: Racer[] = [];
  private clockMs = 0;
  private finishCounter = 0;
  private raceOver = false;
  constructor(private readonly path: TrackPath, readonly totalLaps: number, private readonly events: RaceEvents = {}) {}

  addRacer(id: string, name: string, isPlayer: boolean, vehicle: Vehicle, color: THREE.ColorRepresentation): Racer {
    const { u, index } = this.path.projectPoint(vehicle.position());
    // All grid positions are behind the common start/finish line.
    const distanceTraveled = u > this.path.totalLength / 2 ? u - this.path.totalLength : u;
    const racer: Racer = {
      id, name, isPlayer, vehicle, color, sampleHint: index, lastU: u, distanceTraveled,
      highestLapFloor: 0, lapStartTimeMs: 0, lapTimesMs: [], bestLapMs: null,
      finished: false, finishTimeMs: null, finishOrder: null, rank: this.racers.length + 1,
    };
    this.racers.push(racer);
    return racer;
  }

  get isRaceOver(): boolean { return this.raceOver; }
  currentLapMs(racer: Racer): number {
    return racer.finished ? (racer.lapTimesMs.at(-1) ?? 0) : this.clockMs - racer.lapStartTimeMs;
  }

  update(dtMs: number): void {
    if (this.raceOver) return;
    const previousClock = this.clockMs;
    this.clockMs += dtMs;
    const finishers: Racer[] = [];
    for (const racer of this.racers) {
      if (racer.finished) continue;
      const { u, index, distance } = this.path.projectPoint(racer.vehicle.position(), racer.sampleHint);
      let diff = u - racer.lastU;
      if (diff > this.path.totalLength / 2) diff -= this.path.totalLength;
      else if (diff < -this.path.totalLength / 2) diff += this.path.totalLength;
      // Preserve the last valid location for reset; driving through the infield earns no progress.
      if (Math.abs(diff) >= 25 || distance > ROAD_HALF_WIDTH + 3) continue;
      racer.sampleHint = index;
      const before = racer.distanceTraveled;
      racer.distanceTraveled += diff;
      racer.lastU = u;
      const lap = Math.max(0, Math.floor(racer.distanceTraveled / this.path.totalLength));
      if (lap > racer.highestLapFloor) {
        const boundary = lap * this.path.totalLength;
        const fraction = diff > 0 ? THREE.MathUtils.clamp((boundary - before) / diff, 0, 1) : 1;
        const crossingTime = previousClock + dtMs * fraction;
        const lapMs = crossingTime - racer.lapStartTimeMs;
        racer.highestLapFloor = lap;
        racer.lapTimesMs.push(lapMs);
        racer.bestLapMs = Math.min(racer.bestLapMs ?? Infinity, lapMs);
        racer.lapStartTimeMs = crossingTime;
        this.events.onLapCompleted?.(racer, lapMs, lap);
        if (lap >= this.totalLaps) {
          racer.finished = true;
          racer.finishTimeMs = crossingTime;
          finishers.push(racer);
        }
      }
    }
    // Crossing time, not array order, decides a close finish in the same frame.
    finishers.sort((a, b) => a.finishTimeMs! - b.finishTimeMs!).forEach(racer => {
      racer.finishOrder = ++this.finishCounter;
      this.events.onRaceFinished?.(racer, racer.finishOrder);
      if (racer.isPlayer) this.raceOver = true;
    });
    [...this.racers].sort((a, b) => {
      if (a.finishOrder !== null || b.finishOrder !== null) return (a.finishOrder ?? Infinity) - (b.finishOrder ?? Infinity);
      return b.distanceTraveled - a.distanceTraveled;
    }).forEach((racer, i) => { racer.rank = i + 1; });
  }

  resetRacerToTrack(racer: Racer): void {
    const frame = this.path.frameAtDistance(racer.lastU);
    const yaw = Math.atan2(frame.tangent.x, frame.tangent.z);
    // Prefer a clear lane so a recovery does not place two chassis inside each other.
    const offsets = [0, -3.2, 3.2, -6, 6];
    const lane = offsets.find(offset => {
      const candidate = frame.point.clone().addScaledVector(frame.right, offset);
      return this.racers.every(other => other === racer || other.vehicle.position().distanceTo(candidate) > 4);
    }) ?? 0;
    racer.vehicle.resetTo(frame.point.clone().addScaledVector(frame.right, lane), yaw);
  }

  player(): Racer | undefined { return this.racers.find(racer => racer.isPlayer); }
}
