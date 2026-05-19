import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "BOSS_ANALYSIS_");
  const apiTarget = process.env.BOSS_ANALYSIS_API_TARGET
    || env.BOSS_ANALYSIS_API_TARGET
    || "http://127.0.0.1:8765";

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": apiTarget
      }
    }
  };
});
