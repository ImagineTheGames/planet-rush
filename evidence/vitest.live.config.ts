/**
 * evidence/vitest.live.config.ts — QA harness config for the LIVE online probes.
 * OWNER: QA Manager. Runs evidence/*.live.test.ts (which talk to the real Fly
 * deployment over the real internet using the SHIPPED src/net client modules),
 * with the project's path aliases and a generous timeout for real network round
 * trips. Not part of the app's own test run (vite.config's include is tests/**).
 */
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../src/shared'),
      '@platform': resolve(__dirname, '../src/platform'),
      '@render': resolve(__dirname, '../src/render'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['evidence/**/*.live.test.ts'],
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});
