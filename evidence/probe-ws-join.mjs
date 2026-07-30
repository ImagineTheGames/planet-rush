/**
 * evidence/probe-ws-join.mjs — QA stethoscope on the LIVE match socket hop.
 * Allocate a room (201 JSON), then dial the gameserver exactly as the shipped
 * transport does: wss://…/play?ticket=<ticket>, and send the same JSON join the
 * client sends on open ({type:'join', room, ticket}). Print every frame back.
 */
const ALLOCATOR = 'https://planet-rush-allocator.fly.dev';

const r = await fetch(`${ALLOCATOR}/rooms`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
});
const conn = await r.json();
console.log('allocate POST /rooms ->', r.status, JSON.stringify(conn));

const base = conn.connectUrl;
const url = new URL(base);
url.searchParams.set('ticket', conn.ticket);
console.log('dialing', url.toString().slice(0, 80) + '…(ticket)');

await new Promise((resolve) => {
  const ws = new WebSocket(url.toString());
  ws.binaryType = 'arraybuffer';
  const done = (why) => { console.log('closing:', why); try { ws.close(); } catch {} resolve(); };
  const t = setTimeout(() => done('TIMEOUT 15s'), 15_000);
  ws.onopen = () => {
    console.log('socket OPEN; sending join');
    ws.send(JSON.stringify({ type: 'join', room: conn.room, ticket: conn.ticket }));
    // A short while later, send the lobby choice + startMatch as the client would.
    setTimeout(() => {
      console.log('sending lobbyChoice + startMatch');
      ws.send(JSON.stringify({ type: 'lobbyChoice', shipClass: 0, fireMode: 0 }));
      ws.send(JSON.stringify({ type: 'startMatch' }));
    }, 1000);
  };
  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') console.log('MSG(text):', ev.data.slice(0, 200));
    else console.log('MSG(binary):', ev.data.byteLength, 'bytes (snapshot)');
  };
  ws.onerror = (e) => console.log('WS ERROR', e?.message ?? e?.type ?? '');
  ws.onclose = (e) => { clearTimeout(t); console.log('WS CLOSE code=', e.code, 'reason=', e.reason); resolve(); };
});
console.log('probe done');
