import * as THREE from "three";
import { TrackPath } from "../track/TrackPath";
import { Vehicle } from "../vehicle/Vehicle";

export interface Racer {
  id: string;
  name: string;
  isPlayer: boolean;
  vehicle: Vehicle;
  color: THREE.ColorRepresentation;
  sampleHint: number;
  lastU: number;
  distanceTraveled: number;
  highestLapFloor: number;
  lapStartTimeMs: number;
  lapTimesMs: number[];
  bestLapMs: number | null;
  finished: boolean;
  finishTimeMs: number | null;
  finishOrder: number | null;
  rank: number;
}

export interface RaceEvents {
  onLapCompleted?: (racer: Racer, lapMs: number, lapNumber: number) => void;
  onRaceFinished?: (racer: Racer, place: number) => void;
}

const MAX_PLAUSIBLE_STEP_DISTANCE = 25; // meters per physics substep; guards against projection glitches

export class RaceManager {
  readonly racers: Racer[] = [];
  readonly totalLaps: number;
  private readonly path: TrackPath;
  private events: RaceEvents;
  private clockMs = 0;
  private finishCounter = 0;
  private raceOver = false;

  constructor(path: TrackPath, totalLaps: number, events: RaceEvents = {}) {
    this.path = path;
    this.totalLaps = totalLaps;
    this.events = events;
  }

  addRacer(id: string, name: string, isPlayer: boolean, vehicle: Vehicle, color: THREE.ColorRepresentation): Racer {
    const { u, index } = this.path.projectPoint(vehicle.position());
    const racer: Racer = {
      id,
      name,
      isPlayer,
      vehicle,
      color,
      sampleHint: index,
      lastU: u,
      distanceTraveled: 0,
      highestLapFloor: 0,
      lapStartTimeMs: 0,
      lapTimesMs: [],
      bestLapMs: null,
      finished: false,
      finishTimeMs: null,
      finishOrder: null,
      rank: this.racers.length + 1,
    };
    this.racers.push(racer);
    return racer;
  }

  get isRaceOver(): boolean {
    return this.raceOver;
  }

  currentLapMs(racer: Racer): number {
    return this.clockMs - racer.lapStartTimeMs;
  }

  /** Call once per render frame (after all physics substeps for this frame have run). */
  update(dtMs: number): void {
    this.clockMs += dtMs;

    for (const racer of this.racers) {
      const { u, index } = this.path.projectPoint(racer.vehicle.position(), racer.sampleHint);
      racer.sampleHint = index;

      let rawDiff = u - racer.lastU;
      if (rawDiff > this.path.totalLength / 2) rawDiff -= this.path.totalLength;
      else if (rawDiff < -this.path.totalLength / 2) rawDiff += this.path.totalLength;
      if (Math.abs(rawDiff) < MAX_PLAUSIBLE_STEP_DISTANCE) {
        racer.distanceTraveled += rawDiff;
      }
      racer.lastU = u;

      const lapFloor = Math.max(0, Math.floor(racer.distanceTraveled / this.path.totalLength));
      if (lapFloor > racer.highestLapFloor && !racer.finished) {
        racer.highestLapFloor = lapFloor;
        const lapMs = this.clockMs - racer.lapStartTimeMs;
        racer.lapTimesMs.push(lapMs);
        racer.bestLapMs = racer.bestLapMs === null ? lapMs : Math.min(racer.bestLapMs, lapMs);
        racer.lapStartTimeMs = this.clockMs;
        this.events.onLapCompleted?.(racer, lapMs, lapFloor);

        if (lapFloor >= this.totalLaps) {
          racer.finished = true;
          racer.finishTimeMs = this.clockMs;
          this.finishCounter++;
          racer.finishOrder = this.finishCounter;
          this.events.onRaceFinished?.(racer, this.finishCounter);
          if (racer.isPlayer) this.raceOver = true;
        }
      }
    }

    const ordered = [...this.racers].sort((a, b) => {
      if (a.finishOrder !== null || b.finishOrder !== null) {
        return (a.finishOrder ?? Infinity) - (b.finishOrder ?? Infinity);
      }
      return b.distanceTraveled - a.distanceTraveled;
    });
    ordered.forEach((racer, i) => (racer.rank = i + 1));
  }

  resetRacerToTrack(racer: Racer): void {
    const frame = this.path.frameAtDistance(racer.lastU);
    const yaw = Math.atan2(frame.tangent.x, frame.tangent.z);
    const pos = frame.point.clone().addScaledVector(frame.right, 0);
    racer.vehicle.resetTo(pos, yaw);
  }

  player(): Racer | undefined {
    return this.racers.find((r) => r.isPlayer);
  }
}
