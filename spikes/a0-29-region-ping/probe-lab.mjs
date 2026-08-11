/**
 * spikes/a0-29-region-ping/probe-lab.mjs — WHY does the region probe rank São
 * Paulo above Virginia from the United States? OWNER: Netcode Engineer (a0-29).
 *
 * The brief names three candidate causes and says: determine which BEFORE
 * changing anything. This is that determination. It times the real fleet from
 * this machine several different ways and prints every raw sample, so the cause
 * is read off a table rather than argued from a theory.
 *
 * The modes, in the order they matter:
 *
 *   isolated    A fresh connection per sample, one region fully measured before
 *               the next begins. Nothing is shared, nothing overlaps: this is the
 *               closest thing to ground truth, and it is what `curl` does.
 *   h1-shared   One keep-alive HTTP/1.1 socket, both regions probed CONCURRENTLY,
 *               samples serial within a region, min-of-3 — the shipped
 *               `measureRegionPings` shape.
 *   h2-shared   The same, over one multiplexed HTTP/2 session, which is what a
 *               BROWSER actually does against a single origin. This is the mode
 *               the live client is in.
 *   *-serial    Each of the above with the ONE change of running the regions one
 *               after another instead of concurrently.
 *   h2-warm     Concurrent, but with an untimed warm-up request first.
 *
 * Built-ins only — no dependency to install, so a future session can just run it.
 *
 * Run:  node spikes/a0-29-region-ping/probe-lab.mjs [rounds]
 */

import { connect } from 'node:http2';
import { Agent, request as httpsRequest } from 'node:https';

const ALLOCATOR = 'https://planet-rush-allocator.fly.dev';
const SAMPLES = 3;
const ROUNDS = Number(process.argv[2] ?? 1);

/** The fleet, exactly as the client reads it. No region code lives in this file. */
async function fleet() {
  const res = await fetch(`${ALLOCATOR}/regions`);
  const body = await res.json();
  return body.regions.map((r) => ({ id: r.region, probe: r.probe }));
}

/** Which anycast POP accepted the request — the trailing token of the request id. */
const popOf = (id) => (typeof id === 'string' ? (id.split('-').pop() ?? '?') : '?');

// ---------------------------------------------------------------------------
// One sample, two transports
// ---------------------------------------------------------------------------

/** A sample over HTTP/1.1, on whichever agent the caller hands in. */
function sampleH1(target, agent) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const req = httpsRequest(target.url, { agent, headers: target.headers ?? {} }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        const ms = performance.now() - started;
        try {
          const body = JSON.parse(text);
          resolve({ ms, servedBy: body.region, machine: body.machine, pop: popOf(res.headers['fly-request-id']) });
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/** A sample over an already-open HTTP/2 session — the browser's shape. */
function sampleH2(session, target) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const stream = session.request({ ':path': '/health', ...(target.headers ?? {}) });
    let head = {};
    let text = '';
    stream.setEncoding('utf8');
    stream.on('response', (h) => (head = h));
    stream.on('data', (c) => (text += c));
    stream.on('end', () => {
      const ms = performance.now() - started;
      try {
        const body = JSON.parse(text);
        resolve({ ms, servedBy: body.region, machine: body.machine, pop: popOf(head['fly-request-id']) });
      } catch (err) {
        reject(err);
      }
    });
    stream.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// The modes
// ---------------------------------------------------------------------------

/** Run `measure` over the regions, either all at once or one after another. */
async function survey(regions, concurrent, measure) {
  if (concurrent) return Promise.all(regions.map(measure));
  const acc = [];
  for (const region of regions) acc.push(await measure(region));
  return acc;
}

/** Ground truth: nothing shared, nothing concurrent. */
function isolated(regions) {
  return survey(regions, false, async (region) => {
    const samples = [];
    for (let i = 0; i < SAMPLES; i++) {
      const agent = new Agent({ keepAlive: false, maxSockets: 1 });
      samples.push(await sampleH1(region.probe, agent));
      agent.destroy();
    }
    return { id: region.id, samples };
  });
}

/** One keep-alive HTTP/1.1 socket for the whole survey. */
async function h1Shared(regions, { concurrent = true, sockets = 1, warm = false } = {}) {
  const agent = new Agent({ keepAlive: true, maxSockets: sockets });
  if (warm) await sampleH1({ url: regions[0].probe.url }, agent).catch(() => {});
  const out = await survey(regions, concurrent, async (region) => {
    const samples = [];
    for (let i = 0; i < SAMPLES; i++) samples.push(await sampleH1(region.probe, agent));
    return { id: region.id, samples };
  });
  agent.destroy();
  return out;
}

/** The browser's shape: one multiplexed HTTP/2 session for the whole survey. */
async function h2Shared(regions, { concurrent = true, warm = false } = {}) {
  const origin = new URL(regions[0].probe.url).origin;
  const session = connect(origin);
  await new Promise((res, rej) => {
    session.once('connect', res);
    session.once('error', rej);
  });
  if (warm) await sampleH2(session, { url: regions[0].probe.url }).catch(() => {});
  const out = await survey(regions, concurrent, async (region) => {
    const samples = [];
    for (let i = 0; i < SAMPLES; i++) samples.push(await sampleH2(session, region.probe));
    return { id: region.id, samples };
  });
  session.close();
  return out;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function report(name, results) {
  const rows = results.map((r) => {
    const ok = r.samples.filter((s) => s.servedBy === r.id);
    const min = ok.length > 0 ? Math.round(Math.min(...ok.map((s) => s.ms))) : null;
    return { id: r.id, min, r };
  });
  const ranked = [...rows].sort((a, b) => (a.min ?? Infinity) - (b.min ?? Infinity));
  console.log(`\n## ${name}`);
  for (const row of rows) {
    const raw = row.r.samples
      .map((s) => `${String(Math.round(s.ms)).padStart(4)}${s.servedBy === row.id ? ' ' : `!${s.servedBy}`}@${s.pop}`)
      .join('  ');
    console.log(`  ${row.id}  min ${String(row.min ?? '—').padStart(4)}ms   [ ${raw} ]`);
  }
  console.log(`  -> order: ${ranked.map((r) => `${r.id} ${r.min ?? '—'}`).join(' · ')}`);
}

const regions = await fleet();
console.log(`fleet: ${regions.map((r) => r.id).join(', ')}   samples/region: ${SAMPLES}   rounds: ${ROUNDS}`);

for (let round = 1; round <= ROUNDS; round++) {
  console.log(`\n=========================== ROUND ${round} ===========================`);
  report('isolated   (truth: fresh conn per sample, regions serial)', await isolated(regions));
  report('h1-shared  (one keep-alive socket, regions CONCURRENT)', await h1Shared(regions));
  report('h2-shared  (BROWSER: one h2 session, regions CONCURRENT)', await h2Shared(regions));
  report('h1-serial  (one keep-alive socket, regions ONE AFTER ANOTHER)', await h1Shared(regions, { concurrent: false }));
  report('h2-serial  (one h2 session, regions ONE AFTER ANOTHER)', await h2Shared(regions, { concurrent: false }));
  report('h2-warm    (one h2 session, warm-up first, regions CONCURRENT)', await h2Shared(regions, { warm: true }));
}
