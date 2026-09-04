import * as THREE from "three";
import { TrackPath } from "../track/TrackPath";
import type { Racer } from "../race/RaceManager";

const SIZE = 352; // rendered at 2x CSS size for crispness

export class MiniMap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private readonly points: THREE.Vector3[];

  constructor(private readonly path: TrackPath) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext("2d")!;
    this.points = [...path.getSamplePoints()];

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of this.points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const pad = 40;
    this.bounds = { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
  }

  get element(): HTMLCanvasElement {
    return this.canvas;
  }

  private project(x: number, z: number): [number, number] {
    const { minX, maxX, minZ, maxZ } = this.bounds;
    const w = maxX - minX;
    const h = maxZ - minZ;
    const scale = Math.min(SIZE / w, SIZE / h);
    const offX = (SIZE - w * scale) / 2;
    const offY = (SIZE - h * scale) / 2;
    return [offX + (x - minX) * scale, offY + (z - minZ) * scale];
  }

  render(racers: Racer[]): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = "rgba(10,14,20,0.35)";
    ctx.fillRect(0, 0, SIZE, SIZE);

    ctx.lineWidth = 10;
    ctx.strokeStyle = "rgba(230,225,210,0.85)";
    ctx.lineJoin = "round";
    ctx.beginPath();
    this.points.forEach((p, i) => {
      const [x, y] = this.project(p.x, p.z);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();

    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(60,64,70,0.9)";
    ctx.stroke();

    const start = this.project(this.points[0].x, this.points[0].z);
    ctx.fillStyle = "#ffd27a";
    ctx.fillRect(start[0] - 4, start[1] - 4, 8, 8);

    for (const racer of racers) {
      const pos = racer.vehicle.position();
      const [x, y] = this.project(pos.x, pos.z);
      ctx.beginPath();
      ctx.fillStyle = racer.isPlayer ? "#ffd27a" : (racer.color as string);
      ctx.strokeStyle = "rgba(10,10,10,0.8)";
      ctx.lineWidth = racer.isPlayer ? 2.5 : 1.5;
      ctx.arc(x, y, racer.isPlayer ? 7 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}
