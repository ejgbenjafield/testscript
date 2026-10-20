import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.API_URL || 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Use the shared package's TypeScript source directly, so changes show up instantly.
    alias: { '@testscript/shared': path.resolve(__dirname, '../shared/src/index.ts') },
  },
  server: {
    host: '0.0.0.0',
    port: Number(process.env.WEB_PORT || 5173),
    strictPort: true,
    // Replit serves the preview from its own *.replit.dev address.
    allowedHosts: true,
    proxy: {
      '/v1': { target: apiTarget, changeOrigin: true },
      '/healthz': { target: apiTarget, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
