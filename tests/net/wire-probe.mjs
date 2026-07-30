/**
 * tests/net/wire-probe.mjs — the Director's wire probe, in the repo. OWNER:
 * Netcode Engineer (GDD §4.2; M10 machine-pin).
 *
 * Proves the socket-hop machine-pin against a LIVE fleet the exact way the real
 * client reaches one: allocate a room, dial the shared connectUrl, join, expect a
 * welcome — six times, because the bug it exists to catch is a *coin flip* (the Fly
 * edge lands the upgrade on one of N machines) and one success proves nothing. Each
 * miss under the old, un-armed pin came back `{"type":"joinError","reason":"bad-ticket"}`;
 * with MATCH_ROUTER="fly" armed on the gameserver the wrong machine replays the
 * upgrade to the room's host and every run should welcome.
 *
 * Dependency-free: Node's global `fetch` and global `WebSocket` (Node 22), nothing
 * imported. Not a vitest test — it needs the live network, which CI has no business
 * reaching — so it lives here as a script you run by hand:
 *
 *   node tests/net/wire-probe.mjs https://planet-rush-allocator.fly.dev
 *   node tests/net/wire-probe.mjs $ALLOCATOR_URL 6      # runs, count (default 6)
 *
 * Exit code 0 iff every run welcomed; non-zero (and a printed reason) otherwise, so
 * it can gate a deploy. Mirrors src/net/allocator-client.ts (POST /rooms) and
 * src/net/websocket-transport.ts (`?ticket=` on the dial URL) so it exercises the
 * real path, not a parallel one.
 */

const allocatorBase = (process.argv[2] ?? process.env.ALLOCATOR_URL ?? '').replace(/\/+$/, '');
const runs = Number(process.argv[3] ?? 6);
const PER_RUN_TIMEOUT_MS = 15_000;

if (!allocatorBase) {
  console.error('usage: node tests/net/wire-probe.mjs <allocator-base-url> [runs]');
  process.exit(2);
}

/** Add `?ticket=` to the dial URL exactly as WebSocketTransport.dialUrl does. */
function dialUrl(connectUrl, ticket) {
  try {
    const u = new URL(connectUrl);
    u.searchParams.set('ticket', ticket);
    return u.toString();
  } catch {
    return connectUrl;
  }
}

/** One allocate → dial → join → welcome round. Resolves a verdict, never rejects. */
async function probeOnce(i) {
  let res;
  try {
    res = await fetch(`${allocatorBase}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
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
    return { ok: false, where: 'allocate', detail: `missing room/ticket/connectUrl in ${JSON.stringify(body)}` };
  }

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
      resolve(verdict);
    };
    const timer = setTimeout(
      () => done({ ok: false, where: 'socket', detail: 'no welcome within timeout — the eternal-connecting symptom', room, machine }),
      PER_RUN_TIMEOUT_MS,
    );

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      return done({ ok: false, where: 'dial', detail: `WebSocket ctor threw: ${e?.message ?? e}`, room, machine });
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
      if (msg.type === 'welcome') done({ ok: true, room, machine, seat: msg.you });
      else if (msg.type === 'joinError') done({ ok: false, where: 'join', detail: `joinError: ${msg.reason}`, room, machine });
    };
    ws.onerror = () => done({ ok: false, where: 'socket', detail: 'socket error', room, machine });
    ws.onclose = () => done({ ok: false, where: 'socket', detail: 'closed before welcome', room, machine });
  });
}

const results = [];
for (let i = 0; i < runs; i++) {
  const r = await probeOnce(i);
  results.push(r);
  const line = r.ok
    ? `#${i + 1}  WELCOME   room=${r.room} machine=${r.machine ?? '?'} seat=${r.seat}`
    : `#${i + 1}  FAIL      [${r.where}] ${r.detail}` + (r.room ? `  room=${r.room} machine=${r.machine ?? '?'}` : '');
  console.log(line);
}

const wins = results.filter((r) => r.ok).length;
console.log(`\n${wins}/${runs} welcome`);
process.exit(wins === runs ? 0 : 1);
