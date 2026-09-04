import "./style.css";
import { Game } from "./core/Game";

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById("viewport") as HTMLCanvasElement;
  const uiRoot = document.getElementById("ui-root") as HTMLElement;
  const loadingScreen = document.getElementById("loading-screen")!;
  const loadingBarFill = document.getElementById("loading-bar-fill")!;
  const loadingLabel = document.getElementById("loading-label")!;
  const startScreen = document.getElementById("start-screen")!;
  const startButton = document.getElementById("start-button")!;

  const game = new Game(canvas, uiRoot);

  await game.load((fraction, label) => {
    loadingBarFill.style.width = `${Math.round(fraction * 100)}%`;
    loadingLabel.textContent = label;
  });

  loadingScreen.classList.add("hidden");
  startScreen.classList.remove("hidden");

  startButton.addEventListener("click", () => {
    startScreen.classList.add("hidden");
    canvas.focus();
    game.start();
  });
}

bootstrap().catch((err) => {
  console.error(err);
  const label = document.getElementById("loading-label");
  if (label) label.textContent = `오류가 발생했습니다: ${(err as Error).message}`;
});
