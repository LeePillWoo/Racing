/**
 * Every circuit the game can race on: its centreline, how wide the road is, and the look of the
 * site around it. Geometry and scenery live together because they are designed together — the
 * switchback circuit only reads as parkland with grass and a lake under it, and the figure-eight
 * only reads as a drift arena with a black paddock apron and tyre walls.
 *
 * Control points are metres on the XZ plane, driven in list order; index 0 is the start/finish
 * line. `tests/regression.mjs` asserts every layout here is actually drivable.
 */

/** A flat patch of ground colour laid over the base terrain, drawn in array order. */
export interface GroundPatch {
  x: number;
  z: number;
  /** Ellipse radii, so a patch can be a long lake or a round island. */
  rx: number;
  rz: number;
  kind: "sand" | "water" | "paddock" | "grass";
}

/** Final display-space colour pass. Tints are RGB multipliers, so [1, 1, 1] leaves a tone alone. */
export interface ColorGrade {
  saturation: number;
  contrast: number;
  shadows: [number, number, number];
  highlights: [number, number, number];
  /** How far the corners darken, 0 for none. */
  vignette: number;
}

export interface TrackTheme {
  skyTop: string;
  skyBottom: string;
  /** Haze band along the horizon, strongest on the sun's side. This is what makes a low sun read as low. */
  horizonGlow: string;
  /** Sunlit and shaded cloud colour, and where the cloud field starts: lower is more overcast. */
  clouds: { lit: string; shade: string; cover: number };
  background: string;
  fog: { color: string; near: number; far: number };
  hemisphere: { sky: string; ground: string; intensity: number };
  /** Elevation in degrees above the horizon; azimuth in degrees from +Z towards +X. */
  sun: { color: string; intensity: number; elevation: number; azimuth: number };
  exposure: number;
  grade: ColorGrade;
  /** How hard the floodlight towers burn. 0 by day; above 0 once the sun is too low to light the road. */
  floodlight: number;
  /** The ring of hills that closes off the horizon. */
  hills: string;
  /** Base terrain the whole site sits on. */
  terrain: "grass" | "sand";
  patches: GroundPatch[];
  /** The two alternating kerb stripe colours. */
  kerb: [string, string];
  /** Dashed white lane line down the middle of the road. */
  centerLine: boolean;
  /** Tall wire catch fencing on top of the barriers, versus a bare low wall. */
  catchFence: boolean;
  trees: number;
  /** Arc-length positions of grandstands, and which side of the road they sit on. */
  grandstands: { u: number; side: 1 | -1 }[];
  balloons: number;
  /** A low building alongside the start straight, at this arc-length, or null for none. */
  pitBuilding: { u: number; side: 1 | -1 } | null;
  banner: string;
}

export interface TrackDef {
  id: string;
  name: string;
  /** Shown on the track-select card. */
  subtitle: string;
  blurb: string;
  laps: number;
  halfWidth: number;
  /** True when the layout deliberately crosses over itself, so kerbs and barriers get suppressed there. */
  crossover: boolean;
  controlPoints: Array<[number, number]>;
  theme: TrackTheme;
}

type Mood = Pick<TrackTheme, "skyTop" | "skyBottom" | "horizonGlow" | "clouds" | "background" | "fog" | "hemisphere" | "sun"
  | "exposure" | "grade" | "floodlight" | "hills">;

/**
 * Late afternoon, sun low and dead ahead on the main straight. Everything the sun touches goes
 * amber and everything it misses goes blue, so the shadows have to be cool and the fill weak —
 * raise the hemisphere light and the warmth washes straight out.
 */
const GOLDEN_HOUR: Mood = {
  skyTop: "#3d6fb3",
  skyBottom: "#f6cf9a",
  horizonGlow: "#ffae5c",
  clouds: { lit: "#ffe6c4", shade: "#8d86a3", cover: 0.5 },
  background: "#f0cb9c",
  fog: { color: "#dcb68c", near: 210, far: 1350 },
  hemisphere: { sky: "#a9c3f0", ground: "#7d6a3f", intensity: 0.85 },
  sun: { color: "#ffc078", intensity: 3.4, elevation: 13, azimuth: -27 },
  exposure: 1.02,
  grade: { saturation: 1.1, contrast: 1.07, shadows: [0.9, 0.95, 1.1], highlights: [1.07, 1.0, 0.9], vignette: 0.3 },
  floodlight: 0,
  hills: "#5d6b55",
};

/** High summer: hard sun, deep sky, crisp shadows. The bright one. */
const SUMMER_NOON: Mood = {
  skyTop: "#1f7fe0",
  skyBottom: "#cfeaff",
  horizonGlow: "#eef7ff",
  clouds: { lit: "#ffffff", shade: "#a9b9cc", cover: 0.46 },
  background: "#bfe2f7",
  fog: { color: "#cfe6ee", near: 320, far: 1350 },
  hemisphere: { sky: "#bfe0ff", ground: "#86a24a", intensity: 1.15 },
  sun: { color: "#fff4e0", intensity: 3.1, elevation: 47, azimuth: -125 },
  exposure: 1.0,
  grade: { saturation: 1.14, contrast: 1.06, shadows: [0.95, 1.0, 1.06], highlights: [1.03, 1.01, 0.97], vignette: 0.2 },
  floodlight: 0,
  hills: "#4f7a52",
};

/** Blue hour: the sun is on the horizon and the towers have taken over lighting the road. */
const BLUE_HOUR: Mood = {
  skyTop: "#16244f",
  skyBottom: "#f08a62",
  horizonGlow: "#ff7a45",
  clouds: { lit: "#f3a48a", shade: "#3b3f66", cover: 0.48 },
  background: "#8a6f86",
  fog: { color: "#6f6688", near: 120, far: 950 },
  hemisphere: { sky: "#7f93d6", ground: "#3a3340", intensity: 0.95 },
  sun: { color: "#ff9a62", intensity: 1.5, elevation: 5, azimuth: -72 },
  exposure: 1.1,
  grade: { saturation: 1.12, contrast: 1.1, shadows: [0.88, 0.94, 1.16], highlights: [1.08, 0.99, 0.9], vignette: 0.38 },
  floodlight: 1,
  hills: "#2d3152",
};

export const TRACKS: TrackDef[] = [
  {
    id: "apex-gp",
    name: "APEX GRAND PRIX",
    subtitle: "FORMULA CIRCUIT",
    blurb: "관중석을 끼고 도는 정통 그랑프리 서킷. 긴 직선과 고속 코너 위주.",
    laps: 3,
    halfWidth: 9,
    crossover: false,
    controlPoints: [
      [0, 0], [0, 75], [0, 165], [35, 230], [130, 255],
      [200, 210], [210, 125], [160, 65], [175, -30], [265, -100],
      [245, -185], [160, -220], [80, -185], [40, -115], [0, -80],
    ],
    theme: {
      ...GOLDEN_HOUR,
      terrain: "grass",
      patches: [],
      kerb: ["#e33740", "#f6f8fa"],
      centerLine: false,
      catchFence: true,
      trees: 210,
      grandstands: [{ u: 32, side: -1 }, { u: 105, side: -1 }, { u: 118, side: 1 }, { u: -68, side: -1 }],
      balloons: 5,
      pitBuilding: null,
      banner: "APEX  /  FORMULA CIRCUIT",
    },
  },
  {
    id: "switchback-park",
    name: "SWITCHBACK PARK",
    subtitle: "PARKLAND SERPENTINE",
    blurb: "모래 고원을 가로지르는 연속 헤어핀. 호수를 낀 롱 스트레이트에서 한 번 숨을 돌린다.",
    laps: 2,
    halfWidth: 9,
    crossover: false,
    controlPoints: [
      [-140, 300], [0, 300], [140, 300],
      [300, 285], [400, 230], [455, 140],
      [490, 40], [522, -52], [455, -128], [365, -102], [330, -15],
      [250, 25], [165, 35],
      [80, -25], [25, -100], [-60, -118],
      [-150, -55], [-248, -125], [-346, -55], [-450, -130], [-528, -90],
      [-545, 5], [-470, 75], [-410, 155], [-350, 238], [-265, 292],
    ],
    theme: {
      ...SUMMER_NOON,
      terrain: "grass",
      patches: [
        { x: -300, z: -75, rx: 300, rz: 165, kind: "sand" },
        { x: -80, z: 150, rx: 210, rz: 95, kind: "water" },
        { x: 470, z: 210, rx: 130, rz: 190, kind: "water" },
        { x: 250, z: -70, rx: 95, rz: 70, kind: "sand" },
      ],
      kerb: ["#e33740", "#f6f8fa"],
      centerLine: false,
      catchFence: false,
      trees: 260,
      grandstands: [{ u: 60, side: -1 }, { u: -90, side: -1 }],
      balloons: 3,
      pitBuilding: { u: 175, side: -1 },
      banner: "SWITCHBACK  /  PARKLAND",
    },
  },
  {
    id: "infinity-drift",
    name: "INFINITY DRIFT",
    subtitle: "FIGURE-EIGHT ARENA",
    blurb: "한가운데서 스스로를 가로지르는 8자 드리프트 코스. 좁은 좌측 루프와 넓은 우측 스윕.",
    laps: 3,
    halfWidth: 8,
    crossover: true,
    controlPoints: [
      [230, -210], [140, -210], [80, -155],
      [70, -70], [-70, 70],
      [-150, 120], [-250, 105], [-310, 15], [-275, -85], [-180, -125],
      [-70, -70], [70, 70],
      [165, 130], [270, 150], [350, 80], [385, -40], [350, -150], [310, -205],
    ],
    theme: {
      ...BLUE_HOUR,
      terrain: "grass",
      patches: [
        { x: 35, z: -30, rx: 540, rz: 420, kind: "paddock" },
        { x: 250, z: -25, rx: 110, rz: 95, kind: "grass" },
        { x: -235, z: 10, rx: 80, rz: 65, kind: "grass" },
      ],
      kerb: ["#2f7fd0", "#f4f7fa"],
      centerLine: true,
      catchFence: false,
      trees: 40,
      grandstands: [],
      balloons: 0,
      pitBuilding: { u: 120, side: 1 },
      banner: "INFINITY  /  DRIFT ARENA",
    },
  },
];

export const DEFAULT_TRACK = TRACKS[0];

/** What the ground is at a point: the last patch that covers it, or the base terrain. */
export function groundAt(theme: TrackTheme, x: number, z: number): GroundPatch["kind"] {
  let kind: GroundPatch["kind"] = theme.terrain;
  for (const patch of theme.patches) {
    if (((x - patch.x) / patch.rx) ** 2 + ((z - patch.z) / patch.rz) ** 2 < 1) kind = patch.kind;
  }
  return kind;
}

export function findTrack(id: string): TrackDef {
  return TRACKS.find(track => track.id === id) ?? DEFAULT_TRACK;
}
