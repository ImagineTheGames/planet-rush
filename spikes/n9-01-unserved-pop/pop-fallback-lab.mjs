/**
 * spikes/n9-01-unserved-pop/pop-fallback-lab.mjs — the A/B for "a US player lands
 * in São Paulo on a string comparison". OWNER: Netcode Engineer (n9-01).
 *
 * Node built-ins only, no arguments, no secrets. Two halves, both measuring the
 * SAME request the shipped client sends when the region survey measures nothing:
 * `POST /rooms` with **no body at all**, placed entirely by the edge POP.
 *
 *   BEFORE — against the deployed allocator (`planet-rush-allocator.fly.dev`),
 *            whatever is live at the moment you run it. From this lane's machine
 *            (Davenport, Florida) the anycast POP is `dfw`, which the fleet has
 *            never run a Machine in. The lab prints the POP it was actually
 *            served, so a run from elsewhere is self-describing rather than
 *            silently measuring a different question.
 *
 *   AFTER  — against THIS branch's allocator, run as the real process from
 *            `allocator/dist/allocator.mjs` (the same bundle the Dockerfile
 *            ships), seeded over `/register` with the live fleet's exact shape,
 *            then asked the same thing with `fly-region: dfw`.
 *
 * Three requests each, not one: the live failure was not the first request. The
 * first two reservations weight the `iad` hosts, and the flat whole-fleet pool
 * then hands the third room to the idle `gru` box — with `iad` slots still free.
 *
 *   node spikes/n9-01-unserved-pop/pop-fallback-lab.mjs
 *
 * Run `npx vite build --config allocator/vite.allocator.config.ts` first; the lab
 * says so rather than guessing if the bundle is missing.
 */

import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BUNDLE = resolve(REPO, 'allocator/dist/allocator.mjs');
const LIVE = 'https://planet-rush-allocator.fly.dev';
const LOCAL_PORT = 8099;
/** `allocator/index.ts` main(): this is the key an ALLOCATOR_SECRET-less run uses. */
const DEV_SECRET = 'dev-insecure-allocator-secret';
const ROUNDS = 3;

/** `signFleetRequest` from src/net/fleet-auth.ts, restated in built-ins. */
function signed(body) {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-fleet-auth': createHmac('sha256', DEV_SECRET).update(body).digest('base64url'),
    },
    body,
  };
}

/** One placement, as the response and the response's own headers describe it. */
async function allocate(base, headers) {
  const res = await fetch(`${base}/rooms`, { method: 'POST', headers });
  const body = await res.json();
  return {
    pop: res.headers.get('fly-request-id')?.split('-').pop(),
    region: body.region,
    machine: body.machine,
    detail: body.placement?.detail,
    reason: body.placement?.reason,
  };
}

function report(label, rows) {
  console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 56 - label.length))}`);
  for (const [i, r] of rows.entries()) {
    console.log(`  ${i + 1}. ${String(r.region).padEnd(4)} ${String(r.machine).padEnd(16)} ${r.detail}`);
  }
  const crossed = rows.filter((r) => r.region !== 'iad').length;
  console.log(`  → ${rows.length - crossed}/${rows.length} in iad, ${crossed} elsewhere`);
  return crossed;
}

/** The live fleet's capacity summary — printed, and reused to seed the local run. */
async function liveRegions() {
  const { regions } = await (await fetch(`${LIVE}/regions`)).json();
  console.log('\nLive fleet at this moment:');
  for (const r of regions) {
    console.log(`  ${r.region}  ${r.machines} machine(s), ${r.free} of ${r.capacity} slots free`);
  }
  return regions;
}

async function before() {
  const rows = [];
  for (let i = 0; i < ROUNDS; i++) rows.push(await allocate(LIVE, {}));
  const pop = rows[0].pop;
  console.log(`\nThe edge POP that served this machine: ${pop}`);
  if (pop !== 'dfw') {
    console.log('  NOTE: not dfw — this run is measuring a different POP than the brief.');
  }
  return { rows, pop };
}

/** Boot the branch's allocator as the real process and wait for /health. */
async function bootLocal() {
  if (!existsSync(BUNDLE)) {
    console.error(`\nNo bundle at ${BUNDLE}`);
    console.error('Run: npx vite build --config allocator/vite.allocator.config.ts');
    process.exit(2);
  }
  const proc = spawn(process.execPath, [BUNDLE], {
    env: { ...process.env, PORT: String(LOCAL_PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const placements = [];
  proc.stdout.on('data', (b) => {
    for (const line of String(b).split('\n')) if (line.includes('room ')) placements.push(line.trim());
  });
  const base = `http://127.0.0.1:${LOCAL_PORT}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) return { proc, base, placements };
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  proc.kill();
  throw new Error('local allocator never became healthy');
}

async function after(regions) {
  const { proc, base, placements } = await bootLocal();
  try {
    // The live fleet's shape, machine for machine: same regions, same capacities.
    for (const r of regions) {
      for (let i = 0; i < r.machines; i++) {
        const capacity = Math.round(r.capacity / r.machines);
        const body = JSON.stringify({ machine: `${r.region}-${i}`, region: r.region, capacity });
        const res = await fetch(`${base}/register`, signed(body));
        if (!res.ok) throw new Error(`register ${r.region}-${i}: ${res.status}`);
      }
    }
    const rows = [];
    // The local process is not behind Fly's edge, so the POP arrives as the
    // header Fly would have stamped. `edge-region.ts` reads exactly this.
    for (let i = 0; i < ROUNDS; i++) rows.push(await allocate(base, { 'fly-region': 'dfw' }));
    return { rows, placements };
  } finally {
    proc.kill();
  }
}

const regions = await liveRegions();
const live = await before();
const local = await after(regions);

const crossedBefore = report(`BEFORE — deployed allocator, POP ${live.pop}, no body`, live.rows);
const crossedAfter = report(`AFTER — this branch, same fleet shape, fly-region: dfw`, local.rows);

console.log('\nThe allocator\'s own log lines from the AFTER run (what `fly logs` would show):');
for (const line of local.placements) console.log(`  ${line}`);

console.log(
  `\nVERDICT: ${crossedBefore} of ${ROUNDS} left iad before, ${crossedAfter} of ${ROUNDS} after.`,
);
process.exit(crossedAfter === 0 ? 0 : 1);
