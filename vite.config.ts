import { defineConfig } from 'vite';

// Feste Portnummer für Tauri (siehe src-tauri/tauri.conf.json)
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // Ersatzschriften (~22 kB) einbetten, damit Text-in-Pfad auch ohne Netz und als Einzeldatei funktioniert
  build: { target: 'es2021', outDir: 'dist', assetsInlineLimit: 32768 },
});
