import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The site is served from https://<user>.github.io/f1-telemetry/
export default defineConfig({
  base: process.env.PITWALL_BASE ?? '/f1-telemetry/',
  plugins: [react()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
});
