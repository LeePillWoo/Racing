import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    host: true,
  },
  optimizeDeps: {
    exclude: ["@dimforge/rapier3d-compat"],
  },
  build: {
    target: "esnext",
  },
});
