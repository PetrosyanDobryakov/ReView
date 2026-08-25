import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // LAN / mesh friends hit us by IP; keep host check off for local collab.
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 8080,
    allowedHosts: true,
  },
});
