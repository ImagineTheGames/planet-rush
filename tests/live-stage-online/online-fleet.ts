/**
 * tests/live-stage-online/online-fleet.ts — a REAL fleet, on this machine, for the
 * online half of the live-stage suite. OWNER: Gameplay Engineer (the ratified
 * unified play flow, item 5; GDD §4.2).
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Every other live-stage spec runs against the OFFLINE artifact — a bundle built
 * with no `VITE_ALLOCATOR_URL`, which has no allocator to reach — so the most the
 * online door could ever prove there was that CREATE ROOM fails *gracefully*
 * (`../live-stage/online-flow.spec.ts`, `../live-stage/unified-play-flow.spec.ts`).
 * The ratified flow's
 * item 5 asks for more than that: PLAY → CREATE ROOM → configure → **code
 * visible** → a second client joins → start → in-match, walked in a real browser
 * with real input.
 *
 * That needs three processes, and all three are the SHIPPED ones — nothing here
 * is a stub:
 *
 *   1. the match server  (`server/dist/match-server.mjs`, from `server/index.ts`)
 *   2. the allocator     (`allocator/dist/allocator.mjs`, from `allocator/index.ts`)
 *   3. the client bundle built with `VITE_ALLOCATOR_URL` pointed at (2), served
 *      by `vite preview` — wired by `./playwright.config.ts`
 *
 * The two servers are bundled and spawned here, as a Playwright `globalSetup`,
 * and torn down by the function this module returns. The match server registers
 * with the allocator over the same authenticated fleet routes a deployed Machine
 * uses (`X-Fleet-Auth`, `src/net/fleet-auth.ts`), and the allocator routes rooms
 * straight back to it — `ALLOCATOR_ROUTER=direct`, which is the mode the hosting
 * plan documents for anything that is not Fly's edge. The browser therefore
 * reaches the room the way a classroom does: allocator decision → signed ticket →
 * socket, with no hard-coded server URL in the client.
 *
 * PORTS ARE FIXED AND STRICT
 * ---------------------------------------------------------------------------
 * The client's allocator URL is baked in at BUILD time, so the allocator's port
 * cannot be ephemeral. All three ports are pinned and every listener is strict:
 * a clash fails the run loudly rather than quietly testing the wrong process.
 * They are deliberately not 8080/4173 — nothing here collides with a dev server
 * or with the offline live-stage suite's preview.
 */
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

/** The match server: the room host the browser opens its socket to. */
export const MATCH_PORT = 8791;
/** The allocator: the control plane the browser asks for a room. */
export const ALLOCATOR_PORT = 8792;
/** `vite preview`, serving the online-flavoured client bundle. */
export const PREVIEW_PORT = 4174;

export const ALLOCATOR_URL = `http://127.0.0.1:${ALLOCATOR_PORT}`;
export const MATCH_URL = `ws://127.0.0.1:${MATCH_PORT}/`;
export const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

/** Where the online-flavoured client bundle is built to — its own directory, so a
 *  run of this suite never overwrites the OFFLINE artifact in `dist/` that the
 *  rest of the live-stage suite (and the shipped build) asserts against. */
export const ONLINE_OUT_DIR = 'dist-online-stage';

/** The allocator↔Machine shared secret. A test fleet's secret is a constant, and
 *  it being a constant is itself part of the test: the server and the allocator
 *  must AGREE, and a mismatch must fail closed (401) rather than admit. */
const FLEET_SECRET = 'live-stage-local-fleet';

const repoRoot = resolve(import.meta.dirname, '..', '..');

/** Build one of the two server bundles with the config it ships with. Throws — a
 *  target that does not build must not be silently skipped. */
function build(config: string, out: string): void {
  const result = spawnSync('npx', ['vite', 'build', '--config', config], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) throw new Error(`failed to build ${out} (${config})`);
}

/** Poll an HTTP endpoint until it answers, or give up. Used for both processes'
 *  `/health` — the same plain-HTTP liveness route a host checker uses. */
async function waitForHttp(url: string, what: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'never answered';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (e) {
      lastError = String(e);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${what} never came up at ${url}: ${lastError}`);
}

/** Wait until the allocator has a Machine registered — otherwise the first
 *  `POST /rooms` is answered "no capacity" and the browser sees a refusal that
 *  has nothing to do with the flow under test. */
async function waitForFleet(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${ALLOCATOR_URL}/machines`);
      if (res.ok) {
        const body = (await res.json()) as { machines?: unknown[] };
        if ((body.machines ?? []).length > 0) return;
      }
    } catch {
      // Not up yet; the health wait above already bounds that case.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('no Machine registered with the allocator — the fleet never formed');
}

/** Spawn a bundled server, inheriting stderr so a crash is readable in the run. */
function launch(entry: string, env: Record<string, string>): ChildProcess {
  const child = spawn(process.execPath, [entry], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(`[fleet] ${String(chunk)}`);
  });
  return child;
}

/**
 * Stand the fleet up. Playwright runs this once, before the suite, and awaits the
 * teardown function it returns once the suite is done.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  build('allocator/vite.allocator.config.ts', 'allocator/dist/allocator.mjs');
  build('server/vite.server.config.ts', 'server/dist/match-server.mjs');

  // The allocator first: the match server announces itself to it on boot.
  const allocator = launch('allocator/dist/allocator.mjs', {
    PORT: String(ALLOCATOR_PORT),
    HOST: '127.0.0.1',
    ALLOCATOR_SECRET: FLEET_SECRET,
    // A fixed mint seed makes the run reproducible — the codes a failed run shows
    // are the codes a re-run mints.
    ALLOCATOR_SEED: '7',
    ALLOCATOR_ROUTER: 'direct',
    // One Machine in this fleet, and the client dials it by loopback address.
    MATCH_URL_TEMPLATE: MATCH_URL,
  });
  await waitForHttp(`${ALLOCATOR_URL}/health`, 'the allocator');

  const match = launch('server/dist/match-server.mjs', {
    PORT: String(MATCH_PORT),
    HOST: '127.0.0.1',
    MATCH_SEED: '11',
    // Both set = a fleet Machine: it enforces the allocator's tickets and beats
    // its rooms back, exactly as a deployed one does.
    TICKET_SECRET: FLEET_SECRET,
    ALLOCATOR_URL,
    MACHINE_ID: 'm-live-stage',
    REGION: 'local',
  });
  await waitForHttp(`http://127.0.0.1:${MATCH_PORT}/health`, 'the match server');
  await waitForFleet();

  return async (): Promise<void> => {
    // SIGTERM, not SIGKILL: both processes have graceful shutdowns worth exercising
    // (the match server deregisters, so the fleet does not keep a phantom host).
    for (const child of [match, allocator]) {
      if (child.exitCode === null) child.kill('SIGTERM');
    }
    await new Promise((r) => setTimeout(r, 500));
    for (const child of [match, allocator]) {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  };
}
