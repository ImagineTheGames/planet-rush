/**
 * evidence/probe-ws-reclaim.mjs — QA stethoscope on the LIVE mid-match RECLAIM.
 * OWNER: QA Manager.
 *
 * Bypasses the client session/transport entirely and speaks the wire protocol by
 * hand, so the verdict is the SERVER's behaviour, not a harness artefact:
 *
 *   1. allocate a room (POST /rooms → 201), dial wss /play?ticket, JSON `join`,
 *      retrying past the flaky machine-pin until a `welcome` lands. Capture the
 *      seat (`you`) and the `reclaimToken` the welcome issues.
 *   2. `startMatch`; watch `matchStart` + binary snapshots arrive (match live).
 *   3. HANG UP the socket — a network blip, no goodbye.
 *   4. redial (retrying past the pin) and send `join` carrying reclaim + token,
 *      exactly as src/net/websocket-transport.ts `sendJoin` does on a redial.
 *   5. record every frame the reclaim dial gets: a real reclaim is
 *      welcome → matchStart(tick>0) → snapshot, and the room broadcasts
 *      `playerReclaimed`. A welcome with NO matchStart is the seat not resuming.
 *
 * Writes evidence/images/r2-reclaim-wire.json. Text frames are JSON; binary
 * frames are snapshots (counted, not decoded).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'images');
const ALLOCATOR = 'https://planet-rush-allocator.fly.dev';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function allocate() {
  const r = await fetch(`${ALLOCATOR}/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (r.status !== 201 && r.status !== 200) throw new Error(`allocate ${r.status}`);
  return r.json();
}

/**
 * Dial the gameserver and send `join` (optionally a reclaim). Resolve with the
 * live socket + the frames seen once `welcome` arrives; reject on bad-ticket /
 * close so the caller can redial past the machine-pin miss.
 */
function dialOnce(conn, joinExtra, onFrame) {
  return new Promise((resolve, reject) => {
    const url = new URL(conn.connectUrl);
    url.searchParams.set('ticket', conn.ticket);
    const ws = new WebSocket(url.toString());
    ws.binaryType = 'arraybuffer';
    let welcomed = false;
    const t = setTimeout(() => { if (!welcomed) { try { ws.close(); } catch {} reject(new Error('timeout')); } }, 6000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', room: conn.room, ticket: conn.ticket, ...joinExtra }));
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        const m = JSON.parse(ev.data);
        onFrame?.(m.type, m);
        if (m.type === 'welcome') { welcomed = true; clearTimeout(t); resolve({ ws, welcome: m }); }
        if (m.type === 'joinError') { clearTimeout(t); try { ws.close(); } catch {} reject(new Error('joinError:' + m.reason)); }
      } else {
        onFrame?.('snapshot', null);
      }
    };
    ws.onclose = () => { if (!welcomed) { clearTimeout(t); reject(new Error('closed')); } };
    ws.onerror = () => {};
  });
}

async function dialUntilWelcome(conn, joinExtra, onFrame, maxTries = 30) {
  for (let i = 1; i <= maxTries; i++) {
    try { return { ...(await dialOnce(conn, joinExtra, onFrame)), dials: i }; }
    catch { await sleep(150); }
  }
  throw new Error('never welcomed after ' + maxTries + ' dials');
}

async function main() {
  const out = { probe: 'reclaim-wire', allocator: ALLOCATOR, capturedAt: new Date().toISOString() };
  const conn = await allocate();
  out.room = conn.room;
  out.machine = conn.machine;

  // --- 1 · first connect, capture seat + reclaim token --------------------
  const firstFrames = [];
  const first = await dialUntilWelcome(conn, {}, (type) => { if (firstFrames.length < 40) firstFrames.push(type); });
  out.firstWelcomeDials = first.dials;
  out.seat = first.welcome.you;
  out.reclaimToken = first.welcome.reclaimToken ? first.welcome.reclaimToken.slice(0, 8) + '…' : null;
  const reclaimToken = first.welcome.reclaimToken;

  // --- 2 · start the match, let it tick -----------------------------------
  let firstSnapshots = 0;
  first.ws.onmessage = (ev) => { if (typeof ev.data !== 'string') firstSnapshots++; };
  first.ws.send(JSON.stringify({ type: 'lobbyChoice', shipClass: 0, fireMode: 0 }));
  first.ws.send(JSON.stringify({ type: 'startMatch' }));
  await sleep(4000);
  out.firstSnapshots = firstSnapshots;
  out.matchWentLive = firstSnapshots > 0;

  // --- 3 · the drop: hang up, no goodbye ----------------------------------
  first.ws.close();
  await sleep(1500);

  // --- 4 · the return: redial with reclaim + token ------------------------
  const reclaimFrames = [];
  let reclaimSnapshots = 0;
  let sawReclaimBroadcast = false;
  let sawMatchStart = false;
  let matchStartTick = null;
  const reclaim = await dialUntilWelcome(
    conn,
    { reclaim: out.seat, reclaimToken },
    (type, m) => {
      if (reclaimFrames.length < 60) reclaimFrames.push(type);
      if (type === 'snapshot') reclaimSnapshots++;
      if (type === 'matchStart') { sawMatchStart = true; matchStartTick = m.tick; }
      if (type === 'playerReclaimed') sawReclaimBroadcast = true;
    },
  );
  out.reclaimWelcomeDials = reclaim.dials;
  out.reclaimWelcomeSeat = reclaim.welcome.you;
  // Let the reclaim's follow-on frames arrive.
  reclaim.ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      const m = JSON.parse(ev.data);
      if (reclaimFrames.length < 60) reclaimFrames.push(m.type);
      if (m.type === 'matchStart') { sawMatchStart = true; matchStartTick = m.tick; }
      if (m.type === 'playerReclaimed') sawReclaimBroadcast = true;
    } else reclaimSnapshots++;
  };
  await sleep(4000);

  out.reclaimFrames = reclaimFrames;
  out.reclaimSnapshots = reclaimSnapshots;
  out.reclaimSawMatchStart = sawMatchStart;
  out.reclaimMatchStartTick = matchStartTick;
  out.reclaimBroadcastSeen = sawReclaimBroadcast;
  out.VERDICT = sawMatchStart && reclaimSnapshots > 0
    ? 'RECLAIM-RESUMED-MATCH'
    : (reclaim.welcome ? 'WELCOMED-BUT-MATCH-DID-NOT-RESUME' : 'NO-WELCOME');
  reclaim.ws.close();

  writeFileSync(join(OUT, 'r2-reclaim-wire.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
