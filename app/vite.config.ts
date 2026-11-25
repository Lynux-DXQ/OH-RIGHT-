import { defineConfig } from 'vite';

export default defineConfig({
  root: 'app',
  base: './',
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});
