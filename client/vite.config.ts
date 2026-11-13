import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Vite 8's native resolver follows Windows reparse points (e.g. OneDrive-synced files) like symlinks and then
  // can't find node_modules. This project uses no symlinked packages, so keeping paths as-is is safe.
  resolve: { preserveSymlinks: true },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:5000' },
  },
});
