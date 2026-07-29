/**
 * evidence/probe-online-live.mjs — QA probe of the LIVE M3 deployment.
 *
 * Not a game module and not a test: a stethoscope. It talks to the real Fly
 * apps over the real internet exactly as a client would, and prints what the
 * wire says back. Read-only; opens one socket, one join, hangs up.
 *
 *   node evidence/probe-online-live.mjs
 */

const ALLOCATOR = 'https://planet-rush-allocator.fly.dev';
const GAMESERVER_WS = 'wss://planet-rush-gameserver.fly.dev/play';

async function j(label, url, init) {
  try {
    const r = await fetch(url, init);
    const body = await r.text();
    console.log(`${label}: HTTP ${r.status} ${body.slice(0, 400)}`);
    return { status: r.status, body };
  } catch (e) {
    console.log(`${label}: THREW ${e?.message ?? e}`);
    return { status: 0, body: '' };
  }
}

console.log('=== allocator health / regions ===');
await j('GET /health ', `${ALLOCATOR}/health`);
await j('GET /regions', `${ALLOCATOR}/regions`);

console.log('=== browser CORS reachability (what a real client hits first) ===');
// The browser sends a preflight before a cross-origin POST. If the allocator
// answers no Access-Control-Allow-Origin, the fetch throws before the app ever
// sees the 503 body. Print the preflight status + whether ANY ACAO comes back.
try {
  const pre = await fetch(`${ALLOCATOR}/rooms`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://planet-rush.example',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  const acao = pre.headers.get('access-control-allow-origin');
  console.log(`OPTIONS /rooms (preflight): HTTP ${pre.status} ACAO=${acao ?? '(absent)'}`);
} catch (e) {
  console.log(`OPTIONS /rooms (preflight): THREW ${e?.message ?? e}`);
}
try {
  const got = await fetch(`${ALLOCATOR}/health`, { headers: { Origin: 'https://planet-rush.example' } });
  console.log(`GET /health with Origin: HTTP ${got.status} ACAO=${got.headers.get('access-control-allow-origin') ?? '(absent)'}`);
} catch (e) {
  console.log(`GET /health with Origin: THREW ${e?.message ?? e}`);
}
console.log('=== allocate + join through the allocator ===');
await j('POST /rooms', `${ALLOCATOR}/rooms`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
});
await j('POST /rooms/ABCD/join', `${ALLOCATOR}/rooms/ABCD/join`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
});

console.log('=== direct-connect to the gameserver: ticketless join ===');
await new Promise((resolve) => {
  const ws = new WebSocket(GAMESERVER_WS);
  ws.binaryType = 'arraybuffer';
  const t = setTimeout(() => {
    console.log('direct-join: TIMEOUT (no reply in 12s)');
    try { ws.close(); } catch {}
    resolve();
  }, 12000);
  ws.onopen = () => {
    console.log('direct-join: socket OPEN, sending ticketless join {room:"PROBE"}');
    ws.send(JSON.stringify({ type: 'join', room: 'PROBE' }));
  };
  ws.onmessage = (ev) => {
    const d = ev.data;
    const text = typeof d === 'string' ? d : `<binary ${d.byteLength}b>`;
    console.log('direct-join: MESSAGE', text.slice(0, 400));
  };
  ws.onclose = (ev) => {
    clearTimeout(t);
    console.log(`direct-join: CLOSE code=${ev.code} reason=${JSON.stringify(ev.reason)}`);
    resolve();
  };
  ws.onerror = (ev) => {
    console.log('direct-join: ERROR', ev?.message ?? '(socket error)');
  };
});
console.log('=== probe done ===');
