const SIZE = 168;
const START_ANGLE = Math.PI * 0.72;
const END_ANGLE = Math.PI * 2.28;
const MAX_KMH = 220;

/** Canvas arc gauge for the speedometer face; numeric readout is a separate DOM overlay. */
export class Speedometer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private displayedKmh = 0;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = SIZE * 2;
    this.canvas.height = SIZE * 2;
    this.ctx = this.canvas.getContext("2d")!;
  }

  get element(): HTMLCanvasElement {
    return this.canvas;
  }

  render(speedKmh: number, dt: number): void {
    this.displayedKmh += (speedKmh - this.displayedKmh) * Math.min(1, dt * 8);
    const ctx = this.ctx;
    const cx = SIZE;
    const cy = SIZE;
    const r = SIZE * 0.86;
    ctx.clearRect(0, 0, SIZE * 2, SIZE * 2);

    ctx.lineWidth = 14;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.arc(cx, cy, r, START_ANGLE, END_ANGLE);
    ctx.stroke();

    const frac = Math.min(1, this.displayedKmh / MAX_KMH);
    const grad = ctx.createLinearGradient(0, 0, SIZE * 2, SIZE * 2);
    grad.addColorStop(0, "#4fc3ff");
    grad.addColorStop(0.55, "#ffd27a");
    grad.addColorStop(1, "#ff5c5c");
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, START_ANGLE, START_ANGLE + (END_ANGLE - START_ANGLE) * frac);
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    for (let i = 0; i <= 11; i++) {
      const a = START_ANGLE + ((END_ANGLE - START_ANGLE) * i) / 11;
      const inner = r - 16;
      const outer = r + 10;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      ctx.stroke();
    }

    const needleAngle = START_ANGLE + (END_ANGLE - START_ANGLE) * frac;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(needleAngle);
    ctx.fillStyle = "#f4f4f4";
    ctx.beginPath();
    ctx.moveTo(-4, 0);
    ctx.lineTo(0, -6);
    ctx.lineTo(r - 22, 0);
    ctx.lineTo(0, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "#eef2f6";
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  get value(): number {
    return this.displayedKmh;
  }
}
