/**
 * tests/live-stage/alarm-fleet.ts — a one-spec fleet: allocator, match server, and
 * an online-flavoured client bundle. OWNER: Sound Agent (s9-01).
 *
 * WHY THIS IS HERE AND NOT SHARED
 * ---------------------------------------------------------------------------
 * `./alarm-ownership-online.spec.ts` has to prove something that is only true in
 * an ONLINE match on a NON-ZERO slot: that the audio engine is listening as the
 * seat the server actually gave this client. The rest of this directory runs
 * against the OFFLINE artifact — a bundle built with no `VITE_ALLOCATOR_URL`,
 * which has no allocator to reach — so CREATE ROOM there can only refuse
 * gracefully, and the claim would be untestable.
 *
 * `../live-stage-online/` already solves that problem, with a Playwright
 * `globalSetup` on its own config. Two things stop this spec living there: the
 * definition of done for s9-01 names `npm run test:live-stage`, which is *this*
 * directory's config; and that suite's fleet is a global setup, which this
 * directory's config does not have and which is not mine to add. So the fleet is
 * stood up by the spec itself, in a `beforeAll`, and torn down in an `afterAll` —
 * the same three shipped processes, with its own ports and its own out-dir so the
 * two suites can never collide or overwrite each other's artifact.
 *
 * Everything spawned here is the SHIPPED thing; nothing is a stub:
 *   1. the match server  (`server/dist/match-server.mjs`, from `server/index.ts`)
 *   2. the allocator     (`allocator/dist/allocator.mjs`, from `allocator/index.ts`)
 *   3. the client bundle built with `VITE_ALLOCATOR_URL` pointed at (2), served
 *      by `vite preview`
 *
 * PORTS ARE FIXED AND STRICT, AND THAT IS THE FINGERPRINT
 * ---------------------------------------------------------------------------
 * The allocator URL is baked in at BUILD time, so its port cannot be ephemeral.
 * All three are pinned, distinct from the offline suite's 4173 and from
 * `../live-stage-online/`'s 8791/8792/4174, and every listener is strict — a
 * clash fails the run loudly rather than quietly testing the wrong process. That
 * matters more than usual here: preview ports are shared across working copies,
 * and a bundle served by somebody else's `vite preview` would be an offline
 * artifact with no allocator baked in, so this spec's CREATE ROOM would refuse
 * and the failure would name the door rather than the port. `strictPort` turns
 * that into the honest error instead.
 */
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

/** The match server: the room host the browsers open their sockets to. */
export const MATCH_PORT = 8795;
/** The allocator: the control plane the browsers ask for a room. */
export const ALLOCATOR_PORT = 8796;
/** `vite preview`, serving this spec's online-flavoured client bundle. */
export const PREVIEW_PORT = 4176;

export const ALLOCATOR_URL = `http://127.0.0.1:${ALLOCATOR_PORT}`;
export const MATCH_URL = `ws://127.0.0.1:${MATCH_PORT}/`;
/**
 * `127.0.0.1`, never `localhost`, and the preview is bound to the same — because
 * they are not the same address. Left to itself `vite preview` listens on IPv6
 * `::1`, Node's `fetch('http://localhost')` resolves `localhost` to `127.0.0.1`
 * first, and the readiness probe below gets `ECONNREFUSED` against a server that
 * is plainly printing its own URL to the log. Chromium and `curl` both fall back
 * across families and would not have noticed. Pinning both ends to one literal
 * address is what makes the wait mean "the server is up".
 */
export const PREVIEW_HOST = '127.0.0.1';
export const PREVIEW_URL = `http://${PREVIEW_HOST}:${PREVIEW_PORT}`;

/** Where this spec's client bundle is built to — its own directory, so a run
 *  never overwrites `dist/` (the offline artifact every other spec in this
 *  directory asserts against) or `dist-online-stage/`. */
export const OUT_DIR = 'dist-alarm-stage';

/** The allocator↔Machine shared secret. A test fleet's secret is a constant. */
const FLEET_SECRET = 'live-stage-alarm-fleet';

const repoRoot = resolve(import.meta.dirname, '..', '..');

/** Run a command to completion at the repo root, or throw naming it. */
function run(command: string, args: string[], env: Record<string, string> = {}): void {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) throw new Error(`failed: ${command} ${args.join(' ')}`);
}

/** Poll an HTTP endpoint until it answers — the same plain `/health` route a
 *  host checker uses. */
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
 *  has nothing to do with the thing under test. */
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

/** Spawn a long-lived process, inheriting stderr so a crash is readable. */
function launch(command: string, args: string[], env: Record<string, string>): ChildProcess {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: process.platform === 'win32',
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(`[alarm-fleet] ${String(chunk)}`);
  });
  return child;
}

/** Everything this fleet is holding open, for the teardown. */
export interface AlarmFleet {
  readonly baseURL: string;
  stop(): Promise<void>;
}

/**
 * Build and start the whole thing. Slow by construction — three builds and three
 * listeners — so the spec gives its `beforeAll` a generous timeout and runs its
 * assertions against one standing fleet rather than one per test.
 */
export async function startAlarmFleet(): Promise<AlarmFleet> {
  run('npx', ['vite', 'build', '--config', 'allocator/vite.allocator.config.ts']);
  run('npx', ['vite', 'build', '--config', 'server/vite.server.config.ts']);
  // The client, with the allocator URL baked in (`src/net/allocator-client.ts`
  // reads it at BUILD time), into its own out-dir.
  run('npx', ['vite', 'build', '--outDir', OUT_DIR], { VITE_ALLOCATOR_URL: ALLOCATOR_URL });

  // The allocator first: the match server announces itself to it on boot.
  const allocator = launch(process.execPath, ['allocator/dist/allocator.mjs'], {
    PORT: String(ALLOCATOR_PORT),
    HOST: '127.0.0.1',
    ALLOCATOR_SECRET: FLEET_SECRET,
    ALLOCATOR_SEED: '19',
    ALLOCATOR_ROUTER: 'direct',
    MATCH_URL_TEMPLATE: MATCH_URL,
  });
  const match = launch(process.execPath, ['server/dist/match-server.mjs'], {
    PORT: String(MATCH_PORT),
    HOST: '127.0.0.1',
    MATCH_SEED: '23',
    TICKET_SECRET: FLEET_SECRET,
    ALLOCATOR_URL,
    MACHINE_ID: 'm-alarm-stage',
    REGION: 'local',
  });
  const preview = launch(
    'npx',
    [
      'vite',
      'preview',
      '--outDir',
      OUT_DIR,
      '--host',
      PREVIEW_HOST,
      '--port',
      String(PREVIEW_PORT),
      '--strictPort',
    ],
    {},
  );

  const children = [preview, match, allocator];
  const stop = async (): Promise<void> => {
    // SIGTERM, not SIGKILL: the match server deregisters on a graceful shutdown,
    // so the fleet does not keep a phantom host.
    for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  };

  try {
    await waitForHttp(`${ALLOCATOR_URL}/health`, 'the allocator');
    await waitForHttp(`http://127.0.0.1:${MATCH_PORT}/health`, 'the match server');
    await waitForFleet();
    await waitForHttp(PREVIEW_URL, 'the preview server');
  } catch (e) {
    await stop();
    throw e;
  }

  return { baseURL: PREVIEW_URL, stop };
}
