import * as THREE from "three";
import { loadRapier, PhysicsWorld } from "../physics/PhysicsWorld";
import { TrackPath } from "../track/TrackPath";
import { buildRoadMesh } from "../track/RoadMesh";
import { buildEnvironment, EnvironmentHandles } from "../track/Environment";
import { buildGroundCollider } from "../track/TrackColliders";
import { Vehicle } from "../vehicle/Vehicle";
import { InputManager, InputState } from "./InputManager";
import { DEFAULT_VEHICLE_CONFIG } from "../vehicle/VehicleConfig";
import { ChaseCamera } from "../camera/ChaseCamera";
import { RaceManager, Racer } from "../race/RaceManager";
import { AIController, randomAIPersonality } from "../ai/AIController";
import { HUD } from "../ui/HUD";

const TOTAL_LAPS = 3;
const AI_NAMES = ["Falcon", "Viper", "Scorpion", "Mirage", "Comet"];
const AI_COLORS = ["#4fc3ff", "#ffb74d", "#81c784", "#ba68c8", "#ff8a65"];
const PLAYER_COLOR = "#e63946";

interface GridSlot {
  position: THREE.Vector3;
  yawRad: number;
}

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly input = new InputManager();
  private readonly chaseCamera: ChaseCamera;

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
  private raceFinishedShown = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly uiRoot: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 2500);
    this.chaseCamera = new ChaseCamera(this.camera);

    window.addEventListener("resize", this.onResize);
    this.onResize();
  }

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  async load(onProgress: (fraction: number, label: string) => void): Promise<void> {
    onProgress(0.05, "물리 엔진 초기화 중...");
    const rapier = await loadRapier();
    this.physics = new PhysicsWorld(rapier);

    onProgress(0.25, "서킷 생성 중...");
    this.path = new TrackPath();
    this.scene.add(buildRoadMesh(this.path));
    buildGroundCollider(rapier, this.physics.world);

    onProgress(0.45, "환경 구성 중...");
    this.environment = buildEnvironment(this.scene, this.path);

    onProgress(0.65, "차량 배치 중...");
    const grid = this.buildStartGrid(6);

    this.playerVehicle = new Vehicle(rapier, this.physics.world, this.scene, grid[0].position, grid[0].yawRad, PLAYER_COLOR);
    this.raceManager = new RaceManager(this.path, TOTAL_LAPS, {
      onLapCompleted: () => {},
      onRaceFinished: () => {},
    });
    this.playerRacer = this.raceManager.addRacer("player", "YOU", true, this.playerVehicle, PLAYER_COLOR);

    for (let i = 0; i < 5; i++) {
      const slot = grid[i + 1];
      const color = AI_COLORS[i];
      const vehicle = new Vehicle(rapier, this.physics.world, this.scene, slot.position, slot.yawRad, color);
      const racer = this.raceManager.addRacer(`ai-${i}`, AI_NAMES[i], false, vehicle, color);
      const controller = new AIController(this.path, racer, randomAIPersonality(i + 1), this.playerRacer, (r) =>
        this.raceManager.resetRacerToTrack(r)
      );
      this.aiEntries.push({ vehicle, racer, controller });
    }

    onProgress(0.9, "UI 준비 중...");
    this.hud = new HUD(this.uiRoot, this.path);
    this.chaseCamera.snapTo(this.playerVehicle);

    onProgress(1, "완료");
  }

  private buildStartGrid(count: number): GridSlot[] {
    const startFrame = this.path.frameAtDistance(0);
    const yaw = Math.atan2(startFrame.tangent.x, startFrame.tangent.z);
    const slots: GridSlot[] = [];
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / 2);
      const col = i % 2;
      const back = 8 + row * 7.5;
      const side = (col === 0 ? -1 : 1) * 3.2;
      const pos = startFrame.point
        .clone()
        .addScaledVector(startFrame.tangent, -back)
        .addScaledVector(startFrame.right, side);
      pos.y = DEFAULT_VEHICLE_CONFIG.spawnHeight;
      slots.push({ position: pos, yawRad: yaw });
    }
    return slots;
  }

  start(): void {
    this.started = true;
    this.lastFrameTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  private loop = (now: number): void => {
    if (!this.started) return;
    const dt = Math.min(0.1, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    this.fpsAccumTime += dt;
    this.fpsAccumFrames++;
    if (this.fpsAccumTime >= 0.5) {
      this.hud.setFps(this.fpsAccumFrames / this.fpsAccumTime);
      this.fpsAccumTime = 0;
      this.fpsAccumFrames = 0;
    }

    this.tick(dt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.loop);
  };

  private tick(dt: number): void {
    const playerInput = this.input.sample();

    if (playerInput.resetRequested) {
      this.raceManager.resetRacerToTrack(this.playerRacer);
    }
    if (playerInput.cameraToggleRequested) {
      this.chaseCamera.toggleFarView();
    }

    const aiInputs: InputState[] = this.aiEntries.map((entry) => entry.controller.sample(dt));

    this.physics.step(dt, (stepDt) => {
      this.playerVehicle.physicsStep(stepDt, playerInput);
      this.aiEntries.forEach((entry, i) => entry.vehicle.physicsStep(stepDt, aiInputs[i]));
    });

    this.playerVehicle.syncVisuals();
    this.aiEntries.forEach((entry) => entry.vehicle.syncVisuals());

    this.raceManager.update(dt * 1000);
    this.environment.update(dt, performance.now() / 1000);
    this.environment.followSun(this.playerVehicle.position());
    this.chaseCamera.update(dt, this.playerVehicle);

    const standings = [...this.raceManager.racers].sort((a, b) => a.rank - b.rank);
    this.hud.update({
      speedKmh: this.playerVehicle.telemetry.speedKmh,
      gear: this.playerVehicle.telemetry.gear,
      isDrifting: this.playerVehicle.telemetry.isDrifting,
      currentLapMs: this.raceManager.currentLapMs(this.playerRacer),
      bestLapMs: this.playerRacer.bestLapMs,
      lapNumber: this.playerRacer.highestLapFloor,
      totalLaps: TOTAL_LAPS,
      rank: this.playerRacer.rank,
      totalRacers: this.raceManager.racers.length,
      standings,
      dt,
    });

    if (this.raceManager.isRaceOver && !this.raceFinishedShown) {
      this.raceFinishedShown = true;
      const finalOrder = [...this.raceManager.racers].sort((a, b) => a.rank - b.rank);
      this.hud.showFinish(finalOrder);
    }
  }
}
