/**
 * evidence/probe-ws-join-batch.mjs — is the live match-socket join failure
 * DETERMINISTIC (secret mismatch) or INTERMITTENT (fly-replay machine pin not
 * landing on the ticket's named instance)? Allocate N rooms, dial each ticketed
 * WS, record welcome vs joinError + the machine each ticket names.
 */
const ALLOCATOR = 'https://planet-rush-allocator.fly.dev';
const N = Number(process.argv[2] ?? 8);

function b64urlJson(seg) {
  try { return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8')); } catch { return null; }
}

async function attempt(i) {
  const r = await fetch(`${ALLOCATOR}/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const conn = await r.json();
  const claims = b64urlJson(conn.ticket.split('.')[0]);
  const url = new URL(conn.connectUrl);
  url.searchParams.set('ticket', conn.ticket);
  const result = await new Promise((resolve) => {
    const ws = new WebSocket(url.toString());
    ws.binaryType = 'arraybuffer';
    let first = null;
    const t = setTimeout(() => { try { ws.close(); } catch {} resolve(first ?? 'timeout'); }, 8000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join', room: conn.room, ticket: conn.ticket }));
    ws.onmessage = (ev) => {
      if (first) return;
      if (typeof ev.data === 'string') {
        try { first = JSON.parse(ev.data).type + (JSON.parse(ev.data).reason ? ':' + JSON.parse(ev.data).reason : ''); }
        catch { first = 'text'; }
      } else first = 'snapshot';
      clearTimeout(t); try { ws.close(); } catch {} resolve(first);
    };
    ws.onclose = () => { clearTimeout(t); resolve(first ?? 'closed-no-msg'); };
    ws.onerror = () => {};
  });
  return { i, room: conn.room, ticketMachine: claims?.machine, result };
}

const rows = [];
for (let i = 0; i < N; i++) {
  const row = await attempt(i);
  rows.push(row);
  console.log(`#${i} room=${row.room} ticketMachine=${row.ticketMachine} -> ${row.result}`);
}
const welcomes = rows.filter((r) => r.result === 'welcome').length;
console.log(`\nSUMMARY: ${welcomes}/${N} welcome; ${N - welcomes}/${N} failed`);
console.log('ticket machines seen:', [...new Set(rows.map((r) => r.ticketMachine))].join(', '));
