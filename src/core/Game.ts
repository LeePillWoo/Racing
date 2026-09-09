import * as THREE from "three";
import { loadRapier, PhysicsWorld } from "../physics/PhysicsWorld";
import { TrackPath } from "../track/TrackPath";
import { buildRoadMesh } from "../track/RoadMesh";
import { buildEnvironment, EnvironmentHandles } from "../track/Environment";
import { buildGroundCollider } from "../track/TrackColliders";
import { Vehicle } from "../vehicle/Vehicle";
import { InputManager } from "./InputManager";
import { DEFAULT_VEHICLE_CONFIG } from "../vehicle/VehicleConfig";
import { ChaseCamera } from "../camera/ChaseCamera";
import { RaceManager, Racer } from "../race/RaceManager";
import { AIController, randomAIPersonality } from "../ai/AIController";
import { HUD } from "../ui/HUD";
import { PostProcessing } from "./PostProcessing";

const TOTAL_LAPS = 3;
const AI_NAMES = ["FALCON", "VIPER", "SCORPION", "MIRAGE", "COMET", "NOVA", "ATLAS", "BLAZE", "ORION", "VERTEX", "PULSE"];
const AI_COLORS = ["#e34259", "#00a893", "#fdac35", "#8b35dd", "#b0d52c", "#32bfe5", "#ff6b40", "#d63eb0", "#22ac63", "#792bd9", "#a5d829"];
const PLAYER_COLOR = "#145acb";

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly input = new InputManager();
  private readonly chaseCamera: ChaseCamera;
  private readonly postFX: PostProcessing;
  private physics!: PhysicsWorld;
  private path!: TrackPath;
  private environment!: EnvironmentHandles;
  private raceManager!: RaceManager;
  private hud!: HUD;
  private playerVehicle!: Vehicle;
  private playerRacer!: Racer;
  private aiEntries: { vehicle: Vehicle; racer: Racer; controller: AIController }[] = [];
  private lastFrameTime = 0;
  private fpsAccumTime = 0;
  private fpsAccumFrames = 0;
  private started = false;
  private paused = false;
  private countdown = 3.5;
  private raceFinishedShown = false;
  private readonly countdownEl = document.getElementById("countdown")!;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly uiRoot: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.camera = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.1, 2200);
    this.chaseCamera = new ChaseCamera(this.camera);
    this.postFX = new PostProcessing(this.renderer, this.scene, this.camera, window.innerWidth, window.innerHeight);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("keydown", (e) => { if (e.code === "Escape" && !e.repeat) this.setPaused(!this.paused); });
    window.addEventListener("blur", () => this.setPaused(true));
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.setPaused(true); });
    document.getElementById("resume-button")!.addEventListener("click", () => this.setPaused(false));
    document.getElementById("pause-button")!.addEventListener("click", () => this.setPaused(true));
    document.getElementById("reset-button")!.addEventListener("click", () => {
      if (this.started && !this.paused && !this.raceFinishedShown) this.resetPlayer();
    });
    this.onResize();
  }

  private onResize = (): void => {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.postFX.setSize(w, h);
  };

  async load(onProgress: (fraction: number, label: string) => void): Promise<void> {
    onProgress(0.05, "물리 엔진 준비 중");
    const rapier = await loadRapier();
    this.physics = new PhysicsWorld(rapier);
    onProgress(0.25, "그랑프리 서킷 생성 중");
    this.path = new TrackPath();
    this.scene.add(buildRoadMesh(this.path));
    buildGroundCollider(rapier, this.physics.world, this.path);
    onProgress(0.45, "관중석과 서킷 환경 구성 중");
    this.environment = buildEnvironment(this.scene, this.path);
    onProgress(0.65, "12대의 포뮬러 차량 준비 중");
    const grid = this.buildStartGrid(12);
    const playerSlot = grid[11];
    this.playerVehicle = new Vehicle(rapier, this.physics.world, this.scene, playerSlot.position, playerSlot.yawRad, PLAYER_COLOR);
    this.raceManager = new RaceManager(this.path, TOTAL_LAPS);
    this.playerRacer = this.raceManager.addRacer("player", "YOU", true, this.playerVehicle, PLAYER_COLOR);
    for (let i = 0; i < AI_NAMES.length; i++) {
      const slot = grid[i], color = AI_COLORS[i];
      const vehicle = new Vehicle(rapier, this.physics.world, this.scene, slot.position, slot.yawRad, color);
      const racer = this.raceManager.addRacer("ai-" + i, AI_NAMES[i], false, vehicle, color);
      const controller = new AIController(this.path, racer, randomAIPersonality(i + 1), this.playerRacer,
        r => this.raceManager.resetRacerToTrack(r));
      this.aiEntries.push({ vehicle, racer, controller });
    }
    // Settle suspension before showing the grid; no race time elapses here.
    const idle = { throttle: 0, brake: 0, steer: 0, handbrake: true, resetRequested: false, cameraToggleRequested: false };
    for (let i = 0; i < 100; i++) this.physics.step(1 / 120, dt => {
      this.playerVehicle.physicsStep(dt, idle);
      this.aiEntries.forEach(entry => entry.vehicle.physicsStep(dt, idle));
    });
    this.playerVehicle.syncVisuals();
    this.aiEntries.forEach(entry => entry.vehicle.syncVisuals());
    this.raceManager.update(0);
    onProgress(0.9, "출발 준비");
    this.hud = new HUD(this.uiRoot, this.path);
    this.updateHUD(0);
    this.chaseCamera.snapTo(this.playerVehicle);
    this.environment.followSun(this.playerVehicle.position());
    onProgress(1, "READY TO RACE");
    this.lastFrameTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  private buildStartGrid(count: number): { position: THREE.Vector3; yawRad: number }[] {
    return Array.from({ length: count }, (_, i) => {
      const frame = this.path.frameAtDistance(-12 - Math.floor(i / 2) * 9 - (i % 2) * 2);
      const position = frame.point.clone().addScaledVector(frame.right, (i % 2 === 0 ? -1 : 1) * 3.1);
      position.y = DEFAULT_VEHICLE_CONFIG.spawnHeight;
      return { position, yawRad: Math.atan2(frame.tangent.x, frame.tangent.z) };
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    document.body.classList.add("racing");
    this.input.clearAll();
    this.lastFrameTime = performance.now();
  }

  setPaused(paused: boolean): void {
    if (!this.started || this.raceFinishedShown) return;
    this.paused = paused;
    this.input.clearAll();
    document.getElementById("pause-screen")!.classList.toggle("hidden", !paused);
    this.lastFrameTime = performance.now();
  }

  private resetPlayer(): void {
    this.raceManager.resetRacerToTrack(this.playerRacer);
    this.playerVehicle.syncVisuals();
    this.chaseCamera.snapTo(this.playerVehicle);
  }

  private loop = (now: number): void => {
    const frameDt = Math.max(0, (now - this.lastFrameTime) / 1000);
    const dt = Math.min(1 / 15, frameDt);
    this.lastFrameTime = now;
    this.fpsAccumTime += frameDt; this.fpsAccumFrames++;
    if (this.fpsAccumTime >= 0.5) {
      this.hud.setFps(this.fpsAccumFrames / this.fpsAccumTime);
      this.fpsAccumTime = 0; this.fpsAccumFrames = 0;
    }
    if (this.started && !this.paused && !this.raceFinishedShown) {
      if (this.countdown > 0) {
        this.countdown = Math.max(0, this.countdown - dt);
        this.countdownEl.textContent = this.countdown > 0.5 ? String(Math.ceil(this.countdown - 0.5)) : "GO";
        this.countdownEl.classList.remove("hidden");
      } else {
        this.countdownEl.classList.add("hidden");
        this.tick(dt);
      }
    }
    if (!this.paused) this.environment.update(dt, now / 1000);
    this.renderer.info.reset();
    this.postFX.render();
    requestAnimationFrame(this.loop);
  };

  private tick(dt: number): void {
    const playerInput = this.input.sample();
    if (playerInput.resetRequested) this.resetPlayer();
    if (playerInput.cameraToggleRequested) this.chaseCamera.toggleFarView();
    const aiInputs = this.aiEntries.map(entry => entry.controller.sample(dt));
    const simulatedDt = this.physics.step(dt, stepDt => {
      this.playerVehicle.physicsStep(stepDt, playerInput);
      this.aiEntries.forEach((entry, i) => entry.vehicle.physicsStep(stepDt, aiInputs[i]));
    });
    this.playerVehicle.syncVisuals();
    this.aiEntries.forEach(entry => entry.vehicle.syncVisuals());
    this.raceManager.update(simulatedDt * 1000);
    this.environment.followSun(this.playerVehicle.position());
    this.chaseCamera.update(dt, this.playerVehicle);
    this.updateHUD(dt);
    if (this.raceManager.isRaceOver) {
      this.raceFinishedShown = true;
      document.body.classList.remove("racing");
      this.hud.showFinish([...this.raceManager.racers].sort((a, b) => a.rank - b.rank));
    }
  }

  private updateHUD(dt: number): void {
    this.hud.update({
      speedKmh: this.playerVehicle.telemetry.speedKmh, gear: this.playerVehicle.telemetry.gear,
      isDrifting: this.playerVehicle.telemetry.isDrifting,
      currentLapMs: this.raceManager.currentLapMs(this.playerRacer), bestLapMs: this.playerRacer.bestLapMs,
      lapNumber: this.playerRacer.highestLapFloor, totalLaps: TOTAL_LAPS,
      rank: this.playerRacer.rank, totalRacers: this.raceManager.racers.length,
      standings: [...this.raceManager.racers].sort((a, b) => a.rank - b.rank), dt,
    });
  }
}
