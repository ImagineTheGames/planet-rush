/**
 * server/vite.server.config.ts — how the match server is bundled for the
 * container. OWNER: Netcode Engineer (GDD §3.5, §4.2).
 *
 * One command, one file out:
 *
 *   npx vite build --config server/vite.server.config.ts   → server/dist/match-server.mjs
 *   node server/dist/match-server.mjs                      → the match server
 *
 * Why a bundle rather than `tsc` output: the repository's TypeScript uses path
 * aliases (`@shared/*`), and Node resolves imports, not tsconfig paths — so
 * emitted-but-unbundled JS would fail at runtime on its first `@shared` import.
 * Bundling resolves the aliases at build time and produces a single plain ESM
 * file whose only imports are Node built-ins. The runtime image is therefore
 * `node` plus one file: **no dependencies to install, nothing native to rebuild
 * for the ARM host the spike chose** (docs/netcode-spike.md), and nothing
 * vendor-specific anywhere in it (GDD §4.2, risk 1).
 *
 * This config is deliberately separate from the client's `vite.config.ts`
 * (Platform Engineer's file): a client build and a server build share a
 * repository, not a target.
 */

import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

export default defineConfig({
  // No client assets belong in a server image: `public/` is the PWA shell.
  publicDir: false,
  resolve: {
    // The same aliases the client build and the typechecker use, declared here
    // so the server never depends on the client's config file.
    alias: {
      '@shared': resolve(root, 'src/shared'),
      '@platform': resolve(root, 'src/platform'),
      '@render': resolve(root, 'src/render'),
    },
  },
  build: {
    // Node target: no DOM shims, no polyfills, no browser field resolution.
    ssr: resolve(root, 'server/index.ts'),
    outDir: resolve(root, 'server/dist'),
    emptyOutDir: true,
    target: 'node22',
    // Readable output: this is a server people will have to debug on a host
    // they cannot attach a profiler to, and it is not shipped over the wire.
    minify: false,
    sourcemap: true,
    rollupOptions: {
      output: {
        format: 'es',
        entryFileNames: 'match-server.mjs',
      },
    },
  },
});
