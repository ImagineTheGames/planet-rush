/**
 * tests/net/capacity/local-target.ts — the server under measurement, as a real
 * process. OWNER: Netcode Engineer (m11 server stress; GDD §4.2).
 *
 * **Why a child process when every other `tests/net/` fixture runs the server
 * in-process.** Those fixtures measure *behaviour*, and in-process is the right
 * trade for that: one event loop, one debugger, no build step. This measures
 * **event-loop lag**, and in-process is not merely imprecise for that, it is
 * meaningless — the harness's own 60 Hz driver, its socket reads and its
 * bookkeeping would all be sitting in the very loop whose lateness is the
 * result. The number would rise with harness cost and be reported as server cost.
 *
 * So the thing spawned here is the artifact the container runs: `node
 * server/dist/match-server.mjs`, the single bundled ESM file
 * `server/Dockerfile` copies in. A Docker run would wrap *this same file* in a
 * namespace; the CI subset skips the wrapper because Docker is not available on
 * every runner, and says so rather than pretending the wrapper was the point
 * (docs/server-capacity.md, "The CI-able subset").
 *
 * The bundle is rebuilt when it is older than any source it is built from, so a
 * ramp can never measure last week's server by accident — the single most
 * expensive mistake available here, and the one M10 already paid for once when
 * the gameserver image stopped building and production quietly reverted.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { deriveHealthUrl, makeTarget, readHealth } from './target';
import type { CapacityTarget } from './target';

const ROOT = resolve(import.meta.dirname, '../../..');
const BUNDLE = resolve(ROOT, 'server/dist/match-server.mjs');

/** Everything the bundle is built from. A change under any of these makes the
 *  bundle stale — `src/sim` and `src/bots` most of all, since a sim change is
 *  exactly the kind of change a capacity regression would come from. */
const SOURCE_DIRS = ['server', 'src/net', 'src/sim', 'src/bots', 'src/shared'];

/** How this local server is stood up. */
export interface LocalServerOptions {
  /** Room ceiling (`MAX_ROOMS`). A ramp needs headroom above the advertised one. */
  readonly maxRooms?: number;
  /** Fixed world seed, so two runs build the same arenas. */
  readonly seed?: number;
  /** `taskset -c` CPU list, e.g. `'0'` or `'0,1'`.
   *
   *  This bounds the server to that many cores; it is **not** a quota. A Fly
   *  shared-cpu-1x is 6.25% of a core sustained, which Linux enforces with cgroup
   *  CPU bandwidth, not affinity — nothing here emulates it. Pinning is here for
   *  a different and honest reason: it stops the measurement drifting with
   *  whatever else the dev box is doing on its other seven cores. The quota
   *  arithmetic lives in `./guest-model.ts` and is stated as arithmetic. */
  readonly pinCpus?: string;
  /** Print the child's stdout/stderr. Off by default — a ramp's own table is the
   *  output, and 40 rooms' worth of boot lines is not. */
  readonly verbose?: boolean;
}

/** A spawned server, plus the target the ramp points at it. */
export interface LocalServer extends CapacityTarget {
  readonly port: number;
  readonly pid: number | undefined;
}

/** Newest mtime under a directory tree, ms. Missing paths count as 0. */
function newestMtime(dir: string): number {
  let newest = 0;
  const walk = (path: string): void => {
    let entries;
    try {
      entries = readdirSync(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'dist' || entry.name === 'node_modules') continue;
        walk(child);
      } else if (entry.name.endsWith('.ts')) {
        newest = Math.max(newest, statSync(child).mtimeMs);
      }
    }
  };
  walk(dir);
  return newest;
}

/** Is `server/dist/match-server.mjs` older than anything it is built from? */
export function bundleIsStale(): boolean {
  let built: number;
  try {
    built = statSync(BUNDLE).mtimeMs;
  } catch {
    return true;
  }
  return SOURCE_DIRS.some((dir) => newestMtime(resolve(ROOT, dir)) > built);
}

/** Rebuild the server bundle with the same command the Dockerfile runs. */
export async function buildBundle(): Promise<void> {
  await new Promise<void>((done, fail) => {
    const build = spawn(
      'npx',
      ['vite', 'build', '--config', 'server/vite.server.config.ts', '--logLevel', 'warn'],
      { cwd: ROOT, stdio: 'inherit' },
    );
    build.on('error', fail);
    build.on('exit', (code) =>
      code === 0 ? done() : fail(new Error(`server bundle build exited ${code}`)),
    );
  });
}

/** A port nobody is listening on right now. Racy in principle, fine in practice,
 *  and far simpler than parsing the child's boot line out of its stdout. */
async function freePort(): Promise<number> {
  return new Promise((done) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => done(port));
    });
  });
}

/**
 * Build (if stale), spawn, and wait for `/health`. The returned object is a
 * {@link CapacityTarget} — the ramp cannot tell it from a Fly Machine, which is
 * the point: the same ramp code produces the local curve and the hosted one.
 */
export async function startLocalServer(options: LocalServerOptions = {}): Promise<LocalServer> {
  if (bundleIsStale()) await buildBundle();

  const port = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    // No TICKET_SECRET and no ALLOCATOR_URL: a solo Machine, which is what
    // `--direct` can talk to. Ticket enforcement costs one HMAC per *join* and
    // nothing per tick, so its absence does not flatter the curve.
    ...(options.maxRooms !== undefined ? { MAX_ROOMS: String(options.maxRooms) } : {}),
    ...(options.seed !== undefined ? { MATCH_SEED: String(options.seed) } : {}),
  };
  delete env['TICKET_SECRET'];
  delete env['ALLOCATOR_URL'];

  const command = options.pinCpus ? 'taskset' : process.execPath;
  const args = options.pinCpus
    ? ['-c', options.pinCpus, process.execPath, BUNDLE]
    : [BUNDLE];
  const child: ChildProcess = spawn(command, args, {
    cwd: ROOT,
    env,
    stdio: options.verbose ? 'inherit' : 'ignore',
  });

  const url = `ws://127.0.0.1:${port}/play`;
  const healthUrl = deriveHealthUrl(url);
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`match server exited ${child.exitCode} before answering /health`);
    }
    try {
      await readHealth(healthUrl);
      break;
    } catch {
      if (Date.now() > deadline) {
        child.kill('SIGKILL');
        throw new Error(`match server never answered ${healthUrl}`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const target = makeTarget({ direct: url, health: healthUrl });
  return {
    ...target,
    label: `local ${url}${options.pinCpus ? ` (taskset -c ${options.pinCpus})` : ''}`,
    port,
    pid: child.pid,
    stop: async (): Promise<void> => {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise<void>((done) => {
        const hard = setTimeout(() => {
          child.kill('SIGKILL');
          done();
        }, 5_000);
        hard.unref?.();
        child.on('exit', () => {
          clearTimeout(hard);
          done();
        });
      });
    },
  };
}
