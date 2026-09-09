export interface InputState {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  resetRequested: boolean;
  cameraToggleRequested: boolean;
}

export class InputManager {
  private readonly down = new Set<string>();
  private readonly pointers = new Map<number, string>();
  private resetLatch = false;
  private cameraLatch = false;

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
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    this.down.add(e.code);
    if (!e.repeat && e.code === "KeyR") this.resetLatch = true;
    if (!e.repeat && e.code === "KeyC") this.cameraLatch = true;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  };
  private onKeyUp = (e: KeyboardEvent): void => { this.down.delete(e.code); };

  clearAll = (): void => {
    this.down.clear(); this.pointers.clear();
    this.resetLatch = false; this.cameraLatch = false;
  };

  private pressed(...keys: string[]): boolean {
    return keys.some(key => this.down.has(key) || [...this.pointers.values()].includes(key));
  }

  sample(): InputState {
    const state: InputState = {
      throttle: this.pressed("KeyW", "ArrowUp") ? 1 : 0,
      brake: this.pressed("KeyS", "ArrowDown") ? 1 : 0,
      steer: Number(this.pressed("KeyD", "ArrowRight")) - Number(this.pressed("KeyA", "ArrowLeft")),
      handbrake: this.pressed("Space"),
      resetRequested: this.resetLatch, cameraToggleRequested: this.cameraLatch,
    };
    this.resetLatch = false; this.cameraLatch = false;
    return state;
  }
}
