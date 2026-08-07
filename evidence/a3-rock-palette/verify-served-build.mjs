/**
 * evidence/a3-rock-palette/verify-served-build.mjs — prove the preview on this port
 * is THIS working tree's build. OWNER: Art Agent (brief a3-01).
 *
 * The failure this exists to make impossible: a golden re-shot against another
 * lane's `vite preview` on the shared port 4173, which passes, writes nothing, and
 * leaves a baseline that depicts a branch nobody is reviewing. It happened once in
 * this brief and was caught only by reading the served bundle back.
 *
 * So read it back. `src/art/palette.ts` `DERIVED.rockBody` is a packed integer the
 * bundler leaves as a decimal literal, and its value is exactly what a3-01 changes,
 * which makes it a perfect canary: the new one must be present and the old one must
 * be absent. Exits non-zero if either check fails.
 *
 *   A3_PREVIEW_PORT=4287 node evidence/a3-rock-palette/verify-served-build.mjs
 */
const PORT = process.env.A3_PREVIEW_PORT ?? '4287';

/**
 * `vite preview` binds `localhost` as IPv6 (`::1`) only, and Node's `fetch` resolves
 * `localhost` to `127.0.0.1` and gives up — Chromium tries both, Node does not. So
 * try both here rather than hard-coding whichever one happens to work today.
 */
async function pick() {
  for (const host of ['[::1]', '127.0.0.1']) {
    const base = `http://${host}:${PORT}`;
    try {
      const r = await fetch(base + '/');
      if (r.ok) return { base, html: await r.text() };
    } catch {
      /* try the other family */
    }
  }
  return null;
}

/** `DERIVED.rockBody`, before and after a3-01, as the packed ints the bundle carries. */
const OLD_ROCK_BODY = 0x939ba5; // 9673637 — the value a2-08 measured and failed
const NEW_ROCK_BODY = 0x484e57; // 4738647 — shade(hullSteel, .48), the board's luma

const served = await pick();
if (!served) {
  console.error(`FAIL: nothing answering on port ${PORT} (tried ::1 and 127.0.0.1).`);
  process.exit(1);
}
const { base: BASE, html } = served;
const entry = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
if (!entry) {
  console.error(`FAIL: no entry bundle in ${BASE}/ — is that a Planet Rush preview?`);
  process.exit(1);
}
const js = await fetch(`${BASE}/${entry}`).then((r) => r.text());

const count = (n) => (js.match(new RegExp(String(n), 'g')) ?? []).length;
const fresh = count(NEW_ROCK_BODY);
const stale = count(OLD_ROCK_BODY);

console.log(`served: ${BASE}/${entry}`);
console.log(`  rockBody #484E57 (${NEW_ROCK_BODY}) ×${fresh}   ← must be ≥ 1`);
console.log(`  rockBody #939BA5 (${OLD_ROCK_BODY}) ×${stale}   ← must be 0`);

if (fresh < 1 || stale > 0) {
  console.error('FAIL: this port is not serving this working tree. Do not shoot goldens against it.');
  process.exit(1);
}
console.log('OK — the preview on this port is this working tree.');
