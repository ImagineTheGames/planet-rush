/**
 * evidence/probe-wire-orders.mjs — WHICH SPEND ORDERS SURVIVE THE ONLINE WIRE.
 * OWNER: QA Manager.
 *
 * Written because the reconnect gate's transcript said something stranger than
 * "the wallet did not come back": on a fleet built from HEAD the reclaim welcome
 * DID carry a wallet, and the wallet said the player had never bought anything —
 * `banked 3, every tier 0` — while that same player's own screen had shown the
 * purchase land and hold for hundreds of ticks. Only one of those can be true, so
 * this probe asks the SERVER directly, on the raw wire, with no client in the way.
 *
 * HOW IT ASKS
 * ---------------------------------------------------------------------------
 * Hand-built JSON frames on a real socket (`allocate → dial → join → welcome →
 * startMatch → input`), then it listens for the server's OWN `economy` frames —
 * the authoritative wallet channel `src/net/transport.ts` added in #241, which is
 * emitted on the ticks authority moves the wallet. If a spend order reaches the
 * sim, authority's banked ore falls and says so on that channel. If it does not,
 * nothing moves, and the silence is the finding.
 *
 * Each order gets its OWN room, so one refusal cannot poison another's reading.
 * A ship spawns docked at its home station, so every order under test is legal
 * from the spawn frame: no flying, no staging, no seams.
 *
 * Usage:
 *   node evidence/probe-wire-orders.mjs http://127.0.0.1:8892     # a HEAD fleet
 *   node evidence/probe-wire-orders.mjs https://planet-rush-allocator.fly.dev
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'images');
mkdirSync(OUT, { recursive: true });

const base = (process.argv[2] ?? 'http://127.0.0.1:8892').replace(/\/+$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every spend the shipped UI can issue, one per room. `expect` is what the GDD
 *  and the sim say should happen; the probe reports what the SERVER did. */
const TURRET = { type: 'buildOrder', item: 'turret' };
const ORDERS = [
  // 1. The control. A TURRET costs 3 and a ship spawns with exactly 3 banked, so
  //    "banked fell to 0" is authority saying it received, validated and charged
  //    an order sent from this probe. Everything below is read against it.
  { name: 'A. buildOrder:turret (control)', actions: [TURRET] },

  // 2. Each verb ALONE. Silence here is ambiguous — an order can also fail to
  //    charge because it is unaffordable (SHIELD 5, SATELLITE 6, both above the
  //    3 a ship spawns with) or because it is a no-op (BANK with an empty hold).
  //    Only the CARGO upgrade is unambiguous alone: it costs 2 of 3.
  { name: 'B. buildOrder:shield alone', actions: [{ type: 'buildOrder', item: 'shield' }] },
  { name: 'C. buildOrder:satellite alone', actions: [{ type: 'buildOrder', item: 'satellite' }] },
  { name: 'D. upgradeOrder:cargo alone', actions: [{ type: 'upgradeOrder', track: 'cargo' }] },

  // 3. THE DECISIVE FORM, and it costs nothing to reason about. `parseActions`
  //    validates a tick's whole action list and, on one bad action, rejects the
  //    ENTIRE message ("a partially-applied tick is a worse lie than a missing
  //    one"). So pairing a suspect verb with the control turret answers a
  //    question affordability cannot muddy: if the turret is STILL charged, the
  //    message crossed and the suspect verb is merely unaffordable or a no-op;
  //    if the turret is NOT charged, the suspect verb took the whole message
  //    down with it and CANNOT cross this wire at all.
  { name: 'E. turret + thrust (control pair)', actions: [TURRET, { type: 'thrust', dir: { x: 1, y: 0 } }] },
  { name: 'F. turret + upgradeOrder:cargo', actions: [TURRET, { type: 'upgradeOrder', track: 'cargo' }] },
  { name: 'G. turret + buildOrder:satellite', actions: [TURRET, { type: 'buildOrder', item: 'satellite' }] },
  { name: 'H. turret + buildOrder:shield', actions: [TURRET, { type: 'buildOrder', item: 'shield' }] },
  { name: 'I. turret + buildOrder:repair', actions: [TURRET, { type: 'buildOrder', item: 'repair' }] },
];

function dialUrl(connectUrl, ticket) {
  try {
    const u = new URL(connectUrl);
    u.searchParams.set('ticket', ticket);
    return u.toString();
  } catch {
    return connectUrl;
  }
}

async function allocate() {
  const res = await fetch(`${base}/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (res.status !== 200 && res.status !== 201) throw new Error(`allocate HTTP ${res.status}`);
  return res.json();
}

/** Run one order in its own room. Resolves a verdict; never rejects. */
async function probeOrder(order, dialsAllowed = 8) {
  for (let dial = 1; dial <= dialsAllowed; dial++) {
    const room = await allocate();
    const verdict = await new Promise((resolve) => {
      const record = { order: order.name, room: room.room, machine: room.machine, dial };
      const economies = [];
      let seat = null;
      let tick = 0;
      let started = false;
      let seq = 0;
      let pump = null;
      let settled = false;
      const done = (extra) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (pump) clearInterval(pump);
        try {
          ws.close();
        } catch {
          /* already closing */
        }
        resolve({ ...record, economies, ...extra });
      };
      const timer = setTimeout(() => done({ result: 'timeout' }), 25_000);
      const ws = new WebSocket(dialUrl(room.connectUrl, room.ticket));
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => ws.send(JSON.stringify({ type: 'join', room: room.room, ticket: room.ticket }));
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return; // snapshots are binary
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (m.type === 'joinError') return done({ result: 'joinError', reason: m.reason });
        if (m.type === 'welcome') {
          seat = m.you;
          record.seat = seat;
          ws.send(JSON.stringify({ type: 'startMatch' }));
          return;
        }
        if (m.type === 'matchStart') {
          started = true;
          tick = m.tick ?? 0;
          record.matchStartTick = tick;
          // Send the order every frame for three seconds. One-shot orders are
          // acted on for the tick they arrive in, so repetition only means "the
          // server had many chances", never "it was charged many times" — the
          // wallet channel below is what says whether it was charged at all.
          pump = setInterval(() => {
            tick += 1;
            ws.send(JSON.stringify({ type: 'input', tick, seq: seq++, actions: order.actions }));
          }, 33);
          setTimeout(() => done({ result: 'ran' }), 3_500);
          return;
        }
        if (m.type === 'economy') {
          if (m.player === seat || m.economy) economies.push({ tick: m.tick, player: m.player, economy: m.economy });
        }
      };
      ws.onerror = () => done({ result: 'socketError', started });
      ws.onclose = () => done({ result: settled ? 'closed' : 'closedEarly', started });
    });
    if (verdict.result === 'ran') return verdict;
    if (verdict.result !== 'joinError') return verdict; // a real failure, not the pin
    // A `joinError: bad-ticket` on a multi-Machine Fly fleet is the un-armed
    // socket-hop pin, not an answer about the order. Re-dial a fresh room.
    await sleep(200);
  }
  return { order: order.name, result: 'never-welcomed (machine-pin)' };
}

const results = [];
for (const order of ORDERS) {
  const v = await probeOrder(order);
  // What authority's own wallet channel ended up saying about this seat.
  const mine = v.economies?.filter((e) => e.player === v.seat) ?? [];
  const last = mine.at(-1)?.economy ?? null;
  v.walletFrames = mine.length;
  v.finalWallet = last;
  v.authorityCharged = last ? last.banked !== 3 || Object.values(last.tiers ?? {}).some((n) => n > 0) : false;
  delete v.economies;
  results.push(v);
  console.log(
    `${String(v.order).padEnd(38)} ${String(v.result).padEnd(12)} walletFrames=${v.walletFrames} ` +
      `final=${JSON.stringify(v.finalWallet)} charged=${v.authorityCharged}`,
  );
}

const out = { probe: 'wire-orders', allocator: base, capturedAt: new Date().toISOString(), results };
writeFileSync(join(OUT, 'online-final-wire-orders.json'), JSON.stringify(out, null, 2));
console.log(`\nwrote evidence/images/online-final-wire-orders.json`);
