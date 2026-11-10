import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the Python dev server (python -m tynys.devserver) serves the API on :8787.
// In production the same /api/* paths are Vercel functions on the same origin.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
