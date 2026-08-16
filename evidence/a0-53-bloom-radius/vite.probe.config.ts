/**
 * evidence/a0-53-bloom-radius/vite.probe.config.ts — build the probes the way
 * the game is built. OWNER: Art Agent.
 *
 * Every "correct" reference in this brief was first measured on the DEV SERVER,
 * and the shipped client is a `vite build` bundle. Those two are NOT
 * interchangeable here — that is one of the findings: `isRenderGroup: true` on
 * the void moved the dev frame and left the production frame byte-identical. So
 * the references are re-measured inside a production bundle before anything is
 * concluded from them.
 *
 * `field-probe` and `renderer-probe` both draw the design's radius when built
 * this way. So does the REAL `index.html` when built this way — which is the
 * control that puts the defect in the app shell and its build rather than in
 * `src/art/`.
 *
 *   npx vite build --config evidence/a0-53-bloom-radius/vite.probe.config.ts
 *   npx vite preview --outDir evidence/a0-53-bloom-radius/dist-probe --port 4260
 *
 * `dist-probe/` is build output and is not committed.
 */
import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

export default defineConfig({
  root: ROOT,
  // The app's own aliases and target (`vite.config.ts`), so the only difference
  // from the shipped build is the one being tested.
  resolve: {
    alias: {
      '@shared': resolve(ROOT, 'src/shared'),
      '@platform': resolve(ROOT, 'src/platform'),
      '@render': resolve(ROOT, 'src/render'),
    },
  },
  build: {
    target: 'es2022',
    outDir: resolve(HERE, 'dist-probe'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        field: resolve(HERE, 'field-probe.html'),
        renderer: resolve(HERE, 'renderer-probe.html'),
        // The REAL entry, built by THIS config — the control that isolates the
        // build configuration as the variable.
        indexReal: resolve(ROOT, 'index.html'),
      },
    },
  },
});
