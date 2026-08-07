/**
 * tests/net/capacity/ramp-cli.ts — run a capacity ramp and print its evidence.
 * OWNER: Netcode Engineer (m11 server stress; GDD §4.2).
 *
 *   # against a locally spawned copy of the shipped bundle
 *   npx vite-node tests/net/capacity/ramp-cli.ts -- --local --max 48
 *
 *   # against a throwaway Fly Machine, through its allocator (the real door)
 *   npx vite-node tests/net/capacity/ramp-cli.ts -- \
 *     --allocator https://planet-rush-alloc-scratch.fly.dev \
 *     --health   https://planet-rush-gs-scratch.fly.dev/health \
 *     --max 64 --out docs/runs/shared-cpu-1x.md
 *
 *   # one fixed N, no ramp — for a soak or a "does 24 hold for an hour?"
 *   npx vite-node tests/net/capacity/ramp-cli.ts -- --local --rooms 24 --sample 600000
 *
 * The output IS the deliverable: a markdown block with the core it ran on, the
 * rooms-vs-lag table, and the guest/cost projection, ready to paste into
 * `docs/server-capacity.md`. A capacity number quoted without that block is the
 * guess this brief exists to replace.
 */

import { writeFileSync } from 'node:fs';
import { measureCoreSpeed } from './core-speed';
import { renderRampMarkdown, runCapacityRamp } from './capacity-ramp';
import type { RampOptions, RampResult, RampStep } from './capacity-ramp';
import { advertisedCapacity, projectFleet, renderGuestTable } from './guest-model';
import type { RoomCost } from './guest-model';
import { makeTarget } from './target';
import type { CapacityTarget } from './target';
import { startLocalServer } from './local-target';

/** `--flag value` and `--flag` (boolean) — no dependency, no surprises. */
function parseArgs(argv: readonly string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      args.set(key, next);
      i++;
    } else {
      args.set(key, 'true');
    }
  }
  return args;
}

function number(args: Map<string, string>, key: string): number | undefined {
  const raw = args.get(key);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${key} must be a number, got "${raw}"`);
  return value;
}

/** Turn a finished ramp into the cost inputs the guest model wants. Reads the
 *  *honest* step when there is one, and otherwise the last clean step — never a
 *  breached one, whose numbers describe a server already losing. */
function roomCostFrom(result: RampResult, coreSlowdown: number): RoomCost | null {
  const clean = result.steps.filter((s) => !s.breached && s.failures.length === 0);
  const step: RampStep | undefined =
    clean.find((s) => s.rooms === result.honestN) ?? clean[clean.length - 1];
  if (!step || step.cpuMsPerRoomPerSec === null) return null;
  const floorMsPerSec = (result.baseline.cpuPercentOfCore ?? 0) * 10;
  const floorRssMb = result.baseline.rssMb ?? 0;
  const rssMbPerRoom =
    step.rssMb !== null && step.rooms > 0 ? Math.max(0, (step.rssMb - floorRssMb) / step.rooms) : 0;
  return {
    cpuMsPerRoomPerSec: step.cpuMsPerRoomPerSec,
    floorMsPerSec,
    floorRssMb,
    rssMbPerRoom,
    coreSlowdown,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const log = (line: string): void => console.log(line);

  // A single fixed N is the same instrument with the ramp disabled: start at N,
  // step past the ceiling, so exactly one rung runs.
  const fixed = number(args, 'rooms');
  const rampOptions: RampOptions = {
    ...(fixed !== undefined
      ? { startRooms: fixed, step: 1, maxRooms: fixed }
      : {
          ...opt('start', number(args, 'start'), 'startRooms'),
          ...opt('step', number(args, 'step'), 'step'),
          ...opt('max', number(args, 'max'), 'maxRooms'),
        }),
    ...opt('settle', number(args, 'settle'), 'settleMs'),
    ...opt('sample', number(args, 'sample'), 'sampleMs'),
    ...opt('confirm', number(args, 'confirm'), 'confirmMs'),
    ...opt('limit', number(args, 'limit'), 'lagLimitMs'),
    ...opt('baseline', number(args, 'baseline'), 'baselineMs'),
    log,
  };

  // Measured FIRST, before anything else is spawned. The very first run of this
  // CLI stamped 0.0968 ms/step and every run since has stamped ~0.0152 — because
  // that run rebuilt the server bundle (a multi-core vite build) immediately
  // beforehand and timed the sim on a hot, contended box. The core stamp is only
  // worth having if it is taken on a quiet one.
  log(`measuring this core on the sim's own hot loop…`);
  const core = measureCoreSpeed();
  log(`  ${core.cpu} — ${core.msPerStep.toFixed(4)} ms per 8-station step`);

  const local = args.get('local') === 'true';
  let target: CapacityTarget;
  if (local) {
    log('spawning the shipped server bundle locally…');
    target = await startLocalServer({
      // Headroom above whatever the advertised ceiling is, or the ramp stops
      // being a measurement and starts being a test of `openRoom`'s refusal.
      maxRooms: number(args, 'server-max') ?? (rampOptions.maxRooms ?? 48) + 16,
      ...(args.get('pin') !== undefined ? { pinCpus: args.get('pin')! } : {}),
      ...(args.get('verbose') === 'true' ? { verbose: true } : {}),
    });
  } else {
    target = makeTarget({
      ...(args.get('allocator') !== undefined ? { allocator: args.get('allocator')! } : {}),
      ...(args.get('direct') !== undefined ? { direct: args.get('direct')! } : {}),
      ...(args.get('health') !== undefined ? { health: args.get('health')! } : {}),
      ...(args.get('region') !== undefined ? { region: args.get('region')! } : {}),
    });
  }

  try {
    const result = await runCapacityRamp(target, rampOptions);

    const slowdown = number(args, 'slowdown') ?? 1;
    const cost = roomCostFrom(result, slowdown);

    const report = [
      `## Capacity run — ${new Date().toISOString()}`,
      '',
      `**Core:** ${core.cpu} · ${core.msPerStep.toFixed(4)} ms per 8-station sim step ` +
        `(${core.worldsPerCore.toFixed(0)} worlds per core, sim only)`,
      '',
      renderRampMarkdown(result),
      '',
      ...(cost === null
        ? ['_No clean CPU reading — the guest projection needs a step that held the line with `cpuMs` present._']
        : [
            '### Rooms per guest, and what a room costs',
            '',
            renderGuestTable(projectFleet(cost), cost),
          ]),
      '',
      ...(result.honestN === null
        ? []
        : [
            `**Advertise:** \`capacity = ${advertisedCapacity(result.honestN)}\` ` +
              `(measured ${result.honestN}, less 25% margin).`,
          ]),
    ].join('\n');

    console.log('\n' + report + '\n');
    const out = args.get('out');
    if (out !== undefined && out !== 'true') {
      writeFileSync(out, report + '\n', 'utf8');
      log(`wrote ${out}`);
    }
  } finally {
    await target.stop();
  }
}

/** `{key: value}` when the value is there, `{}` when it is not — the shape
 *  `exactOptionalPropertyTypes` wants for an optional built from a flag. */
function opt(_flag: string, value: number | undefined, key: string): Record<string, number> {
  return value === undefined ? {} : { [key]: value };
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
