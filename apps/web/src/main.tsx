import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter/opsz.css";
import { App } from "./App.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support in production builds only: in development a cache would serve stale modules.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js");
      const registration = await navigator.serviceWorker.ready;
      // Files loaded before the service worker took control (first visit) aren't cached yet; send them.
      const urls = [
        window.location.href.split("#")[0]!,
        ...performance.getEntriesByType("resource").map((e) => e.name),
      ];
      registration.active?.postMessage({ type: "cache-urls", urls });
    } catch {
      // Offline support is a bonus; the app works without it.
    }
  });
}
