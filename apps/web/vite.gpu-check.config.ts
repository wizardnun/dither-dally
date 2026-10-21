import { defineConfig } from "vite";

/** Serves the GPU check page (gpu-check/), with its own dependency cache so it can't disturb the app's dev server. */
export default defineConfig({
  root: "gpu-check",
  cacheDir: "../node_modules/.vite-gpu-check",
  server: { port: 5199 },
});
