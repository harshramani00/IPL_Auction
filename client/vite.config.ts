import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The game server port in development (see .env.example).
const server = `http://localhost:${process.env.SERVER_PORT ?? 3001}`;

export default defineConfig({
  plugins: [react()],
  // Team logos and player photos live in the repo's static/ folder.
  publicDir: "../static",
  // The 3D hall chunk (three.js + post-processing) is ~1.25 MB (~370 kB gzipped) and only loads in the 3D view.
  build: { chunkSizeWarningLimit: 1400 },
  server: {
    port: 5173,
    proxy: {
      "/api": server,
      "/socket.io": { target: server, ws: true },
    },
  },
});
