import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => ({
  root: __dirname,
  plugins: [react()],
  server: { port: 5174, host: "127.0.0.1", strictPort: true },
  build: { outDir: "../dist/renderer" },
  // Emit the dev URL for Electron to pick up if port shifts
  define: {
    __DEV_SERVER__: JSON.stringify(mode === 'development' ? 'http://127.0.0.1' : '')
  }
}));


