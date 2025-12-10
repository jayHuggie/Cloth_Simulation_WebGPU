// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    allowedHosts: true // <-- allow all hosts
  },
  assetsInclude: ['**/*.wgsl'],
  build: {
    rollupOptions: {
      output: {
        manualChunks: undefined
      }
    }
  }
});


