/**
 * evidence/measure-golden-diff.mjs — what a golden re-shoot actually changed.
 *
 * Reads a before/after PNG pair, runs **Playwright's own bundled pixelmatch**
 * (`playwright-core/lib/third_party/pixelmatch.js`) at the same threshold the
 * gate uses, and prints the differing-pixel count and ratio at ZERO tolerance.
 * Writes a diff PNG beside the pair.
 *
 * Why zero tolerance rather than the gate's `maxDiffPixelRatio: 0.01`: a golden
 * that PASSES can still be wrong. A stale baseline whose only difference is a
 * known font change sits under 1% and stays green while spending most of the
 * tolerance budget on a difference nobody wants — leaving almost none for the
 * regression the gate exists to catch (a1-01's finding, r2-01's measurement).
 * The pass/fail bit hides that; the raw number is what shows it.
 *
 * Usage: node evidence/measure-golden-diff.mjs <before.png> <after.png> [diff.png]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
// Resolved as an absolute PATH, not as a package subpath: playwright-core's
// `exports` map deliberately does not publish `lib/third_party/`, so the bare
// specifier throws ERR_PACKAGE_PATH_NOT_EXPORTED. Reaching the file directly is
// the point — this has to be the gate's comparator, not a lookalike copy from
// npm that might rev independently of the Playwright the suite runs on.
const pixelmatch = require(
  new URL('../node_modules/playwright-core/lib/third_party/pixelmatch.js', import.meta.url).pathname,
);

const [, , beforePath, afterPath, diffPath] = process.argv;
if (!beforePath || !afterPath) {
  console.error('usage: node evidence/measure-golden-diff.mjs <before.png> <after.png> [diff.png]');
  process.exit(2);
}

const before = PNG.sync.read(readFileSync(beforePath));
const after = PNG.sync.read(readFileSync(afterPath));

if (before.width !== after.width || before.height !== after.height) {
  // A size change is not a pixel difference — it is a different frame, and
  // comparing them pixelwise would be meaningless rather than merely wrong.
  console.log(
    `${afterPath}\tSIZE CHANGED ${before.width}x${before.height} -> ${after.width}x${after.height}`,
  );
  process.exit(0);
}

const { width, height } = before;
const diff = new PNG({ width, height });
// `threshold: 0.2` and `includeAA: false` are Playwright's own screenshot
// defaults — this is the gate's comparator on the gate's settings, so the count
// below is the number the gate would have measured, not a second opinion.
const differing = pixelmatch(before.data, after.data, diff.data, width, height, {
  threshold: 0.2,
  includeAA: false,
});

const total = width * height;
const ratio = differing / total;
if (diffPath) writeFileSync(diffPath, PNG.sync.write(diff));

console.log(
  `${afterPath}\t${width}x${height}\t${differing.toLocaleString()} px\t${(ratio * 100).toFixed(2)}%\t` +
    `${ratio > 0.01 ? 'OVER the 1% gate' : 'under the 1% gate'}`,
);
