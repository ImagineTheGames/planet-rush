/**
 * src/platform/asset-url.ts — a `public/` asset URL that survives the deploy base.
 * OWNER: Platform Engineer (GDD §4.8; incident a0-66, 2026-08-16).
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS EXISTS TO END
 * ---------------------------------------------------------------------------
 * `vite.config.ts` sets `base: './'` so one bundle serves from the Pages project
 * subpath (`/planet-rush/`), from `/dev`, and from a custom domain without a
 * rebuild. Vite delivers that by rewriting asset references it can *see* — in
 * `index.html`, in CSS, in `new URL(..., import.meta.url)`. A root-absolute path
 * written as a **string literal in TypeScript** is not one of those: it is just a
 * string, it is emitted verbatim, and at runtime the browser resolves it against
 * the ORIGIN, not against the deploy base.
 *
 * Locally that is invisible, because `vite dev` and `vite preview` both serve at
 * `/` — origin and base are the same string. It only appears on the deployed
 * subpath, which is why it reached the live URL and was caught by the post-deploy
 * gate rather than by a PR:
 *
 *     src (title-gate.ts)   '/fonts/Oxanium-Variable-latin.woff2'
 *     localhost             http://localhost:4173/fonts/…      200
 *     live                  https://…github.io/fonts/…         404   ← wrong host path
 *     wanted                https://…github.io/planet-rush/fonts/…   200
 *
 * `src/main.ts` already spells the service-worker registration the right way
 * (`${import.meta.env.BASE_URL}sw.js`). This is that idiom, named, edge-cased and
 * unit-tested, so the next runtime asset reference has somewhere to go that is
 * not a hand-rolled template string.
 *
 * NOT for bundled assets (anything under `src/`): those go through `import` or
 * `new URL(..., import.meta.url)` and Vite hashes and rewrites them for you. This
 * is only for files served verbatim out of `public/`.
 */

/**
 * Resolve a `public/` asset path against the base this bundle was built for.
 *
 * @param path A `public/`-relative path, with or without a leading slash —
 *   `'/fonts/x.woff2'` and `'fonts/x.woff2'` both mean `public/fonts/x.woff2`.
 * @param base The deploy base. Defaults to Vite's `import.meta.env.BASE_URL`,
 *   which is `'./'` for this project's relative base, `'/'` under `vite dev` and
 *   in vitest, and whatever `VITE_BASE` says when an absolute base is forced.
 *   Injectable so the cases below are testable without a bundler.
 * @returns A URL the browser resolves correctly wherever the bundle is served —
 *   document-relative under a relative base, root-absolute under an absolute one.
 *
 * @example
 * assetUrl('/fonts/x.woff2', './')            // './fonts/x.woff2'
 * assetUrl('/fonts/x.woff2', '/')             // '/fonts/x.woff2'
 * assetUrl('/fonts/x.woff2', '/planet-rush/') // '/planet-rush/fonts/x.woff2'
 */
export function assetUrl(path: string, base: string = import.meta.env.BASE_URL): string {
  // Strip every leading slash: the caller's path is base-relative by definition,
  // and a stray '//' would read as a protocol-relative URL and leave the origin.
  const rel = path.replace(/^\/+/, '');
  // An empty base is Vite's other spelling of a relative base; '.' would join to
  // '.fonts/…'. Both normalise to './' before the join.
  const root = base === '' || base === '.' ? './' : base;
  return root.endsWith('/') ? `${root}${rel}` : `${root}/${rel}`;
}
