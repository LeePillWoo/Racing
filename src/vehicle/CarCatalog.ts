import type { CarPaint, CarStyle } from "./CarMesh";

/**
 * The cars on the grid. Every entry drives identically — they share one chassis, one drivetrain
 * and one set of tyres — so picking one is a matter of taste and of telling your car apart in a
 * twelve-way scrap, never of picking the fast one.
 */
export interface CarModel {
  id: string;
  name: string;
  /** One line for the picker card. */
  blurb: string;
  style: CarStyle;
  paint: CarPaint;
}

export const CARS: CarModel[] = [
  { id: "apex-fw", name: "APEX FW-01", blurb: "오픈휠 포뮬러", style: "formula", paint: { body: "#145acb", accent: "#ffdb19" } },
  { id: "silver-arrow", name: "SILVER ARROW", blurb: "실버 포뮬러", style: "formula", paint: { body: "#c7ced6", accent: "#e0273f" } },
  { id: "venom-gt", name: "VENOM GT", blurb: "클로즈드 콕핏 GT", style: "gt", paint: { body: "#2fbf4a", accent: "#10232f" } },
  { id: "midnight-gt", name: "MIDNIGHT GT", blurb: "야간 사양 GT", style: "gt", paint: { body: "#1d2634", accent: "#ff7a29" } },
  { id: "scarlet-x", name: "SCARLET X", blurb: "미드십 하이퍼카", style: "hyper", paint: { body: "#d81f34", accent: "#f2f4f7" } },
  { id: "cobalt-x", name: "COBALT X", blurb: "웨지형 하이퍼카", style: "hyper", paint: { body: "#17a8c9", accent: "#12202a" } },
  { id: "hornet-v8", name: "HORNET V8", blurb: "블로운 머슬카", style: "muscle", paint: { body: "#8ede1f", accent: "#1b1d22" } },
  { id: "ember-v8", name: "EMBER V8", blurb: "스트리트 머슬카", style: "muscle", paint: { body: "#ef7c1f", accent: "#f3efe6" } },
];

export const DEFAULT_CAR = CARS[0];

export function findCar(id: string): CarModel {
  return CARS.find(car => car.id === id) ?? DEFAULT_CAR;
}
