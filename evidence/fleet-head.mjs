/**
 * evidence/fleet-head.mjs — stand up a REAL fleet from the code at HEAD.
 * OWNER: QA Manager.
 *
 * WHY QA NEEDS THIS
 * ---------------------------------------------------------------------------
 * The deployed Fly fleet is not always the code in the repository. On 2026-07-30
 * it demonstrably was not: every `Deploy server (Fly.io)` run since
 * 2026-07-29T08:25Z failed, so the Machines still ran a build that predates the
 * reconnect-wallet fix (#241) and the machine-pin arming (#235). A gate that
 * fails against that fleet has told you something true about the DEPLOYMENT and
 * nothing at all about the CODE, and QA owes the difference.
 *
 * So this launcher runs the two SHIPPED server processes — the same bundles the
 * Dockerfiles build and the same entrypoints Fly runs —
 *
 *   allocator/dist/allocator.mjs   (from allocator/index.ts)
 *   server/dist/match-server.mjs   (from server/index.ts)
 *
 * — on this machine, wired to each other over the same authenticated fleet routes
 * a deployed Machine uses (`X-Fleet-Auth`, `src/net/fleet-auth.ts`). Nothing here
 * is a stub or a mock; the only differences from Fly are the hostname and the
 * absence of the anycast edge (hence `ALLOCATOR_ROUTER=direct`, the mode
 * `docs/hosting-plan.md` documents for anything that is not Fly).
 *
 * Usage:  node evidence/fleet-head.mjs         # runs until killed, prints URLs
 *         QA_ALLOCATOR=http://127.0.0.1:8892 npx vitest run --config evidence/vitest.live.config.ts
 */
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const MATCH_PORT = Number(process.env.QA_MATCH_PORT ?? 8891);
export const ALLOCATOR_PORT = Number(process.env.QA_ALLOCATOR_PORT ?? 8892);
export const ALLOCATOR_URL = `http://127.0.0.1:${ALLOCATOR_PORT}`;
export const MATCH_URL = `ws://127.0.0.1:${MATCH_PORT}/`;

/** A test fleet's shared secret is a constant, and it being a constant is part of
 *  the test: allocator and Machine must AGREE, and a mismatch must fail closed. */
const FLEET_SECRET = 'qa-evidence-head-fleet';

function build(config, what) {
  const r = spawnSync('npx', ['vite', 'build', '--config', config], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) throw new Error(`failed to build ${what} (${config})`);
}

function launch(entry, env, tag) {
  const child = spawn(process.execPath, [entry], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  child.stdout?.on('data', (c) => process.stdout.write(`[${tag}] ${String(c)}`));
  return child;
}

async function waitForHttp(url, what, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  let last = 'never answered';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = String(e);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${what} never came up at ${url}: ${last}`);
}

async function waitForFleet(timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${ALLOCATOR_URL}/machines`);
      if (res.ok && ((await res.json()).machines ?? []).length > 0) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('no Machine registered — the fleet never formed');
}

export async function startFleet() {
  build('allocator/vite.allocator.config.ts', 'the allocator bundle');
  build('server/vite.server.config.ts', 'the match-server bundle');

  const allocator = launch(
    'allocator/dist/allocator.mjs',
    {
      PORT: String(ALLOCATOR_PORT),
      HOST: '127.0.0.1',
      ALLOCATOR_SECRET: FLEET_SECRET,
      ALLOCATOR_SEED: '7',
      ALLOCATOR_ROUTER: 'direct',
      MATCH_URL_TEMPLATE: MATCH_URL,
    },
    'allocator',
  );
  await waitForHttp(`${ALLOCATOR_URL}/health`, 'the allocator');

  const match = launch(
    'server/dist/match-server.mjs',
    {
      PORT: String(MATCH_PORT),
      HOST: '127.0.0.1',
      MATCH_SEED: '11',
      TICKET_SECRET: FLEET_SECRET,
      ALLOCATOR_URL,
      MACHINE_ID: 'm-qa-head',
      REGION: 'local',
    },
    'match',
  );
  await waitForHttp(`http://127.0.0.1:${MATCH_PORT}/health`, 'the match server');
  await waitForFleet();

  return async () => {
    for (const c of [match, allocator]) if (c.exitCode === null) c.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    for (const c of [match, allocator]) if (c.exitCode === null) c.kill('SIGKILL');
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const stop = await startFleet();
  console.log(`FLEET UP  allocator=${ALLOCATOR_URL}  match=${MATCH_URL}`);
  const bye = async () => {
    await stop();
    process.exit(0);
  };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}
