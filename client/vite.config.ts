import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The game server port in development (see .env.example).
const server = `http://localhost:${process.env.SERVER_PORT ?? 3001}`;

export default defineConfig({
  plugins: [react()],
  // Team logos and player photos live in the repo's static/ folder.
  publicDir: "../static",
  server: {
    port: 5173,
    proxy: {
      "/api": server,
      "/socket.io": { target: server, ws: true },
    },
  },
});
