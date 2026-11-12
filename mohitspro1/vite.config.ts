import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the built index.html loads its assets with relative paths,
// which is required when the page is served from a plugin WebView.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
