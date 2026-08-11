/**
 * spikes/a0-29-region-ping/browser-lab.mjs — the same question as `./probe-lab.mjs`,
 * asked in a REAL browser. OWNER: Netcode Engineer (a0-29).
 *
 * `probe-lab.mjs` times the fleet from Node, where the transport is ours to choose.
 * The defect is in a browser, whose connection pool is not ours to choose — so this
 * serves a page from `http://localhost` (always CORS-allowed, `src/net/cors.ts`),
 * opens it in headless Chromium, and runs the probe algorithm IN THE PAGE against
 * the live fleet, exactly as `src/net/region-probe.ts` does.
 *
 * It runs the shipped shape and each candidate fix, and prints every raw sample, so
 * "which mode inverts" is read off a table.
 *
 * **One mode per fresh page.** The modes are not independent within a page load:
 * whichever runs first pays TLS and warms the connection every later mode then
 * inherits, which flatters them all. A survey in the wild is COLD, so each mode
 * gets its own page load and its own cold connection — that is the number that
 * describes the shipped client.
 *
 * Run:  node spikes/a0-29-region-ping/browser-lab.mjs [rounds]
 */

import { createServer } from 'node:http';
import { chromium } from '@playwright/test';

const ALLOCATOR = 'https://planet-rush-allocator.fly.dev';
const ROUNDS = Number(process.argv[2] ?? 1);
const PORT = 4187;

const PAGE = `<!doctype html><meta charset="utf-8"><title>a0-29 probe lab</title>`;

/**
 * The whole experiment, as it runs inside the page. Kept as one function so it can
 * be handed to `page.evaluate` verbatim.
 */
async function inPage([allocator, only]) {
  const SAMPLES = 3;
  const regions = await fetch(`${allocator}/regions`)
    .then((r) => r.json())
    .then((b) => b.regions.map((r) => ({ id: r.region, probe: r.probe })));

  /** One sample, timed exactly as `measureRegionPing` times it: the request AND
   *  reading the body, around `performance.now()`. */
  async function sample(target, region) {
    const started = performance.now();
    let servedBy;
    try {
      const res = await fetch(target.url, target.headers ? { headers: target.headers } : {});
      const body = await res.json();
      servedBy = body?.region;
    } catch (err) {
      return { ms: performance.now() - started, servedBy: `ERR:${err}` };
    }
    return { ms: performance.now() - started, servedBy, ok: servedBy === region };
  }

  /** min-of-N over the samples that came back from the right region. */
  const minOf = (samples) => {
    const ok = samples.filter((s) => s.ok);
    return ok.length > 0 ? Math.round(Math.min(...ok.map((s) => s.ms))) : null;
  };

  /** N serial samples of one region. */
  async function serialSamples(region, n = SAMPLES) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(await sample(region.probe, region.id));
    return out;
  }

  const modes = {
    /** SHIPPED: regions concurrent (`Promise.all`), samples serial, min-of-3. */
    shipped: async () =>
      Promise.all(regions.map(async (r) => ({ id: r.id, samples: await serialSamples(r) }))),

    /** Regions one after another; everything else identical. */
    serialRegions: async () => {
      const out = [];
      for (const r of regions) out.push({ id: r.id, samples: await serialSamples(r) });
      return out;
    },

    /** Concurrent, but one untimed warm-up request before any clock starts. */
    warmedConcurrent: async () => {
      await sample({ url: regions[0].probe.url }, '_warm');
      return Promise.all(regions.map(async (r) => ({ id: r.id, samples: await serialSamples(r) })));
    },

    /** Serial regions, and a warm-up first. */
    warmedSerial: async () => {
      await sample({ url: regions[0].probe.url }, '_warm');
      const out = [];
      for (const r of regions) out.push({ id: r.id, samples: await serialSamples(r) });
      return out;
    },

    /** Interleaved round-robin: one sample of every region, then the next round.
     *  Still serial overall, but no region is measured only at the start. */
    roundRobin: async () => {
      const acc = new Map(regions.map((r) => [r.id, []]));
      await sample({ url: regions[0].probe.url }, '_warm');
      for (let i = 0; i < SAMPLES; i++) {
        for (const r of regions) acc.get(r.id).push(await sample(r.probe, r.id));
      }
      return regions.map((r) => ({ id: r.id, samples: acc.get(r.id) }));
    },
  };

  if (only === '__names') return Object.keys(modes);
  const rows = await modes[only]();
  return rows.map((r) => ({ id: r.id, min: minOf(r.samples), samples: r.samples }));
}

// ---------------------------------------------------------------------------

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch();

/** One mode, in its own browser context — a cold connection pool and a cold DNS
 *  and TLS cache, which is the state a real lobby open is in. */
async function runCold(mode, round) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`http://localhost:${PORT}/?m=${mode}&r=${round}`);
  const rows = await page.evaluate(inPage, [ALLOCATOR, mode]);
  await context.close();
  return rows;
}

const probe = await browser.newContext();
const namesPage = await probe.newPage();
await namesPage.goto(`http://localhost:${PORT}/`);
const MODES = await namesPage.evaluate(inPage, [ALLOCATOR, '__names']);
await probe.close();

console.log(`browser lab — origin http://localhost:${PORT}   rounds: ${ROUNDS}   COLD context per mode`);
for (let round = 1; round <= ROUNDS; round++) {
  console.log(`\n=========================== ROUND ${round} ===========================`);
  for (const name of MODES) {
    const rows = await runCold(name, round);
    console.log(`\n## ${name}`);
    for (const row of rows) {
      const raw = row.samples
        .map((s) => `${String(Math.round(s.ms)).padStart(4)}${s.ok ? ' ' : `!${s.servedBy}`}`)
        .join('  ');
      console.log(`  ${row.id}  min ${String(row.min ?? '—').padStart(4)}ms   [ ${raw} ]`);
    }
    const ranked = [...rows].sort((a, b) => (a.min ?? Infinity) - (b.min ?? Infinity));
    const verdict = ranked[0]?.id === 'iad' ? 'CORRECT' : 'INVERTED';
    console.log(`  -> order: ${ranked.map((r) => `${r.id} ${r.min ?? '—'}`).join(' · ')}   ${verdict}`);
  }
}

await browser.close();
server.close();
