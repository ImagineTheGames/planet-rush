/**
 * spikes/a0-29-region-ping/after-lab.mjs — the AFTER table, measured through the
 * shipped code. OWNER: Netcode Engineer (a0-29).
 *
 * `./browser-lab.mjs` proved the cause by reimplementing each candidate shape in
 * the page. That is the right tool for a diagnosis and the wrong one for an
 * after-table: it measures a model of the fix, not the fix. So this one bundles
 * the REAL `src/net/region-probe.ts` with esbuild, serves it from `http://localhost`
 * (always CORS-allowed, `src/net/cors.ts`), and runs `surveyRegions` against the
 * LIVE allocator in headless Chromium — the same function `main.ts` calls when the
 * doors open, on the same wire.
 *
 * One cold browser context per round, because a survey in the wild is cold.
 *
 * Run:  node spikes/a0-29-region-ping/after-lab.mjs [rounds]
 */

import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';

const ALLOCATOR = 'https://planet-rush-allocator.fly.dev';
const ROUNDS = Number(process.argv[2] ?? 1);
const PORT = 4188;

// The real module, bundled as it ships. Nothing here reimplements the probe.
const bundled = await build({
  stdin: {
    contents: `
      import { surveyRegions, formatRegionChoices } from './src/net/region-probe';
      globalThis.__survey = async (baseUrl) => {
        const started = performance.now();
        const survey = await surveyRegions({ baseUrl });
        return {
          elapsedMs: Math.round(performance.now() - started),
          defaultId: survey.defaultId ?? null,
          line: formatRegionChoices(survey.regions, survey.defaultId),
          regions: survey.regions.map((r) => ({
            id: r.id, pingMs: r.pingMs, samples: r.samples, failure: r.failure ?? null,
          })),
        };
      };
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'iife',
  write: false,
  platform: 'browser',
});
const SCRIPT = bundled.outputFiles[0].text;

const PAGE = `<!doctype html><meta charset="utf-8"><title>a0-29 after</title><script>${SCRIPT}</script>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch();
console.log(`after-lab — the SHIPPED surveyRegions, live fleet, cold context per round`);

for (let round = 1; round <= ROUNDS; round++) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`http://localhost:${PORT}/?r=${round}`);
  const survey = await page.evaluate((base) => globalThis.__survey(base), ALLOCATOR);
  await context.close();

  console.log(`\n## round ${round}   (whole survey: ${survey.elapsedMs}ms)`);
  for (const r of survey.regions) {
    console.log(
      `  ${r.id}  ${String(r.pingMs ?? '—').padStart(4)}ms   samples ${r.samples}${r.failure ? `  failure ${r.failure}` : ''}`,
    );
  }
  console.log(`  line:    ${survey.line}`);
  console.log(`  default: ${survey.defaultId}   ${survey.defaultId === 'iad' ? 'CORRECT' : 'WRONG'}`);
}

await browser.close();
server.close();
