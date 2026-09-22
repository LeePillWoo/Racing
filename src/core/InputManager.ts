export interface InputState {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  boost: boolean;
  resetRequested: boolean;
  cameraToggleRequested: boolean;
}

/**
 * How far the thumb travels for full lock, as a fraction of the viewport width, clamped so it is
 * neither a twitch on a tablet nor a whole screen-width sweep on a phone.
 */
const STEER_TRAVEL_FRACTION = 0.16;
const STEER_TRAVEL_MIN = 64;
const STEER_TRAVEL_MAX = 150;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export class InputManager {
  private readonly down = new Set<string>();
  private readonly pointers = new Map<number, string>();
  private resetLatch = false;
  private cameraLatch = false;
  /** Steering from the touch pad, -1..1. Null while no thumb is down, so the keyboard keeps its say. */
  private padSteer: number | null = null;
  private padPointer = -1;
  private padOriginX = 0;
  private padTravel = STEER_TRAVEL_MIN;

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.clearAll);
    document.querySelectorAll<HTMLElement>("[data-control]").forEach(button => {
      button.addEventListener("pointerdown", event => {
        event.preventDefault(); button.setPointerCapture(event.pointerId);
        this.pointers.set(event.pointerId, button.dataset.control!);
      });
      const release = (event: PointerEvent) => { this.pointers.delete(event.pointerId); };
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("lostpointercapture", release);
    });
    const pad = document.querySelector<HTMLElement>("[data-steer-pad]");
    if (pad) this.bindSteerPad(pad);
  }

  /**
   * Analog steering: press anywhere in the pad and drag. Steering is proportional to how far the
   * thumb has travelled from wherever it landed, not from the middle of the screen, so there is no
   * hunting for a fixed stick. Drag past full lock and the origin follows, which lets a driver
   * re-centre mid-corner without lifting off.
   */
  private bindSteerPad(pad: HTMLElement): void {
    const paint = (): void => {
      pad.style.setProperty("--steer", String(this.padSteer ?? 0));
      pad.classList.toggle("active", this.padSteer !== null);
    };
    pad.addEventListener("pointerdown", event => {
      if (this.padPointer !== -1) return;
      event.preventDefault();
      pad.setPointerCapture(event.pointerId);
      this.padPointer = event.pointerId;
      this.padOriginX = event.clientX;
      this.padTravel = clamp(window.innerWidth * STEER_TRAVEL_FRACTION, STEER_TRAVEL_MIN, STEER_TRAVEL_MAX);
      this.padSteer = 0;
      const rect = pad.getBoundingClientRect();
      pad.style.setProperty("--knob-x", event.clientX - rect.left + "px");
      pad.style.setProperty("--knob-y", event.clientY - rect.top + "px");
      paint();
    });
    pad.addEventListener("pointermove", event => {
      if (event.pointerId !== this.padPointer) return;
      event.preventDefault();
      const offset = event.clientX - this.padOriginX;
      const steer = clamp(offset / this.padTravel, -1, 1);
      // Past full lock the origin trails the thumb, so releasing back toward centre works at once.
      if (Math.abs(offset) > this.padTravel) this.padOriginX = event.clientX - Math.sign(offset) * this.padTravel;
      this.padSteer = steer;
      paint();
    });
    const lift = (event: PointerEvent): void => {
      if (event.pointerId !== this.padPointer) return;
      this.padPointer = -1;
      this.padSteer = null;
      paint();
    };
    pad.addEventListener("pointerup", lift);
    pad.addEventListener("pointercancel", lift);
    pad.addEventListener("lostpointercapture", lift);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    this.down.add(e.code);
    if (!e.repeat && e.code === "KeyR") this.resetLatch = true;
    if (!e.repeat && e.code === "KeyC") this.cameraLatch = true;
    if (["Space", "ShiftLeft", "ShiftRight", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  };
  private onKeyUp = (e: KeyboardEvent): void => { this.down.delete(e.code); };

  clearAll = (): void => {
    this.down.clear(); this.pointers.clear();
    this.resetLatch = false; this.cameraLatch = false;
    this.padSteer = null; this.padPointer = -1;
    document.querySelector<HTMLElement>("[data-steer-pad]")?.classList.remove("active");
  };

  /** Steering from the touch pad, or null when no thumb is on it. Exposed for the on-screen knob. */
  get analogSteer(): number | null {
    return this.padSteer;
  }

  private pressed(...keys: string[]): boolean {
    return keys.some(key => this.down.has(key) || [...this.pointers.values()].includes(key));
  }

  sample(): InputState {
    const state: InputState = {
      throttle: this.pressed("KeyW", "ArrowUp") ? 1 : 0,
      brake: this.pressed("KeyS", "ArrowDown") ? 1 : 0,
      // A thumb on the pad wins over the keys: nothing can be holding both at once, and reading
      // the pad as "no input" whenever it happens to sit at centre would fight the driver.
      steer: this.padSteer ?? (Number(this.pressed("KeyD", "ArrowRight")) - Number(this.pressed("KeyA", "ArrowLeft"))),
      handbrake: this.pressed("Space"),
      boost: this.pressed("ShiftLeft", "ShiftRight"),
      resetRequested: this.resetLatch, cameraToggleRequested: this.cameraLatch,
    };
    this.resetLatch = false; this.cameraLatch = false;
    return state;
  }
}
