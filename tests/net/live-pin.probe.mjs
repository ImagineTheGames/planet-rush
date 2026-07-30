#!/usr/bin/env node
/**
 * tests/net/live-pin.probe.mjs — the 6/6 wire probe, made permanent. OWNER:
 * Netcode Engineer (GDD §4.2; M10 join-pin regression).
 *
 * The Director's probe used to be a thing someone ran by hand against production
 * when a join felt wrong. That is how the machine-pin regression survived: the
 * gameserver image stopped building, the fleet kept serving a pre-pin server, and
 * the only instrument that could see it was a manual one nobody was pointing at
 * the fleet. So the probe now has a CI home and a fleet it can always reach.
 *
 * It does exactly what the browser does — `POST /rooms`, then dial the returned
 * `connectUrl` with `?ticket=` and send `join` — six times, because the failure it
 * exists to catch is a *coin flip* behind an anycast edge and one success proves
 * nothing.
 *
 *   node tests/net/live-pin.probe.mjs --local            # CI: local 2-machine fleet
 *   node tests/net/live-pin.probe.mjs --local 12         # …more rounds
 *   node tests/net/live-pin.probe.mjs https://planet-rush-allocator.fly.dev 6
 *
 * `--local` boots `./local-fleet.ts` (two Machines, a Fly-shaped edge, a real
 * allocator on the FlyReplayRouter) via `vite-node`, probes it, and shuts it down —
 * no network, no secrets, and the edge round-robins its first hop so both the
 * right-Machine and the wrong-Machine path are taken across the six rounds. Against
 * a live base URL it is the same six rounds against the real fleet.
 *
 * Exit code 0 iff every round welcomed; non-zero with the failing frame printed
 * otherwise, so it gates a deploy or a merge. Dependency-free: Node's global
 * `fetch` and global `WebSocket` (Node 22), nothing imported.
 *
 * Supersedes `./wire-probe.mjs` (kept for the live-only muscle memory); the
 * deterministic, both-hops-forced version of the same check is the vitest at
 * `./live-pin.test.ts`, which runs on every `npm test`.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PER_RUN_TIMEOUT_MS = 15_000;
const FLEET_BOOT_TIMEOUT_MS = 60_000;

const args = process.argv.slice(2);
const local = args.includes('--local');
const positional = args.filter((a) => !a.startsWith('--'));
const runs = Number(positional[local ? 0 : 1] ?? 6);
const liveBase = local ? null : (positional[0] ?? process.env.ALLOCATOR_URL ?? '').replace(/\/+$/, '');

if (!local && !liveBase) {
  console.error('usage: node tests/net/live-pin.probe.mjs (--local | <allocator-base-url>) [runs]');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// The local fleet (--local)
// ---------------------------------------------------------------------------

/**
 * Boot the two-Machine fleet in a child process and resolve its allocator base
 * URL, which `local-fleet.ts` prints as `ALLOCATOR <url>` once it is listening.
 * Its stdout is forwarded so a CI log shows which Machines were behind the edge.
 */
function startLocalFleet() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(HERE, '../../node_modules/vite-node/vite-node.mjs'), join(HERE, 'local-fleet.ts')],
      {
        cwd: join(HERE, '../..'),
        stdio: ['ignore', 'pipe', 'inherit'],
        env: { ...process.env, LOCAL_FLEET: 'serve' },
      },
    );
    let settled = false;
    let buffer = '';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('the local fleet did not come up within 60 s'));
    }, FLEET_BOOT_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      process.stdout.write(text.replace(/^/gm, '  | '));
      buffer += text;
      const allocator = /^ALLOCATOR (\S+)$/m.exec(buffer);
      const control = /^CONTROL\s+(\S+)$/m.exec(buffer);
      const machines = [...buffer.matchAll(/^MACHINE\s+(\S+)/gm)].map((m) => m[1]);
      // Wait for the whole banner: without the control URL and the machine list
      // the probe can only sample hops, which is the weakness that let the
      // regression through in the first place.
      if (allocator && control && machines.length >= 2 && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          base: allocator[1],
          control: control[1],
          machines,
          stop: () => child.kill('SIGTERM'),
        });
      }
    });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`the local fleet exited early (code ${code})`));
    });
  });
}

// ---------------------------------------------------------------------------
// One round: allocate -> dial -> join -> welcome
// ---------------------------------------------------------------------------

/** Add `?ticket=` to the dial URL exactly as `WebSocketTransport.dialUrl` does. */
function dialUrl(connectUrl, ticket) {
  try {
    const u = new URL(connectUrl);
    u.searchParams.set('ticket', ticket);
    return u.toString();
  } catch {
    return connectUrl;
  }
}

/**
 * Aim the local edge's next first hop at `machine` and reset its replay counter.
 * Returns the edge's view, or null when there is no edge to talk to (the live
 * fleet, where the hop belongs to Fly's anycast and nobody gets to choose).
 */
async function aimHop(control, machine) {
  if (!control) return null;
  try {
    const res = await fetch(`${control}?machine=${encodeURIComponent(machine)}&reset=1`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Read the edge's replay counter, or null against a live fleet. */
async function edgeReplays(control) {
  if (!control) return null;
  try {
    const res = await fetch(control);
    return res.ok ? (await res.json()).replays : null;
  } catch {
    return null;
  }
}

/** Allocate a room. Resolves `{ok:true, …body}` or a verdict naming the failure. */
async function allocate(base) {
  let res;
  try {
    res = await fetch(`${base}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ size: 2 }),
    });
  } catch (e) {
    return { ok: false, where: 'allocate', detail: `fetch threw: ${e?.message ?? e}` };
  }
  if (res.status !== 201 && res.status !== 200) {
    return { ok: false, where: 'allocate', detail: `HTTP ${res.status}` };
  }
  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, where: 'allocate', detail: 'body was not JSON' };
  }
  const { room, ticket, connectUrl, machine } = body;
  if (!room || !ticket || !connectUrl) {
    return {
      ok: false,
      where: 'allocate',
      detail: `missing room/ticket/connectUrl in ${JSON.stringify(body)}`,
    };
  }

  return { ok: true, room, ticket, connectUrl, machine };
}

/** Dial an allocation the way the browser does and wait for the seat. Resolves a
 *  verdict, never rejects. */
async function dialAndJoin({ room, ticket, connectUrl, machine }) {
  return await new Promise((resolve) => {
    const url = dialUrl(connectUrl, ticket);
    let settled = false;
    const done = (verdict) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closing */
      }
      resolve({ room, machine, ...verdict });
    };
    const timer = setTimeout(
      () =>
        done({
          ok: false,
          where: 'socket',
          detail: 'no welcome within timeout — the eternal-connecting symptom',
        }),
      PER_RUN_TIMEOUT_MS,
    );

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      return done({ ok: false, where: 'dial', detail: `WebSocket ctor threw: ${e?.message ?? e}` });
    }
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join', room, ticket }));
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return; // snapshots are binary; ignore here
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'welcome') done({ ok: true, seat: msg.you });
      // The frame this whole probe exists to catch, printed verbatim so a report
      // can be pasted without paraphrase.
      else if (msg.type === 'joinError') {
        done({ ok: false, where: 'join', detail: JSON.stringify(msg) });
      }
    };
    ws.onerror = () => done({ ok: false, where: 'socket', detail: 'socket error' });
    ws.onclose = () => done({ ok: false, where: 'socket', detail: 'closed before welcome' });
  });
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

let fleet = null;
if (local) {
  console.log('booting the local 2-machine fleet (allocator + Fly-shaped edge)…');
  fleet = await startLocalFleet();
}
const base = local ? fleet.base : liveBase;
const control = local ? fleet.control : null;
console.log(`probing ${base} — ${runs} rounds\n`);

const results = [];
for (let i = 0; i < runs; i++) {
  const room = await allocate(base);
  if (!room.ok) {
    results.push(room);
    console.log(`#${i + 1}  FAIL      [${room.where}] ${room.detail}`);
    continue;
  }

  // On the local fleet the first hop is CHOSEN, alternating between the Machine
  // that hosts the room and the one that does not — so half these rounds take the
  // wrong-Machine path on purpose. On the live fleet nobody gets to choose: Fly's
  // anycast picks, which is why six rounds and not one.
  let aimed = null;
  if (control) {
    const other = fleet.machines.find((m) => m !== room.machine) ?? room.machine;
    aimed = i % 2 === 0 ? room.machine : other;
    await aimHop(control, aimed);
  }

  const r = await dialAndJoin(room);
  const replays = await edgeReplays(control);
  results.push({ ...r, aimed, replays });
  const hop = aimed ? `  hop=${aimed === room.machine ? 'HOST' : 'WRONG'} replays=${replays ?? '?'}` : '';
  console.log(
    r.ok
      ? `#${i + 1}  WELCOME   room=${r.room} machine=${r.machine ?? '?'} seat=${r.seat}${hop}`
      : `#${i + 1}  FAIL      [${r.where}] ${r.detail}` +
          (r.room ? `  room=${r.room} machine=${r.machine ?? '?'}${hop}` : ''),
  );
}

const wins = results.filter((r) => r.ok).length;
const hosts = [...new Set(results.map((r) => r.machine).filter(Boolean))];
const wrongHops = results.filter((r) => r.aimed && r.aimed !== r.machine).length;
console.log(`\n${wins}/${runs} welcome`);
console.log(`rooms were placed on ${hosts.length} machine(s): ${hosts.join(', ') || '(none reported)'}`);
if (control) {
  const replayed = results.filter((r) => (r.replays ?? 0) > 0).length;
  console.log(`${wrongHops}/${runs} rounds landed on the WRONG machine first; ${replayed} were replayed to the host`);
  if (wrongHops > replayed) {
    console.log('  ↳ a wrong hop that was NOT replayed is the pin shipping dead (M10) — see docs/hosting-plan.md.');
  }
}
// A green run that never took the wrong hop proves nothing about the pin — and
// reading such a run as if it did is exactly how the regression went unnoticed.
const provedThePin = control ? wrongHops > 0 : hosts.length >= 2;
if (!provedThePin) {
  console.log('NOTE: no round exercised the machine-pin (single machine, or no wrong hop taken).');
}

fleet?.stop();
process.exit(wins === runs && provedThePin ? 0 : 1);
