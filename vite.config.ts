import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    // three.js alone is ~800KB and Rapier ~2MB (already its own chunk, loaded alongside the
    // models), so the default 500KB warning fires on every build and says nothing useful.
    chunkSizeWarningLimit: 2100,
  },
});
