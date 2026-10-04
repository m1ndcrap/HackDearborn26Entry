import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
// Fonts are bundled (not loaded from Google) so they work offline. Latin covers English and Spanish;
// Arabic falls back to the system font.
import "@fontsource/judson/latin-400.css";
import "@fontsource/judson/latin-700.css";
import "@fontsource/inter/latin-500.css";
import "./styles.css";

registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
