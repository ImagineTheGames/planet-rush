import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Planet Rush client build. The base is set for GitHub Pages project-page
// hosting (served under /planet-rush/); override with VITE_BASE for the /dev
// path or a custom domain. See GDD §4.8.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@platform': resolve(__dirname, 'src/platform'),
      '@render': resolve(__dirname, 'src/render'),
    },
  },
  build: {
    target: 'es2022',
    // Zero-config; the app shell is small on purpose. Sourcemaps aid the
    // day-5 performance gate profiling on real hardware.
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
