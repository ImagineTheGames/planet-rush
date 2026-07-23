import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Planet Rush client build. A relative base ('./') keeps asset URLs
// path-independent so the same bundle serves correctly from a GitHub Pages
// project subpath (/planet-rush/), the /dev path, or a custom domain without a
// rebuild; override with VITE_BASE only when an absolute base is required. See
// GDD §4.8.
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
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
