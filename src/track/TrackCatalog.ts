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

export interface TrackTheme {
  skyTop: string;
  skyBottom: string;
  background: string;
  fog: { color: string; near: number; far: number };
  hemisphere: { sky: string; ground: string; intensity: number };
  sun: { color: string; intensity: number };
  /** Base terrain the whole site sits on. */
  terrain: "grass" | "sand";
  patches: GroundPatch[];
  /** The two alternating kerb stripe colours. */
  kerb: [string, string];
  /** Dashed white lane line down the middle of the road. */
  centerLine: boolean;
  /** Tall wire catch fencing on top of the barriers, versus a bare low wall. */
  catchFence: boolean;
  /** Stacked tyre walls against the barrier, spaced this many metres apart; 0 for none. */
  tyreWallSpacing: number;
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

const PARKLAND_SKY: Pick<TrackTheme, "skyTop" | "skyBottom" | "background" | "fog" | "hemisphere" | "sun"> = {
  skyTop: "#38a7eb",
  skyBottom: "#d9f3ff",
  background: "#b7e0f5",
  fog: { color: "#d6edf2", near: 260, far: 1050 },
  hemisphere: { sky: "#c5e7ff", ground: "#779440", intensity: 1.6 },
  sun: { color: "#fff8ed", intensity: 2.5 },
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
      ...PARKLAND_SKY,
      terrain: "grass",
      patches: [],
      kerb: ["#e33740", "#f6f8fa"],
      centerLine: false,
      catchFence: true,
      tyreWallSpacing: 0,
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
      ...PARKLAND_SKY,
      fog: { color: "#dff0e8", near: 300, far: 1250 },
      hemisphere: { sky: "#cdeaff", ground: "#8aa049", intensity: 1.7 },
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
      tyreWallSpacing: 0,
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
      skyTop: "#2b5f8e",
      skyBottom: "#c8d8e2",
      background: "#9fb6c6",
      fog: { color: "#c2d0da", near: 220, far: 900 },
      hemisphere: { sky: "#b7ccdd", ground: "#4b4f52", intensity: 1.35 },
      sun: { color: "#ffeed6", intensity: 2.1 },
      terrain: "grass",
      patches: [
        { x: 35, z: -30, rx: 540, rz: 420, kind: "paddock" },
        { x: 250, z: -25, rx: 110, rz: 95, kind: "grass" },
        { x: -235, z: 10, rx: 80, rz: 65, kind: "grass" },
      ],
      kerb: ["#2f7fd0", "#f4f7fa"],
      centerLine: true,
      catchFence: false,
      tyreWallSpacing: 46,
      trees: 40,
      grandstands: [],
      balloons: 0,
      pitBuilding: { u: 120, side: 1 },
      banner: "INFINITY  /  DRIFT ARENA",
    },
  },
];

export const DEFAULT_TRACK = TRACKS[0];

export function findTrack(id: string): TrackDef {
  return TRACKS.find(track => track.id === id) ?? DEFAULT_TRACK;
}
