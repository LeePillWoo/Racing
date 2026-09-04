export interface InputState {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1 (left negative, right positive)
  handbrake: boolean;
  resetRequested: boolean;
  cameraToggleRequested: boolean;
}

const THROTTLE_KEYS = ["KeyW", "ArrowUp"];
const BRAKE_KEYS = ["KeyS", "ArrowDown"];
const LEFT_KEYS = ["KeyA", "ArrowLeft"];
const RIGHT_KEYS = ["KeyD", "ArrowRight"];
const HANDBRAKE_KEYS = ["Space"];
const RESET_KEYS = ["KeyR"];
const CAMERA_KEYS = ["KeyC"];

export class InputManager {
  private readonly down = new Set<string>();
  private resetLatch = false;
  private cameraLatch = false;

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.clearAll);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.clearAll);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.down.add(e.code);
    if (RESET_KEYS.includes(e.code)) this.resetLatch = true;
    if (CAMERA_KEYS.includes(e.code)) this.cameraLatch = true;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private clearAll = (): void => {
    this.down.clear();
  };

  private anyDown(keys: string[]): boolean {
    return keys.some((k) => this.down.has(k));
  }

  /** Reads current input and consumes one-shot latches (reset / camera toggle). */
  sample(): InputState {
    const left = this.anyDown(LEFT_KEYS);
    const right = this.anyDown(RIGHT_KEYS);
    let steer = 0;
    if (left && !right) steer = -1;
    else if (right && !left) steer = 1;

    const state: InputState = {
      throttle: this.anyDown(THROTTLE_KEYS) ? 1 : 0,
      brake: this.anyDown(BRAKE_KEYS) ? 1 : 0,
      steer,
      handbrake: this.anyDown(HANDBRAKE_KEYS),
      resetRequested: this.resetLatch,
      cameraToggleRequested: this.cameraLatch,
    };
    this.resetLatch = false;
    this.cameraLatch = false;
    return state;
  }
}
