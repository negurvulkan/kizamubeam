import { defineConfig } from 'vite';

// Feste Portnummer für Tauri (siehe src-tauri/tauri.conf.json)
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: 'es2021', outDir: 'dist' },
});
