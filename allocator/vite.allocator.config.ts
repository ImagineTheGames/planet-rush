/**
 * allocator/vite.allocator.config.ts — how the allocator is bundled for the
 * container. OWNER: Netcode Engineer (GDD §4.2; docs/hosting-plan.md, Task 8).
 *
 * One command, one file out — the same recipe the match server uses
 * (server/vite.server.config.ts), pointed at the allocator's entry:
 *
 *   npx vite build --config allocator/vite.allocator.config.ts  → allocator/dist/allocator.mjs
 *   node allocator/dist/allocator.mjs                            → the allocator
 *
 * Why a bundle rather than `tsc` output: the allocator imports `@shared/*` path
 * aliases (for `mulberry32`) and reaches into `src/net/*` for the ticket and
 * room-code rules. Node resolves imports, not tsconfig paths, so emitted-but-
 * unbundled JS would fail on its first `@shared` import. Bundling resolves the
 * aliases at build time and produces a single plain ESM file whose only imports
 * are Node built-ins — so the runtime image is `node` plus one file: **nothing
 * to install, nothing native to rebuild, nothing vendor-specific** (GDD §4.2,
 * risk 1). The Fly-vs-direct choice is a runtime env var, not a build variant.
 *
 * Deliberately separate from both the client's `vite.config.ts` and the match
 * server's config: three targets share a repository, not a build.
 */

import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

export default defineConfig({
  // No client assets belong in a control-plane image.
  publicDir: false,
  resolve: {
    // The same aliases the client build and the typechecker use, declared here
    // so the allocator never depends on another target's config file.
    alias: {
      '@shared': resolve(root, 'src/shared'),
      '@platform': resolve(root, 'src/platform'),
      '@render': resolve(root, 'src/render'),
    },
  },
  build: {
    // Node target: no DOM shims, no polyfills, no browser field resolution.
    ssr: resolve(root, 'allocator/index.ts'),
    outDir: resolve(root, 'allocator/dist'),
    emptyOutDir: true,
    target: 'node22',
    // Readable output: a control-plane process debugged on a host you cannot
    // attach a profiler to, and never shipped over the wire.
    minify: false,
    sourcemap: true,
    rollupOptions: {
      output: {
        format: 'es',
        entryFileNames: 'allocator.mjs',
      },
    },
  },
});
